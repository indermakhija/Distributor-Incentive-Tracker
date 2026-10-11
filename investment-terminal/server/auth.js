// Authentication: scrypt password hashing, opaque session tokens (hashed at rest), HttpOnly SameSite=Strict cookies.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { now } from './db.js';

const COOKIE = 'hit_session';
const SESSION_DAYS = 7;
const sha = (s) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function validateCredentials(email, password) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return 'A valid email is required.';
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return 'Password must be 10–200 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and digits.';
  return null;
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', sha(token), userId, now(), exp);
  return { token, expires: exp };
}

export function destroySession(db, token) { if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token)); }

export function userFromRequest(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.get('SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', sha(token));
  if (!row) return null;
  if (row.expires_at < now()) { destroySession(db, token); return null; }
  return { id: row.id, email: row.email, name: row.name, token };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, clear = false } = {}) {
  const attrs = [`${COOKIE}=${clear ? '' : token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Simple fixed-window limiter for login/register attempts per IP+email. */
export function makeRateLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const h = hits.get(key);
    if (!h || t - h.start > windowMs) { hits.set(key, { start: t, n: 1 }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}
