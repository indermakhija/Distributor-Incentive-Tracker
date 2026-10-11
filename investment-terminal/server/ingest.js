// Research document ingestion: CSV / XLSX financial statements, PDF / TXT research documents.
// Extraction is deterministic and conservative: unrecognised rows are reported, never guessed.

const ALIASES = {
  income: {
    revenue: ['revenue from operations', 'revenue', 'net sales', 'sales', 'total revenue from operations', 'net revenue', 'turnover', 'income from operations'],
    cogs: ['cost of goods sold', 'cogs', 'cost of materials consumed', 'cost of sales', 'material cost', 'raw material cost'],
    ebitda: ['ebitda', 'operating profit', 'pbdit', 'operating ebitda'],
    depreciation: ['depreciation', 'depreciation and amortisation', 'depreciation and amortization', 'depreciation & amortisation', 'd&a'],
    ebit: ['ebit', 'operating income'],
    interest: ['interest', 'finance costs', 'finance cost', 'interest expense'],
    otherIncome: ['other income', 'non-operating income'],
    exceptional: ['exceptional items', 'exceptional', 'extraordinary items'],
    pbt: ['profit before tax', 'pbt'],
    tax: ['tax', 'tax expense', 'total tax expense', 'income tax'],
    pat: ['net profit', 'profit after tax', 'pat', 'net income', 'profit for the year', 'profit for the period'],
    eps: ['eps', 'diluted eps', 'basic eps', 'earnings per share'],
    dps: ['dps', 'dividend per share']
  },
  balance: {
    equity: ['total equity', 'net worth', 'shareholders funds', "shareholders' funds", 'equity', 'total shareholders equity'],
    totalDebt: ['total debt', 'borrowings', 'total borrowings', 'debt'],
    cash: ['cash and equivalents', 'cash & equivalents', 'cash and cash equivalents', 'cash', 'cash and bank balances'],
    receivables: ['trade receivables', 'receivables', 'debtors', 'sundry debtors'],
    inventory: ['inventories', 'inventory', 'stock'],
    payables: ['trade payables', 'payables', 'creditors', 'sundry creditors'],
    totalAssets: ['total assets', 'balance sheet size'],
    netFixedAssets: ['net fixed assets', 'property plant and equipment', 'net block', 'ppe', 'fixed assets'],
    goodwill: ['goodwill'],
    contingentLiabilities: ['contingent liabilities'],
    leaseLiabilities: ['lease liabilities'],
    sharesOutstanding: ['shares outstanding', 'number of shares', 'no of shares', 'equity shares outstanding']
  },
  cashflow: {
    cfo: ['cash from operations', 'cash flow from operations', 'net cash from operating activities', 'operating cash flow', 'cfo', 'cash from operating activities'],
    capex: ['capex', 'capital expenditure', 'purchase of fixed assets', 'purchase of property plant and equipment'],
    dividendsPaid: ['dividends paid', 'dividend paid'],
    acquisitions: ['acquisitions', 'investment in subsidiaries', 'acquisition of businesses'],
    equityIssued: ['equity issued', 'proceeds from issue of shares', 'share issue proceeds']
  }
};
const LOOKUP = new Map();
for (const [stmt, items] of Object.entries(ALIASES)) for (const [key, names] of Object.entries(items)) for (const n of names) LOOKUP.set(n, { stmt, key });

const normLabel = (s) => String(s ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toNum = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[(),₹\s]/g, '').replace(/^-/, '');
  if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Maps a grid (first column = line item, header row = years) into statements. */
