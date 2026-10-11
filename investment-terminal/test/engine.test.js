import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../engine/financials.js';
import { runForensics } from '../engine/forensics.js';
import { valuation, reverseDcf, costOfCapital, DEFAULT_RATES } from '../engine/valuation.js';
import { resolveScenarios, project } from '../engine/scenarios.js';
import { cagr, bisect } from '../engine/util.js';
import { analyze } from '../engine/analyze.js';
import { sample, NOW, goodAssessment, holdings } from './helpers.js';

test('util: CAGR and bisection', () => {
  assert.equal(Math.round(cagr(100, 200, 5) * 10000) / 10000, 0.1487);
  assert.equal(cagr(-1, 100, 3), null);
  assert.ok(Math.abs(bisect((x) => x * x - 2, 0, 2) - Math.SQRT2) < 1e-5);
});

test('financials: derived lines, ratios and coverage', () => {
  const fin = { years: ['FY24', 'FY25', 'FY26'], income: { revenue: [100, 120, 150], ebitda: [20, 25, 30], depreciation: [5, 5, 6], interest: [1, 1, 1], tax: [3, 4, 5] }, balance: { equity: [100, 110, 125], totalDebt: [10, 10, 10], cash: [5, 5, 20] }, cashflow: { cfo: [15, 18, 25], capex: [-5, -6, -7] } };
  const m = computeMetrics(fin);
  assert.deepEqual(m.series.ebit, [15, 20, 24]);
  assert.deepEqual(m.series.pbt, [14, 19, 23]);
  assert.deepEqual(m.series.pat, [11, 15, 18]);
  assert.deepEqual(m.series.fcf, [10, 12, 18]);
  assert.equal(m.latest.netDebt, -10);
  assert.ok(Math.abs(m.latest.ebitdaMargin - 0.2) < 1e-9);
  assert.ok(m.dataCoverage.score < 1, 'missing useful items lower coverage');
});

test('forensics: receivables outgrowing sales and auditor resignation are flagged with correct kind', () => {
  const c = sample('acb');
  c.financials.balance.receivables = c.financials.balance.receivables.map((v, i) => v * 1.35 ** i);
  c.management.auditorEvents = [{ type: 'resignation', date: '2026-01-01', description: 'Auditor resigned.' }];
  const m = computeMetrics(c.financials);
  const f = runForensics(c, m);
  const rec = f.flags.find((x) => x.id === 'receivables');
  assert.equal(rec.kind, 'warning');
  assert.equal(f.flags.find((x) => x.id.startsWith('auditor-resign')).kind, 'confirmed');
  assert.ok(f.score < 8);
});

test('valuation: reverse DCF reproduces the market price', () => {
  const c = sample('dpe');
  const m = computeMetrics(c.financials);
  const sc = resolveScenarios(c, m).base;
  const coc = costOfCapital(c, DEFAULT_RATES);
  const rd = reverseDcf(m, sc, coc, DEFAULT_RATES, c.market.sharesOutstanding, c.market.price);
  assert.ok(rd.impliedRevenueCagr10y > 0 && rd.impliedRevenueCagr10y < 0.4);
  const again = reverseDcf(m, { ...sc }, coc, DEFAULT_RATES, c.market.sharesOutstanding, c.market.price * 1.5);
  assert.ok(again.impliedRevenueCagr10y > rd.impliedRevenueCagr10y, 'a higher price implies higher growth');
});

test('valuation: sensitivity is monotonic and scenarios are ordered', () => {
  const c = sample('dpe');
  const m = computeMetrics(c.financials);
  const v = valuation(c, m);
  const col = v.sensitivity.waccG.values.map((r) => r[2]);
  for (let i = 1; i < col.length; i++) assert.ok(col[i] < col[i - 1], 'higher WACC → lower value');
  assert.ok(v.intrinsic.bear < v.intrinsic.base && v.intrinsic.base < v.intrinsic.bull);
  assert.ok(Number.isFinite(v.scenarios.base.expectedReturn5y));
});

test('valuation: DCF is not used for financials', () => {
  const c = sample('dpe');
  c.businessType = 'financial';
  const v = valuation(c, computeMetrics(c.financials));
  assert.ok(!v.scenarios.base.methodsUsed.includes('dcf'));
  assert.ok(v.warnings.some((w) => /lenders/.test(w)));
});

test('scenarios: projection margins glide to target', () => {
  const c = sample('acb');
  const m = computeMetrics(c.financials);
  const sc = { ...resolveScenarios(c, m).base, ebitdaMarginTarget: 0.3 };
  const rows = project(m, sc);
  assert.ok(Math.abs(rows[4].ebitdaMargin - 0.3) < 1e-9);
  assert.equal(rows.length, 10);
});

test('acceptance: great business at excessive valuation is NOT a BUY (Aravalli sample)', () => {
  const a = analyze(sample('acb'), { now: NOW, assessment: { ...goodAssessment() }, holdings: holdings() });
  assert.ok(a.decision.quality >= 7, 'high business quality');
  assert.equal(a.decision.greatBusiness, true);
  assert.notEqual(a.decision.code, 'BUY');
  assert.equal(a.decision.trace[0].result, 'WAIT', 'base decision is wait-for-valuation');
  assert.ok(a.decision.rules.some((r) => r.id === 'excessive-valuation' && r.cap === 'WAIT'));
  // This test assessment was written about a different company, so knowledge is (correctly) judged weak and caps further.
  assert.ok(['WAIT', 'WATCHLIST'].includes(a.decision.code));
  assert.match(a.narrative.businessVsInvestment, /great business — but not a great investment/);
});

