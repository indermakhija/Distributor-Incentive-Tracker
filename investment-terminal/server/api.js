// REST API. Every route except auth/health requires a session. All mutations are audit-logged.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { router, readJson, readBody, send, HttpError } from './http.js';
import { now, j, pj } from './db.js';
import { hashPassword, verifyPassword, validateCredentials, createSession, destroySession, sessionCookie, makeRateLimiter } from './auth.js';
import { analyze } from '../engine/analyze.js';
import { snapshotSummary, generateAlerts, THESIS_METRICS } from '../engine/monitoring.js';
import { knowledgeBase, EVIDENCE_QUESTIONS } from '../engine/investor.js';
import { DEFAULT_WEIGHTS, DIMENSIONS } from '../engine/scoring.js';
import { DEFAULT_RATES } from '../engine/valuation.js';
import { DEFAULT_LIMITS } from '../engine/portfolio.js';
import { ingest, TEMPLATE_CSV } from './ingest.js';
import { integrationStatus, fetchQuote } from './adapters/index.js';
import { reportHtml, reportPdf, analysisCsv, compareCsv } from './report.js';
import * as ai from './ai/claude.js';
import { macroStore, registerBridge } from './bridge.js';
import { VALUATION_STATUS_LABEL } from '../engine/valuation.js';

const EDITABLE = ['name', 'ticker', 'exchange', 'isin', 'sector', 'website', 'description', 'businessType', 'macroFactors', 'market', 'financials', 'segments', 'shareholding', 'businessModel', 'businessQuality', 'industry', 'competitors', 'management', 'moat', 'catalysts', 'risks', 'scenarios', 'valuationInputs', 'creditRatings', 'announcements', 'sources', 'contradictions', 'provenance', 'macroExposure', 'macroOverlay'];
const ARRAYS = ['macroFactors', 'segments', 'shareholding', 'competitors', 'catalysts', 'risks', 'creditRatings', 'announcements', 'sources', 'contradictions'];
const BUSINESS_TYPES = ['compounder', 'growth', 'cyclical', 'financial', 'asset_heavy', 'turnaround', 'conglomerate'];
export const DEFAULT_SETTINGS = { weights: DEFAULT_WEIGHTS, rates: DEFAULT_RATES, limits: DEFAULT_LIMITS, requiredMarginOfSafety: 0.2, cash: 0, priceAlerts: false, priceMovePct: 0.1 };

