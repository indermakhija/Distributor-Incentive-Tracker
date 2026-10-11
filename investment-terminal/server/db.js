// Persistence: SQLite via Node's built-in node:sqlite (Node ≥ 22.5). Documents are stored as JSON columns.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies (uid INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, cid TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, cid));
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT, filename TEXT, kind TEXT, mime TEXT, size INTEGER, status TEXT, text TEXT, parsed TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analyses (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT NOT NULL, created_at TEXT NOT NULL, decision TEXT, holistic REAL, summary TEXT, full TEXT);
CREATE TABLE IF NOT EXISTS assessments (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, company_id));
CREATE TABLE IF NOT EXISTS theses (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT NOT NULL, analysis_id INTEGER, decision TEXT, price REAL, notes TEXT, review TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watchlist (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT NOT NULL, prefs TEXT, added_at TEXT NOT NULL, PRIMARY KEY(user_id, company_id));
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT, severity TEXT, title TEXT, what TEXT, why TEXT, reassess INTEGER, read INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS holdings (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT, ticker TEXT, sector TEXT, value REAL, factors TEXT, avg_cost REAL);
CREATE TABLE IF NOT EXISTS settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS redteam_reviews (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, company_id TEXT NOT NULL, responses TEXT, acknowledged_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS macro_readings (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, factor_id TEXT NOT NULL, value REAL NOT NULL, previous REAL, neutral REAL, as_of TEXT, source TEXT, type TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, factor_id));
CREATE TABLE IF NOT EXISTS macro_history (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, factor_id TEXT NOT NULL, value REAL NOT NULL, as_of TEXT, source TEXT, type TEXT, recorded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bridge_tokens (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, revoked INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_macro_hist ON macro_history(user_id, factor_id, as_of);
CREATE INDEX IF NOT EXISTS idx_analyses ON analyses(user_id, company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts ON alerts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(user_id, created_at);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const stmtCache = new Map();
  const prep = (sql) => { let s = stmtCache.get(sql); if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); } return s; };
  return {
    raw: db,
    get: (sql, ...p) => prep(sql).get(...p),
    all: (sql, ...p) => prep(sql).all(...p),
    run: (sql, ...p) => prep(sql).run(...p),
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    close: () => db.close()
  };
}

export const now = () => new Date().toISOString();
export const j = (v) => JSON.stringify(v ?? null);
export const pj = (s, fallback = null) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };
