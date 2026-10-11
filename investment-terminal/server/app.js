// HTTP application: wires auth, CSRF protection, API routes, static assets and error handling.
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { userFromRequest } from './auth.js';
import { send, serveStatic, HttpError } from './http.js';
import { buildApi } from './api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ dbFile = join(ROOT, 'data', 'terminal.db'), log = console } = {}) {
  const db = openDb(dbFile);
  const trustProxy = process.env.TRUST_PROXY === '1';
  const secureCookies = (req) => process.env.COOKIE_SECURE === '1' || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const api = buildApi({ db, sampleDir: join(ROOT, 'data', 'sample'), secureCookies });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = api.match(req.method, url.pathname);
        if (!route) throw new HttpError(404, 'Not found.');
        // CSRF defence in depth (cookies are already SameSite=Strict): state-changing requests must be same-origin.
        if (req.method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request rejected.');
          if (req.headers['x-requested-with'] !== 'terminal') throw new HttpError(403, 'Missing X-Requested-With header.');
        }
        const user = userFromRequest(db, req);
        if (!route.opts.public && !user) throw new HttpError(401, 'Authentication required.');
        const out = await route.handler({ req, res, user, params: route.params, query: url.searchParams, ip });
        if (out.raw !== undefined) return send(res, out.status || 200, out.raw, out.headers);
        return send(res, out.status || 200, out.body ?? {}, out.headers);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      if (url.pathname === '/vendor/chart.umd.js' && (await serveStatic(res, join(ROOT, 'node_modules', 'chart.js', 'dist'), 'chart.umd.js'))) return;
      if (url.pathname.startsWith('/engine/') && (await serveStatic(res, join(ROOT, 'engine'), url.pathname.slice(8)))) return;
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (await serveStatic(res, join(ROOT, 'public'), rel)) return;
      if (!/\.\w+$/.test(url.pathname) && (await serveStatic(res, join(ROOT, 'public'), 'index.html'))) return;
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) log.error?.('[error]', req.method, url.pathname, e);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'Internal server error.' : e.message, details: e.details });
    }
  });
  server.on('close', () => db.close());
  return { server, db };
}
