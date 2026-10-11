// Fetch wrapper: same-origin cookies, CSRF header, JSON errors.
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-Requested-With': 'terminal' };
  let payload = body;
  if (body !== undefined && !raw) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (raw) headers['Content-Type'] = raw.type || 'application/octet-stream';
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('auth:required'));
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data;
}
export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const upload = (p, file) => api(p, { method: 'POST', body: file, raw: { type: file.type || 'application/octet-stream' } });
