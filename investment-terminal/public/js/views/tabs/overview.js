// Screen 3: company overview / executive dashboard.
import { html, mount, $, pct, inr, decisionChip, scoreBar, list, sev, busy, toast, isNum } from '../../ui.js';
import { post } from '../../api.js';
import { VALUATION_STATUS_LABEL } from '/engine/valuation.js';

export default function overview(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const d = a.decision, v = a.valuation, dims = a.dims;
  const tile = (label, value, sub, dimKey) => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${dimKey ? scoreBar(dims[dimKey]?.score) : ''}<div class="sub">${sub || ''}</div></div>`;
  mount(el, html`
    <div class="grid g2">
      <div class="decision-box ${d.tone}">
        <h4>Decision ${d.status === 'provisional' ? '(provisional)' : ''}</h4>
        <div class="decision-label">${d.label}</div>
        <p style="margin-top:6px">${a.narrative.businessVsInvestment}</p>
        ${d.entryPrice ? html`<p><b>Entry price:</b> ${inr(d.entryPrice)} or lower (range ${inr(d.entryRange?.low)}–${inr(d.entryRange?.high)})</p>` : ''}
        ${d.gates.length ? html`<div class="banner info"><b>Before this decision is final:</b>${list(d.gates)}</div>` : ''}
        <p class="muted">Evidence confidence ${pct(d.confidence, 0)} · Suggested size: ${d.sizing.suggestedWeight ? pct(d.sizing.suggestedWeight, 1) + ' of portfolio — ' + d.sizing.note : d.sizing.note}</p>
        <div class="btn-row"><button class="btn" id="snapBtn">Save analysis snapshot</button><button class="btn ghost" id="watchBtn">Add to watchlist</button><a class="btn ghost" href="#/c/${c.id}/report">Open decision report →</a></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Holistic score</h3><a href="#/c/${c.id}/scoring">How it's calculated →</a></div>
        <div style="display:flex;gap:16px;align-items:center"><div class="big-score">${a.aggregate.holistic}</div><div><b>${a.aggregate.band.label}</b><br><span class="muted">${a.aggregate.band.note}</span><br><small>${a.aggregate.neutralFilledWeight > 0 ? `${a.aggregate.neutralFilledWeight}% of weight not yet scored (held at neutral 5/10).` : 'All dimensions scored.'}</small></div></div>
        <p class="muted" style="margin-top:8px">Scores are decision-support classifications, not trading instructions. A BUY also requires every item of the BUY checklist.</p>
      </div>
    </div>
    <h2 style="margin-top:20px">Executive dashboard</h2>
    <div class="grid g4">
      ${tile('Business quality', `${dims.business.score ?? 'n/a'}/10`, dims.business.classification, 'business')}
      ${tile('Industry outlook', `${dims.industry.score ?? 'n/a'}/10`, `${c.industry?.lifecycle || '—'} · 5y growth ${pct(c.industry?.growth5y)}`, 'industry')}
      ${tile('Management credibility', `${dims.management.score ?? 'n/a'}/10`, dims.management.serious ? '⚠ serious governance concern' : dims.management.allegationsOnly ? '⚠ unresolved allegations' : 'no serious findings recorded', 'management')}
      ${tile('Financial health', `${dims.financial.score ?? 'n/a'}/10`, `Net debt/EBITDA ${isNum(a.metrics.latest?.netDebtToEbitda) ? a.metrics.latest.netDebtToEbitda.toFixed(1) + 'x' : '—'} · ${a.forensic.flags.length} forensic flags`, 'financial')}
      ${tile('Competitive moat', `${dims.moat.score ?? 'n/a'}/10`, `${dims.moat.width} · trend ${dims.moat.trend}`, 'moat')}
      ${tile('Future growth', `${dims.growth.score ?? 'n/a'}/10`, `Base revenue CAGR ${pct(v?.scenarios?.base?.assumptions?.revenueCagr5)}`, 'growth')}
      ${tile('Valuation', VALUATION_STATUS_LABEL[v?.status] || 'n/a', `Base value ${inr(v?.intrinsic?.base)} · MoS ${pct(v?.marginOfSafety, 0)}`, 'valuation')}
      ${tile('Downside risk', `${dims.risk.score ?? 'n/a'}/10`, `Bear case ${pct(v?.downsideToBear, 0)} vs price`, 'risk')}
      ${tile('Investor knowledge', a.investor.completed ? `${a.investor.knowledgeScore}/10` : 'Pending', a.investor.completed ? a.investor.convictionType + ' conviction' : html`<a href="#/c/${c.id}/investor">Complete self-assessment →</a>`, 'investor')}
      ${tile('Portfolio fit', isNum(dims.portfolio.score) ? `${dims.portfolio.score}/10` : 'n/a', a.portfolio.fit.available ? `${pct(a.portfolio.fit.positionWeight, 1)} position` : html`<a href="#/portfolio">Add holdings →</a>`, 'portfolio')}
      ${tile('Macro regime', a.macro.usable ? `${a.macro.impact.score}/10` : 'No data', html`${a.macro.regime} · ${a.macro.impact.sensitivity} sensitivity · <a href="#/c/${c.id}/macro">details →</a>`)}
      ${tile('Evidence confidence', pct(d.confidence, 0), `${a.dataQuality.status} data · ${a.dataQuality.staleCount} stale item(s)`)}
      ${tile('Expected 5y return (base)', pct(v?.scenarios?.base?.expectedReturn5y), `Bear ${pct(v?.scenarios?.bear?.expectedReturn5y)} · Bull ${pct(v?.scenarios?.bull?.expectedReturn5y)}`)}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>Overrides & warnings</h3></div>
        ${d.rules.length ? html`<ul>${d.rules.map((r) => html`<li>${sev(r.severity)} <b>${r.title}.</b> ${r.message}</li>`)}</ul>` : html`<p class="muted">No override rules triggered.</p>`}</div>
      <div class="card"><div class="card-head"><h3>Strongest case against</h3><a href="#/c/${c.id}/report">Full red-team →</a></div>
        <p>${a.redTeam.bearThesis}</p>${list(a.redTeam.strongestThree.map((p) => `${p.claim} ${p.evidence}`))}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Data quality & provenance</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Dataset</th><th>As of</th><th>Age</th><th>Source</th><th>Status</th></tr></thead><tbody>
      ${a.dataQuality.items.map((i) => html`<tr><td>${i.section}</td><td>${i.asOf || 'unknown'}</td><td>${i.ageMonths == null ? '—' : i.ageMonths < 1 ? Math.round(i.ageMonths * 30.4) + ' days' : i.ageMonths.toFixed(0) + ' months'}</td><td>${i.source} <span class="prov ${i.type}">${i.type}</span></td><td>${i.stale == null ? html`<span class="chip warn">unknown date</span>` : i.stale ? html`<span class="chip neg">stale</span>` : html`<span class="chip pos">current</span>`}</td></tr>`)}
      </tbody></table></div>
      ${list(a.dataQuality.issues.map((i) => `[${i.severity}] ${i.text}`), 'No data-quality issues detected.')}
    </div>`);
  $('#snapBtn').onclick = (e) => busy(e.target, async () => { const r = await post(`/api/companies/${c.id}/analysis`); toast(`Snapshot #${r.snapshotId} saved${r.alerts.length ? ` · ${r.alerts.length} alert(s)` : ''}.`); app.refreshAlerts(); });
  $('#watchBtn').onclick = (e) => busy(e.target, async () => { await post('/api/watchlist', { companyId: c.id }); toast('Added to watchlist — material changes will now raise alerts.'); });
}
