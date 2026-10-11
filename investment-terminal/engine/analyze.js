// Orchestrator: turns a company record (+ investor context) into the full holistic analysis.

import { computeMetrics } from './financials.js';
import { runForensics } from './forensics.js';
import { valuation, scenarioValue, VALUATION_STATUS_LABEL, DEFAULT_RATES } from './valuation.js';
import { macroExposure, macroSignals, macroImpact, macroOverlay, stressImpact, STRESS_SCENARIOS, regimeLabel, macroDatasetQuality } from './macro.js';
import { projectionSummary } from './scenarios.js';
import { scoreInvestor as scoreInvestorDim, scoreBusiness, scoreIndustry, scoreFinancial, scoreManagement, scoreMoat, scoreGrowth, scoreValuation, scoreRisk, scorePortfolio, aggregate, DEFAULT_WEIGHTS } from './scoring.js';
import { scoreAssessment } from './investor.js';
import { portfolioFit, opportunityCost } from './portfolio.js';
import { dataQuality } from './dataquality.js';
import { decide, horizonFor } from './decision.js';
import { redTeam } from './redteam.js';
import { evaluateThesis } from './monitoring.js';
import { isNum, pct, round } from './util.js';

export const ENGINE_VERSION = '1.1.0';

/**
 * ctx: { settings: {weights, rates, limits, requiredMarginOfSafety}, assessment, holdings, cash, proposal, thesis,
 *        alternatives: [{name,ticker,expectedReturn5y,quality,confidence}], holder, redTeamAcknowledged, now,
 *        macro: { factorId: { value, previous, asOf, source, type } } }
 */
export function analyze(company, ctx = {}) {
  const settings = ctx.settings || {};
  const weights = { ...DEFAULT_WEIGHTS, ...(settings.weights || {}) };
  const rates = { ...DEFAULT_RATES, ...(settings.rates || {}) };
  const metrics = computeMetrics(company.financials, { taxRate: company.valuationInputs?.taxRate });
  const forensic = runForensics(company, metrics);
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const macro = analyzeMacro(company, metrics, ctx.macro, now);
  const val = valuation(company, metrics, { ...settings, rates, macroOverlay: macro.overlay, macroMoSUplift: macro.mosUplift });
  macro.stress = macroStress(company, metrics, val, macro);
  const dq = dataQuality(company, metrics, now, macro);
  const inv = scoreAssessment(ctx.assessment, company);

  const amount = ctx.proposal?.amount ?? inv.suitability?.amount;
  const fit = portfolioFit(ctx.holdings || [], { amount, ticker: company.ticker, name: company.name, sector: company.sector, factors: company.macroFactors || [], avgDailyValue: company.market?.avgDailyValueCr }, { limits: settings.limits, cash: ctx.cash });

  const dims = {};
  dims.business = scoreBusiness(company, metrics);
  dims.industry = scoreIndustry(company);
  dims.financial = scoreFinancial(company, metrics, forensic);
  dims.management = scoreManagement(company, metrics, forensic);
  dims.moat = scoreMoat(company, metrics, rates);
  dims.growth = scoreGrowth(company, metrics, val, dims.management);
  dims.valuation = scoreValuation(company, val);
  dims.risk = scoreRisk(company, val, macro);
  dims.investor = scoreInvestorDim(inv);
  const qualityPre = ['business', 'industry', 'financial', 'management', 'moat', 'growth'].map((k) => dims[k].score).filter(isNum);
  const opp = opportunityCost({ expectedReturn5y: val.scenarios?.base?.expectedReturn5y, quality: qualityPre.length ? qualityPre.reduce((a, b) => a + b) / qualityPre.length : null, confidence: dq.confidence }, ctx.alternatives || [], rates);
  dims.portfolio = scorePortfolio(fit, opp);

  const agg = aggregate(dims, weights);
  const thesis = evaluateThesis(ctx.thesis, { metrics, company, valuation: val, dims, aggregate: agg });
  const a = { company, metrics, forensic, val, valuation: val, macro, dq, inv, fit, opp, dims, agg, aggregate: agg, thesis, settings: { ...settings, weights }, holder: !!ctx.holder, redTeamAcknowledged: !!ctx.redTeamAcknowledged };
  const decision = decide(a);
  a.decision = decision;
  a.redTeam = redTeam(a);
  return {
    engineVersion: ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    company: { id: company.id, name: company.name, ticker: company.ticker, exchange: company.exchange, isin: company.isin, sector: company.sector, industry: company.industry?.name, businessType: company.businessType, dataStatus: company.dataStatus, market: company.market },
    metrics, forensic, valuation: val, macro, dataQuality: dq, investor: inv, portfolio: { fit, opportunity: opp }, dims, aggregate: agg, thesis,
    decision, redTeam: a.redTeam,
    scenarioSummary: val.scenarios ? Object.fromEntries(Object.entries(val.scenarios).map(([k, s]) => [k, projectionSummary(s.projection)])) : null,
    narrative: narrative(a)
  };
}

