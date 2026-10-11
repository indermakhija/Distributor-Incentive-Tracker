// Screen 15: final investment decision report, red-team review and exports (Modules M + red team).
import { html, mount, $, $$, pct, inr, list, sev, busy, toast, dt, decisionChip, raw, esc } from '../../ui.js';
import { get, post } from '../../api.js';

export default async function report(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const n = a.narrative, d = a.decision, rt = a.redTeam;
  const [snaps, reviews] = await Promise.all([get(`/api/companies/${c.id}/snapshots`), get(`/api/companies/${c.id}/redteam-review`)]);
  const ack = app.co.ctx.redTeamAcknowledged;
  mount(el, html`
    <div class="btn-row" style="margin-bottom:12px">
      <a class="btn ghost small" href="/api/companies/${c.id}/report.pdf">Download PDF</a>
      <a class="btn ghost small" href="/api/companies/${c.id}/report.html">Download HTML</a>
      <a class="btn ghost small" href="/api/companies/${c.id}/analysis.csv">Export CSV</a>
      <button class="btn ghost small" onclick="window.print()">Print</button>
      <button class="btn small" id="recordBtn">Record this decision</button>
    </div>
    <div class="decision-box ${d.tone}">
      <h4>Final decision ${d.status === 'provisional' ? '— PROVISIONAL' : ''} ${d.holder ? '(existing shareholder view)' : '(prospective buyer view)'}</h4>
      <div class="decision-label">${d.label}</div>
      <p>${n.headline}</p><p><i>${n.businessVsInvestment}</i></p>
      ${d.entryPrice ? html`<p><b>Reasonable entry range:</b> ${inr(d.entryRange?.low)} – ${inr(d.entryRange?.high)}. Conditions: thesis intact, no new governance/accounting flags, and the red-team points answered.</p>` : ''}
      ${n.holderView ? html`<p><b>For an existing shareholder:</b> ${n.holderView}</p>` : ''}
      ${d.gates.length ? html`<div class="banner info"><b>Gates before this is final:</b>${list(d.gates)}</div>` : ''}
    </div>
    <div class="grid g2" style="margin-top:16px">
      ${[['1. Why this decision is appropriate', n.why], ['2. What is attractive', n.attractive], ['3. What the market may be missing', n.marketMissing], ['4. What the market may already be pricing in', n.pricedIn], ['5. The three strongest arguments against buying', n.argumentsAgainst], ['6. Biggest permanent-loss risks', n.permanentLossRisks]]
        .map(([h, items]) => html`<div class="card"><h3>${h}</h3>${list(items)}</div>`)}
      <div class="card"><h3>7. Investment horizon</h3><p>${n.horizon}</p></div>
      <div class="card"><h3>8. Scenario returns</h3><div class="table-wrap"><table><thead><tr><th>Scenario</th><th class="num">Value</th><th class="num">3y p.a.</th><th class="num">5y p.a.</th><th class="num">Prob.</th></tr></thead><tbody>
        ${n.scenarioReturns.map((s) => html`<tr><td>${s.scenario}</td><td class="num">${inr(s.value)}</td><td class="num">${pct(s.return3y)}</td><td class="num">${pct(s.return5y)}</td><td class="num">${pct(s.probability, 0)}</td></tr>`)}</tbody></table></div></div>
      <div class="card"><h3>9. Key assumptions <span class="prov assumption">Assumption</span></h3>${list(n.keyAssumptions)}</div>
      <div class="card"><h3>10. What would change the recommendation</h3>${list(n.whatWouldChange)}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Red-team investment review</h3>${ack ? html`<span class="chip pos">Reviewed</span>` : html`<span class="chip warn">Not yet reviewed</span>`}</div>
      <p><b>${rt.bearThesis}</b></p>
      <p class="muted">Before approving a BUY you must answer each point: why is it wrong, already priced in, or acceptable — and what would prove you wrong?</p>
      <form id="rtForm">${rt.points.slice(0, 10).map((p, i) => html`<div class="field" style="border-bottom:1px solid var(--grid);padding-bottom:8px">
        <div>${sev(p.severity)} <b>${p.claim}</b> <small class="muted">[${p.source}]</small></div><div class="muted">${p.evidence}</div><div><small>Disconfirming test: ${p.test}</small></div>
        <textarea data-rt="${i}" rows="2" placeholder="Your response" aria-label="Response to red-team point ${i + 1}"></textarea></div>`)}
        ${rt.points.length ? html`<button class="btn" type="submit">Submit red-team responses</button>` : html`<p class="muted">No points generated — this usually means evidence is missing, not that risk is absent.</p>`}</form>
      <div class="btn-row" style="margin-top:10px"><button class="btn ghost small" id="aiRt">Run AI red-team (if configured)</button><button class="btn ghost small" id="aiEx">AI plain-language explanation</button></div>
      <div id="aiOut"></div>
      ${reviews.length ? html`<details style="margin-top:10px"><summary>Previous red-team reviews (${reviews.length})</summary>${reviews.map((r) => html`<div style="margin-top:8px"><b>${dt(r.acknowledged_at)}</b><ul>${r.responses.map((x) => html`<li><i>${x.claim}</i> — ${x.response}</li>`)}</ul></div>`)}</details>` : ''}
    </div>
    <div class="card" style="margin-top:16px"><h3>Historical reports (snapshots)</h3><p class="muted">Every saved snapshot preserves what was believed at the time, so it can be compared with what actually happened.</p>
      ${snaps.length ? html`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Decision</th><th class="num">Score</th><th class="num">Price</th><th class="num">Base value</th><th></th></tr></thead><tbody>
        ${snaps.map((s) => html`<tr><td>${dt(s.created_at)}</td><td>${decisionChip(s.decision)}</td><td class="num">${s.holistic}</td><td class="num">${inr(s.summary?.price)}</td><td class="num">${inr(s.summary?.baseValue)}</td><td><button class="btn ghost small" data-snap="${s.id}">View</button></td></tr>`)}</tbody></table></div>` : html`<p class="muted">No snapshots yet — use "Record this decision" or "Save analysis snapshot".</p>`}
    </div>`);
  $('#rtForm').onsubmit = async (e) => {
    e.preventDefault();
    const responses = rt.points.slice(0, 10).map((p, i) => ({ claim: p.claim, response: $(`[data-rt="${i}"]`, el).value }));
    await busy(e.submitter, () => post(`/api/companies/${c.id}/redteam-review`, { responses }));
    toast('Red-team review recorded.');
    await app.loadCompany(c.id, true); dispatchEvent(new HashChangeEvent('hashchange'));
  };
  $('#recordBtn').onclick = (e) => {
    const notes = prompt('Notes for your decision journal (why you are acting / not acting):') ?? null;
    if (notes === null) return;
    busy(e.target, async () => { const r = await post(`/api/companies/${c.id}/decisions`, { notes }); toast(`Decision recorded: ${r.decision.label}${r.decision.status === 'provisional' ? ' (provisional)' : ''}.`); });
  };
  const aiShow = async (btn, path, title) => {
    const r = await busy(btn, () => post(path));
    if (!r.available || !r.text) return mount($('#aiOut'), html`<p class="banner sample">${r.note || r.error || 'No AI output.'}</p>`);
    mount($('#aiOut'), html`<div class="card" style="margin-top:10px"><h4>${title} <span class="prov ai">AI-generated</span></h4><div class="pre">${r.text}</div><p class="muted">${r.label}${r.truncated ? ' · output truncated' : ''}</p></div>`);
  };
  $('#aiRt').onclick = (e) => aiShow(e.target, `/api/ai/redteam/${c.id}`, 'AI red-team');
  $('#aiEx').onclick = (e) => aiShow(e.target, `/api/ai/explain/${c.id}`, 'AI explanation');
  $$('[data-snap]', el).forEach((b) => (b.onclick = async () => {
    const s = await get(`/api/snapshots/${b.dataset.snap}`);
    const sa = s.analysis;
    const { modal } = await import('../../ui.js');
    modal(html`<h2>Snapshot ${dt(s.createdAt)}</h2><p>${decisionChip(sa.decision.code, sa.decision.label)} · score ${sa.aggregate.holistic} · price ${inr(sa.company.market?.price)} (${sa.company.market?.priceDate})</p>
      <p>${sa.narrative.headline}</p><h4>Arguments against at the time</h4>${list(sa.narrative.argumentsAgainst)}<h4>Key assumptions at the time</h4>${list(sa.narrative.keyAssumptions)}
      <div class="btn-row"><button class="btn ghost" data-close>Close</button></div>`);
  }));
  void raw; void esc;
}
