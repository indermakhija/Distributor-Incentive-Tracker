// Screen 6: financial analysis & forensic accounting (Module C).
import { html, mount, $, pct, num, x, chart, series, legend, list, isNum, sev, token } from '../../ui.js';
import { dimCard } from '../common.js';

const ROWS = [
  ['Income statement', [['revenue', 'Revenue'], ['ebitda', 'EBITDA'], ['ebit', 'EBIT'], ['otherIncome', 'Other income'], ['exceptional', 'Exceptional items'], ['pat', 'PAT'], ['eps', 'EPS (₹)', 2]]],
  ['Balance sheet', [['equity', 'Equity'], ['totalDebt', 'Gross debt'], ['cash', 'Cash'], ['netDebt', 'Net debt'], ['receivables', 'Receivables'], ['inventory', 'Inventory'], ['goodwill', 'Goodwill'], ['contingentLiabilities', 'Contingent liabilities']]],
  ['Cash flow', [['cfo', 'Operating cash flow'], ['capex', 'Capex'], ['fcf', 'Free cash flow'], ['dividendsPaid', 'Dividends paid']]]
];
const RATIOS = [['ebitdaMargin', 'EBITDA margin', pct], ['patMargin', 'PAT margin', pct], ['roe', 'ROE', pct], ['roce', 'ROCE', pct], ['roic', 'ROIC', pct], ['assetTurnover', 'Asset turnover', (v) => x(v, 2)], ['debtToEquity', 'Debt / equity', (v) => x(v, 2)], ['netDebtToEbitda', 'Net debt / EBITDA', (v) => x(v, 2)], ['interestCoverage', 'Interest coverage', (v) => (v === Infinity ? 'no debt' : x(v))], ['receivableDays', 'Receivable days', (v) => num(v)], ['inventoryDays', 'Inventory days', (v) => num(v)], ['cashConversionCycle', 'Cash conversion cycle', (v) => num(v)], ['cfoToPat', 'CFO / PAT', (v) => pct(v, 0)], ['effectiveTaxRate', 'Effective tax rate', pct]];

