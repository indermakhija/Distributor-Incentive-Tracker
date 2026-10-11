// Screen 20: settings, scoring customisation, integrations and audit log.
import { html, mount, $, $$, pct, dt, statusChip, busy, toast } from '../ui.js';
import { get, put } from '../api.js';

export default async function settings(main, { app }) {
  const [{ settings: s, defaults, dimensions }, integ, audit] = await Promise.all([get('/api/settings'), get('/api/integrations'), get('/api/audit')]);
  const r = s.rates;
  const rateField = (k, label) => html`<div class="field"><label>${label} (%) <small class="muted">default ${pct(defaults.rates[k])}</small></label><input data-rate="${k}" type="number" step="0.1" value="${+(r[k] * 100).toFixed(2)}"></div>`;
  mount(main, html`
    <div class="page-head"><h1>Settings & scoring customisation</h1></div>
    <div class="grid g2">
      <div class="card"><h3>Scoring weights</h3><p class="muted">Must total 100. The default framework stays visible.</p>
        <div class="table-wrap"><table><thead><tr><th>Dimension</th><th class="num">Default</th><th class="num">Yours</th></tr></thead><tbody>
        ${dimensions.map((d) => html`<tr><td>${d.label}</td><td class="num">${d.weight}</td><td class="num"><input data-w="${d.id}" type="number" min="0" max="50" step="1" value="${s.weights[d.id]}" style="width:80px"></td></tr>`)}
        <tr><th>Total</th><th class="num">100</th><th class="num" id="wt"></th></tr></tbody></table></div>
        <div class="btn-row"><button class="btn" id="saveW">Save weights</button><button class="btn ghost" id="resetAll">Reset all settings to defaults</button></div></div>
      <div class="card"><h3>Rates, hurdles & limits</h3><div class="grid g2">
        ${rateField('riskFree', 'Risk-free rate (10y G-sec)')}${rateField('equityRiskPremium', 'Equity risk premium')}${rateField('terminalGrowth', 'Default terminal growth')}${rateField('costOfDebt', 'Cost of debt')}
        ${rateField('indexExpectedReturn', 'Index fund expected return')}${rateField('fixedIncomeReturn', 'Fixed income return')}
        <div class="field"><label>Required margin of safety (%)</label><input id="mos" type="number" step="1" value="${Math.round(s.requiredMarginOfSafety * 100)}"></div>
        <div class="field"><label>Max single-stock weight (%)</label><input id="maxStock" type="number" step="1" value="${Math.round(s.limits.maxSingleStock * 100)}"></div>
        <div class="field"><label>Max sector weight (%)</label><input id="maxSector" type="number" step="1" value="${Math.round(s.limits.maxSector * 100)}"></div>
        <div class="field"><label><input type="checkbox" id="priceAlerts" ${s.priceAlerts ? 'checked' : ''}> Alert me on ±10% price moves (off by default)</label></div>
      </div><button class="btn" id="saveR">Save rates & limits</button></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Data integrations — actual status</h3><p class="muted">API keys live only on the server (environment variables). Nothing here is shown as live unless it is.</p>
      <div class="table-wrap"><table><tbody>${integ.map((i) => html`<tr><td><b>${i.name}</b></td><td>${statusChip(i.status)}</td><td class="muted">${i.detail}</td></tr>`)}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h3>Audit log (latest 300)</h3><div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>
      ${audit.map((a) => html`<tr><td>${dt(a.created_at)}</td><td>${a.action}</td><td>${a.entity || ''} ${a.entity_id || ''}</td><td class="muted"><small>${a.detail ? JSON.stringify(a.detail).slice(0, 160) : ''}</small></td></tr>`)}</tbody></table></div></div>`);
  const tot = () => { const t = $$('[data-w]', main).reduce((a, i) => a + Number(i.value || 0), 0); $('#wt').textContent = t; $('#wt').style.color = t === 100 ? '' : 'var(--crit-ink)'; };
  main.addEventListener('input', (e) => { if (e.target.dataset.w) tot(); });
  tot();
  const done = () => { app.invalidate(); toast('Settings saved.'); settings(main, { app }); };
  $('#saveW').onclick = (e) => busy(e.target, async () => { await put('/api/settings', { weights: Object.fromEntries($$('[data-w]', main).map((i) => [i.dataset.w, Number(i.value)])) }); done(); });
  $('#saveR').onclick = (e) => busy(e.target, async () => {
    await put('/api/settings', { rates: Object.fromEntries($$('[data-rate]', main).map((i) => [i.dataset.rate, Number(i.value) / 100])), requiredMarginOfSafety: Number($('#mos').value) / 100, limits: { maxSingleStock: Number($('#maxStock').value) / 100, maxSector: Number($('#maxSector').value) / 100 }, priceAlerts: $('#priceAlerts').checked });
    done();
  });
  $('#resetAll').onclick = (e) => { if (confirm('Reset weights, rates and limits to defaults?')) busy(e.target, async () => { await put('/api/settings', { reset: true }); done(); }); };
}
