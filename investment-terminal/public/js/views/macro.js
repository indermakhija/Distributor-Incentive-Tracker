// Macro dashboard: national (India) and international factor readings, signals, staleness and stress scenarios.
import { html, mount, $, $$, num, dt, date, modal, toast, busy, token } from '../ui.js';
import { get, put } from '../api.js';

export const signalBar = (s) => {
  if (s == null) return html`<span class="muted">—</span>`;
  const w = Math.round(Math.abs(s) * 50);
  return html`<span class="sig" role="img" aria-label="signal ${s}"><span class="sig-mid"></span><span class="sig-fill" style="${s >= 0 ? `left:50%;width:${w}%;background:var(--div-pos)` : `left:${50 - w}%;width:${w}%;background:var(--div-neg)`}"></span></span> <small>${s > 0 ? '+' : ''}${s.toFixed(2)}</small>`;
};

export default async function macro(main, { app }) {
  const m = await get('/api/macro');
  const q = m.quality;
  const table = (scope) => html`<div class="table-wrap"><table><thead><tr><th>Factor</th><th class="num">Value</th><th class="num">Previous</th><th>Trend</th><th>Signal (high/rising = +)</th><th>As of</th><th>Source</th><th></th></tr></thead><tbody>
    ${m.factors.filter((f) => f.scope === scope).map((f) => { const s = m.signals[f.id]; return html`<tr>
      <td><b>${f.name}</b><br><small class="muted">${f.group} · ${f.unit} · neutral ${s.neutral ?? f.neutral}</small></td>
      <td class="num">${s.available ? num(s.value, 2) : html`<span class="muted">missing</span>`}</td><td class="num">${s.previous != null ? num(s.previous, 2) : '—'}</td>
      <td>${s.available ? (s.direction === 'rising' ? '▲ rising' : s.direction === 'falling' ? '▼ falling' : s.direction) : ''}</td>
      <td style="min-width:150px">${s.available ? signalBar(s.signal) : ''}</td>
      <td>${date(s.asOf)}${s.stale ? html` <span class="chip warn">stale</span>` : ''}</td>
      <td><span class="prov ${s.type}">${s.type || '—'}</span> <small class="muted">${s.source || ''}</small></td>
      <td><button class="btn ghost small" data-edit="${f.id}">Update</button></td></tr>`; })}</tbody></table></div>`;
  mount(main, html`
    <div class="page-head"><div><h1>Macro dashboard</h1><p class="muted">National and international factors feed every company's decision through its sensitivities: a macro overlay on scenario assumptions, macro stress tests, a higher required margin of safety in adverse regimes, and alerts when the regime shifts.</p></div></div>
    ${q.status === 'sample' ? html`<div class="banner sample"><b>Illustrative sample macro readings.</b> These are not current data. Connect the Nifty terminal bridge (Settings → Nifty terminal bridge) to stream live readings, or update each factor manually with its date and source.</div>` : ''}
    <div class="grid g4"><div class="tile"><div class="label">Factors with data</div><div class="value">${q.available}/${q.total}</div></div>
      <div class="tile"><div class="label">Live (bridge)</div><div class="value">${q.live}</div></div>
      <div class="tile"><div class="label">Sample</div><div class="value">${q.sample}</div></div>
      <div class="tile"><div class="label">Stale</div><div class="value">${q.stale}</div></div></div>
    <div class="card" style="margin-top:16px"><h3>🇮🇳 National — India</h3>${table('india')}</div>
    <div class="card" style="margin-top:16px"><h3>🌐 International</h3>${table('global')}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Stress scenarios applied to every company</h3><div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Shocks</th></tr></thead><tbody>
        ${m.stressScenarios.map((s) => html`<tr><td><b>${s.name}</b><br><small class="muted">${s.note}</small></td><td><small>${Object.entries(s.shocks).map(([k, v]) => `${m.factors.find((f) => f.id === k)?.name || k} ${v > 0 ? '+' : ''}${v}`).join(' · ')}</small></td></tr>`)}</tbody></table></div></div>
      <div class="card"><h3>How a signal is computed</h3><p>signal = clamp(level weight × (value − neutral) / scale + momentum weight × (value − previous) / scale, −1, +1). Currency and gold use momentum only. Monsoon and flows use level only. Neutral levels and scales are model assumptions for India and can be changed per factor.</p>
        <p>Company impact = Σ (sensitivity × signal) ÷ Σ |sensitivity|, mapped to a 0–10 macro score where 5 is neutral. Sensitivities come from sector templates, thematic tags and the balance sheet (leverage, export share). You can override them on each company's Macro tab.</p></div>
    </div>`);
  $$('[data-edit]', main).forEach((b) => (b.onclick = () => {
    const f = m.factors.find((x) => x.id === b.dataset.edit);
    const r = m.readings[f.id] || {};
    modal(html`<h2>Update: ${f.name}</h2><p class="muted">${f.note}</p><form id="mf"><div class="grid g2">
      <div class="field"><label>Value (${f.unit})</label><input name="value" type="number" step="any" required value="${r.value ?? ''}"></div>
      <div class="field"><label>As of</label><input name="asOf" type="date" required value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>Comparison value ~3 months ago (blank = from history)</label><input name="previous" type="number" step="any" value="${r.previous ?? ''}"></div>
      <div class="field"><label>Neutral level override (default ${f.neutral})</label><input name="neutral" type="number" step="any" value="${r.neutral ?? ''}"></div></div>
      <div class="field"><label>Source</label><input name="source" required placeholder="e.g. RBI MPC statement, MoSPI release"></div>
      <div class="btn-row"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`, (el, close) => {
      $('#mf', el).onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { const res = await put(`/api/macro/${f.id}`, Object.fromEntries(new FormData(e.target))); toast(`Saved. ${res.alerts.length} alert(s) on watchlisted companies.`); close(); app.invalidate(); app.refreshAlerts(); macro(main, { app }); }); };
    });
  }));
  void dt; void token;
}
