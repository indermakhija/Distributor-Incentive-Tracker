// Screen 9: future prospects, catalysts and interactive bear/base/bull scenarios (Module F).
import { html, mount, $, $$, pct, inr, num, chart, series, legend, isNum, token } from '../../ui.js';
import { CATALYST_STATUS_WEIGHT } from '/engine/scoring.js';
import { editTable, bindEditTables, readTable, saveSection, dimCard } from '../common.js';

const PARAMS = [
  ['revenueCagr5', 'Revenue growth, years 1–5', -0.15, 0.45, 0.005, 'pct'], ['revenueCagr10', 'Revenue growth, years 6–10', -0.05, 0.3, 0.005, 'pct'],
  ['ebitdaMarginTarget', 'EBITDA margin (target by year 5)', -0.1, 0.6, 0.0025, 'pct'], ['capexToRevenue', 'Capex / revenue', 0, 0.3, 0.0025, 'pct'],
  ['nwcToRevenue', 'Working capital / revenue', -0.3, 1.5, 0.005, 'pct'], ['exitPE', 'Exit P/E (for expected return)', 3, 90, 0.5, 'x'], ['probability', 'Scenario probability', 0, 1, 0.05, 'pct']
];
const CAT_COLS = [{ key: 'name', label: 'Catalyst', type: 'text', width: '180px' }, { key: 'status', label: 'Status', type: 'select', options: ['announced', 'approved', 'executing', 'speculative'] }, { key: 'timeline', label: 'Timeline', type: 'text' }, { key: 'impactRevenuePct', label: 'Revenue impact', type: 'pct' }, { key: 'probability', label: 'Probability', type: 'pct' }, { key: 'evidence', label: 'Supporting evidence', type: 'textarea' }, { key: 'dependencies', label: 'Dependencies', type: 'text' }, { key: 'risks', label: 'Risks', type: 'text' }, { key: 'indicatorsText', label: 'Indicators to monitor', type: 'text' }];

