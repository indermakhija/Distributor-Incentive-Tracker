// Company macro tab: sensitivities, current impact (national vs international), overlay, stress tests.
import { html, mount, $, $$, pct, inr, chart, token, list, toast } from '../../ui.js';
import { MACRO_FACTORS } from '/engine/macro.js';
import { saveSection } from '../common.js';
import { signalBar } from '../macro.js';

export default function macroTab(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const mc = a.macro;
  const imp = mc.impact;
  const exp = mc.exposures;
  mount(el, html`
    ${!mc.usable ? html`<div class="banner sample">No macro readings are loaded, so the macro layer isn't affecting this decision. <a href="#/macro">Open the Macro dashboard →</a></div>` : ''}
    ${mc.dataset.sample ? html`<div class="banner sample">${mc.dataset.sample} of ${mc.dataset.available} macro readings are illustrative samples, not current data. Connect the Nifty terminal live feed in Settings.</div>` : ''}
    <div class="grid g4">
      <div class="tile"><div class="label">Macro regime for this company</div><div class="value" style="font-size:18px">${mc.regime}</div><div class="sub">score ${mc.usable ? imp.score : '—'}/10 · 5 = neutral</div></div>
      <div class="tile"><div class="label">Macro sensitivity</div><div class="value">${imp.sensitivity}</div><div class="sub">Σ|sensitivity| = ${imp.sensitivityTotal}${mc.template ? ' · template: ' + mc.template : ''}</div></div>
      <div class="tile"><div class="label">National vs international pull</div><div class="value" style="font-size:18px">${imp.national >= 0 ? '+' : ''}${imp.national.toFixed(2)} / ${imp.international >= 0 ? '+' : ''}${imp.international.toFixed(2)}</div><div class="sub">India / global contribution</div></div>
      <div class="tile"><div class="label">Effect on the decision</div><div class="value" style="font-size:15px">Growth ${mc.overlay.growth >= 0 ? '+' : ''}${(mc.overlay.growth * 100).toFixed(1)}pp · margin ${mc.overlay.margin >= 0 ? '+' : ''}${(mc.overlay.margin * 100).toFixed(1)}pp</div><div class="sub">Required MoS +${pct(mc.mosUplift, 0)} · overlay: ${mc.overlayMode}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>What is driving it (sensitivity × signal)</h3><div class="chart-box"><canvas id="chMacro" aria-label="Macro factor contributions"></canvas></div>
        <p class="muted" style="font-size:12px">Blue bars help, red bars hurt. Only factors this company is sensitive to are shown.</p></div>
      <div class="card"><h3>Macro stress tests (base case re-valued)</h3><div class="table-wrap"><table><thead><tr><th>Scenario</th><th class="num">Value</th><th class="num">vs base</th><th class="num">vs price</th><th>Biggest drivers</th></tr></thead><tbody>
        ${(mc.stress || []).map((s) => html`<tr><td><b>${s.name}</b><br><small class="muted">${s.scope === 'india' ? 'National' : 'International'}</small></td><td class="num">${inr(s.value)}</td><td class="num"><span class="chip ${s.vsBase < -0.15 ? 'neg' : s.vsBase > 0.05 ? 'pos' : ''}">${pct(s.vsBase, 0)}</span></td><td class="num">${pct(s.vsPrice, 0)}</td><td><small>${s.parts.slice(0, 3).map((p) => `${p.name} (${p.effect > 0 ? '+' : ''}${p.effect})`).join(', ') || '—'}</small></td></tr>`)}</tbody></table></div>
        <p class="muted" style="font-size:12px">Each shock moves base-case growth by up to ±6pp and margin by up to ±3pp in years 1–5, scaled by this company's sensitivities. All of these are model estimates.</p></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Tailwinds</h3>${list(imp.tailwinds.map((r) => `${r.name} (${r.scope === 'india' ? 'India' : 'global'}) — ${r.direction}, sensitivity ${r.sensitivity}`), 'No material tailwinds.')}
        <h3>Headwinds</h3>${list(imp.headwinds.map((r) => `${r.name} (${r.scope === 'india' ? 'India' : 'global'}) — ${r.direction}, sensitivity ${r.sensitivity}`), 'No material headwinds.')}</div>
      <div class="card"><div class="card-head"><h3>Sensitivities (−2 hurt … +2 benefit when the factor rises)</h3><button class="btn small" id="saveExp">Save</button></div>
        <div class="field"><label>Macro overlay on scenarios</label><select id="ovMode">${[['auto', 'Auto: apply to auto-derived scenarios only'], ['always', 'Always: also apply to my own scenario assumptions'], ['off', 'Off: show macro, but don’t adjust scenarios']].map(([v, l]) => html`<option value="${v}" ${v === (c.macroOverlay || 'auto') ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div class="table-wrap" style="max-height:420px;overflow:auto"><table><thead><tr><th>Factor</th><th>Sensitivity</th><th>Basis</th></tr></thead><tbody>
        ${MACRO_FACTORS.map((f) => { const e = exp[f.id]; const v = e?.value ?? 0; return html`<tr><td>${f.name}<br><small class="muted">${f.scope === 'india' ? 'India' : 'Global'}</small></td>
          <td style="min-width:150px"><input type="range" min="-2" max="2" step="0.5" value="${v}" data-exp="${f.id}" aria-label="Sensitivity to ${f.name}"> <output>${v}</output></td><td><small class="muted">${e?.basis || ''}</small></td></tr>`; })}</tbody></table></div>
        <p class="muted" style="font-size:12px">Saving stores your values as user judgments that override the automatic sector, tag and balance-sheet basis.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Current factor readings used</h3><div class="table-wrap"><table><thead><tr><th>Factor</th><th class="num">Value</th><th>Signal</th><th class="num">Contribution</th></tr></thead><tbody>
      ${imp.rows.map((r) => html`<tr><td>${r.name}</td><td class="num">${r.missing ? html`<span class="muted">missing</span>` : `${r.value} ${r.unit}`}${r.stale ? html` <span class="chip warn">stale</span>` : ''}</td><td>${r.missing ? '' : signalBar(r.signal)}</td><td class="num">${r.contribution ?? '—'}</td></tr>`)}</tbody></table></div></div>`);
  const rows = imp.rows.filter((r) => r.contribution != null).slice(0, 12);
  chart($('#chMacro'), { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'Contribution', data: rows.map((r) => r.contribution), backgroundColor: rows.map((r) => (r.contribution >= 0 ? token('--div-pos') : token('--div-neg'))), maxBarThickness: 14 }] },
    options: { indexAxis: 'y', interaction: { mode: 'nearest', intersect: true }, scales: { x: { grid: { display: true, color: token('--grid') } }, y: { grid: { display: false } } } } });
  el.addEventListener('input', (e) => { if (e.target.dataset.exp) e.target.nextElementSibling.textContent = e.target.value; });
  $('#saveExp').onclick = () => {
    const out = {};
    $$('[data-exp]', el).forEach((i) => { const v = Number(i.value); const auto = exp[i.dataset.exp]?.value ?? 0; if (v !== 0 || auto !== 0) out[i.dataset.exp] = { value: v, basis: v === auto ? exp[i.dataset.exp]?.basis || 'user' : 'user override' }; });
    saveSection(app, { macroExposure: out, macroOverlay: $('#ovMode').value }).then(() => macroTab(el, { app })).catch((e) => toast(e.message, true));
  };
}