export function mapStatements(grid) {
  const report = { recognised: [], unrecognised: [], missingRequired: [], warnings: [] };
  if (!grid.length) return { error: 'Empty file.', report };
  // Find header row: first row with ≥2 cells that look like fiscal years.
  const yearRe = /^(fy\s?'?\d{2,4}|\d{4}(-\d{2,4})?|mar[- ]?\d{2,4}|\d{4}-03-31)$/i;
  let h = grid.findIndex((r) => r.slice(1).filter((c) => yearRe.test(String(c).trim())).length >= 2);
  if (h < 0) return { error: 'Could not find a header row with fiscal years (e.g. FY22, FY23 …).', report };
  const header = grid[h];
  const cols = [];
  header.forEach((c, i) => { if (i > 0 && yearRe.test(String(c).trim())) cols.push({ i, label: String(c).trim().toUpperCase().replace(/\s/g, '') }); });
  const years = cols.map((c) => c.label);
  const out = { years, income: {}, balance: {}, cashflow: {} };
  for (const r of grid.slice(h + 1)) {
    const label = normLabel(r[0]);
    if (!label) continue;
    const hit = LOOKUP.get(label);
    const values = cols.map((c) => toNum(r[c.i]));
    if (!hit) { report.unrecognised.push(String(r[0]).trim()); continue; }
    if (out[hit.stmt][hit.key]) { report.warnings.push(`Duplicate row for ${hit.key} ("${r[0]}") ignored.`); continue; }
    out[hit.stmt][hit.key] = values;
    report.recognised.push({ label: String(r[0]).trim(), mappedTo: `${hit.stmt}.${hit.key}`, filled: values.filter((v) => v != null).length });
  }
  const required = [['income', 'revenue'], ['income', 'pat'], ['balance', 'equity'], ['cashflow', 'cfo']];
  report.missingRequired = required.filter(([s, k]) => !out[s][k]).map(([s, k]) => `${s}.${k}`);
  if (years.length < 3) report.warnings.push('Fewer than 3 years — trend and forensic checks will be limited.');
  const sorted = [...years].sort();
  if (years.join() !== sorted.join()) report.warnings.push('Year columns are not in ascending order — please order oldest → newest.');
  return { statements: out, report };
}

export async function gridFromXlsx(buffer) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values.slice(1).map((v) => (v && typeof v === 'object' ? (v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? '') : v ?? ''));
    grid.push(vals);
  });
  return grid;
}

export async function textFromPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  const maxPages = Math.min(doc.numPages, 400);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  return { pages, numPages: doc.numPages, truncated: doc.numPages > maxPages };
}

// Loughran–McDonald-inspired mini lexicon for earnings-call tone (indicative only).
const POS = ['strong', 'growth', 'improve', 'improved', 'record', 'robust', 'confident', 'healthy', 'gain', 'opportunity', 'momentum', 'outperform', 'expansion', 'resilient', 'beat'];
const NEG = ['decline', 'weak', 'pressure', 'loss', 'challenging', 'slowdown', 'delay', 'headwind', 'impairment', 'default', 'downturn', 'adverse', 'shortfall', 'destocking', 'litigation'];
const UNC = ['uncertain', 'uncertainty', 'may', 'might', 'could', 'volatile', 'depend', 'risk', 'unclear', 'approximately', 'subject to'];

