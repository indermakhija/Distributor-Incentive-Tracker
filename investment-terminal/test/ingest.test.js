import { test } from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { parseCsv, mapStatements, ingest, TEMPLATE_CSV } from '../server/ingest.js';

test('CSV parser handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c",d\r\n1,"he said ""hi""",3\n'), [['a', 'b,c', 'd'], ['1', 'he said "hi"', '3']]);
});

test('statement mapping: aliases, negatives in parentheses, unrecognised rows reported', () => {
  const grid = parseCsv('Particulars,FY24,FY25,FY26\nNet Sales,"1,000",1100,1250\nProfit after tax,100,(20),130\nMystery line,1,2,3\nNet worth,500,520,600\nNet cash from operating activities,90,110,140\n');
  const { statements: s, report } = mapStatements(grid);
  assert.deepEqual(s.years, ['FY24', 'FY25', 'FY26']);
  assert.deepEqual(s.income.revenue, [1000, 1100, 1250]);
  assert.deepEqual(s.income.pat, [100, -20, 130]);
  assert.deepEqual(report.unrecognised, ['Mystery line']);
  assert.deepEqual(report.missingRequired, []);
});

test('template CSV maps every row', () => {
  const { report } = mapStatements(parseCsv(TEMPLATE_CSV));
  assert.equal(report.unrecognised.length, 0);
  assert.ok(report.recognised.length >= 25);
});

test('missing header is a clear error, not a guess', () => {
  const r = mapStatements(parseCsv('foo,bar\n1,2\n'));
  assert.match(r.error, /header row/);
});

test('PDF ingestion extracts text and governance signals with page numbers', async () => {
  const buf = await new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)));
    doc.text('Annual Report 2026. Independent Auditor\'s Report.');
    doc.addPage().text('Basis for Qualified Opinion: we were unable to verify receivables of Rs 120 crore. We expect revenue to double by FY29 as capacity expansion is commissioned.');
    doc.end();
  });
  const r = await ingest(buf, 'ar.pdf', 'application/pdf');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'annual_report');
  const q = r.analysis.findings.find((f) => f.id === 'qualified');
  assert.ok(q);
  assert.equal(q.page, 2);
  assert.ok(r.analysis.findings.some((f) => f.id === 'guidance'));
});

test('rejects unsupported and fake files', async () => {
  assert.equal((await ingest(Buffer.from('x'), 'a.exe')).status, 'error');
  assert.equal((await ingest(Buffer.from('not a pdf'), 'a.pdf')).status, 'error');
});

test('XLSX ingestion maps statements', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('P&L');
  ws.addRow(['Line item', 'FY25', 'FY26']);
  ws.addRow(['Revenue from operations', 500, 560]);
  ws.addRow(['Net profit', 50, { formula: 'B3*1.2', result: 60 }]);
  ws.addRow(['Total equity', 300, 340]);
  ws.addRow(['Cash from operations', 45, 70]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await ingest(buf, 'fin.xlsx');
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.statements.income.pat, [50, 60]);
});
