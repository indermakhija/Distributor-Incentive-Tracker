// Macro dataset store + Nifty-terminal bridge.
//
// Bridge design (stack-agnostic):
//   • The Nifty terminal (which already has live market connectivity) PUSHES live macro readings and quotes here,
//     authenticated by a per-user bridge token (Authorization: Bearer hit_...). Tokens are stored hashed.
//   • Its backend PULLS a compact analysis for any ticker (GET /api/bridge/analysis?ticker=...).
//   • Its analyser page EMBEDS the analysis card via a short-lived signed iframe URL (GET /api/bridge/embed-link),
//     so no long-lived secret ever reaches the browser. Allowed iframe parents come from EMBED_ALLOWED_ORIGINS.
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, readJson } from './http.js';
import { now, j, pj } from './db.js';
import { MACRO_FACTORS, FACTOR, STRESS_SCENARIOS, SECTOR_TEMPLATES, macroSignals, macroDatasetQuality } from '../engine/macro.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const EMBED_SECRET = process.env.EMBED_SECRET || randomBytes(32).toString('hex');
const EMBED_TTL_MS = 15 * 60 * 1000;
const LOOKBACK_DAYS = { daily: 30, event: 90, monthly: 90, quarterly: 180, seasonal: 365, annual: 365 };

export function macroStore(db) {
  const dataset = (userId) => Object.fromEntries(db.all('SELECT * FROM macro_readings WHERE user_id = ?', userId).map((r) => [r.factor_id, { value: r.value, previous: r.previous, neutral: r.neutral, asOf: r.as_of, source: r.source, type: r.type, updatedAt: r.updated_at }]));

  /** Upserts one reading. `previous` = the most recent historical reading at least one lookback window older. */
  const upsert = (userId, { factorId, value, asOf, source, type, previous, neutral }) => {
    const f = FACTOR[factorId];
    if (!f) throw new HttpError(400, `Unknown macro factor "${factorId}".`);
    const v = Number(value);
    if (!Number.isFinite(v)) throw new HttpError(400, `Value for ${factorId} must be a number.`);
    if (!asOf || Number.isNaN(Date.parse(asOf))) throw new HttpError(400, `asOf date required for ${factorId} — undated readings are not accepted.`);
    if (Date.parse(asOf) > Date.now() + 864e5) throw new HttpError(400, `asOf for ${factorId} is in the future.`);
    let prev = previous == null || previous === '' ? null : Number(previous);
    if (prev == null) {
      const cutoff = new Date(Date.parse(asOf) - (LOOKBACK_DAYS[f.frequency] || 90) * 864e5).toISOString();
      prev = db.get('SELECT value FROM macro_history WHERE user_id = ? AND factor_id = ? AND as_of <= ? ORDER BY as_of DESC LIMIT 1', userId, factorId, cutoff)?.value
        ?? db.get('SELECT previous FROM macro_readings WHERE user_id = ? AND factor_id = ?', userId, factorId)?.previous ?? null;
    }
    const n = neutral == null || neutral === '' ? db.get('SELECT neutral FROM macro_readings WHERE user_id = ? AND factor_id = ?', userId, factorId)?.neutral ?? null : Number(neutral);
    db.run(`INSERT INTO macro_readings (user_id, factor_id, value, previous, neutral, as_of, source, type, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id, factor_id) DO UPDATE SET value = excluded.value, previous = excluded.previous, neutral = excluded.neutral, as_of = excluded.as_of, source = excluded.source, type = excluded.type, updated_at = excluded.updated_at`,
    userId, factorId, v, Number.isFinite(prev) ? prev : null, Number.isFinite(n) ? n : null, asOf, String(source || 'unknown').slice(0, 120), type, now());
    db.run('INSERT INTO macro_history (user_id, factor_id, value, as_of, source, type, recorded_at) VALUES (?,?,?,?,?,?,?)', userId, factorId, v, asOf, String(source || '').slice(0, 120), type, now());
  };

  const seedSample = (userId, file) => {
    if (db.get('SELECT 1 FROM macro_readings WHERE user_id = ? LIMIT 1', userId)) return;
    const { readings } = JSON.parse(readFileSync(file, 'utf8'));
    for (const [factorId, r] of Object.entries(readings)) upsert(userId, { factorId, value: r.value, previous: r.previous, asOf: r.asOf, source: r.source, type: 'sample' });
  };
  return { dataset, upsert, seedSample };
}

