// Screen 18: investment thesis tracker — versioned thesis, measurable assumptions, sell triggers.
import { html, mount, $, toast, busy, dt, list, decisionChip, inr } from '../../ui.js';
import { get, post } from '../../api.js';
import { editTable, bindEditTables, readTable } from '../common.js';

export default async function thesis(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const t = await get(`/api/companies/${c.id}/thesis`);
  const cur = t.current;
  const metricOpts = ['', ...Object.keys(t.metrics)];
  const ASSUME = [{ key: 'text', label: 'Assumption that must stay true', type: 'text', width: '240px' }, { key: 'metric', label: 'Measured by', type: 'select', options: metricOpts }, { key: 'operator', label: 'Op', type: 'select', options: ['', '>=', '>', '<=', '<'] }, { key: 'threshold', label: 'Threshold (ratio, e.g. 0.18 = 18%)', type: 'number' }, { key: 'critical', label: 'Critical?', type: 'select', options: ['yes', 'no'] }];
  const TRIG = [{ key: 'text', label: 'Sell trigger (qualitative)', type: 'text', width: '300px' }, { key: 'triggered', label: 'Triggered?', type: 'select', options: ['no', 'yes'] }];
  const st = a.thesis;
  mount(el, html`
    ${st ? html`<div class="banner ${st.status === 'broken' ? 'crit' : st.status === 'at_risk' ? 'sample' : 'good'}"><b>Thesis status: ${st.status.replace('_', ' ')}.</b> ${st.status === 'broken' ? 'A fresh assessment is required — the original reason to own this no longer holds.' : st.status === 'at_risk' ? 'One or more assumptions are close to failing.' : 'All measurable assumptions currently hold.'}</div>` : html`<div class="banner info">No thesis recorded yet. A written thesis is required before a high-conviction decision, and it makes thesis-breaking events detectable.</div>`}
    ${st ? html`<div class="card"><h3>Live assumption check (v${cur.version}, ${dt(cur.createdAt)})</h3><p><i>${cur.statement}</i></p>
      <div class="table-wrap"><table><thead><tr><th>Assumption</th><th>Metric</th><th>Rule</th><th>Now</th><th>Status</th></tr></thead><tbody>
      ${st.results.map((r) => html`<tr><td>${r.text}</td><td>${r.metric ? t.metrics[r.metric] : 'qualitative'}</td><td>${r.operator ? `${r.operator} ${r.threshold}` : '—'}</td><td>${r.display ?? '—'}</td><td><span class="chip ${r.status === 'holding' ? 'pos' : r.status === 'broken' ? 'neg' : r.status === 'at_risk' ? 'warn' : ''}">${r.status}</span></td></tr>`)}</tbody></table></div>
      <div class="grid g2" style="margin-top:10px"><div><h4>At creation</h4><p>Decision ${decisionChip(cur.decisionAtCreation)} · price ${inr(cur.valuationAtCreation?.price)} · base value ${inr(cur.valuationAtCreation?.base)}</p></div>
        <div><h4>Risks recorded at creation</h4>${list((cur.risksAtCreation || []).map((r) => r.claim))}</div></div></div>` : ''}
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${cur ? 'Revise thesis (creates a new version)' : 'Write your thesis'}</h3></div>
      <div class="field"><label>Thesis statement (three sentences: why it's a good business, why it will get better, why the price is attractive)</label><textarea id="stmt" rows="4">${cur?.statement || app.co.ctx.assessment?.conviction?.thesis || c.thesisInput || ''}</textarea></div>
      <h4>Measurable assumptions</h4>${editTable('assume', ASSUME, (cur?.assumptions || [{ text: 'EBITDA margin stays healthy', metric: 'ebitdaMargin', operator: '>=', threshold: Math.round((a.metrics.latest?.ebitdaMargin || 0.15) * 0.85 * 100) / 100 }, { text: 'Balance sheet stays conservative', metric: 'netDebtToEbitda', operator: '<=', threshold: 2 }]).map((x) => ({ ...x, critical: x.critical === false ? 'no' : 'yes' })), { addLabel: 'Add assumption' })}
      <h4 style="margin-top:12px">Sell triggers</h4>${editTable('trig', TRIG, (cur?.sellTriggers || []).map((x) => ({ ...x, triggered: x.triggered ? 'yes' : 'no' })), { addLabel: 'Add trigger' })}
      <div class="btn-row" style="margin-top:10px"><button class="btn" id="saveT">Save thesis version</button></div></div>
    ${t.history.length > 1 ? html`<div class="card" style="margin-top:16px"><h3>Version history</h3>${t.history.map((h) => html`<details><summary>v${h.version} — ${dt(h.created_at)} — ${h.data.decisionAtCreation}</summary><p><i>${h.data.statement}</i></p>${list(h.data.assumptions.map((x) => `${x.text}${x.metric ? ` (${x.metric} ${x.operator} ${x.threshold})` : ''}`))}</details>`)}</div>` : ''}`);
  bindEditTables(el);
  $('#saveT').onclick = (e) => busy(e.target, async () => {
    const assumptions = readTable(el, 'assume').map((x) => ({ ...x, critical: x.critical !== 'no' }));
    const sellTriggers = readTable(el, 'trig').map((x) => ({ ...x, triggered: x.triggered === 'yes' }));
    const r = await post(`/api/companies/${c.id}/thesis`, { statement: $('#stmt').value, assumptions, sellTriggers });
    toast(`Thesis v${r.version} saved.${r.alerts?.length ? ` ${r.alerts.length} alert(s).` : ''}`);
    await app.loadCompany(c.id, true); dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
