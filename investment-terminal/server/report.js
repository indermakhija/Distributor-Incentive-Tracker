// Report generation: standalone HTML, PDF (pdfkit) and CSV exports of an analysis.
import PDFDocument from 'pdfkit';
import { VALUATION_STATUS_LABEL } from '../engine/valuation.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, dp = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : 'n/a');
const num = (v, dp = 0) => (Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: dp }) : 'n/a');
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

function sections(a) {
  const n = a.narrative, d = a.decision, v = a.valuation;
  return {
    dashboard: [
      ['Company', `${a.company.name} (${a.company.ticker})`],
      ['Data status', a.company.dataStatus === 'sample' ? 'ILLUSTRATIVE SAMPLE — fictional' : a.company.dataStatus],
      ['Price', `₹${num(a.company.market?.price, 2)} as of ${a.company.market?.priceDate || 'unknown'} (${a.company.market?.source || 'n/a'})`],
      ['Holistic score', `${a.aggregate.holistic}/100 — ${a.aggregate.band.label}`],
      ...a.aggregate.rows.map((r) => [r.label, r.score == null ? 'Not scored' : `${r.score}/10 (weight ${r.weight}%, contribution ${r.contribution ?? '—'})`]),
      ['Valuation status', VALUATION_STATUS_LABEL[v?.status] || 'n/a'],
      ['Macro regime', a.macro?.usable ? `${a.macro.regime} (${a.macro.impact.score}/10, ${a.macro.impact.sensitivity} sensitivity)` : 'No macro data'],
      ['Evidence confidence', pct(d.confidence, 0)],
      ['Report generated', a.generatedAt]
    ],
    decision: [`${d.label}${d.status === 'provisional' ? ' (PROVISIONAL)' : ''}`, n.headline, n.businessVsInvestment],
    lists: [
      ['1. Why this decision', n.why],
      ['2. What is attractive', n.attractive],
      ['3. What the market may be missing', n.marketMissing],
      ['4. What the market may already be pricing in', n.pricedIn],
      ['5. Strongest arguments against buying', n.argumentsAgainst],
      ['6. Biggest permanent-loss risks', n.permanentLossRisks],
      ['7. Investment horizon', [n.horizon]],
      ['8. Scenario values and returns', n.scenarioReturns.map((s) => `${s.scenario.toUpperCase()}: value ₹${num(s.value)} | 3y ${pct(s.return3y)} p.a. | 5y ${pct(s.return5y)} p.a. | probability ${pct(s.probability, 0)}`)],
      ['9. Key assumptions', n.keyAssumptions],
      ['10. What would change the recommendation', n.whatWouldChange],
      ['Macro context (national & international)', [n.macro.regime, n.macro.tailwinds.length ? `Tailwinds: ${n.macro.tailwinds.join(', ')}` : null, n.macro.headwinds.length ? `Headwinds: ${n.macro.headwinds.join(', ')}` : null, n.macro.worstStress ? `Worst stress: ${n.macro.worstStress}` : null].filter(Boolean)],
      ['Override rules applied', d.rules.map((r) => `[${r.severity.toUpperCase()}] ${r.title}: ${r.message}`)],
      ['BUY checklist (a BUY needs every item)', d.buyChecklist.map((c) => `${c.ok ? '✔' : '✘'} ${c.item} (${c.value ?? 'n/a'})`)],
      ['Red-team bear thesis', [a.redTeam.bearThesis, ...a.redTeam.points.slice(0, 8).map((p) => `[${p.severity}] ${p.claim} ${p.evidence}`)]],
      ['Accounting & forensic flags', a.forensic.flags.map((f) => `[${f.kind === 'confirmed' ? 'CONFIRMED' : 'WARNING — investigate'}] ${f.title}: ${f.detail}`)],
      ['Data quality & missing information', a.dataQuality.issues.map((i) => `[${i.severity}] ${i.text}`)],
      ['Investor assessment', a.investor.completed ? [`Knowledge ${a.investor.knowledgeScore}/10 (self ${a.investor.selfScore}, evidence ${a.investor.evidenceScore})`, `Conviction ${a.investor.convictionScore}/10 — ${a.investor.convictionType}`, ...a.investor.biases.map((b) => `${b.label}: ${b.countermeasure}`)] : [a.investor.note]]
    ].concat(d.entryPrice ? [['Entry price', [`₹${num(d.entryPrice)} (range ₹${num(d.entryRange?.low)}–₹${num(d.entryRange?.high)}). Conditions: thesis intact, no new governance or accounting flags.`]]] : []).concat(n.holderView ? [['Existing shareholder view', [n.holderView]]] : [])
  };
}

