import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer, scoreAssessment, detectBiases } from '../engine/investor.js';
import { portfolioFit, opportunityCost } from '../engine/portfolio.js';
import { evaluateThesis, generateAlerts, snapshotSummary } from '../engine/monitoring.js';
import { analyze } from '../engine/analyze.js';
import { sample, NOW, goodAssessment } from './helpers.js';

test('gradeAnswer rewards concept coverage, not length alone', () => {
  const concepts = ['steel|raw material', 'utilisation|operating leverage', 'mix|defence'];
  const good = gradeAnswer('Steel costs, plant utilisation and the mix shift to defence drive margins by 2-3%.', concepts);
  const fluff = gradeAnswer('I think the company is very good and management is great and it will do well over time for sure.', concepts);
  assert.ok(good.score > fluff.score + 3);
  assert.equal(gradeAnswer('dunno', concepts).score, 0);
});

test('assessment scoring is independent of company quality and flags biases', () => {
  const s = scoreAssessment(goodAssessment(), sample('dpe'));
  assert.equal(s.completed, true);
  assert.ok(s.knowledgeScore >= 6);
  assert.equal(s.convictionType, 'evidence-backed');
  const emo = goodAssessment();
  emo.conviction = { reasons: ['social', 'fomo', 'previousHigh'], thesis: 'It has fallen from its previous high so it must bounce', supporting: '', contradicting: '', changeMind: '' };
  const b = detectBiases(emo, { overconfidence: false, emotional: ['social', 'fomo'] }).map((x) => x.id);
  for (const id of ['confirmation', 'recency', 'anchoring', 'herd', 'narrative']) assert.ok(b.includes(id), id);
  assert.equal(scoreAssessment(emo, sample('dpe')).convictionType, 'emotional / borrowed');
  assert.equal(scoreAssessment(null, sample('dpe')).completed, false);
});

test('portfolio fit: concentration, sector and overlap warnings', () => {
  const holdings = [{ name: 'A', sector: 'FMCG', value: 300000, factors: ['consumer_demand'] }, { name: 'B', sector: 'FMCG', value: 200000, factors: ['consumer_demand', 'rural_income'] }];
  const f = portfolioFit(holdings, { amount: 200000, sector: 'FMCG', factors: ['consumer_demand'], ticker: 'X', name: 'X', avgDailyValue: 0.5 }, {});
  assert.ok(f.positionWeight > 0.1);
  assert.ok(f.warnings.some((w) => /Position would be/.test(w)));
  assert.ok(f.warnings.some((w) => /FMCG exposure/.test(w)));
  assert.ok(f.score < 7);
  assert.equal(portfolioFit([], {}).available, false);
});

test('opportunity cost compares against index and alternatives', () => {
  const o = opportunityCost({ expectedReturn5y: 0.09, quality: 6, confidence: 0.6 }, [{ name: 'Alt', expectedReturn5y: 0.2, quality: 8, confidence: 0.8 }], { indexExpectedReturn: 0.11, fixedIncomeReturn: 0.07 });
  assert.equal(o.beatsNextBest, false);
  assert.equal(o.nextBest.name, 'Alt');
});

test('thesis evaluation detects broken and at-risk assumptions', () => {
  const a = analyze(sample('dpe'), { now: NOW });
  const t = evaluateThesis({ assumptions: [{ text: 'Margins hold', metric: 'ebitdaMargin', operator: '>=', threshold: 0.25 }, { text: 'Low debt', metric: 'netDebtToEbitda', operator: '<=', threshold: 2 }] }, { ...a, company: sample('dpe') });
  assert.equal(t.status, 'broken');
  assert.equal(t.results[0].status, 'broken');
  assert.equal(t.results[1].status, 'holding');
});

test('alerts: pledge increase and auditor flag alert; ordinary price moves do not unless enabled', () => {
  const c1 = sample('ksc');
  const a1 = analyze(c1, { now: NOW });
  const s1 = snapshotSummary({ ...a1, company: c1 });
  const c2 = sample('ksc');
  c2.shareholding.push({ date: '2026-09-30', promoter: 0.45, pledgedPctOfPromoter: 0.3, fii: 0.08, dii: 0.12, retail: 0.35 });
  c2.market.price = c1.market.price * 0.85;
  c2.management.auditorEvents.push({ type: 'qualification', date: '2026-09-01', description: 'Qualified opinion on inventory' });
  const a2 = analyze(c2, { now: NOW });
  const s2 = snapshotSummary({ ...a2, company: c2 });
  const alerts = generateAlerts(s1, s2, { ...a2, company: c2 });
  assert.ok(alerts.some((x) => x.title === 'Promoter pledging increased'));
  assert.ok(alerts.some((x) => /New accounting flag: Qualified audit opinion/.test(x.title) && x.severity === 'critical'));
  assert.ok(!alerts.some((x) => x.title === 'Price move'));
  assert.ok(generateAlerts(s1, s2, { ...a2, company: c2 }, { priceAlerts: true }).some((x) => x.title === 'Price move'));
});
