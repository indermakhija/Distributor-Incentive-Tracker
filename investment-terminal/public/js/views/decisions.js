// Screen 19: historical decisions & post-investment review.
import { html, mount, $$, pct, inr, dt, decisionChip, modal, toast, $ } from '../ui.js';
import { get, patch } from '../api.js';

export default async function decisions(main, { app }) {
  const list = await get('/api/decisions');
  mount(main, html`
    <div class="page-head"><div><h1>Decision history & post-investment review</h1><p class="muted">Compare what you believed at the time with what happened. Judge the process, not just the outcome.</p></div></div>
    ${list.length ? html`<div class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Company</th><th>Decision</th><th class="num">Price then</th><th class="num">Price now</th><th class="num">Return since</th><th class="num">Score then → now</th><th class="num">Base value then → now</th><th>Review</th><th></th></tr></thead><tbody>
      ${list.map((d) => html`<tr><td>${dt(d.createdAt)}</td><td><a href="#/c/${d.companyId}/report">${d.company}</a></td><td>${decisionChip(d.decision)}</td><td class="num">${inr(d.priceAtDecision, 2)}</td><td class="num">${inr(d.currentPrice, 2)}<br><small class="muted">${d.priceDateNow || ''}</small></td>
        <td class="num">${pct(d.returnSince)}</td><td class="num">${d.then?.holistic ?? '—'} → ${d.now?.holistic ?? '—'}</td><td class="num">${inr(d.then?.baseValue)} → ${inr(d.now?.baseValue)}</td>
        <td>${d.review ? html`<span class="chip ${d.review.thesisCorrect === 'yes' ? 'pos' : d.review.thesisCorrect === 'no' ? 'neg' : ''}">thesis: ${d.review.thesisCorrect}</span>` : html`<span class="muted">not reviewed</span>`}</td>
        <td><button class="btn ghost small" data-rev="${d.id}">Review</button></td></tr>${d.notes ? html`<tr><td></td><td colspan="9" class="muted">Notes: ${d.notes}</td></tr>` : ''}`)}</tbody></table></div></div>` : html`<div class="empty">No decisions recorded yet. Use "Record this decision" on a company's Decision report.</div>`}`);
  $$('[data-rev]', main).forEach((b) => (b.onclick = () => {
    const d = list.find((x) => String(x.id) === b.dataset.rev);
    modal(html`<h2>Review: ${d.company} (${dt(d.createdAt)})</h2><p>Decision ${decisionChip(d.decision)} at ${inr(d.priceAtDecision, 2)}; now ${inr(d.currentPrice, 2)} (${pct(d.returnSince)}).</p>
      <form id="rf"><div class="field"><label>Was the thesis correct?</label><select name="thesisCorrect">${['too_early', 'yes', 'partly', 'no'].map((o) => html`<option ${d.review?.thesisCorrect === o ? 'selected' : ''}>${o}</option>`)}</select></div>
      <div class="field"><label>Process vs outcome — was it a good decision given what was knowable?</label><textarea name="processVsOutcome">${d.review?.processVsOutcome || ''}</textarea></div>
      <div class="field"><label>Lessons</label><textarea name="lessons">${d.review?.lessons || ''}</textarea></div>
      <div class="btn-row"><button class="btn" type="submit">Save review</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`, (m, close) => {
      $('#rf', m).onsubmit = async (e) => { e.preventDefault(); await patch(`/api/decisions/${d.id}`, Object.fromEntries(new FormData(e.target))); toast('Review saved.'); close(); decisions(main, { app }); };
    });
  }));
}
