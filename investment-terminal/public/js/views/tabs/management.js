// Screen 7: management quality, governance & capital allocation (Module D).
import { html, mount, $, pct } from '../../ui.js';
import { editTable, bindEditTables, readTable, saveSection, dimCard, scoreEditor, bindScoreEditors, readScores } from '../common.js';

const PROMISE_COLS = [{ key: 'promise', label: 'Management promise', type: 'textarea', width: '200px' }, { key: 'date', label: 'Made', type: 'text' }, { key: 'commitment', label: 'Original commitment', type: 'textarea' }, { key: 'outcome', label: 'Actual outcome', type: 'textarea' }, { key: 'variance', label: 'Variance', type: 'text' }, { key: 'assessment', label: 'Assessment', type: 'select', options: ['pending', 'exceeded', 'met', 'partly', 'missed'] }, { key: 'source', label: 'Source', type: 'text' }];
const EVENT_COLS = [{ key: 'type', label: 'Type', type: 'select', options: ['allegation', 'disclosed', 'regulatory_finding', 'proven'] }, { key: 'description', label: 'Description', type: 'textarea', width: '240px' }, { key: 'date', label: 'Date', type: 'text' }, { key: 'source', label: 'Source', type: 'text' }, { key: 'severity', label: 'Severity', type: 'select', options: ['medium', 'high', 'low'] }, { key: 'resolved', label: 'Resolved?', type: 'select', options: ['', 'yes'] }];
const AUD_COLS = [{ key: 'type', label: 'Type', type: 'select', options: ['qualification', 'emphasis', 'resignation'] }, { key: 'date', label: 'Date', type: 'text' }, { key: 'description', label: 'Description', type: 'textarea', width: '240px' }, { key: 'source', label: 'Source', type: 'text' }];
const SH_COLS = [{ key: 'date', label: 'Quarter end', type: 'text' }, { key: 'promoter', label: 'Promoter', type: 'pct' }, { key: 'pledgedPctOfPromoter', label: 'Pledged (of promoter)', type: 'pct' }, { key: 'fii', label: 'FII', type: 'pct' }, { key: 'dii', label: 'DII', type: 'pct' }, { key: 'retail', label: 'Retail', type: 'pct' }];

export default function management(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const mg = c.management || {};
  const d = a.dims.management;
  mount(el, html`
    ${d.serious ? html`<div class="banner crit"><b>Escalation: serious governance concern.</b> Proven misconduct, a material regulatory finding, or an auditor resignation/qualification is on record. Verify primary sources independently before any capital decision.</div>` : ''}
    ${d.allegationsOnly ? html`<div class="banner sample"><b>Unresolved allegations.</b> Allegations are recorded as allegations — not facts. Read the original source and the company's response.</div>` : ''}
    <div class="grid g2">${dimCard(d)}
      <div class="card"><h3>Capital allocation & ownership <span class="prov calculated">Calculated</span></h3>
        <dl class="kv"><dt>Incremental ROCE (3y)</dt><dd>${pct(a.metrics.incrementalRoce)}</dd><dt>Share-count change</dt><dd>${pct(a.metrics.dilution)}</dd>
          <dt>Acquisition spend (5y)</dt><dd>₹${Math.round(a.metrics.growth?.acquisitionSpend5y || 0)} Cr</dd><dt>Payout ratio (latest)</dt><dd>${pct(a.metrics.latest?.payoutRatio, 0)}</dd>
          <dt>Related-party transactions</dt><dd>${pct(mg.relatedPartyPctRevenue, 0)} of revenue</dd><dt>Promoter/KMP pay</dt><dd>${pct(mg.ceoPayToPat, 1)} of PAT</dd><dt>Succession</dt><dd>${mg.succession || 'unknown'}</dd></dl>
        <h4 style="margin-top:12px">Judgment scores</h4>
        ${scoreEditor('mgj', [['disclosureQuality', 'Transparency of disclosures'], ['trackRecord', 'Leadership track record']], mg)}
        <div class="grid g2"><div class="field"><label>Related-party txns (% of revenue)</label><input id="rpt" type="number" step="any" value="${mg.relatedPartyPctRevenue != null ? +(mg.relatedPartyPctRevenue * 100).toFixed(2) : ''}"></div>
          <div class="field"><label>Succession plan</label><select id="succ">${['', 'clear', 'unclear'].map((o) => html`<option ${o === (mg.succession || '') ? 'selected' : ''}>${o}</option>`)}</select></div></div>
        <button class="btn small" id="saveJ">Save</button>
      </div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Management credibility tracker</h3><button class="btn small" id="saveP">Save tracker</button></div>
      <p class="muted">Record what management promised, when, and what actually happened. Delivery rate feeds the management and growth-execution scores.</p>
      ${editTable('promises', PROMISE_COLS, mg.promises || [], { addLabel: 'Add promise' })}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Governance record</h3><button class="btn small" id="saveE">Save record</button></div>
      <p class="muted">Classify carefully: <b>allegation</b> (unproven claim), <b>disclosed</b> (company-disclosed fact), <b>regulatory_finding</b> (order by a regulator), <b>proven</b> (adjudicated misconduct). Do not record unsupported claims.</p>
      ${editTable('events', EVENT_COLS, (mg.events || []).map((e) => ({ ...e, resolved: e.resolved ? 'yes' : '' })), { addLabel: 'Add event' })}
      <h4 style="margin-top:12px">Auditor events</h4>${editTable('aud', AUD_COLS, mg.auditorEvents || [], { addLabel: 'Add auditor event' })}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Shareholding pattern & pledges</h3><button class="btn small" id="saveS">Save shareholding</button></div>
      ${editTable('sh', SH_COLS, c.shareholding || [], { addLabel: 'Add quarter' })}</div>`);
  bindEditTables(el); bindScoreEditors(el);
  const re = () => management(el, { app });
  $('#saveP').onclick = () => saveSection(app, { management: { ...mg, promises: readTable(el, 'promises') } }).then(re);
  $('#saveE').onclick = () => saveSection(app, { management: { ...mg, events: readTable(el, 'events').map((e) => ({ ...e, resolved: e.resolved === 'yes' })), auditorEvents: readTable(el, 'aud') } }).then(re);
  $('#saveS').onclick = () => saveSection(app, { shareholding: readTable(el, 'sh').sort((x, y) => String(x.date).localeCompare(String(y.date))) }).then(re);
  $('#saveJ').onclick = () => { const s = readScores(el, 'mgj'); const rpt = $('#rpt').value; saveSection(app, { management: { ...mg, ...s, relatedPartyPctRevenue: rpt === '' ? null : Number(rpt) / 100, succession: $('#succ').value || null } }).then(re); };
}
