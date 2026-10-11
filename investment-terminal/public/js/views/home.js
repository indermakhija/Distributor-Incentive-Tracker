// Screen 1: home dashboard.
import { html, mount, $, inr, date, dt, decisionChip, sev, statusChip, busy, toast } from '../ui.js';
import { get, post } from '../api.js';

export default async function home(main, { app }) {
  const [companies, alerts, integrations, decisions] = await Promise.all([get('/api/companies'), get('/api/alerts'), get('/api/integrations'), get('/api/decisions')]);
  const unread = alerts.filter((a) => !a.read);
  mount(main, html`
    <div class="page-head"><div><h1>Good to see you${app.user.name ? ', ' + app.user.name : ''}</h1>
      <p class="muted">Understand the business · Challenge the thesis · Value the future · Protect the downside · Know yourself before investing.</p></div>
      <div class="btn-row"><a class="btn" href="#/search?new=1">+ Analyse a company</a><button class="btn ghost" id="runAll">Refresh all analyses</button></div></div>
    <div class="grid g4">
      <div class="tile"><div class="label">Companies</div><div class="value">${companies.length}</div><div class="sub">${companies.filter((c) => c.dataStatus === 'sample').length} illustrative samples</div></div>
      <div class="tile"><div class="label">Watchlist</div><div class="value">${companies.filter((c) => c.watchlisted).length}</div><div class="sub"><a href="#/watchlist">Open watchlist →</a></div></div>
      <div class="tile"><div class="label">Unread alerts</div><div class="value">${unread.length}</div><div class="sub">${unread.filter((a) => a.severity === 'critical').length} critical · ${unread.filter((a) => a.severity === 'high').length} high</div></div>
      <div class="tile"><div class="label">Recorded decisions</div><div class="value">${decisions.length}</div><div class="sub"><a href="#/decisions">Post-investment review →</a></div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>Companies</h3><a href="#/compare">Compare →</a></div>
        <div class="table-wrap"><table><thead><tr><th>Company</th><th class="num">Price</th><th>Last decision</th><th class="num">Score</th></tr></thead><tbody>
        ${companies.map((c) => html`<tr><td><a href="#/c/${c.id}/overview">${c.name}</a><br><small class="muted">${c.ticker || ''} · ${c.sector || ''} ${c.dataStatus === 'sample' ? html`<span class="prov sample">sample</span>` : ''}</small></td>
          <td class="num">${inr(c.price, 2)}<br><small class="muted">${date(c.priceDate)}</small></td>
          <td>${c.lastSnapshot ? html`${decisionChip(c.lastSnapshot.decision)}<br><small class="muted">${dt(c.lastSnapshot.created_at)}</small>` : html`<span class="muted">not saved yet</span>`}</td><td class="num">${c.lastSnapshot?.holistic ?? '—'}</td></tr>`)}
        </tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>Latest alerts</h3><a href="#/watchlist">All alerts →</a></div>
        ${alerts.length ? html`<ul style="list-style:none;padding:0">${alerts.slice(0, 8).map((a) => html`<li style="padding:6px 0;border-bottom:1px solid var(--grid)">${sev(a.severity)} <b>${a.title}</b> — ${a.company || ''}<br><small class="muted">${a.what} · ${dt(a.created_at)}</small></li>`)}</ul>` : html`<p class="muted">No alerts. Add companies to your watchlist — material changes in evidence (not ordinary price moves) will appear here.</p>`}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Data integrations — actual status</h3><a href="#/settings">Settings →</a></div>
      <div class="table-wrap"><table><tbody>${integrations.map((i) => html`<tr><td><b>${i.name}</b></td><td>${statusChip(i.status)}</td><td class="muted">${i.detail}</td></tr>`)}</tbody></table></div></div>`);
  $('#runAll').onclick = (e) => busy(e.target, async () => {
    for (const c of companies) await post(`/api/companies/${c.id}/analysis`);
    toast(`Saved fresh snapshots for ${companies.length} companies.`);
    app.refreshAlerts();
    home(main, { app });
  });
}