export function reportHtml(a) {
  const s = sections(a);
  const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">None identified from available evidence.</p>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.company.name)} — Investment Decision Report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111;background:#fff}h1{font-size:22px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #eee;padding:4px 6px;vertical-align:top}td:first-child{color:#555;width:40%}.banner{background:#fff4e5;border:1px solid #f0b46b;padding:8px 12px;border-radius:6px}
.decision{font-size:20px;font-weight:700;margin:8px 0}.muted{color:#777}@media print{body{margin:0}}</style></head><body>
${a.company.dataStatus === 'sample' ? '<p class="banner"><b>ILLUSTRATIVE SAMPLE DATA.</b> This is a fictional company used to demonstrate the terminal. Do not act on this report.</p>' : ''}
<h1>${esc(a.company.name)} <span class="muted">${esc(a.company.ticker)}</span></h1>
<p class="decision">${esc(s.decision[0])}</p><p>${esc(s.decision[1])}</p><p><i>${esc(s.decision[2])}</i></p>
<h2>Executive dashboard</h2><table>${s.dashboard.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
${s.lists.map(([h, items]) => `<h2>${esc(h)}</h2>${list(items)}`).join('')}
<p class="muted">Decision-support output, not investment advice or a trading instruction. Scores are transparent heuristics; valuation outputs are estimates with wide uncertainty. Engine v${esc(a.engineVersion)}.</p>
</body></html>`;
}

export function reportPdf(a) {
  return new Promise((resolve, reject) => {
    const s = sections(a);
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${a.company.name} — Investment Decision Report` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    // Built-in PDF fonts are WinAnsi only: replace characters they cannot encode.
    const t = (x) => String(x ?? '').replace(/₹/g, 'Rs ').replace(/[✔]/g, '[x]').replace(/[✘]/g, '[ ]').replace(/[–—]/g, '-').replace(/[^\x00-\xFF]/g, '');
    if (a.company.dataStatus === 'sample') doc.fillColor('#b45309').fontSize(10).text('ILLUSTRATIVE SAMPLE DATA - fictional company. Do not act on this report.').moveDown(0.5);
    doc.fillColor('#000').fontSize(18).text(t(`${a.company.name} (${a.company.ticker})`));
    doc.moveDown(0.3).fontSize(14).text(t(s.decision[0]));
    doc.moveDown(0.3).fontSize(10).text(t(s.decision[1])).text(t(s.decision[2]));
    doc.moveDown(0.6).fontSize(12).text('Executive dashboard');
    doc.fontSize(9);
    for (const [k, v] of s.dashboard) doc.text(t(`${k}: ${v}`));
    for (const [h, items] of s.lists) {
      doc.moveDown(0.6).fontSize(12).fillColor('#000').text(t(h));
      doc.fontSize(9).fillColor('#222');
      if (!items?.length) doc.text('None identified from available evidence.');
      for (const i of items || []) doc.text(t(`- ${i}`), { indent: 6 });
    }
    doc.moveDown(1).fontSize(8).fillColor('#666').text('Decision-support output, not investment advice. Valuation outputs are estimates with wide uncertainty.');
    doc.end();
  });
}

export function analysisCsv(a) {
  const rows = [['Section', 'Item', 'Value', 'Provenance']];
  rows.push(['Company', 'Name', a.company.name, a.company.dataStatus], ['Company', 'Price', a.company.market?.price, `${a.company.market?.source} @ ${a.company.market?.priceDate}`]);
  rows.push(['Decision', 'Decision', a.decision.label, 'decision engine'], ['Decision', 'Status', a.decision.status, ''], ['Score', 'Holistic', a.aggregate.holistic, 'calculated']);
  for (const r of a.aggregate.rows) {
    rows.push(['Score', r.label, r.score, `weight ${r.weight}%`]);
    for (const c of r.components) rows.push(['Component', `${r.label} › ${c.name}`, c.score, c.source]);
  }
  const L = a.metrics.latest || {};
  for (const [k, v] of Object.entries(L)) rows.push(['Latest metric', k, Number.isFinite(v) ? +v.toFixed(4) : v, 'calculated']);
  const v = a.valuation;
  if (v?.intrinsic) for (const k of ['bear', 'base', 'bull']) rows.push(['Valuation', `${k} intrinsic value`, Math.round(v.intrinsic[k]), 'estimate'], ['Valuation', `${k} 5y expected return`, v.scenarios[k].expectedReturn5y?.toFixed(4), 'estimate']);
  for (const f of a.forensic.flags) rows.push(['Forensic', f.title, f.kind, f.detail]);
  for (const r of a.decision.rules) rows.push(['Override', r.title, r.severity, r.message]);
  return toCsv(rows);
}

export function compareCsv(list) {
  const head = ['Metric', ...list.map((a) => `${a.company.name} (${a.company.ticker})`)];
  const row = (label, fn) => [label, ...list.map((a) => { try { const x = fn(a); return Number.isFinite(x) ? +x.toFixed(4) : x ?? ''; } catch { return ''; } })];
  const rows = [head,
    row('Data status', (a) => a.company.dataStatus), row('Price', (a) => a.company.market?.price), row('Price date', (a) => a.company.market?.priceDate),
    row('Decision', (a) => a.decision.label), row('Holistic score', (a) => a.aggregate.holistic), row('Business quality (composite)', (a) => a.decision.quality),
    ...a0dims(list).map(([id, label]) => row(label, (a) => a.dims[id]?.score)),
    row('Revenue 5y CAGR', (a) => a.metrics.growth?.revenue5y), row('EBITDA margin', (a) => a.metrics.latest?.ebitdaMargin), row('ROCE', (a) => a.metrics.latest?.roce),
    row('Net debt/EBITDA', (a) => a.metrics.latest?.netDebtToEbitda), row('P/E', (a) => a.valuation?.multiples?.pe), row('EV/EBITDA', (a) => a.valuation?.multiples?.evEbitda),
    row('Base intrinsic value', (a) => a.valuation?.intrinsic?.base), row('Margin of safety', (a) => a.valuation?.marginOfSafety), row('Base 5y expected return', (a) => a.valuation?.scenarios?.base?.expectedReturn5y),
    row('Forensic flags', (a) => a.forensic.flags.length), row('Evidence confidence', (a) => a.decision.confidence)];
  return toCsv(rows);
}
const a0dims = (list) => (list[0]?.aggregate.rows || []).map((r) => [r.id, r.label]);
