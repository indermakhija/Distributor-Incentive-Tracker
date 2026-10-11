// Screen 16: watchlist & alerts (Module N).
import { html, mount, $, $$, inr, dt, date, decisionChip, sev, busy, toast } from '../ui.js';
import { get, post, patch, del } from '../api.js';

export default async function watchlist(main, { app }) {
  const [wl, alerts] = await Promise.all([get('/api/watchlist'), get('/api/alerts')]);
  mount(main, html`
    <div class="page-head"><div><h1>Watchlist & alerts</h1><p class="muted">Alerts fire on material changes in evidence — governance, accounting flags, pledges, ratings, thesis assumptions, entry-price triggers. Ordinary price volatility does not alert unless you enable price alerts in Settings.</p></div>
      <button class="btn ghost" id="readAll">Mark all read</button></div>
    <div class="card"><h3>Watchlist</h3>
      ${wl.length ? html`<div class="table-wrap"><table><thead><tr><th>Company</th><th class="num">Price</th><th>Decision (last snapshot)</th><th class="num">Score</th><th class="num">Entry trigger</th><th>Thesis</th><th class="num">Unread</th><th></th></tr></thead><tbody>
        ${wl.map((w) => html`<tr><td><a href="#/c/${w.companyId}/overview">${w.name}</a> ${w.dataStatus === 'sample' ? html`<span class="prov sample">sample</span>` : ''}</td><td class="num">${inr(w.price, 2)}<br><small class="muted">${date(w.priceDate)}</small></td>
          <td>${w.last ? html`${decisionChip(w.last.decision)}<br><small class="muted">${dt(w.last.created_at)}</small>` : '—'}</td><td class="num">${w.last?.holistic ?? '—'}</td><td class="num">${inr(w.last?.summary?.entryPrice)}</td><td>${w.last?.summary?.thesisStatus || '—'}</td><td class="num">${w.unread}</td>
          <td class="btn-row"><button class="btn ghost small" data-check="${w.companyId}">Re-check now</button><button class="btn ghost small" data-rm="${w.companyId}">Remove</button></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Your watchlist is empty. Open a company and choose "Add to watchlist".</p>`}</div>
    <div class="card" style="margin-top:16px"><h3>Alerts</h3>
      <p class="muted"><b>Critical</b>: potential permanent capital impairment · <b>High</b>: material deterioration in the thesis · <b>Medium</b>: meaningful change in valuation or prospects · <b>Low</b>: informational.</p>
      ${alerts.length ? html`<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Company</th><th>What changed</th><th>Why it matters</th><th>Reassess?</th><th>When</th><th></th></tr></thead><tbody>
        ${alerts.map((a) => html`<tr style="${a.read ? 'opacity:.6' : ''}"><td>${sev(a.severity)}</td><td><a href="#/c/${a.company_id}/overview">${a.company || a.company_id}</a></td><td><b>${a.title}</b><br>${a.what}</td><td class="muted">${a.why}</td><td>${a.reassess ? html`<span class="chip warn">yes</span>` : 'no'}</td><td>${dt(a.created_at)}</td><td>${a.read ? '' : html`<button class="btn ghost small" data-read="${a.id}">Mark read</button>`}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No alerts yet.</p>`}</div>`);
  const re = () => { app.refreshAlerts(); watchlist(main, { app }); };
  $('#readAll').onclick = async () => { await post('/api/alerts/read-all'); re(); };
  $$('[data-read]', main).forEach((b) => (b.onclick = async () => { await patch(`/api/alerts/${b.dataset.read}`, {}); re(); }));
  $$('[data-rm]', main).forEach((b) => (b.onclick = async () => { await del(`/api/watchlist/${b.dataset.rm}`); re(); }));
  $$('[data-check]', main).forEach((b) => (b.onclick = (e) => busy(e.target, async () => { const r = await post(`/api/companies/${b.dataset.check}/analysis`); toast(r.alerts.length ? `${r.alerts.length} new alert(s).` : 'No material changes since the last snapshot.'); re(); })));
}
