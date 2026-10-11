// Integration tests: real HTTP server, temporary SQLite database, clearly-labelled sample/test data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { goodAssessment } from './helpers.js';

import { request } from 'node:http';
let server, base, dir;
const rawGet = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: server.address().port, path, method: 'GET' }, (res) => { let body = ''; res.on('data', (d) => (body += d)); res.on('end', () => resolve({ status: res.statusCode, body })); });
  req.on('error', reject); req.end();
});
const silent = { error: () => {} };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hit-test-'));
  ({ server } = createApp({ dbFile: join(dir, 'test.db'), log: silent }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, path, body, { raw, headers = {} } = {}) => {
    const h = { 'X-Requested-With': 'terminal', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (raw) { payload = raw; h['Content-Type'] = 'text/csv'; } else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}

const register = async (email) => { const c = client(); const r = await c.post('/api/auth/register', { email, password: 'correct-horse-42', name: 'Tester' }); assert.equal(r.status, 201); return c; };

test('auth: protected routes require a session; weak passwords rejected; login works', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/companies')).status, 401);
  assert.equal((await anon.post('/api/auth/register', { email: 'x@y.co', password: 'short' })).status, 400);
  const c = await register('a@test.dev');
  assert.equal((await c.get('/api/auth/me')).data.email, 'a@test.dev');
  const r = await client().post('/api/auth/login', { email: 'a@test.dev', password: 'wrong-password-1' });
  assert.equal(r.status, 401);
  const ok = client();
  const l = await ok.post('/api/auth/login', { email: 'a@test.dev', password: 'correct-horse-42' });
  assert.equal(l.status, 200);
  assert.match(l.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  await ok.post('/api/auth/logout');
  assert.equal((await ok.get('/api/companies')).status, 401);
});

test('security: CSRF header and same-origin enforced; headers set; no path traversal', async () => {
  const c = await register('csrf@test.dev');
  const res = await c.call('POST', '/api/watchlist', { companyId: 'sample-acb' }, { headers: { 'X-Requested-With': '' } });
  assert.equal(res.status, 403);
  const res2 = await c.call('POST', '/api/watchlist', { companyId: 'sample-acb' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res2.status, 403);
  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/engine/../server/auth.js', '/engine/%2e%2e/server/auth.js', '/..%2fpackage.json', '/vendor/../../server/db.js']) {
    const r = await rawGet(path);
    assert.ok(!/scrypt|DatabaseSync|"dependencies"/.test(r.body), `traversal blocked for ${path}`);
  }
});

test('companies: seeded samples are labelled; users are isolated; analysis runs', async () => {
  const a = await register('iso-a@test.dev');
  const b = await register('iso-b@test.dev');
  const list = (await a.get('/api/companies')).data;
  assert.equal(list.length, 4);
  assert.ok(list.every((c) => c.dataStatus === 'sample' && /SAMPLE/.test(c.name)));
  const created = (await a.post('/api/companies', { name: 'Test Manual Co', ticker: 'tmc', isin: 'INE000T01010', sector: 'Testing' })).data;
  assert.equal(created.ticker, 'TMC');
  assert.equal((await b.get(`/api/companies/${created.id}`)).status, 404);
  const an = (await a.get('/api/companies/sample-vir/analysis')).data;
  assert.equal(an.decision.code, 'SELL_AVOID');
  assert.equal(an.company.dataStatus, 'sample');
  const bad = await a.post('/api/companies', { name: 'X', isin: 'BAD' });
  assert.equal(bad.status, 400);
});

test('editing: whitelisted fields only; prices must be dated', async () => {
  const c = await register('edit@test.dev');
  assert.equal((await c.patch('/api/companies/sample-acb', { password_hash: 'x' })).status, 400);
  assert.equal((await c.patch('/api/companies/sample-acb', { risks: 'nope' })).status, 400);
  const ok = await c.patch('/api/companies/sample-acb', { scenarios: { base: { revenueCagr5: 0.2 } } });
  assert.equal(ok.status, 200);
  assert.equal((await c.put('/api/companies/sample-acb/price', { price: 100 })).status, 400);
  assert.equal((await c.put('/api/companies/sample-acb/price', { price: 100, priceDate: '2999-01-01' })).status, 400);
  const p = await c.put('/api/companies/sample-acb/price', { price: 4000, priceDate: '2026-10-10', source: 'Test entry' });
  assert.equal(p.data.market.price, 4000);
  const live = await c.post('/api/companies/sample-acb/refresh-price');
  assert.equal(live.data.ok, false, 'no live provider configured — reports real status');
});

test('workflow: upload statements → apply → assessment → thesis → red team → decision → report exports', async () => {
  const c = await register('flow@test.dev');
  const co = (await c.post('/api/companies', { name: 'Flow Test Industries (TEST DATA)', ticker: 'FLOW', sector: 'Industrials', businessType: 'compounder' })).data;
  const csv = 'Line item,FY22,FY23,FY24,FY25,FY26\nRevenue from operations,1000,1150,1320,1500,1700\nEBITDA,180,210,240,275,315\nDepreciation,30,33,36,40,44\nFinance costs,10,9,8,7,6\nOther income,5,6,6,7,8\nTax expense,36,43,50,58,68\nNet profit,109,131,152,177,205\nTotal equity,800,900,1010,1140,1290\nTotal debt,100,90,80,60,40\nCash and equivalents,50,70,90,120,160\nTrade receivables,120,135,150,170,190\nInventories,100,110,125,140,155\nTrade payables,80,90,100,115,130\nTotal assets,1100,1220,1350,1500,1660\nShares outstanding,10,10,10,10,10\nCash from operations,120,140,160,185,215\nCapex,-60,-65,-70,-75,-80\nDividends paid,-20,-25,-30,-35,-40\nUnknown thing,1,2,3,4,5\n';
  const up = await c.call('POST', `/api/companies/${co.id}/documents?filename=flow.csv`, undefined, { raw: csv });
  assert.equal(up.status, 201);
  assert.equal(up.data.status, 'parsed');
  assert.deepEqual(up.data.report.unrecognised, ['Unknown thing']);
  assert.equal((await c.post(`/api/documents/${up.data.id}/apply`, { financials: true })).status, 400, 'as-of date required');
  assert.equal((await c.post(`/api/documents/${up.data.id}/apply`, { financials: true, asOf: '2026-03-31' })).status, 200);
  await c.put(`/api/companies/${co.id}/price`, { price: 250, priceDate: '2026-10-10', source: 'Test entry' });
  let an = (await c.get(`/api/companies/${co.id}/analysis`)).data;
  assert.equal(an.metrics.n, 5);
  assert.equal(an.company.dataStatus, 'uploaded');
  assert.ok(an.dataQuality.issues.length > 0, 'missing qualitative data disclosed');
  assert.ok(an.dims.moat.missing.length > 0);

  const incomplete = await c.put(`/api/companies/${co.id}/assessment`, { self: { understandModel: 5 }, complete: true });
  assert.equal(incomplete.status, 400);
  const as = goodAssessment();
  assert.equal((await c.put(`/api/companies/${co.id}/assessment`, { ...as, complete: true })).status, 200);
  an = (await c.get(`/api/companies/${co.id}/analysis`)).data;
  assert.equal(an.investor.completed, true);

  const t = await c.post(`/api/companies/${co.id}/thesis`, { statement: 'Flow grows 13% with improving margins and a net-cash balance sheet; price below base value.', assumptions: [{ text: 'Margins hold', metric: 'ebitdaMargin', operator: '>=', threshold: 0.15 }] });
  assert.equal(t.data.version, 1);
  assert.equal((await c.post(`/api/companies/${co.id}/redteam-review`, { responses: [{ claim: 'x', response: 'short' }] })).status, 400);
  assert.equal((await c.post(`/api/companies/${co.id}/redteam-review`, { responses: [{ claim: 'Price assumes growth', response: 'Checked: implied growth is below history.' }] })).status, 200);
  const ctx = (await c.get(`/api/companies/${co.id}/context`)).data;
  assert.equal(ctx.redTeamAcknowledged, true);

  const d = await c.post(`/api/companies/${co.id}/decisions`, { notes: 'Test decision' });
  assert.equal(d.status, 201);
  const hist = (await c.get('/api/decisions')).data;
  assert.equal(hist[0].priceAtDecision, 250);

  const pdf = await c.get(`/api/companies/${co.id}/report.pdf`);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  const htmlR = await c.get(`/api/companies/${co.id}/report.html`);
  assert.match(htmlR.data.toString(), /Executive dashboard/);
  const csvR = await c.get(`/api/companies/${co.id}/analysis.csv`);
  assert.match(csvR.data.toString(), /^Section,Item,Value,Provenance/);
  const cmp = await c.get(`/api/export/compare.csv?ids=${co.id},sample-acb`);
  assert.match(cmp.data.toString(), /Holistic score/);
  const audit = (await c.get('/api/audit')).data.map((x) => x.action);
  for (const act of ['document.upload', 'document.apply', 'assessment.complete', 'thesis.version', 'redteam.acknowledge', 'decision.record', 'report.export']) assert.ok(audit.includes(act), act);
});

test('monitoring: watchlisted company raises alerts when new evidence arrives', async () => {
  const c = await register('watch@test.dev');
  assert.equal((await c.post('/api/watchlist', { companyId: 'sample-ksc' })).status, 201);
  const co = (await c.get('/api/companies/sample-ksc')).data;
  const sh = [...co.shareholding, { date: '2026-09-30', promoter: 0.44, pledgedPctOfPromoter: 0.4, fii: 0.08, dii: 0.12, retail: 0.36 }];
  const r = await c.patch('/api/companies/sample-ksc', { shareholding: sh });
  assert.ok(r.data.alerts.some((a) => a.title === 'Promoter pledging increased'));
  const alerts = (await c.get('/api/alerts')).data;
  assert.ok(alerts.length >= 1);
  assert.ok(['critical', 'high'].includes(alerts.find((a) => a.title === 'Promoter pledging increased').severity));
  // Ordinary price move without price alerts: no "Price move" alert.
  const p = await c.put('/api/companies/sample-ksc/price', { price: 600, priceDate: '2026-10-10' });
  assert.ok(!p.data.alerts.some((a) => a.title === 'Price move'));
});

test('settings: weights must total 100; integrations report real status', async () => {
  const c = await register('set@test.dev');
  assert.equal((await c.put('/api/settings', { weights: { business: 50 } })).status, 400);
  const integ = (await c.get('/api/integrations')).data;
  assert.equal(integ.find((i) => i.id === 'market').status, 'not_configured');
  assert.equal(integ.find((i) => i.id === 'filings').status, 'not_configured');
  assert.equal(integ.find((i) => i.id === 'sample').status, 'active');
  const ai = await c.post('/api/ai/explain/sample-acb');
  if (!process.env.ANTHROPIC_API_KEY) assert.equal(ai.data.available, false);
});
