// Company workspace: header (price + provenance), tab strip, and tab dispatch.
import { html, mount, $, inr, date, decisionChip, sampleBanner, toast, busy, modal } from '../ui.js';
import { put, post } from '../api.js';
import { COMPANY_TABS } from '../app.js';

const TABS = {
  overview: () => import('./tabs/overview.js'), business: () => import('./tabs/business.js'), industry: () => import('./tabs/industry.js'),
  financials: () => import('./tabs/financials.js'), management: () => import('./tabs/management.js'), moat: () => import('./tabs/moat.js'),
  prospects: () => import('./tabs/prospects.js'), risks: () => import('./tabs/risks.js'), valuation: () => import('./tabs/valuation.js'),
  investor: () => import('./tabs/investor.js'), macro: () => import('./tabs/macrotab.js'), fit: () => import('./tabs/fit.js'), scoring: () => import('./tabs/scoring.js'),
  report: () => import('./tabs/report.js'), documents: () => import('./tabs/documents.js'), thesis: () => import('./tabs/thesis.js')
};

export default async function company(main, { parts, app }) {
  const tab = TABS[parts[2]] ? parts[2] : 'overview';
  const { company: c, analysis: a } = app.co;
  const m = c.market || {};
  const stale = a.dataQuality.items.find((i) => i.section === 'Market price')?.stale;
  mount(main, html`
    ${sampleBanner(c)}
    <div class="co-head">
      <div>
        <div class="co-name">${c.name}</div>
        <div class="co-meta">${c.ticker || '—'} · ${c.exchange || ''} ${c.isin ? '· ' + c.isin : ''} · ${c.sector || ''} · ${c.industry?.name || ''} · type: ${c.businessType || 'compounder'}</div>
      </div>
      <div style="text-align:right">
        <div class="price">${inr(m.price, 2)}</div>
        <div class="co-meta">as of ${date(m.priceDate)} · ${m.source || 'no source'} ${stale ? html`<span class="chip warn">stale</span>` : ''}
          <button class="btn ghost small" id="priceBtn">Update price</button></div>
        <div style="margin-top:4px">${decisionChip(a.decision.code, a.decision.label)} ${a.decision.status === 'provisional' ? html`<span class="chip">provisional</span>` : ''} <span class="chip neutral">Score ${a.aggregate.holistic}</span></div>
      </div>
    </div>
    <nav class="tabs" aria-label="Company sections">${COMPANY_TABS.map(([t, l]) => html`<a href="#/c/${c.id}/${t}" class="${t === tab ? 'active' : ''}">${l}</a>`)}</nav>
    <section id="tabBody"></section>`);
  $('#priceBtn').onclick = () => priceModal(app, c);
  const mod = await TABS[tab]();
  await mod.default($('#tabBody'), { app, rerender: () => company(main, { parts, app }) });
}

function priceModal(app, c) {
  modal(html`<h2>Update market price</h2>
    <p class="muted">Every price must carry a date and source so stale data is never silently used. Live quotes require a licensed provider (see Settings → Integrations).</p>
    <form id="pf"><div class="grid g3">
      <div class="field"><label>Price (₹)</label><input name="price" type="number" step="any" required value="${c.market?.price ?? ''}"></div>
      <div class="field"><label>Price date</label><input name="priceDate" type="date" required value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>Shares outstanding (Cr)</label><input name="sharesOutstanding" type="number" step="any" value="${c.market?.sharesOutstanding ?? ''}"></div>
    </div><div class="field"><label>Source</label><input name="source" placeholder="e.g. NSE closing price" value="Manual entry"></div>
    <div class="btn-row"><button class="btn" type="submit">Save price</button><button class="btn ghost" type="button" id="liveBtn">Try live quote</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`, (el, close) => {
    $('#pf', el).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.sharesOutstanding === '') delete f.sharesOutstanding;
      await busy(e.submitter, async () => { const r = await put(`/api/companies/${c.id}/price`, f); toast('Price updated.'); if (r.alerts?.length) toast(`${r.alerts.length} alert(s) generated.`); });
      close(); await app.loadCompany(c.id, true); dispatchEvent(new HashChangeEvent('hashchange'));
    };
    $('#liveBtn', el).onclick = async (e) => {
      const r = await busy(e.target, () => post(`/api/companies/${c.id}/refresh-price`));
      if (!r.ok) return toast(r.error, true);
      toast(`Live price ₹${r.price} from ${r.source}`); close(); await app.loadCompany(c.id, true); dispatchEvent(new HashChangeEvent('hashchange'));
    };
  });
}
