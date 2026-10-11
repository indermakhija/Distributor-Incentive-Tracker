// SPA bootstrap: auth gate, hash router, shared company state. The same engine modules run here and on the server.
import { get, post, ApiError } from './api.js';
import { html, mount, $, toast, esc } from './ui.js';
import { analyze } from '/engine/analyze.js';

const views = {
  home: () => import('./views/home.js'), search: () => import('./views/search.js'), compare: () => import('./views/compare.js'),
  watchlist: () => import('./views/watchlist.js'), decisions: () => import('./views/decisions.js'), portfolio: () => import('./views/holdings.js'),
  settings: () => import('./views/settings.js'), macro: () => import('./views/macro.js'), company: () => import('./views/company.js')
};

export const COMPANY_TABS = [
  ['overview', 'Overview'], ['business', 'Business model'], ['industry', 'Industry & peers'], ['financials', 'Financials'], ['management', 'Management'],
  ['moat', 'Moat'], ['prospects', 'Prospects & scenarios'], ['risks', 'Risk register'], ['valuation', 'Valuation lab'], ['investor', 'Self-assessment'],
  ['macro', 'Macro factors'], ['fit', 'Portfolio fit'], ['scoring', 'Holistic score'], ['report', 'Decision report'], ['documents', 'Documents & sources'], ['thesis', 'Thesis tracker']
];

export const app = {
  user: null,
  co: null, // { id, company, ctx, analysis, updatedAt }
  async loadCompany(id, force = false) {
    if (!force && this.co?.id === id) return this.co;
    const ctx = await get(`/api/companies/${encodeURIComponent(id)}/context`);
    this.co = { id, company: ctx.company, ctx, updatedAt: ctx.updatedAt };
    this.recompute();
    return this.co;
  },
  /** Re-runs the full analysis locally (instant) — used by interactive scenario and weight controls. */
  recompute(companyOverride) {
    const { ctx } = this.co;
    this.co.analysis = analyze(companyOverride || this.co.company, {
      settings: ctx.settings, assessment: ctx.assessment, holdings: ctx.holdings, cash: ctx.cash, thesis: ctx.thesis,
      alternatives: ctx.alternatives, holder: ctx.holder, redTeamAcknowledged: ctx.redTeamAcknowledged, macro: ctx.macro
    });
    return this.co.analysis;
  },
  invalidate() { this.co = null; },
  go(hash) { location.hash = hash; },
  async refreshAlerts() {
    try {
      const alerts = await get('/api/alerts');
      const n = alerts.filter((a) => !a.read).length;
      const b = $('#alertCount');
      b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
    } catch { /* non-critical */ }
  }
};

function parseHash() {
  const [path, qs] = (location.hash.slice(1) || '/home').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(qs || '') };
}

function renderSidebar(parts) {
  const cur = parts[0] === 'c' ? `c/${parts[1]}/${parts[2] || 'overview'}` : parts[0];
  const link = (href, label, icon) => html`<a href="#/${href}" class="${cur === href ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</a>`;
  const co = parts[0] === 'c' && app.co?.id === parts[1] ? app.co.company : null;
  mount($('#sidebar'), html`
    <div class="group"><div class="group-title">Terminal</div>
      ${link('home', 'Home dashboard', '⌂')}${link('search', 'Search & discovery', '⌕')}${link('compare', 'Compare companies', '⇆')}${link('macro', 'Macro dashboard', '🌐')}
      ${link('watchlist', 'Watchlist & alerts', '◉')}${link('decisions', 'Decision history', '☰')}${link('portfolio', 'My portfolio', '◧')}${link('settings', 'Settings & scoring', '⚙')}
    </div>
    ${co ? html`<div class="group company-nav"><div class="group-title">${co.name}</div>${COMPANY_TABS.map(([t, l]) => link(`c/${parts[1]}/${t}`, l, '·'))}</div>` : ''}
  `);
}

let navToken = 0;
async function route() {
  if (!app.user) return;
  const { parts, query } = parseHash();
  const name = parts[0] === 'c' ? 'company' : parts[0] || 'home';
  const loader = views[name] || views.home;
  const main = $('#main');
  const my = ++navToken;
  $('#sidebar').classList.remove('open');
  try {
    if (name === 'company') await app.loadCompany(parts[1]);
    if (my !== navToken) return;
    renderSidebar(parts);
    const mod = await loader();
    if (my !== navToken) return;
    await mod.default(main, { parts, query, app });
    main.focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    mount(main, html`<div class="banner crit"><b>Could not load this screen.</b> ${e.message}</div>`);
    console.error(e);
  }
}

function showAuth(mode = 'login') {
  $('#shell').hidden = true;
  const el = $('#auth');
  el.hidden = false;
  mount(el, html`<div class="card auth-card">
    <h1><span class="brand-mark">◆</span> Holistic Investment Terminal</h1>
    <p class="muted">Understand the business. Challenge the thesis. Value the future. Protect the downside. Know yourself before investing.</p>
    <form id="authForm">
      ${mode === 'register' ? html`<div class="field"><label for="an">Name</label><input id="an" name="name" autocomplete="name"></div>` : ''}
      <div class="field"><label for="ae">Email</label><input id="ae" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="ap">Password</label><input id="ap" name="password" type="password" required minlength="${mode === 'register' ? 10 : 1}" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}">
      ${mode === 'register' ? html`<small>At least 10 characters with letters and digits.</small>` : ''}</div>
      <div class="btn-row"><button class="btn" type="submit">${mode === 'register' ? 'Create account' : 'Sign in'}</button>
      <a href="#" id="authSwitch">${mode === 'register' ? 'I have an account' : 'Create an account'}</a></div>
      <p id="authErr" class="muted" role="alert"></p>
    </form>
    <p class="muted" style="font-size:12px">New accounts include four fictional, clearly-labelled sample companies to explore the workflow. Decision support only — not investment advice.</p>
  </div>`);
  $('#authSwitch').onclick = (e) => { e.preventDefault(); showAuth(mode === 'register' ? 'login' : 'register'); };
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await post(`/api/auth/${mode}`, f);
      await start();
    } catch (err) { $('#authErr').textContent = err.message; }
  };
}

async function start() {
  try { app.user = await get('/api/auth/me'); } catch { app.user = null; return showAuth(); }
  $('#auth').hidden = true;
  $('#shell').hidden = false;
  app.refreshAlerts();
  route();
}

function initTheme() {
  let t = null;
  try { t = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  if (t) document.documentElement.dataset.theme = t;
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    route();
  };
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:required', () => { app.user = null; showAuth(); });
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#logoutBtn').onclick = async () => { try { await post('/api/auth/logout'); } finally { app.user = null; app.co = null; showAuth(); } };
  $('#topSearch').onsubmit = (e) => { e.preventDefault(); app.go(`#/search?q=${encodeURIComponent(new FormData(e.target).get('q') || '')}`); };
  start();
});
export { esc, toast };