export function bridgeAuth(db, req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(hit_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const row = db.get('SELECT t.id, t.user_id, u.email, u.name FROM bridge_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked = 0', sha(m[1]));
  if (!row) return null;
  db.run('UPDATE bridge_tokens SET last_used_at = ? WHERE id = ?', now(), row.id);
  return { id: row.user_id, email: row.email, name: row.name, via: 'bridge', tokenId: row.id };
}

export const signEmbed = (userId, cid) => {
  const payload = Buffer.from(JSON.stringify({ u: userId, c: cid, e: Date.now() + EMBED_TTL_MS })).toString('base64url');
  return `${payload}.${createHmac('sha256', EMBED_SECRET).update(payload).digest('base64url')}`;
};
export const verifyEmbed = (t) => {
  const [payload, sig] = String(t || '').split('.');
  if (!payload || !sig) return null;
  // Compare the canonical base64url string, so non-canonical encodings of the same bytes are rejected too.
  const expect = Buffer.from(createHmac('sha256', EMBED_SECRET).update(payload).digest('base64url'));
  const got = Buffer.from(sig);
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  const p = pj(Buffer.from(payload, 'base64url').toString());
  return p && p.e > Date.now() ? p : null;
};

/** Registers macro + bridge routes. deps come from buildApi. */
export function registerBridge(r, deps) {
  const { db, audit, store, findCompanyRow, getCompanyRow, runAnalysis, refreshIfWatched, refreshAllWatched, compact } = deps;

  // ---- Macro dataset (session auth)
  r.get('/api/macro', async (ctx) => {
    const ds = store.dataset(ctx.user.id);
    const signals = macroSignals(ds);
    return { body: { factors: MACRO_FACTORS, readings: ds, signals, quality: macroDatasetQuality(signals), stressScenarios: STRESS_SCENARIOS, sectorTemplates: Object.fromEntries(Object.entries(SECTOR_TEMPLATES).filter(([, t]) => !t.ref)) } };
  });
  r.put('/api/macro/:factorId', async (ctx) => {
    const b = await readJson(ctx.req);
    store.upsert(ctx.user.id, { factorId: ctx.params.factorId, value: b.value, previous: b.previous, neutral: b.neutral, asOf: b.asOf, source: b.source || 'Manual entry', type: 'manual' });
    audit(ctx.user, 'macro.update', 'macro', ctx.params.factorId, { value: b.value, asOf: b.asOf }, ctx.ip);
    const alerts = refreshAllWatched(ctx.user, ctx.ip);
    return { body: { ok: true, alerts } };
  });
  r.get('/api/macro/history/:factorId', async (ctx) => ({ body: db.all('SELECT value, as_of, source, type, recorded_at FROM macro_history WHERE user_id = ? AND factor_id = ? ORDER BY as_of DESC, id DESC LIMIT 200', ctx.user.id, ctx.params.factorId) }));

  // ---- Bridge tokens (session auth)
  r.get('/api/bridge/tokens', async (ctx) => ({ body: db.all('SELECT id, name, created_at, last_used_at, revoked FROM bridge_tokens WHERE user_id = ? ORDER BY id DESC', ctx.user.id) }));
  r.post('/api/bridge/tokens', async (ctx) => {
    const { name } = await readJson(ctx.req);
    const token = 'hit_' + randomBytes(24).toString('base64url');
    const info = db.run('INSERT INTO bridge_tokens (user_id, name, token_hash, created_at) VALUES (?,?,?,?)', ctx.user.id, String(name || 'Nifty terminal').slice(0, 60), sha(token), now());
    audit(ctx.user, 'bridge.token_create', 'bridge_token', info.lastInsertRowid, { name }, ctx.ip);
    return { status: 201, body: { id: Number(info.lastInsertRowid), token, note: 'Shown once. Store it in the Nifty terminal backend as a secret — never in browser code.' } };
  });
  r.del('/api/bridge/tokens/:id', async (ctx) => {
    db.run('UPDATE bridge_tokens SET revoked = 1 WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    audit(ctx.user, 'bridge.token_revoke', 'bridge_token', ctx.params.id, null, ctx.ip);
    return { body: { ok: true } };
  });

  // ---- Bridge endpoints (bearer-token auth; called server-to-server by the Nifty terminal)
  r.post('/api/bridge/macro', async (ctx) => {
    const { readings } = await readJson(ctx.req);
    if (!Array.isArray(readings) || !readings.length || readings.length > 200) throw new HttpError(400, 'Body must be { readings: [{ factorId, value, asOf, source }] } (1–200 items).');
    const accepted = [], rejected = [];
    for (const rd of readings) {
      try { store.upsert(ctx.user.id, { factorId: rd.factorId, value: rd.value, previous: rd.previous, asOf: rd.asOf, source: rd.source || 'Nifty terminal (live)', type: 'live' }); accepted.push(rd.factorId); }
      catch (e) { rejected.push({ factorId: rd.factorId, error: e.message }); }
    }
    audit(ctx.user, 'bridge.macro_push', 'macro', null, { accepted: accepted.length, rejected: rejected.length }, ctx.ip);
    const alerts = accepted.length ? refreshAllWatched(ctx.user, ctx.ip) : [];
    return { body: { accepted, rejected, alerts: alerts.length } };
  }, { bridge: true });

  r.post('/api/bridge/quotes', async (ctx) => {
    const { quotes } = await readJson(ctx.req);
    if (!Array.isArray(quotes) || !quotes.length || quotes.length > 500) throw new HttpError(400, 'Body must be { quotes: [{ ticker|isin, price, timestamp, source }] } (1–500 items).');
    const updated = [], unmatched = [], rejected = [];
    let alerts = 0;
    for (const q of quotes) {
      const price = Number(q.price);
      const ts = q.timestamp ? Date.parse(q.timestamp) : NaN;
      if (!(price > 0) || Number.isNaN(ts) || ts > Date.now() + 864e5) { rejected.push({ ticker: q.ticker, error: 'price > 0 and a valid, non-future timestamp are required' }); continue; }
      const row = findCompanyRow(ctx.user, q);
      if (!row) { unmatched.push(q.ticker || q.isin); continue; }
      if (row.data.dataStatus === 'sample') { rejected.push({ ticker: q.ticker, error: 'sample companies are fictional and never receive live prices' }); continue; }
      const data = { ...row.data, market: { ...row.data.market, price, priceDate: new Date(ts).toISOString().slice(0, 10), priceTimestamp: new Date(ts).toISOString(), source: String(q.source || 'Nifty terminal (live)').slice(0, 120), type: 'live' } };
      if (Number(q.avgDailyValueCr) > 0) data.market.avgDailyValueCr = Number(q.avgDailyValueCr);
      db.run('UPDATE companies SET data = ?, updated_at = ? WHERE uid = ?', j(data), now(), row.uid);
      alerts += refreshIfWatched(ctx.user, row.cid, ctx.ip).length;
      updated.push(row.data.ticker);
    }
    audit(ctx.user, 'bridge.quotes_push', 'company', null, { updated: updated.length, unmatched: unmatched.length }, ctx.ip);
    return { body: { updated, unmatched, rejected, alerts } };
  }, { bridge: true });

  r.get('/api/bridge/analysis', async (ctx) => {
    const row = findCompanyRow(ctx.user, { ticker: ctx.query.get('ticker'), isin: ctx.query.get('isin') });
    if (!row) throw new HttpError(404, 'No analysed company with that ticker/ISIN. Create it in the terminal first.');
    return { body: compact(runAnalysis(ctx.user, row)) };
  }, { bridge: true });

  r.get('/api/bridge/embed-link', async (ctx) => {
    const row = findCompanyRow(ctx.user, { ticker: ctx.query.get('ticker'), isin: ctx.query.get('isin') });
    if (!row) throw new HttpError(404, 'No analysed company with that ticker/ISIN.');
    const origin = process.env.PUBLIC_URL || `http://${ctx.req.headers.host}`;
    return { body: { url: `${origin}/embed/analyser?t=${signEmbed(ctx.user.id, row.cid)}`, expiresInSeconds: EMBED_TTL_MS / 1000 } };
  }, { bridge: true });

  // Same compact payload for the logged-in UI (lets users preview what the Nifty terminal will show).
  r.get('/api/companies/:id/compact', async (ctx) => ({ body: compact(runAnalysis(ctx.user, getCompanyRow(ctx.user, ctx.params.id))) }));
  return { verifyEmbed };
}
