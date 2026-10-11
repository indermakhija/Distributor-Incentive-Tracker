// Screen 10: risk register & thesis-failure analysis (Module G).
import { html, mount, $, pct, list } from '../../ui.js';
import { riskScore, SCORED_ELSEWHERE } from '/engine/scoring.js';
import { editTable, bindEditTables, readTable, saveSection, dimCard } from '../common.js';

const CATS = ['Business model', 'Industry disruption', 'Competitive', 'Financial leverage', 'Liquidity', 'Accounting', 'Governance', 'Customer concentration', 'Supplier concentration', 'Regulatory', 'Political and geopolitical', 'Technology', 'Execution', 'Commodity and currency', 'Valuation', 'Reputational', 'Climate and environmental'];
const COLS = [{ key: 'category', label: 'Category', type: 'select', options: CATS }, { key: 'description', label: 'Risk description', type: 'textarea', width: '220px' }, { key: 'probability', label: 'Probability', type: 'pct' }, { key: 'impact', label: 'Impact (1–5)', type: 'number' }, { key: 'horizon', label: 'Horizon', type: 'text' }, { key: 'warning', label: 'Early-warning indicator', type: 'textarea' }, { key: 'mitigation', label: 'Mitigation', type: 'textarea' }, { key: 'residual', label: 'Residual', type: 'select', options: ['medium', 'low', 'high'] }, { key: 'confidence', label: 'Evidence confidence', type: 'select', options: ['medium', 'low', 'high'] }];

export default function risks(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const rs = [...(c.risks || [])].sort((x, y) => riskScore(y) - riskScore(x));
  const hi = (r) => riskScore(r) >= 2;
  const permanent = rs.filter((r) => r.impact >= 4);
  const thesis = a.thesis;
  mount(el, html`
    <div class="grid g2">
      <div class="card"><h3>Risk heat list</h3>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Risk</th><th class="num">P</th><th class="num">Impact</th><th class="num">Score</th><th>Warning sign</th></tr></thead><tbody>
        ${rs.map((r) => html`<tr><td>${r.category}${SCORED_ELSEWHERE.includes(String(r.category).toLowerCase()) ? html`<br><small class="muted">scored in another dimension</small>` : ''}</td><td>${r.description}</td><td class="num">${pct(r.probability, 0)}</td><td class="num">${r.impact}</td><td class="num"><span class="chip ${hi(r) ? 'neg' : ''}">${riskScore(r).toFixed(1)}</span></td><td class="muted">${r.warning || ''}</td></tr>`)}</tbody></table></div>
        <p class="muted">Score = probability × impact (max 5). Categories scored elsewhere (valuation, governance, accounting, leverage, liquidity) are excluded from the risk dimension to avoid double counting.</p></div>
      ${dimCard(a.dims.risk)}
    </div>
    <div class="card" style="margin-top:16px"><h3>Thesis-breaker analysis</h3>
      <div class="grid g2">
        <div><h4>What could make this permanently unattractive?</h4>${list([...a.decision.rules.filter((r) => r.severity === 'critical').map((r) => r.title), ...permanent.map((r) => `${r.category}: ${r.description}`)])}
          <h4>What could reduce earnings by 30–50%?</h4>${list([`Bear case: ${pct(a.valuation?.scenarios?.bear?.assumptions?.revenueCagr5)} growth with EBITDA margin at ${pct(a.valuation?.scenarios?.bear?.assumptions?.ebitdaMarginTarget)} (vs ${pct(a.metrics.latest?.ebitdaMargin)} today).`, ...rs.filter((r) => r.impact >= 3).map((r) => r.description)])}</div>
        <div><h4>Assumptions that must remain true</h4>${list(a.narrative.keyAssumptions)}
          <h4>Developments that would trigger a sell decision</h4>${list([...(thesis?.results || []).filter((x) => x.metric).map((x) => `${x.text} (${x.metric} ${x.operator} ${x.threshold}) — now ${x.display ?? 'n/a'}: ${x.status}`), ...(c.moat?.disappearanceEvidence || [])], 'Define sell triggers in the Thesis tracker.')}</div>
      </div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Edit risk register</h3><button class="btn small" id="saveR">Save register</button></div>
      ${editTable('risksT', COLS, c.risks || [], { addLabel: 'Add risk' })}</div>`);
  bindEditTables(el);
  $('#saveR').onclick = () => saveSection(app, { risks: readTable(el, 'risksT').map((r) => ({ ...r, impact: Math.max(1, Math.min(5, r.impact ?? 3)), probability: Math.max(0, Math.min(1, r.probability ?? 0.3)) })) }).then(() => risks(el, { app }));
}
