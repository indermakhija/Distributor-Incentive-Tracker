// Screen 5: industry structure, Porter, PESTLE, competitor benchmarking (Module B).
import { html, mount, $, pct, cr, x, num, isNum } from '../../ui.js';
import { PORTER } from '/engine/scoring.js';
import { scoreEditor, bindScoreEditors, readScores, editTable, bindEditTables, readTable, saveSection, dimCard } from '../common.js';

const PEER_COLS = [
  { key: 'name', label: 'Competitor', type: 'text', width: '180px' }, { key: 'revenue', label: 'Revenue (₹ Cr)', type: 'number' }, { key: 'revenueGrowth3y', label: '3y growth', type: 'pct' },
  { key: 'ebitdaMargin', label: 'EBITDA margin', type: 'pct' }, { key: 'roce', label: 'ROCE', type: 'pct' }, { key: 'netDebtEbitda', label: 'Net debt/EBITDA', type: 'number' },
  { key: 'pe', label: 'P/E', type: 'number' }, { key: 'evEbitda', label: 'EV/EBITDA', type: 'number' }, { key: 'marketShare', label: 'Mkt share', type: 'pct' },
  { key: 'pricingPower', label: 'Pricing power', type: 'select', options: ['', 'High', 'Medium', 'Low'] }, { key: 'innovation', label: 'Innovation', type: 'select', options: ['', 'High', 'Medium', 'Low'] }, { key: 'distribution', label: 'Distribution', type: 'select', options: ['', 'Strong', 'Medium', 'Weak'] }
];