export default function prospects(el, { app }) {
  const { company: c } = app.co;
  let working = structuredClone(c);
  const a0 = app.co.analysis;
  const scen = a0.valuation?.scenarios;
  if (!scen) { mount(el, html`<div class="empty">Scenarios need financial statements, price and share count.</div>`); return; }
  working.scenarios = Object.fromEntries(['bear', 'base', 'bull'].map((k) => [k, Object.fromEntries(PARAMS.map(([p]) => [p, scen[k].assumptions[p]]))]));
  const fmtP = (v, t) => (t === 'pct' ? pct(v) : `${(+v).toFixed(1)}x`);

  mount(el, html`
    <p class="banner info">All projections are <b>model assumptions</b>, not forecasts of fact. Move the sliders — valuation, expected returns, scores and the decision recompute instantly. Save to persist your assumptions.</p>
    <div class="grid g3">${['bear', 'base', 'bull'].map((k, i) => html`<div class="card"><div class="card-head"><h3 style="color:${series(i === 0 ? 1 : i === 1 ? 0 : 2)}">${k.toUpperCase()} case</h3><span class="prov ${scen[k].assumptions.source}">${scen[k].assumptions.source}</span></div>
      ${PARAMS.map(([p, l, mn, mx, st, t]) => html`<div class="slider-row"><label for="${k}-${p}" style="margin:0">${l}</label><input id="${k}-${p}" type="range" min="${mn}" max="${mx}" step="${st}" value="${working.scenarios[k][p]}" data-sc="${k}" data-p="${p}" data-t="${t}"><output id="o-${k}-${p}">${fmtP(working.scenarios[k][p], t)}</output></div>`)}
      <p class="muted" style="font-size:12px">${scen[k].assumptions.rationale}</p></div>`)}</div>
    <div class="btn-row" style="margin:12px 0"><button class="btn" id="saveSc">Save scenarios</button><button class="btn ghost" id="resetSc">Reset to evidence-based defaults</button><span id="liveDecision"></span></div>
    <div class="grid g2"><div class="card"><h3>Projected revenue (₹ Cr)</h3>${legend([['Bear', series(1)], ['Base', series(0)], ['Bull', series(2)]])}<div class="chart-box"><canvas id="chRev" aria-label="Projected revenue by scenario"></canvas></div></div>
      <div class="card"><h3>Intrinsic value per share vs price</h3><div id="ivTable"></div></div></div>
    <div class="card" style="margin-top:16px"><h3>Projections at 3, 5 and 10 years</h3><div id="projTable"></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Growth catalysts</h3><button class="btn small" id="saveCat">Save catalysts</button></div>
      <p class="muted">Separate announced, approved, executing and speculative projects. Status weights in the growth score: ${Object.entries(CATALYST_STATUS_WEIGHT).map(([k, v]) => `${k} ×${v}`).join(', ')}.</p>
      ${editTable('cats', CAT_COLS, (c.catalysts || []).map((x) => ({ ...x, indicatorsText: (x.indicators || []).join('; ') })), { addLabel: 'Add catalyst' })}</div>
    <div style="margin-top:16px" id="growthDim"></div>`);

  const update = () => {
    const a = app.recompute(working);
    const v = a.valuation;
    const rows = ['bear', 'base', 'bull'].map((k) => v.scenarios[k]);
    mount($('#ivTable'), html`<div class="table-wrap"><table><thead><tr><th></th><th class="num">Bear</th><th class="num">Base</th><th class="num">Bull</th></tr></thead><tbody>
      <tr><td>Intrinsic value</td>${rows.map((s) => html`<td class="num"><b>${inr(s.intrinsicValue)}</b></td>`)}</tr>
      <tr><td>vs price ${inr(v.price)}</td>${rows.map((s) => html`<td class="num">${pct(s.intrinsicValue / v.price - 1, 0)}</td>`)}</tr>
      <tr><td>Expected return 3y (p.a.)</td>${rows.map((s) => html`<td class="num">${pct(s.expectedReturn3y)}</td>`)}</tr>
      <tr><td>Expected return 5y (p.a.)</td>${rows.map((s) => html`<td class="num">${pct(s.expectedReturn5y)}</td>`)}</tr>
      <tr><td>Methods used</td>${rows.map((s) => html`<td class="num" style="font-size:11px">${s.methodsUsed.join(', ')}</td>`)}</tr>
      <tr><td>Probability-weighted value</td><td colspan="3" class="num"><b>${inr(v.intrinsic.probabilityWeighted)}</b></td></tr></tbody></table></div>`);
    const at = (s, y) => s.projection.find((r) => r.year === y);
    mount($('#projTable'), html`<div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Year</th><th class="num">Revenue</th><th class="num">EBITDA margin</th><th class="num">EBITDA</th><th class="num">PAT</th><th class="num">EPS</th><th class="num">FCFF</th><th class="num">Net debt</th><th class="num">Cum. capex</th></tr></thead><tbody>
      ${['bear', 'base', 'bull'].flatMap((k) => [3, 5, 10].map((y) => { const r = at(v.scenarios[k], y); const cum = v.scenarios[k].projection.filter((p) => p.year <= y).reduce((x, p) => x + p.capex, 0); return html`<tr><td>${k}</td><td>Y${y}</td><td class="num">${num(r.revenue)}</td><td class="num">${pct(r.ebitdaMargin)}</td><td class="num">${num(r.ebitda)}</td><td class="num">${num(r.pat)}</td><td class="num">${num(r.eps, 1)}</td><td class="num">${num(r.fcff)}</td><td class="num">${num(r.netDebt)}</td><td class="num">${num(cum)}</td></tr>`; }))}
      </tbody></table></div>`);
    const L = a.metrics.latest.revenue;
    const labels = ['Now', ...v.scenarios.base.projection.map((r) => `Y${r.year}`)];
    chart($('#chRev'), { type: 'line', data: { labels, datasets: [['Bear', 'bear', 1], ['Base', 'base', 0], ['Bull', 'bull', 2]].map(([l, k, i]) => ({ label: l, data: [L, ...v.scenarios[k].projection.map((r) => Math.round(r.revenue))], borderColor: series(i), backgroundColor: series(i) })) } });
    mount($('#liveDecision'), html`Live decision: <b>${a.decision.label}</b> · score ${a.aggregate.holistic} · base value ${inr(v.intrinsic.base)}`);
    mount($('#growthDim'), dimCard(a.dims.growth));
  };
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.sc) return;
    working.scenarios[t.dataset.sc][t.dataset.p] = Number(t.value);
    $('#o-' + t.dataset.sc + '-' + t.dataset.p).textContent = fmtP(t.value, t.dataset.t);
    update();
  });
  bindEditTables(el);
  update();
  $('#saveSc').onclick = () => saveSection(app, { scenarios: working.scenarios }).then(() => prospects(el, { app }));
  $('#resetSc').onclick = () => saveSection(app, { scenarios: {} }).then(() => prospects(el, { app }));
  $('#saveCat').onclick = () => saveSection(app, { catalysts: readTable(el, 'cats').map(({ indicatorsText, ...x }) => ({ ...x, indicators: String(indicatorsText || '').split(';').map((s) => s.trim()).filter(Boolean) })) }).then(() => prospects(el, { app }));
  void $$; void isNum; void token;
}
