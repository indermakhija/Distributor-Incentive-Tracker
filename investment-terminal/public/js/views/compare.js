// Side-by-side comparison of multiple companies under consistent assumptions.
import { html, mount, $, pct, inr, x, decisionChip, scoreBar, toast } from '../ui.js';
import { get } from '../api.js';
import { VALUATION_STATUS_LABEL } from '/engine/valuation.js';

export default async function compare(main, { query, app }) {
  const all = await get('/api/companies');
  const ids = (query.get('ids') || all.slice(0, 4).map((c) => c.id).join(',')).split(',').filter(Boolean);
  const list = ids.length >= 2 ? await get(`/api/compare?ids=${ids.join(',')}`) : [];
  const ranked = [...list].sort((a, b) => b.aggregate.holistic - a.aggregate.holistic);
  const row = (label, fn) => html`<tr><td>${label}</td>${ranked.map((a) => html`<td class="num">${fn(a)}</td>`)}</tr>`;
  const dims = ranked[0]?.aggregate.rows || [];
  mount(main, html`
    <div class="page-head"><h1>Compare companies</h1><div class="btn-row">${ids.length >= 2 ? html`<a class="btn ghost small" href="/api/export/compare.csv?ids=${ids.join(',')}">Export comparison CSV</a>` : ''}</div></div>
    <div class="card"><h3>Select companies (2–8)</h3><div class="btn-row">${all.map((c) => html`<label style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" value="${c.id}" ${ids.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`)}</div>
      <button class="btn small" id="apply" style="margin-top:8px">Compare</button></div>
    ${ranked.length ? html`<div class="card" style="margin-top:16px"><h3>Ranked by holistic score (same weights, rates and rules for all)</h3>
      <div class="table-wrap"><table class="sticky-first"><thead><tr><th>Metric</th>${ranked.map((a, i) => html`<th class="num">#${i + 1} <a href="#/c/${a.company.id}/overview">${a.company.name}</a>${a.company.dataStatus === 'sample' ? html` <span class="prov sample">sample</span>` : ''}</th>`)}</tr></thead><tbody>
        ${row('Decision', (a) => decisionChip(a.decision.code, a.decision.label))}
        ${row('Holistic score', (a) => html`<b>${a.aggregate.holistic}</b>`)}
        ${row('Business-quality composite', (a) => a.decision.quality ?? '—')}
        ${row('Great business?', (a) => (a.decision.greatBusiness ? 'Yes' : 'No'))}
        ${row('Great investment at this price?', (a) => (a.decision.greatInvestment ? 'Yes' : 'No'))}
        ${dims.map((d) => row(d.label, (a) => { const r = a.aggregate.rows.find((y) => y.id === d.id); return html`${r.score ?? 'n/a'}${scoreBar(r.score)}`; }))}
        ${row('Price (date)', (a) => html`${inr(a.company.market?.price, 2)}<br><small class="muted">${a.company.market?.priceDate || ''}</small>`)}
        ${row('Valuation status', (a) => VALUATION_STATUS_LABEL[a.valuation?.status] || '—')}
        ${row('Base intrinsic value', (a) => inr(a.valuation?.intrinsic?.base))}
        ${row('Margin of safety', (a) => pct(a.valuation?.marginOfSafety, 0))}
        ${row('Market-implied growth', (a) => pct(a.valuation?.reverseDcf?.impliedRevenueCagr10y))}
        ${row('Base 5y expected return', (a) => pct(a.valuation?.scenarios?.base?.expectedReturn5y))}
        ${row('Revenue 5y CAGR', (a) => pct(a.metrics.growth?.revenue5y))}
        ${row('EBITDA margin', (a) => pct(a.metrics.latest?.ebitdaMargin))}
        ${row('ROCE (5y avg)', (a) => pct(a.metrics.avg5?.roce))}
        ${row('Net debt / EBITDA', (a) => x(a.metrics.latest?.netDebtToEbitda))}
        ${row('P/E', (a) => x(a.valuation?.multiples?.pe))}
        ${row('EV/EBITDA', (a) => x(a.valuation?.multiples?.evEbitda))}
        ${row('Forensic flags', (a) => a.forensic.flags.length)}
        ${row('Overrides triggered', (a) => a.decision.rules.filter((r) => r.cap).map((r) => r.title).join('; ') || '—')}
        ${row('Evidence confidence', (a) => pct(a.decision.confidence, 0))}
      </tbody></table></div></div>` : html`<div class="empty" style="margin-top:16px">Select at least two companies.</div>`}`);
  $('#apply').onclick = () => { const sel = [...main.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value); if (sel.length < 2) return toast('Select at least two.', true); app.go(`#/compare?ids=${sel.slice(0, 8).join(',')}`); };
}
