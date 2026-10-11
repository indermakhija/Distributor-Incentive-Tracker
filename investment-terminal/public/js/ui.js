// UI helpers: escaped HTML templating, formatters, shared components and chart wrappers.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __html: String(s ?? '') });
const render = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(render).join('') : typeof v === 'object' && '__html' in v ? v.__html : esc(v));
/** Tagged template: interpolations are escaped unless wrapped in raw()/html``. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? render(vals[i]) : ''); });
  return { __html: out };
}
export const mount = (el, tpl) => { el.innerHTML = tpl.__html; return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const on = (root, event, selector, fn) => root.addEventListener(event, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(e, t); });

// Formatters
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const pct = (v, dp = 1) => (isNum(v) ? `${(v * 100).toFixed(dp)}%` : '—');
export const num = (v, dp = 0) => (isNum(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: dp }) : '—');
export const inr = (v, dp = 0) => (isNum(v) ? `₹${num(v, dp)}` : '—');
export const cr = (v) => (isNum(v) ? `₹${num(v)} Cr` : '—');
export const x = (v, dp = 1) => (isNum(v) ? `${v.toFixed(dp)}x` : '—');
export const date = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const dt = (s) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Components
const PROV = { reported: 'Reported', uploaded: 'Uploaded', sample: 'Sample', calculated: 'Calculated', external_forecast: 'Forecast', ai_estimate: 'AI estimate', assumption: 'Assumption', judgment: 'Judgment', manual: 'Manual', 'auto-derived assumption': 'Assumption', 'user assumption': 'User assumption' };
export const prov = (type) => html`<span class="prov ${type === 'ai_estimate' ? 'ai' : String(type || '').split(' ')[0]}" title="Provenance">${PROV[type] || type || 'unknown'}</span>`;
export const scoreBar = (s, max = 10) => html`<div class="score-bar" role="img" aria-label="${isNum(s) ? s + ' of ' + max : 'not scored'}"><span style="width:${isNum(s) ? Math.max(2, (s / max) * 100) : 0}%"></span></div>`;
export const scoreText = (s, max = 10) => (isNum(s) ? html`<span class="score-pill">${s}</span><small>/${max}</small>` : html`<span class="muted">n/a</span>`);
export const decisionChip = (code, label) => {
  const tone = { BUY: 'pos', BUY_BELOW: 'pos', WAIT: 'warn', WATCHLIST: 'neutral', HOLD: 'neutral', REDUCE: 'warn', SELL_AVOID: 'neg', INSUFFICIENT: '' }[code] ?? '';
  return html`<span class="chip ${tone}">${label || code?.replace('_', ' ') || '—'}</span>`;
};
export const sev = (s) => html`<span class="sev ${s}">${s}</span>`;
export const statusChip = (s) => html`<span class="chip ${{ active: 'pos', configured: 'pos', live: 'pos', not_configured: '', error: 'neg' }[s] ?? ''}">${String(s).replace('_', ' ')}</span>`;
export const list = (items, empty = 'None identified from the available evidence.') => (items?.length ? html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>` : html`<p class="muted">${empty}</p>`);
export const empty = (msg) => html`<div class="empty">${msg}</div>`;
export const sampleBanner = (c) => (c?.dataStatus === 'sample' ? html`<div class="banner sample"><b>Illustrative sample data.</b> ${c.sampleNote || 'Fictional company — not a real security. Figures are synthetic and not real-time.'}</div>` : c?.sampleNote ? html`<div class="banner sample">${c.sampleNote}</div>` : '');

export function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), isErr ? 7000 : 3500);
}

export function modal(tpl, onMount) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-back" role="dialog" aria-modal="true"><div class="modal">${tpl.__html}</div></div>`;
  const back = root.firstChild;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  onMount?.(back.firstChild, close);
  back.querySelector('input,textarea,select,button')?.focus();
  return close;
}

/** Runs an async action with button busy state and error toast. */
export async function busy(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + label; }
  try { return await fn(); } catch (e) { toast(e.message, true); throw e; } finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}

// Charts (Chart.js). Colors are read from CSS tokens so light/dark both use validated steps.
const charts = new WeakMap();
export const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const series = (i) => token(['--s1', '--s2', '--s3', '--s4', '--s5', '--s7'][i] || '--s1');

export function chart(canvas, config) {
  if (!window.Chart || !canvas) return null;
  charts.get(canvas)?.destroy();
  const ink = token('--text-2'), grid = token('--grid'), muted = token('--muted');
  const base = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: token('--surface'), titleColor: token('--text'), bodyColor: token('--text'), borderColor: token('--border-strong'), borderWidth: 1, padding: 10, usePointStyle: true }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: muted, font: { size: 11 } }, border: { color: token('--axis') } },
      y: { grid: { color: grid }, ticks: { color: muted, font: { size: 11 } }, border: { display: false } }
    },
    elements: { line: { borderWidth: 2, tension: 0.25 }, point: { radius: 0, hoverRadius: 5, hitRadius: 10 }, bar: { borderRadius: 4, borderSkipped: 'start' } },
    color: ink
  };
  const merged = deepMerge(base, config.options || {});
  const c = new window.Chart(canvas, { ...config, options: merged });
  charts.set(canvas, c);
  return c;
}
const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
};
export const legend = (items) => html`<div class="chart-legend">${items.map(([label, color]) => html`<span><i style="background:${color}"></i>${label}</span>`)}</div>`;

/** Diverging cell colour for heatmaps: value relative to a reference (price). */
export function heatColor(v, ref) {
  if (!isNum(v) || !isNum(ref) || ref === 0) return 'transparent';
  const t = Math.max(-1, Math.min(1, (v - ref) / ref));
  const pole = t >= 0 ? token('--div-pos') : token('--div-neg');
  return `color-mix(in srgb, ${pole} ${Math.round(Math.abs(t) * 70)}%, ${token('--div-mid')})`;
}

export function downloadLink(href, label) { return html`<a class="btn ghost small" href="${href}" download>${label}</a>`; }