/** Macro layer for one company: sensitivities × current national/international regime. */
export function analyzeMacro(company, metrics, dataset, now = new Date()) {
  const { exposures, template } = macroExposure(company, metrics);
  const signals = macroSignals(dataset || {}, now);
  const impact = macroImpact(exposures, signals);
  const dsq = macroDatasetQuality(signals);
  const usable = dsq.available > 0 && impact.coverage > 0;
  const overlay = usable ? macroOverlay(impact) : { growth: 0, margin: 0 };
  // Adverse regime for a macro-sensitive business → demand a bigger margin of safety.
  const mosUplift = !usable ? 0 : impact.score <= 3 && impact.sensitivity !== 'low' ? 0.1 : impact.score < 4 && impact.sensitivity === 'high' ? 0.05 : 0;
  return { template, exposures, signals, impact, dataset: dsq, usable, overlay, mosUplift, regime: usable ? regimeLabel(impact.score) : 'No macro data', overlayMode: company.macroOverlay || 'auto' };
}

/** Re-values the base case under each macro stress scenario. */
export function macroStress(company, metrics, val, macro) {
  if (!val?.ctx || !val.scenarios?.base) return [];
  const base = val.scenarios.base.assumptions;
  return STRESS_SCENARIOS.map((st) => {
    const si = stressImpact(macro.exposures, st.shocks);
    const sc = { ...base, revenueCagr5: base.revenueCagr5 + si.growthDelta, ebitdaMarginTarget: base.ebitdaMarginTarget + si.marginDelta };
    const v = scenarioValue(company, metrics, sc, val.ctx);
    return { ...st, ...si, value: v, vsBase: isNum(v) && val.intrinsic.base ? v / val.intrinsic.base - 1 : null, vsPrice: isNum(v) ? v / val.price - 1 : null };
  });
}

