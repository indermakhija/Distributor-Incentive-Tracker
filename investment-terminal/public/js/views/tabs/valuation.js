// Screen 11: valuation laboratory (Module H).
import { html, mount, $, pct, inr, x, num, heatColor, isNum, chart, series, token } from '../../ui.js';
import { METHOD_LABELS, METHOD_WEIGHTS, VALUATION_STATUS_LABEL } from '/engine/valuation.js';
import { saveSection, dimCard } from '../common.js';

export default function valuation(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const v = a.valuation;
  if (!v?.scenarios) { mount(el, html`<div class="empty">${(v?.warnings || ['Valuation not available.']).join(' ')}</div>`); return; }
  const mu = v.multiples, vi = c.valuationInputs || {};
  const heat = (t, fmtR, fmtC, rowLabel, colLabel) => html`<div class="table-wrap"><table class="heat"><thead><tr><th>${rowLabel} ↓ / ${colLabel} →</th>${t.cols.map((cc) => html`<th class="num">${fmtC(cc)}</th>`)}</tr></thead><tbody>
    ${t.rows.map((rr, i) => html`<tr><th>${fmtR(rr)}</th>${t.values[i].map((val, j) => html`<td class="${i === 2 && j === 2 ? 'base' : ''}" style="background:${heatColor(val, t.price)}" title="${isNum(val) ? pct(val / t.price - 1, 0) + ' vs price' : ''}">${isNum(val) ? num(val) : '—'}</td>`)}</tr>`)}</tbody></table></div>
    <p class="muted" style="font-size:12px">Blue = above current price (${inr(t.price)}), red = below; outlined cell = base case.</p>`;
  mount(el, html`
    <div class="grid g4">
      <div class="tile"><div class="label">Status</div><div class="value" style="font-size:17px">${VALUATION_STATUS_LABEL[v.status]}</div></div>
      <div class="tile"><div class="label">Bear / Base / Bull value</div><div class="value" style="font-size:17px">${inr(v.intrinsic.bear)} / ${inr(v.intrinsic.base)} / ${inr(v.intrinsic.bull)}</div><div class="sub">Probability-weighted ${inr(v.intrinsic.probabilityWeighted)}</div></div>
      <div class="tile"><div class="label">Margin of safety (vs base)</div><div class="value">${pct(v.marginOfSafety, 0)}</div><div class="sub">Required ${pct(v.requiredMarginOfSafety, 0)} · entry ≤ ${inr(v.entryPrice)}</div></div>
      <div class="tile"><div class="label">Base 5y expected return</div><div class="value">${pct(v.scenarios.base.expectedReturn5y)}</div><div class="sub">Hurdle ${pct(v.hurdle)} · index ${pct(v.benchmark.index)} · risk-free ${pct(v.benchmark.riskFree)}</div></div>
    </div>
    ${v.warnings.length ? html`<div class="banner sample" style="margin-top:12px">${v.warnings.join(' ')}</div>` : ''}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Current multiples <span class="prov calculated">Calculated</span></h3>
        <dl class="kv"><dt>Market cap</dt><dd>₹${num(mu.marketCap)} Cr</dd><dt>Enterprise value</dt><dd>₹${num(mu.enterpriseValue)} Cr</dd><dt>P/E</dt><dd>${x(mu.pe)} ${vi.historicalPE ? html`<small class="muted">(history ${vi.historicalPE.min}–${vi.historicalPE.max}x, median ${vi.historicalPE.median}x)</small>` : ''}</dd>
          <dt>EV/EBITDA</dt><dd>${x(mu.evEbitda)}</dd><dt>Price/book</dt><dd>${x(mu.pb, 2)}</dd><dt>Price/sales</dt><dd>${x(mu.ps, 2)}</dd><dt>Price/FCF</dt><dd>${x(mu.pfcf)}</dd>
          <dt>Earnings yield</dt><dd>${pct(mu.earningsYield)}</dd><dt>FCF yield</dt><dd>${pct(mu.fcfYield)}</dd><dt>Dividend yield</dt><dd>${pct(mu.dividendYield)}</dd>
          <dt>PEG</dt><dd>${x(mu.peg, 2)} <small class="muted">${mu.pegNote}</small></dd></dl></div>
      <div class="card"><h3>What is the market pricing in? (reverse DCF)</h3>
        <p style="font-size:16px">${v.reverseDcf.interpretation}</p>
        <dl class="kv"><dt>Implied 10y revenue CAGR</dt><dd><b>${pct(v.reverseDcf.impliedRevenueCagr10y)}</b></dd><dt>Base-case CAGR (yrs 1–5)</dt><dd>${pct(v.reverseDcf.baseCaseCagr)}</dd><dt>Achieved 5y CAGR</dt><dd>${pct(v.reverseDcf.historicalCagr5y)}</dd>
          <dt>Cost of equity / WACC</dt><dd>${pct(v.coc.ke)} / ${pct(v.coc.wacc)} (beta ${v.coc.beta})</dd><dt>Terminal growth</dt><dd>${pct(v.coc.g)}</dd>
          <dt>Dividend contribution (5y)</dt><dd>${pct(v.dividendContribution5y)} of today's price</dd><dt>Dilution over history</dt><dd>${pct(v.dilutionImpact)}</dd></dl></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Methods by scenario</h3><small>Business type <b>${v.businessType}</b> → weights ${Object.entries(v.methodWeights).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(', ')}</small></div>
      <p class="muted">Methods are chosen for the business type — DCF is not forced onto lenders, cyclicals or asset-heavy businesses. The method set is fixed by the base case so scenarios stay comparable.</p>
      <div class="table-wrap"><table><thead><tr><th>Method</th><th class="num">Weight</th><th class="num">Bear</th><th class="num">Base</th><th class="num">Bull</th><th>Basis (base case)</th></tr></thead><tbody>
      ${Object.keys(METHOD_LABELS).map((k) => { const used = v.scenarios.base.methodsUsed.includes(k); return html`<tr style="${used ? '' : 'opacity:.55'}"><td>${METHOD_LABELS[k]}${used ? '' : html` <small>(not used)</small>`}</td><td class="num">${v.methodWeights[k] ? pct(v.methodWeights[k], 0) : '—'}</td>${['bear', 'base', 'bull'].map((s) => html`<td class="num">${inr(v.scenarios[s].methods[k]?.value)}</td>`)}<td class="muted">${v.scenarios.base.methods[k]?.note || ''}</td></tr>`; })}
      <tr><th>Blended intrinsic value</th><td></td>${['bear', 'base', 'bull'].map((s) => html`<th class="num">${inr(v.scenarios[s].intrinsicValue)}</th>`)}<td></td></tr></tbody></table></div>
      ${v.scenarios.base.methods.dcf?.detail ? html`<p class="muted">DCF: PV of 10-year cash flows ₹${num(v.scenarios.base.methods.dcf.detail.pvExplicit)} Cr + PV of terminal value ₹${num(v.scenarios.base.methods.dcf.detail.pvTerminal)} Cr (${pct(v.scenarios.base.methods.dcf.detail.terminalShare, 0)} of EV); terminal reinvestment at RONIC ${pct(v.scenarios.base.methods.dcf.detail.ronic)}.</p>` : ''}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Sensitivity: WACC × terminal growth (₹/share)</h3>${heat(v.sensitivity.waccG, (r) => pct(r), (cc) => pct(cc), 'WACC', 'g')}</div>
      <div class="card"><h3>Sensitivity: revenue growth × EBITDA margin (₹/share)</h3>${heat(v.sensitivity.growthMargin, (r) => pct(r), (cc) => pct(cc), 'Growth', 'Margin')}</div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Expected annual return vs alternatives (5y)</h3><div class="chart-box small"><canvas id="chRet" aria-label="Expected return by scenario versus benchmarks"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Valuation inputs</h3><button class="btn small" id="saveV">Save inputs</button></div>
        <div class="grid g2" id="vForm">
          <div class="field"><label>Business type (drives method choice)</label><select id="btype">${Object.keys(METHOD_WEIGHTS).map((t) => html`<option ${t === (c.businessType || 'compounder') ? 'selected' : ''}>${t}</option>`)}</select></div>
          <div class="field"><label>Beta</label><input data-n="beta" type="number" step="any" value="${vi.beta ?? ''}"></div>
          <div class="field"><label>Cost of equity override (%)</label><input data-p="costOfEquity" type="number" step="any" value="${vi.costOfEquity != null ? vi.costOfEquity * 100 : ''}"></div>
          <div class="field"><label>Terminal growth override (%)</label><input data-p="terminalGrowth" type="number" step="any" value="${vi.terminalGrowth != null ? vi.terminalGrowth * 100 : ''}"></div>
          <div class="field"><label>Historical P/E low</label><input data-h="min" type="number" step="any" value="${vi.historicalPE?.min ?? ''}"></div>
          <div class="field"><label>Historical P/E median</label><input data-h="median" type="number" step="any" value="${vi.historicalPE?.median ?? ''}"></div>
          <div class="field"><label>Historical P/E high</label><input data-h="max" type="number" step="any" value="${vi.historicalPE?.max ?? ''}"></div>
          <div class="field"><label>NAV / replacement value per share (₹)</label><input data-n="navPerShare" type="number" step="any" value="${vi.navPerShare ?? ''}"></div>
        </div><p class="muted">Rates (risk-free, equity risk premium, required margin of safety) are set in Settings.</p></div>
    </div>
    <div style="margin-top:16px">${dimCard(a.dims.valuation)}</div>`);
  const labels = ['Bear', 'Base', 'Bull', 'Index fund', 'Fixed income'];
  const vals = [v.scenarios.bear.expectedReturn5y, v.scenarios.base.expectedReturn5y, v.scenarios.bull.expectedReturn5y, v.benchmark.index, v.benchmark.fixedIncome];
  chart($('#chRet'), { type: 'bar', data: { labels, datasets: [{ label: '5y expected return p.a.', data: vals, backgroundColor: [series(1), series(0), series(2), token('--axis'), token('--axis')], maxBarThickness: 36 }] }, options: { interaction: { mode: 'nearest', intersect: true }, scales: { y: { ticks: { callback: (t) => `${Math.round(t * 100)}%` } } }, plugins: { tooltip: { callbacks: { label: (ctx) => pct(ctx.parsed.y) } } } } });
  $('#saveV').onclick = () => {
    const out = { ...vi };
    el.querySelectorAll('#vForm [data-n]').forEach((i) => { out[i.dataset.n] = i.value === '' ? undefined : Number(i.value); });
    el.querySelectorAll('#vForm [data-p]').forEach((i) => { out[i.dataset.p] = i.value === '' ? undefined : Number(i.value) / 100; });
    const h = {}; el.querySelectorAll('#vForm [data-h]').forEach((i) => { if (i.value !== '') h[i.dataset.h] = Number(i.value); });
    out.historicalPE = Object.keys(h).length === 3 ? h : undefined;
    saveSection(app, { valuationInputs: out, businessType: $('#btype').value }).then(() => valuation(el, { app }));
  };
}
