// Portfolio holdings (used by every company's portfolio-fit analysis).
import { html, mount, $, $$, inr, pct, busy, toast } from '../ui.js';
import { get, post, del, put } from '../api.js';

const FACTORS = ['consumer_demand', 'rural_income', 'commodity_inputs', 'rates', 'credit_conditions', 'capex_cycle', 'government_spending', 'global_demand', 'inr_usd', 'china_supply', 'housing_cycle', 'it_spending', 'crude_oil'];

export default async function holdings(main, { app }) {
  const [list, { settings }] = await Promise.all([get('/api/holdings'), get('/api/settings')]);
  const total = list.reduce((a, h) => a + h.value, 0) + (settings.cash || 0);
  const sectors = {};
  for (const h of list) sectors[h.sector] = (sectors[h.sector] || 0) + h.value;
  mount(main, html`
    <div class="page-head"><div><h1>My portfolio</h1><p class="muted">Used to assess concentration, sector and macro-factor overlap, liquidity and opportunity cost for every company. Values in ₹.</p></div></div>
    <div class="grid g3"><div class="tile"><div class="label">Total (incl. cash)</div><div class="value">${inr(total)}</div></div><div class="tile"><div class="label">Holdings</div><div class="value">${list.length}</div></div>
      <div class="tile"><div class="label">Cash</div><div class="value">${inr(settings.cash)}</div><div class="sub"><form id="cf" class="btn-row"><input name="cash" type="number" min="0" value="${settings.cash || 0}" style="width:140px" aria-label="Cash"><button class="btn ghost small">Update</button></form></div></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Holdings</h3>${list.length ? html`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Ticker</th><th>Sector</th><th class="num">Value</th><th class="num">Weight</th><th>Macro factors</th><th></th></tr></thead><tbody>
        ${list.map((h) => html`<tr><td>${h.name}</td><td>${h.ticker || ''}</td><td>${h.sector}</td><td class="num">${inr(h.value)}</td><td class="num">${pct(h.value / total)}</td><td><small>${h.factors.join(', ')}</small></td><td><button class="btn ghost small" data-del="${h.id}" aria-label="Remove">✕</button></td></tr>`)}</tbody></table></div>` : html`<p class="muted">No holdings yet.</p>`}
        <h4 style="margin-top:12px">Sector allocation</h4><ul>${Object.entries(sectors).sort((a, b) => b[1] - a[1]).map(([s, v]) => html`<li>${s}: ${pct(v / total)}${v / total > settings.limits.maxSector ? html` <span class="chip warn">above ${pct(settings.limits.maxSector, 0)} limit</span>` : ''}</li>`)}</ul></div>
      <div class="card"><h3>Add holding</h3><form id="hf">
        <div class="grid g2"><div class="field"><label>Name *</label><input name="name" required></div><div class="field"><label>Ticker (match a company's ticker to mark it as held)</label><input name="ticker"></div>
          <div class="field"><label>Sector</label><input name="sector" placeholder="e.g. FMCG, Financials, Index fund"></div><div class="field"><label>Current value (₹) *</label><input name="value" type="number" min="0" required></div></div>
        <div class="field"><label>Macro factors it is exposed to</label><div class="btn-row">${FACTORS.map((f) => html`<label style="font-weight:400;display:flex;gap:4px;align-items:center"><input type="checkbox" value="${f}" data-factor> ${f}</label>`)}</div></div>
        <button class="btn" type="submit">Add holding</button></form></div>
    </div>`);
  $('#hf').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { const f = Object.fromEntries(new FormData(e.target)); f.factors = $$('[data-factor]:checked', main).map((i) => i.value); await post('/api/holdings', f); toast('Holding added.'); app.invalidate(); holdings(main, { app }); }); };
  $('#cf').onsubmit = async (e) => { e.preventDefault(); await put('/api/settings', { cash: Number(new FormData(e.target).get('cash')) }); toast('Cash updated.'); app.invalidate(); holdings(main, { app }); };
  $$('[data-del]', main).forEach((b) => (b.onclick = async () => { await del(`/api/holdings/${b.dataset.del}`); app.invalidate(); holdings(main, { app }); }));
}