const PATTERNS = [
  { id: 'qualified', re: /qualified opinion|basis for qualified|adverse opinion|disclaimer of opinion/i, label: 'Auditor qualification language', suggest: { kind: 'auditorEvent', type: 'qualification' } },
  { id: 'emphasis', re: /emphasis of matter|material uncertainty related to going concern/i, label: 'Emphasis of matter / going-concern language', suggest: { kind: 'auditorEvent', type: 'emphasis' } },
  { id: 'resign', re: /auditor[s]? (has|have)? ?resign|resignation of (the )?(statutory )?auditor/i, label: 'Auditor resignation', suggest: { kind: 'auditorEvent', type: 'resignation' } },
  { id: 'pledge', re: /pledge[ds]?|encumbrance/i, label: 'Share pledge / encumbrance mention', suggest: null },
  { id: 'rpt', re: /related[- ]party transaction/i, label: 'Related-party transaction mention', suggest: null },
  { id: 'rating', re: /\b(upgrade[ds]?|downgrade[ds]?|reaffirm(ed)?|rating watch)\b.{0,80}\b(AAA|AA\+?-?|A\+?-?|BBB\+?-?|BB\+?-?|B\+?-?|C|D)\b/i, label: 'Credit-rating action', suggest: { kind: 'announcement', type: 'rating' } },
  { id: 'guidance', re: /\b(we expect|we aim|we target|guidance|outlook|by fy\s?'?\d{2}|we plan to|we will achieve|targeting)\b/i, label: 'Forward-looking management statement', suggest: { kind: 'promise' } },
  { id: 'capex', re: /capacity expansion|capex of|commission(ed|ing)?|greenfield|brownfield/i, label: 'Capex / capacity statement', suggest: { kind: 'catalyst' } },
  { id: 'regulatory', re: /show cause|sebi order|penalty|investigation|enforcement directorate|cbi|income tax search/i, label: 'Regulatory / investigation mention', suggest: { kind: 'event', type: 'disclosed' } },
  { id: 'orderbook', re: /order book|order inflow|order backlog/i, label: 'Order book mention', suggest: null }
];

export function detectKind(text, filename = '') {
  const t = (filename + ' ' + text.slice(0, 20000)).toLowerCase();
  if (/transcript|conference call|earnings call|q&a session|moderator/.test(t)) return 'earnings_transcript';
  if (/annual report|directors'? report|independent auditor'?s report/.test(t)) return 'annual_report';
  if (/rating rationale|rating action|credit rating/.test(t)) return 'credit_rating';
  if (/investor presentation|investor deck/.test(t)) return 'investor_presentation';
  if (/quarterly results|results for the quarter|statement of standalone/.test(t)) return 'quarterly_results';
  if (/industry report|market size|cagr of/.test(t)) return 'industry_report';
  if (/target price|recommendation|broker/.test(t)) return 'broker_report';
  return 'document';
}

/** Extracts candidate signals (with page refs) for the user to review and apply. */
export function analyseText(pages) {
  const findings = [];
  const counts = { pos: 0, neg: 0, unc: 0, words: 0 };
  pages.forEach((txt, pi) => {
    const sentences = txt.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      if (s.length < 25 || s.length > 600) continue;
      for (const p of PATTERNS) if (p.re.test(s) && findings.filter((f) => f.id === p.id).length < 15) findings.push({ id: p.id, label: p.label, page: pi + 1, text: s.trim(), suggest: p.suggest });
    }
    const words = txt.toLowerCase().match(/[a-z]+/g) || [];
    counts.words += words.length;
    for (const w of words) { if (POS.includes(w)) counts.pos++; else if (NEG.includes(w)) counts.neg++; else if (UNC.includes(w)) counts.unc++; }
  });
  const net = counts.pos + counts.neg ? (counts.pos - counts.neg) / (counts.pos + counts.neg) : 0;
  return {
    findings,
    tone: { ...counts, net: Math.round(net * 100) / 100, uncertaintyPer1k: counts.words ? Math.round((counts.unc / counts.words) * 10000) / 10 : 0,
      label: net > 0.3 ? 'Positive' : net < -0.1 ? 'Negative' : 'Neutral', note: 'Lexicon-based indicator, not a judgment of truthfulness.' }
  };
}

export async function ingest(buffer, filename, mime = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (buffer.length === 0) return { status: 'error', error: 'Empty file.' };
  if (ext === 'csv' || mime.includes('csv')) {
    const grid = parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
    const m = mapStatements(grid);
    return { status: m.error ? 'error' : 'parsed', type: 'financials', error: m.error, ...m };
  }
  if (ext === 'xlsx') {
    let grid;
    try { grid = await gridFromXlsx(buffer); } catch (e) { return { status: 'error', error: 'Could not read the Excel file: ' + e.message }; }
    const m = mapStatements(grid);
    return { status: m.error ? 'error' : 'parsed', type: 'financials', error: m.error, ...m };
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') return { status: 'error', error: 'File is not a valid PDF.' };
    let pdf;
    try { pdf = await textFromPdf(buffer); } catch (e) { return { status: 'error', error: 'PDF parsing failed: ' + e.message }; }
    const text = pdf.pages.join('\n\n');
    if (text.replace(/\s/g, '').length < 50) return { status: 'parsed', type: 'document', kind: 'scanned_pdf', pages: pdf.numPages, text: '', analysis: { findings: [], tone: null }, warning: 'No extractable text — this looks like a scanned PDF. OCR is not supported; enter key data manually.' };
    return { status: 'parsed', type: 'document', kind: detectKind(text, filename), pages: pdf.numPages, truncated: pdf.truncated, text, analysis: analyseText(pdf.pages) };
  }
  if (ext === 'txt' || ext === 'md' || mime.startsWith('text/')) {
    const text = buffer.toString('utf8');
    const pages = text.split(/\f|\n{3,}/);
    return { status: 'parsed', type: 'document', kind: detectKind(text, filename), pages: pages.length, text, analysis: analyseText(pages) };
  }
  return { status: 'error', error: `Unsupported file type ".${ext}". Use CSV, XLSX, PDF or TXT.` };
}

export const TEMPLATE_CSV = [
  'Line item,FY22,FY23,FY24,FY25,FY26',
  'Revenue from operations,,,,,',
  'Cost of materials consumed,,,,,',
  'EBITDA,,,,,',
  'Depreciation,,,,,',
  'Finance costs,,,,,',
  'Other income,,,,,',
  'Exceptional items,,,,,',
  'Profit before tax,,,,,',
  'Tax expense,,,,,',
  'Net profit,,,,,',
  'EPS,,,,,',
  'Dividend per share,,,,,',
  'Total equity,,,,,',
  'Total debt,,,,,',
  'Cash and equivalents,,,,,',
  'Trade receivables,,,,,',
  'Inventories,,,,,',
  'Trade payables,,,,,',
  'Total assets,,,,,',
  'Net fixed assets,,,,,',
  'Goodwill,,,,,',
  'Contingent liabilities,,,,,',
  'Shares outstanding,,,,,',
  'Cash from operations,,,,,',
  'Capex,,,,,',
  'Dividends paid,,,,,',
  'Acquisitions,,,,,',
  'Equity issued,,,,,'
].join('\n') + '\n';
