// Screen 4: business model & business quality (Module A).
import { html, mount, $, pct } from '../../ui.js';
import { BUSINESS_QUALITY_ITEMS } from '/engine/scoring.js';
import { scoreEditor, bindScoreEditors, readScores, saveSection, dimCard } from '../common.js';

const FIELDS = [
  ['whatItSells', 'What the company sells'], ['customers', 'Who its customers are'], ['whyBuy', 'Why customers buy from it'], ['howEarns', 'How it earns money'],
  ['pricingPowerNote', 'Pricing power (evidence)'], ['distribution', 'Distribution strength'], ['switchingCosts', 'Customer retention & switching costs'],
  ['supplierConcentration', 'Supplier concentration'], ['capitalIntensity', 'Capital intensity'], ['workingCapital', 'Working-capital needs'],
  ['cyclicality', 'Cyclicality'], ['seasonality', 'Seasonality'], ['operatingLeverage', 'Operating leverage']
];
const CLASSES = ['', 'Exceptional business', 'Average business', 'Cyclical opportunity', 'Turnaround', 'Speculative growth story', 'Structurally declining business'];

export default function business(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const bm = c.businessModel || {};
  const m = a.metrics;
  mount(el, html`
    <div class="grid g2">
      <div class="card"><h3>The business in plain language</h3>
        <dl class="kv">${FIELDS.filter(([k]) => bm[k]).map(([k, l]) => html`<dt>${l}</dt><dd>${bm[k]}</dd>`)}
          <dt>Revenue streams</dt><dd>${(bm.revenueStreams || []).join(' · ') || '—'}</dd>
          <dt>Geographic exposure</dt><dd>${(bm.geographic || []).join(' · ') || '—'}</dd>
          <dt>Recurring / repeat revenue</dt><dd>${pct(bm.recurringShare, 0)}</dd>
          <dt>Customer concentration</dt><dd>${pct(bm.customerConcentration, 0)} of revenue from top customers</dd>
        </dl>
        <p style="margin-top:8px"><span class="prov judgment">Judgment</span> Classification: <b>${a.dims.business.classification}</b></p>
      </div>
      <div class="card"><h3>Quantitative fingerprints <span class="prov calculated">Calculated</span></h3>
        <dl class="kv">
          <dt>Cash conversion cycle</dt><dd>${m.latest?.cashConversionCycle != null ? Math.round(m.latest.cashConversionCycle) + ' days' : '—'}</dd>
          <dt>Working capital / revenue</dt><dd>${pct(m.latest?.nwcToRevenue)}</dd>
          <dt>Capex / revenue (5y avg)</dt><dd>${pct(m.avg5?.capexToRevenue)}</dd>
          <dt>ROCE (5y avg)</dt><dd>${pct(m.avg5?.roce)}</dd>
          <dt>Revenue growth volatility (σ)</dt><dd>${pct(m.stability?.revenueGrowthStdev)}</dd>
          <dt>EBITDA margin volatility (σ)</dt><dd>${pct(m.stability?.ebitdaMarginStdev)}</dd>
          <dt>Worst revenue year</dt><dd>${pct(m.stability?.worstRevenueYoY)}</dd>
          <dt>CFO / PAT (5y)</dt><dd>${pct(m.avg5?.cfoToPat, 0)}</dd>
        </dl>
        <h4 style="margin-top:12px">Segments</h4>
        <div class="table-wrap"><table><thead><tr><th>Segment</th><th class="num">Share</th><th class="num">Growth</th><th class="num">Margin</th></tr></thead><tbody>
        ${(c.segments || []).map((s) => html`<tr><td>${s.name}</td><td class="num">${pct(s.revenueShare, 0)}</td><td class="num">${pct(s.growth)}</td><td class="num">${pct(s.margin)}</td></tr>`)}</tbody></table></div>
      </div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>Business-quality scores (0–10)</h3><button class="btn small" id="saveBq">Save scores</button></div>
        ${scoreEditor('bq', BUSINESS_QUALITY_ITEMS, c.businessQuality || {}, { hint: 'Every score needs evidence. Unscored items stay unscored (they are not treated as 5).' })}</div>
      <div>${dimCard(a.dims.business)}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Edit business description</h3><button class="btn small" id="saveBm">Save description</button></div>
      <div class="grid g2" id="bmForm">${FIELDS.map(([k, l]) => html`<div class="field"><label>${l}</label><textarea data-f="${k}" rows="2">${bm[k] || ''}</textarea></div>`)}
        <div class="field"><label>Recurring revenue share (%)</label><input data-n="recurringShare" type="number" step="any" value="${bm.recurringShare != null ? bm.recurringShare * 100 : ''}"></div>
        <div class="field"><label>Top-customer concentration (%)</label><input data-n="customerConcentration" type="number" step="any" value="${bm.customerConcentration != null ? bm.customerConcentration * 100 : ''}"></div>
        <div class="field"><label>Revenue streams (one per line)</label><textarea data-l="revenueStreams">${(bm.revenueStreams || []).join('\n')}</textarea></div>
        <div class="field"><label>Geographic exposure (one per line)</label><textarea data-l="geographic">${(bm.geographic || []).join('\n')}</textarea></div>
        <div class="field"><label>Classification override</label><select data-f="classification">${CLASSES.map((o) => html`<option ${o === (bm.classification || '') ? 'selected' : ''} value="${o}">${o || 'Automatic'}</option>`)}</select></div>
      </div></div>`);
  bindScoreEditors(el);
  $('#saveBq').onclick = () => saveSection(app, { businessQuality: readScores(el, 'bq') }).then(() => business(el, { app }));
  $('#saveBm').onclick = () => {
    const out = { ...bm };
    el.querySelectorAll('#bmForm [data-f]').forEach((i) => { out[i.dataset.f] = i.value.trim() || undefined; });
    el.querySelectorAll('#bmForm [data-n]').forEach((i) => { out[i.dataset.n] = i.value === '' ? null : Number(i.value) / 100; });
    el.querySelectorAll('#bmForm [data-l]').forEach((i) => { out[i.dataset.l] = i.value.split('\n').map((s) => s.trim()).filter(Boolean); });
    saveSection(app, { businessModel: out }).then(() => business(el, { app }));
  };
}