export default function industry(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const ind = c.industry || {};
  const self = { name: `${c.name} (this company)`, revenue: a.metrics.latest?.revenue, revenueGrowth3y: a.metrics.growth?.revenue3y, ebitdaMargin: a.metrics.latest?.ebitdaMargin, roce: a.metrics.latest?.roce, netDebtEbitda: a.metrics.latest?.netDebtToEbitda, pe: a.valuation?.multiples?.pe, evEbitda: a.valuation?.multiples?.evEbitda };
  const peers = [self, ...(c.competitors || [])];
  const best = (k, hi = true) => { const v = peers.map((p) => p[k]).filter(isNum); return v.length ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
  const cell = (p, k, f, hi = true) => html`<td class="num" style="${p[k] === best(k, hi) && isNum(p[k]) ? 'font-weight:700' : ''}">${f(p[k])}</td>`;
  mount(el, html`
    <div class="grid g2">
      <div class="card"><h3>${ind.name || 'Industry'} <span class="prov ${ind.growthSource || 'judgment'}">${ind.growthSource || 'judgment'}</span></h3>
        <dl class="kv">
          <dt>Total addressable market</dt><dd>${cr(ind.tamCr)}</dd><dt>Current market size</dt><dd>${cr(ind.sizeCr)}</dd>
          <dt>Historical growth</dt><dd>${pct(ind.growthHist)}</dd><dt>Expected growth 3y / 5y / 10y</dt><dd>${pct(ind.growth3y)} / ${pct(ind.growth5y)} / ${pct(ind.growth10y)}</dd>
          <dt>Life-cycle stage</dt><dd>${ind.lifecycle || '—'}</dd><dt>Growth type</dt><dd>${ind.structural || '—'}</dd><dt>Company position</dt><dd>${ind.position || '—'}</dd>
          <dt>Key success factors</dt><dd>${(ind.successFactors || []).map((s) => s.split('|')[0]).join(', ') || '—'}</dd>
          <dt>Indicators to watch</dt><dd>${(ind.indicators || []).join('; ') || '—'}</dd>
        </dl>
        <h4 style="margin-top:12px">PESTLE</h4>
        ${(ind.pestle || []).length ? html`<ul>${ind.pestle.map((p) => html`<li><b>${p.factor}</b> (${p.impact === '+' ? 'tailwind' : 'headwind'}): ${p.note}</li>`)}</ul>` : html`<p class="muted">No PESTLE factors recorded.</p>`}
      </div>
      ${dimCard(a.dims.industry)}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Competitive benchmarking matrix</h3><small class="muted">Bold = best in group. Peer data entered by user/sample.</small></div>
      <div class="table-wrap"><table class="sticky-first"><thead><tr><th>Company</th><th class="num">Revenue</th><th class="num">3y growth</th><th class="num">EBITDA %</th><th class="num">ROCE</th><th class="num">ND/EBITDA</th><th class="num">P/E</th><th class="num">EV/EBITDA</th><th class="num">Share</th><th>Pricing</th><th>Innovation</th><th>Distribution</th></tr></thead><tbody>
      ${peers.map((p) => html`<tr><td>${p.name}</td>${cell(p, 'revenue', cr)}${cell(p, 'revenueGrowth3y', pct)}${cell(p, 'ebitdaMargin', pct)}${cell(p, 'roce', pct)}${cell(p, 'netDebtEbitda', (v) => x(v), false)}${cell(p, 'pe', (v) => x(v), false)}${cell(p, 'evEbitda', (v) => x(v), false)}${cell(p, 'marketShare', (v) => pct(v, 0))}<td>${p.pricingPower || ''}</td><td>${p.innovation || ''}</td><td>${p.distribution || ''}</td></tr>`)}
      </tbody></table></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>Porter's Five Forces — threat level (0 low – 10 high)</h3><button class="btn small" id="savePorter">Save</button></div>
        ${scoreEditor('porter', PORTER, ind.porter || {})}</div>
      <div class="card"><div class="card-head"><h3>Industry facts & outlook</h3><button class="btn small" id="saveInd">Save</button></div>
        <div class="grid g2" id="indForm">
          <div class="field"><label>Industry name</label><input data-f="name" value="${ind.name || ''}"></div>
          <div class="field"><label>Life-cycle</label><select data-f="lifecycle">${['', 'emerging', 'growth', 'mature', 'decline'].map((o) => html`<option ${o === (ind.lifecycle || '') ? 'selected' : ''}>${o}</option>`)}</select></div>
          <div class="field"><label>TAM (₹ Cr)</label><input data-n="tamCr" type="number" value="${ind.tamCr ?? ''}"></div>
          <div class="field"><label>Market size (₹ Cr)</label><input data-n="sizeCr" type="number" value="${ind.sizeCr ?? ''}"></div>
          <div class="field"><label>Expected 3y growth (%)</label><input data-p="growth3y" type="number" step="any" value="${ind.growth3y != null ? +(ind.growth3y * 100).toFixed(2) : ''}"></div>
          <div class="field"><label>Expected 5y growth (%)</label><input data-p="growth5y" type="number" step="any" value="${ind.growth5y != null ? +(ind.growth5y * 100).toFixed(2) : ''}"></div>
          <div class="field"><label>Expected 10y growth (%)</label><input data-p="growth10y" type="number" step="any" value="${ind.growth10y != null ? +(ind.growth10y * 100).toFixed(2) : ''}"></div>
          <div class="field"><label>Growth source</label><select data-f="growthSource">${['judgment', 'external_forecast', 'reported', 'sample'].map((o) => html`<option ${o === (ind.growthSource || 'judgment') ? 'selected' : ''}>${o}</option>`)}</select></div>
          <div class="field"><label>Structural or cyclical</label><select data-f="structural">${['', 'structural', 'cyclical'].map((o) => html`<option ${o === (ind.structural || '') ? 'selected' : ''}>${o}</option>`)}</select></div>
          <div class="field"><label>Company position</label><select data-f="position">${['', 'leader', 'challenger', 'niche', 'disruptor', 'commodity', 'disadvantaged'].map((o) => html`<option ${o === (ind.position || '') ? 'selected' : ''}>${o}</option>`)}</select></div>
          <div class="field" style="grid-column:1/-1"><label>Success factors (one per line; use | for synonyms, e.g. "distribution|reach")</label><textarea data-l="successFactors">${(ind.successFactors || []).join('\n')}</textarea></div>
          <div class="field" style="grid-column:1/-1"><label>Industry indicators to monitor (one per line)</label><textarea data-l="indicators">${(ind.indicators || []).join('\n')}</textarea></div>
        </div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Edit competitors (3–5 recommended)</h3><button class="btn small" id="savePeers">Save competitors</button></div>
      ${editTable('peers', PEER_COLS, c.competitors || [], { addLabel: 'Add competitor' })}</div>`);
  bindScoreEditors(el); bindEditTables(el);
  $('#savePorter').onclick = () => saveSection(app, { industry: { ...ind, porter: readScores(el, 'porter', 'note') } }).then(() => industry(el, { app }));
  $('#savePeers').onclick = () => saveSection(app, { competitors: readTable(el, 'peers') }).then(() => industry(el, { app }));
  $('#saveInd').onclick = () => {
    const out = { ...ind };
    el.querySelectorAll('#indForm [data-f]').forEach((i) => { out[i.dataset.f] = i.value || null; });
    el.querySelectorAll('#indForm [data-n]').forEach((i) => { out[i.dataset.n] = i.value === '' ? null : Number(i.value); });
    el.querySelectorAll('#indForm [data-p]').forEach((i) => { out[i.dataset.p] = i.value === '' ? null : Number(i.value) / 100; });
    el.querySelectorAll('#indForm [data-l]').forEach((i) => { out[i.dataset.l] = i.value.split('\n').map((s) => s.trim()).filter(Boolean); });
    saveSection(app, { industry: out }).then(() => industry(el, { app }));
  };
  void num;
}
