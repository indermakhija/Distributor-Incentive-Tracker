// Minimal HTTP toolkit: router, body parsing, responses, static files, security headers.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }

export function router() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, opts });
  };
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  return { get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o), put: (p, h, o) => add('PUT', p, h, o), patch: (p, h, o) => add('PATCH', p, h, o), del: (p, h, o) => add('DELETE', p, h, o), match };
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `Payload too large (limit ${Math.round(limit / 1048576)} MB).`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 2 * 1048576) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const isStr = typeof body === 'string';
  const payload = isBuf || isStr ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': isBuf || isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

/** Serves files under `root` for URL prefix; refuses path traversal. */
export async function serveStatic(res, root, relPath) {
  const safe = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(root, safe);
  if (!file.startsWith(root + sep) && file !== root) return false;
  try {
    const st = await stat(file);
    if (!st.isFile()) return false;
    const data = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
    return true;
  } catch { return false; }
}
