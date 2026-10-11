// Screen 14: holistic scoring dashboard (Module L) with live weight customisation.
import { html, mount, $, $$, pct, scoreBar, sev, toast, busy, chart, series, token } from '../../ui.js';
import { put } from '../../api.js';
import { DIMENSIONS, DEFAULT_WEIGHTS } from '/engine/scoring.js';
import { dimCard } from '../common.js';

export default function scoring(el, { app }) {
  const { company: c, ctx } = app.co;
  const weights = { ...DEFAULT_WEIGHTS, ...(ctx.settings.weights || {}) };
  mount(el, html`
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Weights</h3><span id="wTotal"></span></div>
        <p class="muted">Default framework shown in brackets. Adjust to see the effect live; save to apply to all companies.</p>
        ${DIMENSIONS.map((d) => html`<div class="slider-row"><label style="margin:0" for="w-${d.id}">${d.label} <small class="muted">[${d.weight}%]</small></label><input type="range" id="w-${d.id}" min="0" max="30" step="1" value="${weights[d.id]}" data-w="${d.id}"><output>${weights[d.id]}%</output></div>`)}
        <div class="btn-row"><button class="btn" id="saveW">Save weights</button><button class="btn ghost" id="resetW">Restore defaults</button></div></div>
      <div class="card"><h3>Weighted contribution to the holistic score</h3><div class="chart-box"><canvas id="chContrib" aria-label="Contribution by dimension"></canvas></div></div>
    </div>
    <div id="scoreBody" style="margin-top:16px"></div>`);
  const update = () => {
    const w = Object.fromEntries($$('[data-w]', el).map((i) => [i.dataset.w, Number(i.value)]));
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    $('#wTotal').innerHTML = `Total <b style="color:${Math.abs(tot - 100) < 0.5 ? 'inherit' : 'var(--crit-ink)'}">${tot}%</b>${Math.abs(tot - 100) < 0.5 ? '' : ' (must be 100 to save; preview normalises)'}`;
    ctx.settings = { ...ctx.settings, weights: w };
    const a = app.recompute();
    const g = a.aggregate, d = a.decision;
    mount($('#scoreBody'), html`
      <div class="grid g3">
        <div class="tile"><div class="label">Holistic score</div><div class="value">${g.holistic}/100</div><div class="sub">${g.band.label} — ${g.band.note}</div></div>
        <div class="tile"><div class="label">Business-quality composite</div><div class="value">${d.quality ?? 'n/a'}/10</div><div class="sub">Average of business, industry, financial, management, moat, growth (weighted)</div></div>
        <div class="tile"><div class="label">Decision</div><div class="value" style="font-size:17px">${d.label}</div><div class="sub">confidence ${pct(d.confidence, 0)} · ${d.status}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Scorecard</h3><div class="table-wrap"><table><thead><tr><th>Dimension</th><th class="num">Score</th><th></th><th class="num">Weight</th><th class="num">Contribution</th><th class="num">Confidence</th><th>Missing data</th></tr></thead><tbody>
        ${g.rows.map((r) => html`<tr><td><a href="#dim-${r.id}">${r.label}</a></td><td class="num"><b>${r.score ?? 'n/a'}</b></td><td style="width:120px">${scoreBar(r.score)}</td><td class="num">${r.weight}%</td><td class="num">${r.contribution ?? html`<span class="muted">neutral ${(r.weight / 2).toFixed(1)}</span>`}</td><td class="num">${pct(r.confidence, 0)}</td><td class="muted" style="font-size:12px">${(r.missing || []).join('; ')}</td></tr>`)}
        <tr><th>Total</th><th class="num">${g.holistic}</th><th></th><th class="num">100%</th><th class="num">${g.holistic}</th><th class="num">${pct(g.confidence, 0)}</th><th></th></tr></tbody></table></div>
        <p class="muted">Unscored dimensions are held at a neutral 5/10 so missing data neither hides nor inflates the total — and lowers confidence.</p></div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>BUY checklist — every item is required</h3><ul style="list-style:none;padding:0">${d.buyChecklist.map((x) => html`<li>${x.ok ? html`<span class="check">✔</span>` : html`<span class="cross">✘</span>`} ${x.item} <small class="muted">(${x.value ?? 'n/a'})</small></li>`)}</ul>
          <p class="muted">No BUY is generated from the aggregate score alone.</p></div>
        <div class="card"><h3>Decision trace & non-negotiable overrides</h3><ol>${d.trace.map((t) => html`<li><b>${t.step}</b> → ${t.result}<br><span class="muted">${t.why}</span></li>`)}</ol>
          ${d.rules.length ? html`<h4>Rules evaluated</h4><ul>${d.rules.map((r) => html`<li>${sev(r.severity)} ${r.title}${r.cap ? html` <small class="muted">(caps at ${r.cap})</small>` : ''}</li>`)}</ul>` : ''}</div>
      </div>
      ${g.rows.map((r) => html`<div id="dim-${r.id}" style="margin-top:16px">${dimCard(a.dims[r.id])}</div>`)}`);
    chart($('#chContrib'), { type: 'bar', data: { labels: g.rows.map((r) => r.label.split(' ')[0] + (r.label.includes('Investor') ? ' knowledge' : '')), datasets: [{ label: 'Contribution', data: g.rows.map((r) => r.contribution ?? 0), backgroundColor: series(0), maxBarThickness: 14 }, { label: 'Maximum (weight)', data: g.rows.map((r) => r.weight), backgroundColor: token('--surface-2'), maxBarThickness: 14 }] },
      options: { indexAxis: 'y', scales: { x: { stacked: false, grid: { display: true, color: token('--grid') } }, y: { grid: { display: false } } }, datasets: { bar: { grouped: false } }, plugins: { tooltip: { callbacks: { label: (cx) => `${cx.dataset.label}: ${cx.parsed.x}` } } } } });
  };
  el.addEventListener('input', (e) => { if (e.target.dataset.w) { e.target.nextElementSibling.textContent = e.target.value + '%'; update(); } });
  update();
  $('#saveW').onclick = (e) => busy(e.target, async () => { await put('/api/settings', { weights: ctx.settings.weights }); toast('Weights saved for all companies.'); });
  $('#resetW').onclick = () => { $$('[data-w]', el).forEach((i) => { i.value = DEFAULT_WEIGHTS[i.dataset.w]; i.nextElementSibling.textContent = i.value + '%'; }); update(); };
  void c;
}