/** Module M: plain-language explanation built only from computed evidence (no invented facts). */
export function narrative(a) {
  const { company: c, val, dims, decision: d, metrics: m, agg } = a;
  const mc = a.macro;
  const worstStress = (mc?.stress || []).filter((x) => isNum(x.vsBase) && x.id !== 'easing').sort((x, y) => x.vsBase - y.vsBase)[0];
  const top = (k, n = 3) => (dims[k]?.positives || []).slice(0, n);
  const attractive = ['business', 'moat', 'financial', 'growth', 'management'].flatMap((k) => top(k, 2)).slice(0, 6);
  const er = (k, y) => val?.scenarios?.[k]?.[`expectedReturn${y}y`];
  const scenarioReturns = val?.scenarios ? ['bear', 'base', 'bull'].map((k) => ({ scenario: k, value: round(val.intrinsic[k], 0), return3y: er(k, 3), return5y: er(k, 5), probability: val.scenarios[k].assumptions.probability })) : [];
  const sb = val?.scenarios?.base?.assumptions;
  const permanentLoss = [
    ...d.rules.filter((r) => r.severity === 'critical').map((r) => r.title),
    ...(c.risks || []).filter((r) => r.impact >= 4).map((r) => `${r.category}: ${r.description}`),
    ...(worstStress && worstStress.vsBase < -0.2 ? [`Macro stress — ${worstStress.name}: estimated value falls ${pct(-worstStress.vsBase, 0)} to ₹${round(worstStress.value, 0)}.`] : [])
  ].slice(0, 6);
  const marketMissing = [];
  if (val?.reverseDcf?.impliedRevenueCagr10y < (sb?.revenueCagr5 ?? 0) - 0.02) marketMissing.push(`The price implies only ${pct(val.reverseDcf.impliedRevenueCagr10y)} growth versus an evidence-based ${pct(sb.revenueCagr5)}.`);
  for (const x of (c.catalysts || []).filter((y) => ['executing', 'approved'].includes(y.status)).slice(0, 2)) marketMissing.push(`${x.name} (${x.status}) — ${(x.evidence || 'see catalyst register').replace(/\.$/, '')}.`);
  const pricedIn = [];
  if (isNum(val?.reverseDcf?.impliedRevenueCagr10y)) pricedIn.push(val.reverseDcf.interpretation);
  if (val?.multiples?.pe) pricedIn.push(`P/E ${val.multiples.pe.toFixed(1)}x${c.valuationInputs?.historicalPE?.median ? ` vs historical median ${c.valuationInputs.historicalPE.median}x` : ''}.`);
  const change = [];
  if (val?.entryPrice && d.code !== 'BUY') change.push(`A price at or below ₹${round(val.entryPrice, 0)} (base value less ${pct(val.requiredMarginOfSafety, 0)} margin of safety).`);
  change.push(...d.gates);
  for (const r of d.rules.filter((x) => x.cap)) change.push(`Resolution of: ${r.title}.`);
  change.push('Thesis-breaking evidence listed in the red-team review.');
  const why = d.trace.map((t) => `${t.step}: ${t.why}`);
  const macroText = mc?.usable ? {
    regime: `${mc.regime} (macro score ${mc.impact.score}/10, ${mc.impact.sensitivity} sensitivity).`,
    tailwinds: mc.impact.tailwinds.slice(0, 4).map((r) => `${r.name} ${r.direction !== 'n/a' ? '(' + r.direction + ')' : ''}`.trim()),
    headwinds: mc.impact.headwinds.slice(0, 4).map((r) => `${r.name} ${r.direction !== 'n/a' ? '(' + r.direction + ')' : ''}`.trim()),
    worstStress: worstStress ? `${worstStress.name}: value ₹${round(worstStress.value, 0)} (${pct(worstStress.vsBase, 0)} vs base, ${pct(worstStress.vsPrice, 0)} vs price).` : null
  } : { regime: 'No macro data loaded — decision made without the macro overlay.', tailwinds: [], headwinds: [], worstStress: null };
  return {
    headline: `${d.label}${d.status === 'provisional' ? ' (provisional)' : ''} — holistic score ${agg.holistic}/100 (${agg.band.label}), business quality ${d.quality ?? 'n/a'}/10, valuation: ${VALUATION_STATUS_LABEL[val?.status] || 'n/a'}.`,
    businessVsInvestment: d.greatBusiness && !d.greatInvestment ? 'A great business — but not a great investment at the current price and evidence.' : d.greatBusiness && d.greatInvestment ? 'A great business at an attractive price.' : !d.greatBusiness && ['BUY', 'BUY_BELOW'].includes(d.code) ? 'Not a great business — only the price makes it interesting, so demand a larger margin of safety.' : 'Neither the business quality nor the price makes a compelling case today.',
    why,
    attractive,
    marketMissing,
    pricedIn,
    argumentsAgainst: a.redTeam?.strongestThree?.map((x) => `${x.claim} ${x.evidence}`) || [],
    permanentLossRisks: permanentLoss,
    horizon: horizonFor(c, dims),
    scenarioReturns,
    keyAssumptions: sb ? [
      `Revenue growth ${pct(sb.revenueCagr5)} p.a. (years 1–5), ${pct(sb.revenueCagr10)} (years 6–10).`,
      `EBITDA margin moving to ${pct(sb.ebitdaMarginTarget)}.`,
      `Capex ${pct(sb.capexToRevenue)} and working capital ${pct(sb.nwcToRevenue)} of revenue.`,
      `Discount rate (WACC) ${pct(val.coc?.wacc)}, terminal growth ${pct(val.coc?.g)}, exit P/E ${sb.exitPE}x.`,
      `Shares outstanding ${c.market?.sharesOutstanding ?? m.latest?.sharesOutstanding} Cr; net debt ₹${round(m.latest?.netDebt, 0)} Cr.`
    ] : [],
    whatWouldChange: change,
    macro: macroText,
    holderView: d.holder ? `Is the company still attractive? ${d.quality >= 6 ? 'Yes' : 'Doubtful'} (quality ${d.quality}/10). Is holding at ₹${round(val?.price, 0)} justified? ${['HOLD'].includes(d.code) ? 'Yes' : 'Not fully'} — ${d.trace[d.trace.length - 1].why}` : null
  };
}
