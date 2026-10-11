import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { macroExposure, macroSignals, macroImpact, stressImpact, STRESS_SCENARIOS, MACRO_FACTORS } from '../engine/macro.js';
import { computeMetrics } from '../engine/financials.js';
import { analyze } from '../engine/analyze.js';
import { sample, NOW, goodAssessment, holdings } from './helpers.js';

const SAMPLE_MACRO = JSON.parse(readFileSync(new URL('../data/macro-sample.json', import.meta.url))).readings;
const reading = (value, previous, asOf = NOW) => ({ value, previous, asOf, source: 'test', type: 'manual' });

test('catalogue covers national and international factors', () => {
  assert.ok(MACRO_FACTORS.filter((f) => f.scope === 'india').length >= 12);
  assert.ok(MACRO_FACTORS.filter((f) => f.scope === 'global').length >= 10);
  for (const s of STRESS_SCENARIOS) for (const id of Object.keys(s.shocks)) assert.ok(MACRO_FACTORS.some((f) => f.id === id), `${s.id}:${id}`);
});

test('exposures: sector template + tags + leverage, user overrides win', () => {
  const c = sample('vir');
  const e = macroExposure(c, computeMetrics(c.financials)).exposures;
  assert.ok(e.in_repo.value <= -2, 'leveraged realty is very rate-sensitive');
  assert.match(e.in_repo.basis, /leverage/);
  c.macroExposure = { in_repo: 1 };
  assert.equal(macroExposure(c, computeMetrics(c.financials)).exposures.in_repo.value, 1);
});

test('signals: level + momentum, clamped; staleness by frequency', () => {
  const s = macroSignals({ brent: reading(111, 75), in_inr: reading(85, 85), in_gdp: reading(6.5, 6.5, '2025-01-01') }, new Date(NOW));
  assert.equal(s.brent.signal, 1);
  assert.equal(s.in_inr.signal, 0, 'INR is momentum-only');
  assert.equal(s.in_gdp.stale, true);
  assert.equal(s.cn_pmi.available, false);
});

test('impact: oil spike hurts an FMCG company, rupee slide helps an exporter', () => {
  const fmcg = sample('acb');
  const e = macroExposure(fmcg, computeMetrics(fmcg.financials)).exposures;
  const oil = macroImpact(e, macroSignals({ brent: reading(115, 75), in_cpi: reading(6.5, 4) }, new Date(NOW)));
  assert.ok(oil.score < 5 && oil.headwinds.some((h) => h.id === 'brent'));
  const chem = sample('ksc');
  const ec = macroExposure(chem, computeMetrics(chem.financials)).exposures;
  assert.ok(stressImpact(ec, { in_inr: 8 }).impact > 0);
});

test('analysis: macro overlay changes assumptions; adverse regime raises margin of safety and caps BUY', () => {
  const c = sample('dpe');
  c.market.price = 470;
  const base = analyze(c, { now: NOW, assessment: goodAssessment(), holdings: holdings(), redTeamAcknowledged: true });
  assert.equal(base.decision.code, 'BUY');
  assert.ok(base.decision.rules.some((r) => r.id === 'macro-missing'), 'missing macro is disclosed');
  // Hostile domestic regime for a capex/rate-sensitive industrial.
  const hostile = { in_repo: reading(7.5, 6.0), in_gsec10: reading(8.0, 7.0), in_govcapex: reading(-15, 15), in_iip: reading(-1, 5), in_pmi_mfg: reading(50, 57), in_gdp: reading(4.5, 6.8), gl_pmi: reading(47, 50) };
  const a = analyze(c, { now: NOW, macro: hostile, assessment: goodAssessment(), holdings: holdings(), redTeamAcknowledged: true });
  assert.ok(a.macro.impact.score <= 3, `score ${a.macro.impact.score}`);
  assert.ok(a.macro.overlay.growth < 0);
  assert.ok(a.valuation.requiredMarginOfSafety > base.valuation.requiredMarginOfSafety);
  assert.ok(a.valuation.intrinsic.base < base.valuation.intrinsic.base);
  assert.ok(a.decision.rules.some((r) => r.id === 'macro-headwind'));
  assert.notEqual(a.decision.code, 'BUY');
  assert.ok(a.redTeam.points.some((p) => p.source === 'macro'));
  assert.ok(a.narrative.macro.headwinds.length > 0);
});

test('analysis: user scenarios are not overlaid unless macroOverlay=always; off disables', () => {
  const c = sample('acb');
  c.scenarios = { base: { revenueCagr5: 0.1 } };
  const a = analyze(c, { now: NOW, macro: SAMPLE_MACRO });
  assert.equal(a.valuation.scenarios.base.assumptions.revenueCagr5, 0.1);
  assert.notEqual(a.valuation.scenarios.bear.assumptions.macroAdjustment, undefined);
  c.macroOverlay = 'off';
  assert.equal(analyze(c, { now: NOW, macro: SAMPLE_MACRO }).valuation.scenarios.bear.assumptions.macroAdjustment, undefined);
});

test('stress tests produce a value per scenario and sample macro data is disclosed', () => {
  const a = analyze(sample('acb'), { now: NOW, macro: SAMPLE_MACRO });
  assert.equal(a.macro.stress.length, STRESS_SCENARIOS.length);
  const monsoon = a.macro.stress.find((s) => s.id === 'weak_monsoon');
  assert.ok(monsoon.vsBase < 0, 'weak monsoon hurts a rural FMCG franchise');
  assert.ok(a.decision.rules.some((r) => r.id === 'macro-data'));
  assert.ok(a.dataQuality.issues.some((i) => /illustrative sample/.test(i.text)));
});