test('acceptance: governance and solvency overrides escalate regardless of score (Vindhya sample)', () => {
  const a = analyze(sample('vir'), { now: NOW, assessment: goodAssessment() });
  assert.equal(a.decision.code, 'SELL_AVOID');
  const ids = a.decision.rules.map((r) => r.id);
  assert.ok(ids.includes('governance-serious'));
  assert.ok(ids.includes('insolvency'));
  assert.ok(a.forensic.confirmed.length >= 2);
});

test('acceptance: BUY requires investor assessment — pending assessment blocks BUY', () => {
  const c = sample('dpe');
  c.market.price = 470;
  const pending = analyze(c, { now: NOW, holdings: holdings() });
  assert.notEqual(pending.decision.code, 'BUY');
  assert.ok(pending.decision.rules.some((r) => r.id === 'investor-pending'));
  const done = analyze(c, { now: NOW, assessment: goodAssessment(), holdings: holdings() });
  assert.equal(done.decision.code, 'BUY');
  assert.equal(done.decision.status, 'provisional', 'red-team review gate');
  const final = analyze(c, { now: NOW, assessment: goodAssessment(), holdings: holdings(), redTeamAcknowledged: true });
  assert.equal(final.decision.status, 'final');
  assert.ok(final.decision.buyChecklist.every((x) => x.ok));
});

test('acceptance: a critical weakness in one dimension cannot be hidden by others', () => {
  const c = sample('dpe');
  c.market.price = 470;
  c.risks = [{ category: 'Technology', description: 'Product obsolete', probability: 0.95, impact: 5, residual: 'high' }];
  c.market.price = 300; // very cheap → great valuation score
  const a = analyze(c, { now: NOW, assessment: goodAssessment(), holdings: holdings() });
  assert.ok(a.dims.valuation.score >= 7, 'valuation looks great in isolation');
  assert.ok(a.decision.rules.some((r) => r.id === 'critical-risk'));
  assert.notEqual(a.decision.code, 'BUY');
});

test('acceptance: poor investor knowledge is disclosed and caps the decision', () => {
  const c = sample('dpe');
  c.market.price = 470;
  const weak = goodAssessment();
  weak.evidence = Object.fromEntries(Object.keys(weak.evidence).map((k) => [k, 'not sure really']));
  weak.self = Object.fromEntries(Object.keys(weak.self).map((k) => [k, 9]));
  const a = analyze(c, { now: NOW, assessment: weak, holdings: holdings() });
  assert.ok(a.investor.knowledgeScore < 4);
  assert.equal(a.investor.overconfidence, true);
  assert.ok(a.decision.rules.some((r) => r.id === 'investor-knowledge'));
  assert.equal(a.decision.code, 'WATCHLIST');
});

test('data quality: stale price and missing statements lower confidence; no statements → insufficient evidence', () => {
  const c = sample('dpe');
  c.market.priceDate = '2026-01-01';
  const a = analyze(c, { now: NOW });
  assert.ok(a.dataQuality.issues.some((i) => /Market price is \d+ days old/.test(i.text)));
  const empty = { id: 'x', name: 'Empty Co', market: { price: 100, priceDate: NOW, sharesOutstanding: 10 }, financials: { years: [] }, dataStatus: 'uploaded' };
  const e = analyze(empty, { now: NOW });
  assert.equal(e.decision.code, 'INSUFFICIENT');
  assert.ok(e.dataQuality.confidence < 0.5);
});

test('existing holder view distinguishes HOLD/REDUCE from BUY', () => {
  const a = analyze(sample('acb'), { now: NOW, holder: true, assessment: goodAssessment() });
  assert.ok(['HOLD', 'REDUCE'].includes(a.decision.code));
  assert.ok(a.narrative.holderView);
});

test('red team always produces counter-arguments and disconfirming tests', () => {
  const a = analyze(sample('ksc'), { now: NOW });
  assert.ok(a.redTeam.points.length >= 3);
  assert.equal(a.redTeam.strongestThree.length, 3);
  assert.ok(a.redTeam.disconfirmingEvidence.length > 0);
  assert.match(a.redTeam.bearThesis, /bear case/i);
});

test('scoring: custom weights change the holistic score but not override rules', () => {
  const c = sample('acb');
  const base = analyze(c, { now: NOW });
  const w = { business: 30, industry: 10, financial: 20, management: 10, moat: 20, growth: 4, valuation: 0, risk: 2, investor: 2, portfolio: 2 };
  const tuned = analyze(c, { now: NOW, settings: { weights: w } });
  assert.ok(tuned.aggregate.holistic > base.aggregate.holistic);
  assert.ok(tuned.decision.rules.some((r) => r.id === 'excessive-valuation'), 'valuation override still applies at zero weight');
  assert.notEqual(tuned.decision.code, 'BUY');
});
