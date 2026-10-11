// Screen 2: company search & discovery + new-company creation.
import { html, mount, $, inr, date, decisionChip, busy, toast } from '../ui.js';
import { get, post } from '../api.js';

export default async function search(main, { query, app }) {
  const q = query.get('q') || '';
  const list = await get(`/api/companies?q=${encodeURIComponent(q)}`);
  mount(main, html`
    <div class="page-head"><h1>Search & discovery</h1></div>
    <div class="grid g2">
      <div class="card"><form id="sf" class="btn-row"><input name="q" type="search" value="${q}" placeholder="Name, NSE/BSE ticker, ISIN, sector…" style="flex:1" aria-label="Search"><button class="btn">Search</button></form>
        <p class="muted" style="margin-top:8px">${list.length} result(s). Live identification from exchange databases requires a licensed data feed (not configured) — create the company below and upload its filings.</p>
        <div class="table-wrap"><table><thead><tr><th>Company</th><th>Ticker / ISIN</th><th>Sector / industry</th><th class="num">Price</th><th>Last decision</th><th></th></tr></thead><tbody>
        ${list.map((c) => html`<tr><td><a href="#/c/${c.id}/overview">${c.name}</a> ${c.dataStatus === 'sample' ? html`<span class="prov sample">sample</span>` : html`<span class="prov ${c.dataStatus}">${c.dataStatus}</span>`}</td><td>${c.ticker || '—'}<br><small class="muted">${c.isin || ''}</small></td><td>${c.sector || ''}<br><small class="muted">${c.industry || ''}</small></td><td class="num">${inr(c.price, 2)}<br><small class="muted">${date(c.priceDate)}</small></td><td>${c.lastSnapshot ? decisionChip(c.lastSnapshot.decision) : '—'}</td><td><input type="checkbox" data-cmp="${c.id}" aria-label="Select ${c.name} to compare"></td></tr>`)}
        </tbody></table></div>
        <button class="btn ghost small" id="cmpBtn" style="margin-top:8px">Compare selected</button></div>
      <div class="card" id="newCo"><h3>Analyse a new company</h3>
        <form id="nf"><div class="grid g2">
          <div class="field"><label>Company name *</label><input name="name" required maxlength="200"></div>
          <div class="field"><label>NSE/BSE ticker</label><input name="ticker" maxlength="30"></div>
          <div class="field"><label>Exchange</label><select name="exchange"><option>NSE</option><option>BSE</option></select></div>
          <div class="field"><label>ISIN</label><input name="isin" pattern="IN[A-Z0-9]{10}" placeholder="INE…" title="12 characters starting with IN"></div>
          <div class="field"><label>Sector</label><input name="sector"></div>
          <div class="field"><label>Industry</label><input name="industry"></div>
          <div class="field"><label>Business type</label><select name="businessType">${['compounder', 'growth', 'cyclical', 'financial', 'asset_heavy', 'turnaround', 'conglomerate'].map((t) => html`<option>${t}</option>`)}</select></div>
          <div class="field"><label>Company website</label><input name="website" type="url" placeholder="https://"></div>
        </div><div class="field"><label>Your investment thesis (optional — you will be challenged on it)</label><textarea name="thesis" rows="3"></textarea></div>
        <button class="btn" type="submit">Create & go to documents</button></form>
        <p class="muted" style="margin-top:8px">Next: upload financial statements (CSV/XLSX template) and research PDFs, enter the dated market price, then work through each module. Nothing is fabricated — missing data is shown as missing.</p></div>
    </div>`);
  $('#sf').onsubmit = (e) => { e.preventDefault(); app.go(`#/search?q=${encodeURIComponent(new FormData(e.target).get('q'))}`); };
  $('#cmpBtn').onclick = () => { const ids = [...main.querySelectorAll('[data-cmp]:checked')].map((i) => i.dataset.cmp); if (ids.length < 2) return toast('Select at least two companies.', true); app.go(`#/compare?ids=${ids.join(',')}`); };
  $('#nf').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { const f = Object.fromEntries(new FormData(e.target)); for (const k of Object.keys(f)) if (f[k] === '') delete f[k]; const c = await post('/api/companies', f); toast('Company created.'); app.go(`#/c/${c.id}/documents`); }); };
  if (query.get('new')) $('#newCo').scrollIntoView();
}
