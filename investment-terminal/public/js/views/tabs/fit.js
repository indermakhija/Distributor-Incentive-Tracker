// Screen 13: portfolio fit & opportunity cost for this company (Module K).
import { html, mount, pct, inr, num, list, chart, series, $, token } from '../../ui.js';
import { dimCard } from '../common.js';

export default function fit(el, { app }) {
  const { company: c, analysis: a, ctx } = app.co;
  const f = a.portfolio.fit, o = a.portfolio.opportunity;
  const amount = ctx.assessment?.suitability?.amount;
  mount(el, html`
    ${!amount ? html`<div class="banner sample">Set your proposed investment amount in the <a href="#/c/${c.id}/investor">self-assessment</a> to see post-purchase allocation.</div>` : ''}
    ${!f.available ? html`<div class="empty">${f.note} <a href="#/portfolio">Manage portfolio →</a></div>` : html`
    <div class="grid g4">
      <div class="tile"><div class="label">Proposed amount</div><div class="value">${inr(amount)}</div></div>
      <div class="tile"><div class="label">Position weight after purchase</div><div class="value">${pct(f.positionWeight, 1)}</div><div class="sub">Limit ${pct(f.limits.maxSingleStock, 0)}</div></div>
      <div class="tile"><div class="label">Macro-factor overlap</div><div class="value">${pct(f.overlapWeight, 0)}</div><div class="sub">Correlation proxy ${f.correlationProxy ?? '—'}</div></div>
      <div class="tile"><div class="label">Stress: portfolio loss</div><div class="value">${pct(f.stress.portfolioLoss, 1)}</div><div class="sub">${f.stress.note}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Sector allocation: before vs after</h3><div class="chart-box"><canvas id="chSec" aria-label="Sector allocation before and after"></canvas></div>
        ${html`<div class="chart-legend"><span><i style="background:${series(0)}"></i>Before</span><span><i style="background:${series(1)}"></i>After</span></div>`}</div>
      <div class="card"><h3>Concentration, overlap & liquidity</h3>
        <h4>Warnings</h4>${list(f.warnings, 'No concentration or liquidity warnings.')}
        <h4>Positives</h4>${list(f.positives, '—')}
        <h4>Holdings sharing macro factors (${(c.macroFactors || []).join(', ') || 'none tagged'})</h4>${list(f.overlap.map((x) => `${x.name}: ${x.shared.join(', ')}`), 'None.')}
        <p class="muted">${f.correlationNote}${f.daysToExit != null ? ` Days to exit at 20% of ADV: ${f.daysToExit.toFixed(1)}.` : ''}</p></div>
    </div>`}
    <div class="card" style="margin-top:16px"><h3>Opportunity cost — why this company instead of the next-best alternative?</h3>
      <p style="font-size:15px"><b>${o.answer}</b></p>
      <div class="table-wrap"><table><thead><tr><th>Alternative</th><th class="num">Expected return (5y p.a.)</th><th class="num">Risk-adjusted</th><th class="num">Quality</th></tr></thead><tbody>
        <tr style="font-weight:700"><td>${c.name} (this idea)</td><td class="num">${pct(a.valuation?.scenarios?.base?.expectedReturn5y)}</td><td class="num">${pct(o.riskAdjustedReturn)}</td><td class="num">${a.decision.quality ?? '—'}</td></tr>
        ${o.options.map((x) => html`<tr><td>${x.name}</td><td class="num">${pct(x.expectedReturn)}</td><td class="num">${pct(x.riskAdjusted)}</td><td class="num">${x.quality != null ? num(x.quality, 1) : '—'}</td></tr>`)}</tbody></table></div>
      <p class="muted">Risk adjustment deducts 0.5pp per quality point below 10 and up to 2pp for low evidence confidence. Stocks listed are your other analysed companies; index and fixed-income returns come from Settings.</p></div>
    <div style="margin-top:16px">${dimCard(a.dims.portfolio)}</div>`);
  if (f.available) {
    const secs = [...new Set([...Object.keys(f.sectorBefore), ...Object.keys(f.sectorAfter)])];
    chart($('#chSec'), { type: 'bar', data: { labels: secs, datasets: [{ label: 'Before', data: secs.map((s) => f.sectorBefore[s] || 0), backgroundColor: series(0), maxBarThickness: 16 }, { label: 'After', data: secs.map((s) => f.sectorAfter[s] || 0), backgroundColor: series(1), maxBarThickness: 16 }] },
      options: { indexAxis: 'y', datasets: { bar: { borderColor: token('--surface'), borderWidth: 1 } }, scales: { x: { grid: { color: token('--grid'), display: true }, ticks: { callback: (t) => `${Math.round(t * 100)}%` } }, y: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${pct(ctx.parsed.x)}` } } } } });
  }
}