export default function financials(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const m = a.metrics;
  if (m.empty) {
    mount(el, html`<div class="empty">No financial statements yet. <a href="#/c/${c.id}/documents">Upload a CSV/XLSX</a> using the template, or enter data manually.</div>`);
    return;
  }
  const s = m.series, g = m.growth;
  const f = a.forensic;
  mount(el, html`
    <p class="muted">Source: ${c.financials?.source || 'unknown'} · as of ${c.financials?.asOf || 'unknown'} · unit ${c.financials?.unit || '₹ Cr'} · ${m.n} years. Ratios are <span class="prov calculated">Calculated</span> from these statements.</p>
    <div class="grid g4">
      ${[['Revenue CAGR 3y / 5y', `${pct(g.revenue3y)} / ${pct(g.revenue5y)}`], ['PAT CAGR 3y / 5y', `${pct(g.pat3y)} / ${pct(g.pat5y)}`], ['EPS CAGR 5y', pct(g.eps5y)], ['FCF CAGR 5y', pct(g.fcf5y)], ['ROCE (latest / 5y)', `${pct(m.latest.roce)} / ${pct(m.avg5.roce)}`], ['Incremental ROCE (3y)', pct(m.incrementalRoce)], ['CFO / PAT (5y)', pct(m.avg5.cfoToPat, 0)], ['Acquisition-led growth', isNum(g.acquisitionIntensity) ? pct(g.acquisitionIntensity, 0) + ' of added revenue' : 'none recorded']]
        .map(([l, v]) => html`<div class="tile"><div class="label">${l}</div><div class="value" style="font-size:18px">${v}</div></div>`)}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Revenue, EBITDA and PAT (₹ Cr)</h3>${legend([['Revenue', series(0)], ['EBITDA', series(1)], ['PAT', series(2)]])}<div class="chart-box"><canvas id="chGrowth" aria-label="Revenue, EBITDA and PAT by year"></canvas></div></div>
      <div class="card"><h3>Margins & returns</h3>${legend([['EBITDA margin', series(0)], ['ROCE', series(1)], ['ROE', series(2)]])}<div class="chart-box"><canvas id="chMargin" aria-label="Margins and returns by year"></canvas></div></div>
      <div class="card"><h3>Profit vs cash: PAT, CFO and FCF (₹ Cr)</h3>${legend([['PAT', series(0)], ['Operating cash flow', series(1)], ['Free cash flow', series(2)]])}<div class="chart-box"><canvas id="chCash" aria-label="PAT, CFO and FCF by year"></canvas></div></div>
      <div class="card"><h3>Working-capital days</h3>${legend([['Receivable days', series(0)], ['Inventory days', series(1)], ['Cash conversion cycle', series(2)]])}<div class="chart-box"><canvas id="chWc" aria-label="Working capital days by year"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Accounting quality & forensic checks</h3><span>Score <b>${f.score ?? 'n/a'}</b>/10</span></div>
      <p class="muted">"Confirmed" = disclosed fact in filings. "Warning" = statistical signal that needs investigation — not proof of wrongdoing.</p>
      ${f.note ? html`<p class="muted">${f.note}</p>` : ''}
      ${f.flags.length ? html`<div class="table-wrap"><table><thead><tr><th>Type</th><th>Severity</th><th>Check</th><th>Detail</th><th>Evidence</th></tr></thead><tbody>
        ${f.flags.map((fl) => html`<tr><td><span class="chip ${fl.kind === 'confirmed' ? 'neg' : 'warn'}">${fl.kind}</span></td><td>${sev(fl.severity)}</td><td>${fl.title}</td><td>${fl.detail}</td><td class="muted">${fl.evidence}</td></tr>`)}</tbody></table></div>` : html`<p class="banner good">No forensic flags triggered by the checks run.</p>`}
      <details style="margin-top:8px"><summary>Checks performed</summary>${list(['Profit vs operating cash flow', 'Receivables vs sales growth', 'Inventory build-up', 'Other-income dependence', 'Recurring exceptional items', 'Depreciation rate vs capex (capitalisation)', 'Tax-rate swings', 'Goodwill vs equity', 'Cash and debt both high', 'Contingent liabilities', 'Negative CFO years', 'External-funding dependence', 'Auditor resignations / qualifications', 'Accounting-policy changes', 'Related-party transactions', 'Promoter pledges and loans'])}</details>
    </div>
    <div class="card" style="margin-top:16px"><h3>Statements (₹ Cr)</h3>
      <div class="table-wrap"><table class="sticky-first"><thead><tr><th>Line item</th>${m.years.map((y) => html`<th class="num">${y}</th>`)}</tr></thead><tbody>
      ${ROWS.map(([title, rows]) => html`<tr><th colspan="${m.n + 1}">${title}</th></tr>${rows.map(([k, l, dp]) => html`<tr><td>${l}</td>${s[k].map((v) => html`<td class="num">${num(v, dp || 0)}</td>`)}</tr>`)}`)}
      <tr><th colspan="${m.n + 1}">Ratios</th></tr>
      ${RATIOS.map(([k, l, fm]) => html`<tr><td>${l}</td>${m[k].map((v) => html`<td class="num">${fm(v)}</td>`)}</tr>`)}
      </tbody></table></div></div>
    <div style="margin-top:16px">${dimCard(a.dims.financial)}</div>`);
  const lbl = m.years;
  const ds = (label, data, i, type = 'line') => ({ label, data, borderColor: series(i), backgroundColor: series(i), type, maxBarThickness: 18 });
  chart($('#chGrowth'), { type: 'bar', data: { labels: lbl, datasets: [ds('Revenue', s.revenue, 0, 'bar'), ds('EBITDA', s.ebitda, 1, 'bar'), ds('PAT', s.pat, 2, 'bar')] }, options: { datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9, borderColor: token('--surface'), borderWidth: 1 } } } });
  const pctAxis = { scales: { y: { ticks: { callback: (v) => `${Math.round(v * 100)}%` } } }, plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${pct(ctx.parsed.y)}` } } } };
  chart($('#chMargin'), { type: 'line', data: { labels: lbl, datasets: [ds('EBITDA margin', m.ebitdaMargin, 0), ds('ROCE', m.roce, 1), ds('ROE', m.roe, 2)] }, options: pctAxis });
  chart($('#chCash'), { type: 'line', data: { labels: lbl, datasets: [ds('PAT', s.pat, 0), ds('Operating cash flow', s.cfo, 1), ds('Free cash flow', s.fcf, 2)] } });
  chart($('#chWc'), { type: 'line', data: { labels: lbl, datasets: [ds('Receivable days', m.receivableDays, 0), ds('Inventory days', m.inventoryDays, 1), ds('Cash conversion cycle', m.cashConversionCycle, 2)] } });
}