export function loadSamples(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

export function buildApi({ db, sampleDir, secureCookies }) {
  const r = router();
  const limiter = makeRateLimiter({ max: 10 });
  const samples = loadSamples(sampleDir);
  const quickCache = new Map();
  const store = macroStore(db);
  const macroSampleFile = join(sampleDir, '..', 'macro-sample.json');
  const macroOf = (user) => { store.seedSample(user.id, macroSampleFile); return store.dataset(user.id); };

  const audit = (user, action, entity, id, detail, ip) => db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)', user?.id ?? null, action, entity, id == null ? null : String(id), j(detail), ip, now());

  const seedUser = (userId) => db.tx(() => {
    for (const s of samples) db.run('INSERT OR IGNORE INTO companies (user_id, cid, data, created_at, updated_at) VALUES (?,?,?,?,?)', userId, s.id, j(s), now(), now());
    db.run('INSERT OR IGNORE INTO settings (user_id, data) VALUES (?,?)', userId, j(DEFAULT_SETTINGS));
    store.seedSample(userId, macroSampleFile);
  });

  const getCompanyRow = (user, cid) => {
    const row = db.get('SELECT * FROM companies WHERE user_id = ? AND cid = ?', user.id, cid);
    if (!row) throw new HttpError(404, 'Company not found.');
    return { ...row, data: pj(row.data) };
  };
  const settingsOf = (user) => ({ ...DEFAULT_SETTINGS, ...pj(db.get('SELECT data FROM settings WHERE user_id = ?', user.id)?.data, {}) });
  const holdingsOf = (user) => db.all('SELECT * FROM holdings WHERE user_id = ? ORDER BY value DESC', user.id).map((h) => ({ ...h, factors: pj(h.factors, []) }));
  const latestThesis = (user, cid) => { const t = db.get('SELECT * FROM theses WHERE user_id = ? AND company_id = ? ORDER BY version DESC LIMIT 1', user.id, cid); return t ? { ...pj(t.data), version: t.version, createdAt: t.created_at, id: t.id } : null; };
  const assessmentOf = (user, cid) => pj(db.get('SELECT data FROM assessments WHERE user_id = ? AND company_id = ?', user.id, cid)?.data);

  /** Quick context-free analysis of the user's other companies, used for opportunity-cost comparisons. */
  const alternativesFor = (user, cid, settings, macro) => db.all('SELECT cid, data, updated_at FROM companies WHERE user_id = ? AND cid != ?', user.id, cid).map((row) => {
    const macroStamp = db.get('SELECT MAX(updated_at) t FROM macro_readings WHERE user_id = ?', user.id)?.t;
    const key = `${user.id}:${row.cid}:${row.updated_at}:${JSON.stringify(settings.rates)}:${macroStamp}`;
    let q = quickCache.get(key);
    if (!q) {
      const c = pj(row.data);
      const a = analyze(c, { settings, macro });
      q = { name: c.name, ticker: c.ticker, expectedReturn5y: a.valuation?.scenarios?.base?.expectedReturn5y, quality: a.decision.quality, confidence: a.decision.confidence };
      quickCache.set(key, q);
    }
    return q;
  }).filter((x) => Number.isFinite(x.expectedReturn5y));

  const contextFor = (user, row, overrides = {}) => {
    const settings = settingsOf(user);
    const holdings = holdingsOf(user);
    const c = row.data;
    const holding = holdings.find((h) => h.ticker && h.ticker === c.ticker);
    const ack = db.get('SELECT acknowledged_at FROM redteam_reviews WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', user.id, row.cid);
    const macro = macroOf(user);
    return {
      settings, holdings, cash: settings.cash, assessment: assessmentOf(user, row.cid), thesis: latestThesis(user, row.cid), macro,
      alternatives: alternativesFor(user, row.cid, settings, macro), holder: overrides.holder ?? !!holding,
      redTeamAcknowledged: !!ack && ack.acknowledged_at >= row.updated_at
    };
  };
  const runAnalysis = (user, row, overrides) => analyze(row.data, contextFor(user, row, overrides));

  const saveSnapshot = (user, row, a, ip) => {
    const prev = db.get('SELECT summary FROM analyses WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', user.id, row.cid);
    const summary = snapshotSummary({ ...a, aggregate: a.aggregate, valuation: a.valuation, company: row.data });
    summary.expectedReturn5y = a.valuation?.scenarios?.base?.expectedReturn5y ?? null;
    summary.quality = a.decision.quality;
    const info = db.run('INSERT INTO analyses (user_id, company_id, created_at, decision, holistic, summary, full) VALUES (?,?,?,?,?,?,?)', user.id, row.cid, now(), a.decision.code, a.aggregate.holistic, j(summary), j(a));
    let alerts = [];
    const watch = db.get('SELECT prefs FROM watchlist WHERE user_id = ? AND company_id = ?', user.id, row.cid);
    if (watch && prev) {
      const s = settingsOf(user);
      alerts = generateAlerts(pj(prev.summary), summary, { ...a, company: row.data }, { priceAlerts: s.priceAlerts, priceMovePct: s.priceMovePct, ...pj(watch.prefs, {}) });
      for (const al of alerts) db.run('INSERT INTO alerts (user_id, company_id, severity, title, what, why, reassess, created_at) VALUES (?,?,?,?,?,?,?,?)', user.id, row.cid, al.severity, al.title, al.what, al.why, al.reassess ? 1 : 0, now());
    }
    audit(user, 'analysis.snapshot', 'company', row.cid, { decision: a.decision.code, holistic: a.aggregate.holistic, alerts: alerts.length }, ip);
    return { id: Number(info.lastInsertRowid), alerts };
  };

  /** After any evidence change on a watchlisted company, re-run and flag changes automatically. */
  const refreshIfWatched = (user, cid, ip) => {
    if (!db.get('SELECT 1 FROM watchlist WHERE user_id = ? AND company_id = ?', user.id, cid)) return [];
    const row = getCompanyRow(user, cid);
    return saveSnapshot(user, row, runAnalysis(user, row), ip).alerts;
  };

  const refreshAllWatched = (user, ip) => db.all('SELECT company_id FROM watchlist WHERE user_id = ?', user.id).flatMap((w) => {
    try { return refreshIfWatched(user, w.company_id, ip); } catch { return []; }
  });

  /** Matches a company by ISIN or ticker (accepts NSE:/BSE: prefixes and .NS/.BO suffixes). */
  const findCompanyRow = (user, { ticker, isin }) => {
    const norm = (t) => String(t || '').toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '').trim();
    const rows = db.all('SELECT * FROM companies WHERE user_id = ?', user.id).map((r) => ({ ...r, data: pj(r.data) }));
    if (isin) { const hit = rows.find((r) => r.data.isin && r.data.isin.toUpperCase() === String(isin).toUpperCase()); if (hit) return hit; }
    if (ticker) return rows.find((r) => norm(r.data.ticker) === norm(ticker)) || null;
    return null;
  };

  /** Compact analyser payload consumed by the Nifty terminal (and the embed card). */
  const compact = (a) => ({
    engineVersion: a.engineVersion, generatedAt: a.generatedAt,
    company: { id: a.company.id, name: a.company.name, ticker: a.company.ticker, isin: a.company.isin, sector: a.company.sector, dataStatus: a.company.dataStatus },
    price: { value: a.company.market?.price ?? null, asOf: a.company.market?.priceTimestamp || a.company.market?.priceDate || null, source: a.company.market?.source || null, type: a.company.market?.type || null },
    decision: { code: a.decision.code, label: a.decision.label, status: a.decision.status, gates: a.decision.gates, confidence: a.decision.confidence, entryPrice: a.decision.entryPrice ?? null, entryRange: a.decision.entryRange, greatBusiness: a.decision.greatBusiness, greatInvestment: a.decision.greatInvestment },
    headline: a.narrative.headline, businessVsInvestment: a.narrative.businessVsInvestment,
    holistic: a.aggregate.holistic, band: a.aggregate.band.label, quality: a.decision.quality,
    dimensions: a.aggregate.rows.map((r) => ({ id: r.id, label: r.label, score: r.score, weight: r.weight })),
    valuation: a.valuation?.intrinsic ? { status: a.valuation.status, statusLabel: VALUATION_STATUS_LABEL[a.valuation.status], bear: a.valuation.intrinsic.bear, base: a.valuation.intrinsic.base, bull: a.valuation.intrinsic.bull, marginOfSafety: a.valuation.marginOfSafety, requiredMarginOfSafety: a.valuation.requiredMarginOfSafety, impliedGrowth10y: a.valuation.reverseDcf?.impliedRevenueCagr10y ?? null, expectedReturn5y: a.valuation.scenarios.base.expectedReturn5y } : null,
    macro: { regime: a.macro.regime, score: a.macro.usable ? a.macro.impact.score : null, sensitivity: a.macro.impact.sensitivity, national: a.macro.impact.national, international: a.macro.impact.international,
      tailwinds: a.macro.impact.tailwinds.slice(0, 5).map((x) => ({ factor: x.name, scope: x.scope, contribution: x.contribution })), headwinds: a.macro.impact.headwinds.slice(0, 5).map((x) => ({ factor: x.name, scope: x.scope, contribution: x.contribution })),
      stress: (a.macro.stress || []).map((x) => ({ id: x.id, name: x.name, value: x.value, vsBase: x.vsBase, vsPrice: x.vsPrice })), dataset: a.macro.dataset },
    overrides: a.decision.rules.map((r) => ({ id: r.id, severity: r.severity, title: r.title, cap: r.cap })),
    redTeam: a.redTeam.strongestThree.map((p) => ({ severity: p.severity, claim: p.claim, evidence: p.evidence })),
    dataQuality: { confidence: a.dataQuality.confidence, issues: a.dataQuality.issues.map((i) => i.text) },
    disclaimer: 'Decision support, not investment advice. Valuations are estimates with wide uncertainty.'
  });

  const updateCompany = (user, row, data, ip, action, detail) => {
    db.run('UPDATE companies SET data = ?, updated_at = ? WHERE uid = ?', j(data), now(), row.uid);
    audit(user, action, 'company', row.cid, detail, ip);
    return refreshIfWatched(user, row.cid, ip);
  };

  // ------------------------------------------------------------------ auth
  r.post('/api/auth/register', async (ctx) => {
    const { email, password, name } = await readJson(ctx.req);
    if (!limiter(`reg:${ctx.ip}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const err = validateCredentials(email, password);
    if (err) throw new HttpError(400, err);
    if (db.get('SELECT 1 FROM users WHERE email = ?', email.toLowerCase())) throw new HttpError(409, 'An account with this email already exists.');
    const info = db.run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,?)', email.toLowerCase(), String(name || '').slice(0, 100), hashPassword(password), now());
    const userId = Number(info.lastInsertRowid);
    seedUser(userId);
    const s = createSession(db, userId);
    audit({ id: userId }, 'auth.register', 'user', userId, null, ctx.ip);
    return { status: 201, body: { id: userId, email: email.toLowerCase() }, headers: { 'Set-Cookie': sessionCookie(s.token, { secure: secureCookies(ctx.req) }) } };
  }, { public: true });

  r.post('/api/auth/login', async (ctx) => {
    const { email, password } = await readJson(ctx.req);
    if (!limiter(`login:${ctx.ip}:${String(email).toLowerCase()}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const u = db.get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) { audit(null, 'auth.login_failed', 'user', null, { email: String(email).slice(0, 200) }, ctx.ip); throw new HttpError(401, 'Invalid email or password.'); }
    const s = createSession(db, u.id);
    audit(u, 'auth.login', 'user', u.id, null, ctx.ip);
    return { body: { id: u.id, email: u.email, name: u.name }, headers: { 'Set-Cookie': sessionCookie(s.token, { secure: secureCookies(ctx.req) }) } };
  }, { public: true });

  r.post('/api/auth/logout', async (ctx) => {
    destroySession(db, ctx.user.token);
    audit(ctx.user, 'auth.logout', 'user', ctx.user.id, null, ctx.ip);
    return { body: { ok: true }, headers: { 'Set-Cookie': sessionCookie('', { clear: true, secure: secureCookies(ctx.req) }) } };
  });
  r.get('/api/auth/me', async (ctx) => ({ body: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name } }));
  r.get('/api/health', async () => ({ body: { ok: true, time: now() } }), { public: true });

  // ------------------------------------------------------------------ companies
  r.get('/api/companies', async (ctx) => {
    const q = (ctx.query.get('q') || '').toLowerCase().trim();
    const rows = db.all('SELECT cid, data, updated_at FROM companies WHERE user_id = ? ORDER BY cid', ctx.user.id);
    const watch = new Set(db.all('SELECT company_id FROM watchlist WHERE user_id = ?', ctx.user.id).map((w) => w.company_id));
    const list = rows.map((row) => {
      const c = pj(row.data);
      const snap = db.get('SELECT decision, holistic, created_at FROM analyses WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', ctx.user.id, row.cid);
      return { id: row.cid, name: c.name, ticker: c.ticker, exchange: c.exchange, isin: c.isin, sector: c.sector, industry: c.industry?.name, dataStatus: c.dataStatus, price: c.market?.price, priceDate: c.market?.priceDate, updatedAt: row.updated_at, watchlisted: watch.has(row.cid), lastSnapshot: snap || null };
    }).filter((c) => !q || [c.name, c.ticker, c.isin, c.sector, c.industry].some((v) => String(v || '').toLowerCase().includes(q)));
    return { body: list };
  });

  r.post('/api/companies', async (ctx) => {
    const b = await readJson(ctx.req);
    const name = String(b.name || '').trim();
    if (!name || name.length > 200) throw new HttpError(400, 'Company name is required.');
    if (b.isin && !/^IN[A-Z0-9]{10}$/.test(b.isin)) throw new HttpError(400, 'ISIN must be 12 characters starting with IN (e.g. INE000A01010).');
    const ticker = String(b.ticker || '').toUpperCase().replace(/[^A-Z0-9&\-.]/g, '').slice(0, 30) || null;
    const cid = 'c-' + randomUUID().slice(0, 8);
    const company = {
      id: cid, name, ticker, exchange: ['NSE', 'BSE'].includes(b.exchange) ? b.exchange : 'NSE', isin: b.isin || null, sector: String(b.sector || '').slice(0, 80) || 'Unclassified',
      website: b.website ? String(b.website).slice(0, 300) : null, description: String(b.description || '').slice(0, 2000), businessType: BUSINESS_TYPES.includes(b.businessType) ? b.businessType : 'compounder',
      dataStatus: 'uploaded', market: { price: null, priceDate: null, sharesOutstanding: null, source: null, type: 'manual' }, financials: { years: [], income: {}, balance: {}, cashflow: {} },
      industry: { name: b.industry || null }, competitors: [], management: { promises: [], events: [], auditorEvents: [] }, risks: [], catalysts: [], segments: [], shareholding: [], sources: [], announcements: [],
      provenance: {}, thesisInput: b.thesis ? String(b.thesis).slice(0, 4000) : null
    };
    db.run('INSERT INTO companies (user_id, cid, data, created_at, updated_at) VALUES (?,?,?,?,?)', ctx.user.id, cid, j(company), now(), now());
    audit(ctx.user, 'company.create', 'company', cid, { name, ticker }, ctx.ip);
    return { status: 201, body: company };
  });

  r.get('/api/companies/:id', async (ctx) => ({ body: getCompanyRow(ctx.user, ctx.params.id).data }));

  r.patch('/api/companies/:id', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const b = await readJson(ctx.req);
    const data = { ...row.data };
    const changed = [];
    for (const [k, v] of Object.entries(b)) {
      if (!EDITABLE.includes(k)) throw new HttpError(400, `Field "${k}" is not editable.`);
      if (ARRAYS.includes(k) && !Array.isArray(v)) throw new HttpError(400, `Field "${k}" must be an array.`);
      if (!ARRAYS.includes(k) && v !== null && typeof v === 'object' && Array.isArray(v)) throw new HttpError(400, `Field "${k}" must be an object.`);
      if (k === 'businessType' && !BUSINESS_TYPES.includes(v)) throw new HttpError(400, 'Invalid business type.');
      if (k === 'macroOverlay' && !['auto', 'always', 'off'].includes(v)) throw new HttpError(400, 'macroOverlay must be auto, always or off.');
      if (k === 'macroExposure' && (typeof v !== 'object' || v === null || Array.isArray(v) || Object.values(v).some((x) => !Number.isFinite(Number(typeof x === 'object' ? x?.value : x)) || Math.abs(Number(typeof x === 'object' ? x.value : x)) > 2))) throw new HttpError(400, 'macroExposure must map factor ids to sensitivities between -2 and 2.');
      data[k] = v;
      changed.push(k);
    }
    if (changed.includes('financials') && data.dataStatus !== 'sample') data.provenance = { ...data.provenance, financials: { type: 'manual', source: 'Manual edit', asOf: data.financials?.asOf || null } };
    if (changed.includes('market') && data.market) data.market.type = data.dataStatus === 'sample' ? 'sample' : data.market.type || 'manual';
    const alerts = updateCompany(ctx.user, row, data, ctx.ip, 'company.update', { fields: changed });
    return { body: { company: data, alerts } };
  });

  r.del('/api/companies/:id', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    db.tx(() => {
      db.run('DELETE FROM companies WHERE uid = ?', row.uid);
      db.run('DELETE FROM watchlist WHERE user_id = ? AND company_id = ?', ctx.user.id, row.cid);
    });
    audit(ctx.user, 'company.delete', 'company', row.cid, { name: row.data.name }, ctx.ip);
    return { body: { ok: true } };
  });

  r.put('/api/companies/:id/price', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const { price, priceDate, sharesOutstanding, source } = await readJson(ctx.req);
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) throw new HttpError(400, 'Price must be a positive number.');
    if (!priceDate || Number.isNaN(Date.parse(priceDate))) throw new HttpError(400, 'Price date is required (YYYY-MM-DD) — undated prices are not accepted.');
    if (Date.parse(priceDate) > Date.now() + 864e5) throw new HttpError(400, 'Price date cannot be in the future.');
    const data = { ...row.data, market: { ...row.data.market, price: p, priceDate, source: String(source || 'Manual entry').slice(0, 120), type: row.data.dataStatus === 'sample' ? 'sample' : 'manual' } };
    if (sharesOutstanding != null) { const s = Number(sharesOutstanding); if (!Number.isFinite(s) || s <= 0) throw new HttpError(400, 'Shares outstanding must be positive (in crore).'); data.market.sharesOutstanding = s; }
    const alerts = updateCompany(ctx.user, row, data, ctx.ip, 'company.price', { price: p, priceDate });
    return { body: { market: data.market, alerts } };
  });

  r.post('/api/companies/:id/refresh-price', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const q = await fetchQuote(row.data.ticker, row.data.exchange);
    if (!q.ok) return { status: 200, body: q };
    const data = { ...row.data, market: { ...row.data.market, price: q.price, priceDate: q.priceDate, source: q.source, type: 'live' } };
    const alerts = updateCompany(ctx.user, row, data, ctx.ip, 'company.price_refresh', { price: q.price, source: q.source });
    return { body: { ...q, alerts } };
  });

  // ------------------------------------------------------------------ analysis
  r.get('/api/companies/:id/context', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const c = contextFor(ctx.user, row);
    return { body: { company: row.data, updatedAt: row.updated_at, ...c, knowledgeQuestions: EVIDENCE_QUESTIONS } };
  });
  r.get('/api/companies/:id/analysis', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const holder = ctx.query.get('holder');
    return { body: runAnalysis(ctx.user, row, holder == null ? {} : { holder: holder === '1' }) };
  });
  r.post('/api/companies/:id/analysis', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const a = runAnalysis(ctx.user, row);
    const snap = saveSnapshot(ctx.user, row, a, ctx.ip);
    return { status: 201, body: { snapshotId: snap.id, alerts: snap.alerts, analysis: a } };
  });
  r.get('/api/companies/:id/snapshots', async (ctx) => ({ body: db.all('SELECT id, created_at, decision, holistic, summary FROM analyses WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 100', ctx.user.id, ctx.params.id).map((s) => ({ ...s, summary: pj(s.summary) })) }));
  r.get('/api/snapshots/:sid', async (ctx) => {
    const s = db.get('SELECT * FROM analyses WHERE id = ? AND user_id = ?', Number(ctx.params.sid), ctx.user.id);
    if (!s) throw new HttpError(404, 'Snapshot not found.');
    return { body: { id: s.id, createdAt: s.created_at, analysis: pj(s.full) } };
  });

  r.get('/api/compare', async (ctx) => {
    const ids = (ctx.query.get('ids') || '').split(',').filter(Boolean).slice(0, 8);
    if (ids.length < 2) throw new HttpError(400, 'Select at least two companies to compare.');
    return { body: ids.map((id) => runAnalysis(ctx.user, getCompanyRow(ctx.user, id))) };
  });

  // ------------------------------------------------------------------ investor assessment, thesis, red team, decisions
  r.get('/api/companies/:id/assessment', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    return { body: { assessment: assessmentOf(ctx.user, row.cid), questions: EVIDENCE_QUESTIONS, knowledgeBaseSize: Object.values(knowledgeBase(row.data)).flat().length } };
  });
  r.put('/api/companies/:id/assessment', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const b = await readJson(ctx.req);
    const clean = { self: {}, evidence: {}, conviction: {}, suitability: {}, aiGrades: b.aiGrades && typeof b.aiGrades === 'object' ? b.aiGrades : undefined };
    for (const [k, v] of Object.entries(b.self || {})) { const n = Number(v); if (Number.isFinite(n)) clean.self[k] = Math.max(0, Math.min(10, n)); }
    for (const [k, v] of Object.entries(b.evidence || {})) clean.evidence[k] = String(v ?? '').slice(0, 4000);
    const cv = b.conviction || {};
    clean.conviction = { reasons: Array.isArray(cv.reasons) ? cv.reasons.map(String).slice(0, 10) : [], thesis: String(cv.thesis || '').slice(0, 4000), supporting: String(cv.supporting || '').slice(0, 4000), contradicting: String(cv.contradicting || '').slice(0, 4000), changeMind: String(cv.changeMind || '').slice(0, 2000), wouldBuyIfNotOwned: ['yes', 'no', 'unsure'].includes(cv.wouldBuyIfNotOwned) ? cv.wouldBuyIfNotOwned : 'unsure' };
    const sv = b.suitability || {};
    const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    clean.suitability = { amount: n(sv.amount), horizonYears: n(sv.horizonYears), liquidityNeedMonths: n(sv.liquidityNeedMonths), maxDrawdown: n(sv.maxDrawdown), maxPermanentLoss: n(sv.maxPermanentLoss), incomeNeed: !!sv.incomeNeed, style: String(sv.style || '').slice(0, 40), willingToMonitor: !!sv.willingToMonitor, taxNotes: String(sv.taxNotes || '').slice(0, 1000), existingHolder: !!sv.existingHolder, unrealisedLossPct: n(sv.unrealisedLossPct) };
    if (b.complete) {
      const missing = EVIDENCE_QUESTIONS.filter((q) => !clean.evidence[q.id]?.trim()).length;
      if (Object.keys(clean.self).length < 7) throw new HttpError(400, 'Answer all seven self-assessment statements before completing.');
      if (missing > 0) throw new HttpError(400, `Answer all evidence questions before completing (${missing} unanswered). A short honest answer is better than none.`);
      if (!clean.conviction.thesis.trim()) throw new HttpError(400, 'Write your investment thesis before completing.');
      clean.completedAt = now();
    }
    db.run('INSERT INTO assessments (user_id, company_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id, company_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', ctx.user.id, row.cid, j(clean), now());
    audit(ctx.user, b.complete ? 'assessment.complete' : 'assessment.save', 'company', row.cid, null, ctx.ip);
    return { body: { assessment: clean } };
  });

  r.get('/api/companies/:id/thesis', async (ctx) => ({ body: { current: latestThesis(ctx.user, ctx.params.id), history: db.all('SELECT id, version, created_at, data FROM theses WHERE user_id = ? AND company_id = ? ORDER BY version DESC', ctx.user.id, ctx.params.id).map((t) => ({ ...t, data: pj(t.data) })), metrics: Object.fromEntries(Object.entries(THESIS_METRICS).map(([k, v]) => [k, v.label])) } }));
  r.post('/api/companies/:id/thesis', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const b = await readJson(ctx.req);
    const statement = String(b.statement || '').trim();
    if (statement.length < 20) throw new HttpError(400, 'Write the thesis in at least a sentence or two.');
    const assumptions = (Array.isArray(b.assumptions) ? b.assumptions : []).slice(0, 20).map((x) => ({
      text: String(x.text || '').slice(0, 300), metric: THESIS_METRICS[x.metric] ? x.metric : null, operator: ['>', '>=', '<', '<='].includes(x.operator) ? x.operator : null,
      threshold: x.threshold === '' || x.threshold == null ? null : Number(x.threshold), critical: x.critical !== false
    })).filter((x) => x.text);
    const sellTriggers = (Array.isArray(b.sellTriggers) ? b.sellTriggers : []).slice(0, 20).map((x) => ({ text: String(x.text || '').slice(0, 300), triggered: !!x.triggered })).filter((x) => x.text);
    const a = runAnalysis(ctx.user, row);
    const v = (db.get('SELECT MAX(version) v FROM theses WHERE user_id = ? AND company_id = ?', ctx.user.id, row.cid)?.v || 0) + 1;
    const data = { statement, assumptions, sellTriggers, valuationAtCreation: { price: a.valuation?.price, base: a.valuation?.intrinsic?.base, assumptions: a.valuation?.scenarios?.base?.assumptions }, risksAtCreation: a.redTeam.strongestThree, decisionAtCreation: a.decision.code };
    db.run('INSERT INTO theses (user_id, company_id, version, data, created_at) VALUES (?,?,?,?,?)', ctx.user.id, row.cid, v, j(data), now());
    audit(ctx.user, 'thesis.version', 'company', row.cid, { version: v }, ctx.ip);
    const alerts = refreshIfWatched(ctx.user, row.cid, ctx.ip);
    return { status: 201, body: { version: v, alerts } };
  });

  r.post('/api/companies/:id/redteam-review', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const { responses } = await readJson(ctx.req);
    if (!Array.isArray(responses) || !responses.length || responses.some((x) => String(x?.response || '').trim().length < 10))
      throw new HttpError(400, 'Respond to each red-team point (at least a sentence) before acknowledging.');
    db.run('INSERT INTO redteam_reviews (user_id, company_id, responses, acknowledged_at) VALUES (?,?,?,?)', ctx.user.id, row.cid, j(responses.slice(0, 30).map((x) => ({ claim: String(x.claim).slice(0, 500), response: String(x.response).slice(0, 2000) }))), now());
    audit(ctx.user, 'redteam.acknowledge', 'company', row.cid, { points: responses.length }, ctx.ip);
    return { body: { ok: true } };
  });
  r.get('/api/companies/:id/redteam-review', async (ctx) => ({ body: db.all('SELECT * FROM redteam_reviews WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 10', ctx.user.id, ctx.params.id).map((x) => ({ ...x, responses: pj(x.responses) })) }));

  r.post('/api/companies/:id/decisions', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const b = await readJson(ctx.req);
    const a = runAnalysis(ctx.user, row);
    const snap = saveSnapshot(ctx.user, row, a, ctx.ip);
    const info = db.run('INSERT INTO decisions (user_id, company_id, analysis_id, decision, price, notes, created_at) VALUES (?,?,?,?,?,?,?)', ctx.user.id, row.cid, snap.id, a.decision.code, row.data.market?.price ?? null, String(b.notes || '').slice(0, 4000), now());
    audit(ctx.user, 'decision.record', 'company', row.cid, { decision: a.decision.code, status: a.decision.status }, ctx.ip);
    return { status: 201, body: { id: Number(info.lastInsertRowid), decision: a.decision, snapshotId: snap.id } };
  });
  r.get('/api/decisions', async (ctx) => {
    const rows = db.all('SELECT d.*, a.summary FROM decisions d LEFT JOIN analyses a ON a.id = d.analysis_id WHERE d.user_id = ? ORDER BY d.id DESC', ctx.user.id);
    return { body: rows.map((d) => {
      const c = pj(db.get('SELECT data FROM companies WHERE user_id = ? AND cid = ?', ctx.user.id, d.company_id)?.data);
      const latest = pj(db.get('SELECT summary FROM analyses WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', ctx.user.id, d.company_id)?.summary);
      const then = pj(d.summary);
      const curPrice = c?.market?.price;
      return { id: d.id, companyId: d.company_id, company: c?.name || '(deleted)', ticker: c?.ticker, decision: d.decision, priceAtDecision: d.price, notes: d.notes, review: pj(d.review), createdAt: d.created_at,
        currentPrice: curPrice, priceDateNow: c?.market?.priceDate, returnSince: Number.isFinite(curPrice) && d.price ? curPrice / d.price - 1 : null,
        then: then && { holistic: then.holistic, baseValue: then.baseValue, dims: then.dims }, now: latest && { holistic: latest.holistic, decision: latest.decision, baseValue: latest.baseValue, dims: latest.dims } };
    }) };
  });
  r.patch('/api/decisions/:id', async (ctx) => {
    const d = db.get('SELECT * FROM decisions WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!d) throw new HttpError(404, 'Decision not found.');
    const b = await readJson(ctx.req);
    const review = { reviewedAt: now(), thesisCorrect: ['yes', 'partly', 'no', 'too_early'].includes(b.thesisCorrect) ? b.thesisCorrect : 'too_early', lessons: String(b.lessons || '').slice(0, 4000), processVsOutcome: String(b.processVsOutcome || '').slice(0, 2000) };
    db.run('UPDATE decisions SET review = ? WHERE id = ?', j(review), d.id);
    audit(ctx.user, 'decision.review', 'decision', d.id, null, ctx.ip);
    return { body: { review } };
  });

  // ------------------------------------------------------------------ watchlist & alerts
  r.get('/api/watchlist', async (ctx) => ({ body: db.all('SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC', ctx.user.id).map((w) => {
    const c = pj(db.get('SELECT data FROM companies WHERE user_id = ? AND cid = ?', ctx.user.id, w.company_id)?.data) || {};
    const snap = db.get('SELECT decision, holistic, summary, created_at FROM analyses WHERE user_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', ctx.user.id, w.company_id);
    return { companyId: w.company_id, name: c.name, ticker: c.ticker, dataStatus: c.dataStatus, price: c.market?.price, priceDate: c.market?.priceDate, prefs: pj(w.prefs, {}), addedAt: w.added_at, last: snap && { ...snap, summary: pj(snap.summary) }, unread: db.get('SELECT COUNT(*) n FROM alerts WHERE user_id = ? AND company_id = ? AND read = 0', ctx.user.id, w.company_id).n };
  }) }));
  r.post('/api/watchlist', async (ctx) => {
    const { companyId, prefs } = await readJson(ctx.req);
    const row = getCompanyRow(ctx.user, companyId);
    db.run('INSERT INTO watchlist (user_id, company_id, prefs, added_at) VALUES (?,?,?,?) ON CONFLICT(user_id, company_id) DO UPDATE SET prefs = excluded.prefs', ctx.user.id, row.cid, j(prefs || {}), now());
    audit(ctx.user, 'watchlist.add', 'company', row.cid, null, ctx.ip);
    if (!db.get('SELECT 1 FROM analyses WHERE user_id = ? AND company_id = ?', ctx.user.id, row.cid)) saveSnapshot(ctx.user, row, runAnalysis(ctx.user, row), ctx.ip);
    return { status: 201, body: { ok: true } };
  });
  r.del('/api/watchlist/:id', async (ctx) => { db.run('DELETE FROM watchlist WHERE user_id = ? AND company_id = ?', ctx.user.id, ctx.params.id); audit(ctx.user, 'watchlist.remove', 'company', ctx.params.id, null, ctx.ip); return { body: { ok: true } }; });
  r.get('/api/alerts', async (ctx) => ({ body: db.all("SELECT a.*, json_extract(c.data, '$.name') company FROM alerts a LEFT JOIN companies c ON c.user_id = a.user_id AND c.cid = a.company_id WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 200", ctx.user.id) }));
  r.patch('/api/alerts/:id', async (ctx) => { db.run('UPDATE alerts SET read = 1 WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id); return { body: { ok: true } }; });
  r.post('/api/alerts/read-all', async (ctx) => { db.run('UPDATE alerts SET read = 1 WHERE user_id = ?', ctx.user.id); return { body: { ok: true } }; });

  // ------------------------------------------------------------------ portfolio & settings
  r.get('/api/holdings', async (ctx) => ({ body: holdingsOf(ctx.user) }));
  r.post('/api/holdings', async (ctx) => {
    const b = await readJson(ctx.req);
    const v = Number(b.value);
    if (!String(b.name || '').trim() || !Number.isFinite(v) || v < 0) throw new HttpError(400, 'Holding needs a name and a non-negative value.');
    const info = db.run('INSERT INTO holdings (user_id, name, ticker, sector, value, factors, avg_cost) VALUES (?,?,?,?,?,?,?)', ctx.user.id, String(b.name).slice(0, 120), String(b.ticker || '').toUpperCase().slice(0, 30) || null, String(b.sector || 'Unclassified').slice(0, 80), v, j(Array.isArray(b.factors) ? b.factors.map(String).slice(0, 10) : []), Number.isFinite(Number(b.avgCost)) ? Number(b.avgCost) : null);
    audit(ctx.user, 'holding.add', 'holding', info.lastInsertRowid, { name: b.name }, ctx.ip);
    return { status: 201, body: { id: Number(info.lastInsertRowid) } };
  });
  r.del('/api/holdings/:id', async (ctx) => { db.run('DELETE FROM holdings WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id); audit(ctx.user, 'holding.remove', 'holding', ctx.params.id, null, ctx.ip); return { body: { ok: true } }; });

  r.get('/api/settings', async (ctx) => ({ body: { settings: settingsOf(ctx.user), defaults: DEFAULT_SETTINGS, dimensions: DIMENSIONS } }));
  r.put('/api/settings', async (ctx) => {
    const b = await readJson(ctx.req);
    const s = settingsOf(ctx.user);
    if (b.weights) {
      const w = {};
      for (const d of DIMENSIONS) { const n = Number(b.weights[d.id]); if (!Number.isFinite(n) || n < 0 || n > 50) throw new HttpError(400, `Weight for ${d.label} must be 0–50.`); w[d.id] = n; }
      const tot = Object.values(w).reduce((x, y) => x + y, 0);
      if (Math.abs(tot - 100) > 0.5) throw new HttpError(400, `Weights must total 100 (currently ${tot}).`);
      s.weights = w;
    }
    if (b.rates) for (const [k, v] of Object.entries(b.rates)) { if (!(k in DEFAULT_RATES)) continue; const n = Number(v); if (!Number.isFinite(n) || n < -0.05 || n > 0.5) throw new HttpError(400, `Rate ${k} out of range.`); s.rates = { ...s.rates, [k]: n }; }
    if (b.limits) for (const k of ['maxSingleStock', 'maxSector']) if (b.limits[k] != null) { const n = Number(b.limits[k]); if (!(n > 0 && n <= 1)) throw new HttpError(400, `${k} must be between 0 and 1.`); s.limits = { ...s.limits, [k]: n }; }
    if (b.requiredMarginOfSafety != null) { const n = Number(b.requiredMarginOfSafety); if (!(n >= 0 && n < 0.8)) throw new HttpError(400, 'Margin of safety must be 0–0.8.'); s.requiredMarginOfSafety = n; s.rates = { ...s.rates, requiredMarginOfSafety: n }; }
    if (b.cash != null) { const n = Number(b.cash); if (!(n >= 0)) throw new HttpError(400, 'Cash must be ≥ 0.'); s.cash = n; }
    if (b.priceAlerts != null) s.priceAlerts = !!b.priceAlerts;
    if (b.reset) Object.assign(s, DEFAULT_SETTINGS);
    db.run('INSERT INTO settings (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data', ctx.user.id, j(s));
    audit(ctx.user, 'settings.update', 'settings', ctx.user.id, b, ctx.ip);
    return { body: { settings: s } };
  });

  // ------------------------------------------------------------------ documents
  r.post('/api/companies/:id/documents', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const filename = String(ctx.query.get('filename') || 'upload').replace(/[^\w.\- ]/g, '_').slice(0, 150);
    const buf = await readBody(ctx.req, 25 * 1048576);
    const result = await ingest(buf, filename, ctx.req.headers['content-type'] || '');
    const kind = result.type === 'financials' ? 'financial_statements' : result.kind || 'document';
    const info = db.run('INSERT INTO documents (user_id, company_id, filename, kind, mime, size, status, text, parsed, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.user.id, row.cid, filename, kind, String(ctx.req.headers['content-type'] || '').slice(0, 100), buf.length, result.status, (result.text || '').slice(0, 2_000_000), j({ ...result, text: undefined }), now());
    audit(ctx.user, 'document.upload', 'company', row.cid, { filename, kind, status: result.status }, ctx.ip);
    return { status: 201, body: { id: Number(info.lastInsertRowid), filename, kind, ...result, text: result.text ? result.text.slice(0, 5000) : undefined } };
  });
  r.get('/api/companies/:id/documents', async (ctx) => ({ body: db.all('SELECT id, filename, kind, size, status, created_at, parsed FROM documents WHERE user_id = ? AND company_id = ? ORDER BY id DESC', ctx.user.id, ctx.params.id).map((d) => { const p = pj(d.parsed, {}); return { ...d, parsed: undefined, error: p.error, report: p.report, findings: p.analysis?.findings?.length ?? null, tone: p.analysis?.tone ?? null, pages: p.pages, applied: p.applied || false }; }) }));
  r.get('/api/documents/:id', async (ctx) => {
    const d = db.get('SELECT * FROM documents WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!d) throw new HttpError(404, 'Document not found.');
    return { body: { ...d, text: (d.text || '').slice(0, 200000), parsed: pj(d.parsed) } };
  });
  r.del('/api/documents/:id', async (ctx) => { db.run('DELETE FROM documents WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id); audit(ctx.user, 'document.delete', 'document', ctx.params.id, null, ctx.ip); return { body: { ok: true } }; });

  /** Applies a parsed document to the company: financial statements, or individually confirmed findings. */
  r.post('/api/documents/:id/apply', async (ctx) => {
    const d = db.get('SELECT * FROM documents WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!d) throw new HttpError(404, 'Document not found.');
    const parsed = pj(d.parsed, {});
    const row = getCompanyRow(ctx.user, d.company_id);
    const b = await readJson(ctx.req);
    const data = structuredClone(row.data);
    const applied = [];
    if (b.financials) {
      if (parsed.type !== 'financials' || !parsed.statements) throw new HttpError(400, 'This document has no parsed financial statements.');
      const asOf = b.asOf && !Number.isNaN(Date.parse(b.asOf)) ? b.asOf : null;
      if (!asOf) throw new HttpError(400, 'Provide the reporting date (as-of) of these statements so staleness can be tracked.');
      const s = parsed.statements;
      data.financials = { years: s.years, unit: b.unit || '₹ Cr', asOf, source: `Upload: ${d.filename}`, income: s.income, balance: s.balance, cashflow: s.cashflow };
      if (data.dataStatus === 'sample') { data.dataStatus = 'uploaded'; data.sampleNote = 'Sample company with user-uploaded statements — qualitative fields remain illustrative.'; }
      data.provenance = { ...data.provenance, financials: { type: 'uploaded', source: d.filename, asOf } };
      const shares = s.balance?.sharesOutstanding?.filter(Number.isFinite).at(-1);
      if (shares && !data.market?.sharesOutstanding) data.market = { ...data.market, sharesOutstanding: shares };
      applied.push('financials');
    }
    for (const f of Array.isArray(b.findings) ? b.findings.slice(0, 30) : []) {
      const text = String(f.text || '').slice(0, 600);
      const ref = `${d.filename}${f.page ? ' p.' + f.page : ''}`;
      data.management = data.management || {};
      if (f.kind === 'promise') (data.management.promises = data.management.promises || []).push({ promise: text, date: String(f.date || '').slice(0, 20), commitment: String(f.commitment || '').slice(0, 200), outcome: '', variance: '', assessment: 'pending', source: ref });
      else if (f.kind === 'auditorEvent') (data.management.auditorEvents = data.management.auditorEvents || []).push({ type: ['qualification', 'emphasis', 'resignation'].includes(f.type) ? f.type : 'emphasis', date: String(f.date || '').slice(0, 20), description: text, source: ref });
      else if (f.kind === 'event') (data.management.events = data.management.events || []).push({ type: ['allegation', 'disclosed', 'regulatory_finding', 'proven'].includes(f.type) ? f.type : 'disclosed', description: text, date: String(f.date || '').slice(0, 20), source: ref, severity: 'medium' });
      else if (f.kind === 'catalyst') (data.catalysts = data.catalysts || []).push({ name: text.slice(0, 120), status: 'announced', timeline: '', impactRevenuePct: 0, probability: 0.3, evidence: ref, indicators: [] });
      else if (f.kind === 'announcement') (data.announcements = data.announcements || []).push({ id: 'doc-' + d.id + '-' + applied.length, date: String(f.date || now().slice(0, 10)), type: f.type || 'other', title: text.slice(0, 140), detail: ref });
      else continue;
      applied.push(f.kind);
    }
    if (!applied.length) throw new HttpError(400, 'Nothing to apply.');
    (data.sources = data.sources || []).push({ id: 'doc-' + d.id, title: d.filename, type: d.kind, date: now().slice(0, 10), note: `Applied: ${[...new Set(applied)].join(', ')}` });
    db.run('UPDATE documents SET parsed = ? WHERE id = ?', j({ ...parsed, applied: true }), d.id);
    const alerts = updateCompany(ctx.user, row, data, ctx.ip, 'document.apply', { document: d.id, applied });
    return { body: { applied, alerts } };
  });

  // ------------------------------------------------------------------ exports & reports
  r.get('/api/templates/financials.csv', async () => ({ raw: TEMPLATE_CSV, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="financials-template.csv"' } }), { public: true });
  const fname = (c, ext) => `${String(c.ticker || c.id).replace(/[^\w-]/g, '_')}-report-${now().slice(0, 10)}.${ext}`;
  r.get('/api/companies/:id/report.html', async (ctx) => { const row = getCompanyRow(ctx.user, ctx.params.id); const a = runAnalysis(ctx.user, row); audit(ctx.user, 'report.export', 'company', row.cid, { format: 'html' }, ctx.ip); return { raw: reportHtml(a), headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname(row.data, 'html')}"` } }; });
  r.get('/api/companies/:id/report.pdf', async (ctx) => { const row = getCompanyRow(ctx.user, ctx.params.id); const a = runAnalysis(ctx.user, row); audit(ctx.user, 'report.export', 'company', row.cid, { format: 'pdf' }, ctx.ip); return { raw: await reportPdf(a), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname(row.data, 'pdf')}"` } }; });
  r.get('/api/companies/:id/analysis.csv', async (ctx) => { const row = getCompanyRow(ctx.user, ctx.params.id); return { raw: analysisCsv(runAnalysis(ctx.user, row)), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname(row.data, 'csv')}"` } }; });
  r.get('/api/export/compare.csv', async (ctx) => {
    const ids = (ctx.query.get('ids') || '').split(',').filter(Boolean).slice(0, 8);
    if (ids.length < 2) throw new HttpError(400, 'Select at least two companies.');
    return { raw: compareCsv(ids.map((id) => runAnalysis(ctx.user, getCompanyRow(ctx.user, id)))), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="company-comparison.csv"' } };
  });

  // ------------------------------------------------------------------ integrations, AI, audit
  r.get('/api/integrations', async (ctx) => {
    const t = db.get('SELECT COUNT(*) n, MAX(last_used_at) last FROM bridge_tokens WHERE user_id = ? AND revoked = 0', ctx.user.id);
    const m = db.get("SELECT COUNT(*) total, SUM(type = 'live') live FROM macro_readings WHERE user_id = ?", ctx.user.id);
    return { body: integrationStatus({ sample: db.get("SELECT COUNT(*) n FROM companies WHERE user_id = ? AND json_extract(data, '$.dataStatus') = 'sample'", ctx.user.id).n }, { tokens: t.n, lastUsed: t.last, liveMacro: m.live || 0, totalMacro: m.total }) };
  });
  r.post('/api/ai/explain/:id', async (ctx) => { const row = getCompanyRow(ctx.user, ctx.params.id); audit(ctx.user, 'ai.explain', 'company', row.cid, null, ctx.ip); return { body: await ai.explain(runAnalysis(ctx.user, row)) }; });
  r.post('/api/ai/redteam/:id', async (ctx) => { const row = getCompanyRow(ctx.user, ctx.params.id); audit(ctx.user, 'ai.redteam', 'company', row.cid, null, ctx.ip); return { body: await ai.aiRedTeam(runAnalysis(ctx.user, row)) }; });
  r.post('/api/ai/grade/:id', async (ctx) => {
    const row = getCompanyRow(ctx.user, ctx.params.id);
    const as = assessmentOf(ctx.user, row.cid);
    if (!as) throw new HttpError(400, 'Save the assessment first.');
    if (!ai.aiConfigured()) return { body: { available: false, note: 'AI layer not configured; rule-based grading is used.' } };
    const kb = knowledgeBase(row.data);
    const grades = {};
    for (const q of EVIDENCE_QUESTIONS) { const g = await ai.gradeKnowledge(q.q, as.evidence?.[q.id] || '', kb[q.key] || []); if (g) grades[q.id] = g; }
    as.aiGrades = grades;
    db.run('UPDATE assessments SET data = ?, updated_at = ? WHERE user_id = ? AND company_id = ?', j(as), now(), ctx.user.id, row.cid);
    audit(ctx.user, 'ai.grade', 'company', row.cid, { graded: Object.keys(grades).length }, ctx.ip);
    return { body: { available: true, grades } };
  });
  r.get('/api/audit', async (ctx) => ({ body: db.all('SELECT id, action, entity, entity_id, detail, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 300', ctx.user.id).map((x) => ({ ...x, detail: pj(x.detail) })) }));

  const bridge = registerBridge(r, { db, audit, store, findCompanyRow, getCompanyRow, runAnalysis, refreshIfWatched, refreshAllWatched, compact });
  r.embedCard = (token) => {
    const p = bridge.verifyEmbed(token);
    if (!p) return null;
    const user = db.get('SELECT id, email, name FROM users WHERE id = ?', p.u);
    if (!user) return null;
    const row = db.get('SELECT * FROM companies WHERE user_id = ? AND cid = ?', p.u, p.c);
    if (!row) return null;
    return compact(runAnalysis(user, { ...row, data: pj(row.data) }));
  };
  return r;
}
