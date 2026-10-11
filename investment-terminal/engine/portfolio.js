// Module K: portfolio fit & opportunity cost.

import { isNum, clamp, round, sum } from './util.js';

export const DEFAULT_LIMITS = { maxSingleStock: 0.1, maxSector: 0.3 };

/**
 * holdings: [{ name, ticker, sector, value, factors: [] }]
 * proposal: { amount, sector, factors, ticker, avgDailyValue }
 */
export function portfolioFit(holdings = [], proposal = {}, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const cash = opts.cash ?? 0;
  const amount = proposal.amount ?? 0;
  const total = sum(holdings.map((h) => h.value)) + cash;
  const post = total + (opts.fromCash ? 0 : amount);
  const out = { limits, totalBefore: total, totalAfter: post, warnings: [], positives: [] };
  if (!holdings.length && !amount) return { ...out, available: false, note: 'No portfolio entered. Add holdings to assess fit.' };

  const bySector = (list, tot) => {
    const m = {};
    for (const h of list) m[h.sector || 'Unclassified'] = (m[h.sector || 'Unclassified'] || 0) + (h.value || 0);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, tot ? v / tot : 0]));
  };
  const existing = holdings.find((h) => proposal.ticker && h.ticker === proposal.ticker);
  const afterList = holdings.map((h) => (h === existing ? { ...h, value: h.value + amount } : h));
  if (!existing && amount) afterList.push({ name: proposal.name, ticker: proposal.ticker, sector: proposal.sector, value: amount, factors: proposal.factors || [] });
  if (opts.fromCash) out.cashAfter = cash - amount;

  out.sectorBefore = bySector(holdings, total);
  out.sectorAfter = bySector(afterList, post);
  out.positionWeight = post ? ((existing?.value || 0) + amount) / post : null;
  out.largestPositionAfter = post ? Math.max(...afterList.map((h) => h.value / post)) : null;

  if (out.positionWeight > limits.maxSingleStock) out.warnings.push(`Position would be ${(out.positionWeight * 100).toFixed(1)}% of the portfolio (limit ${(limits.maxSingleStock * 100).toFixed(0)}%).`);
  const sw = out.sectorAfter[proposal.sector || 'Unclassified'];
  if (sw > limits.maxSector) out.warnings.push(`${proposal.sector} exposure would reach ${(sw * 100).toFixed(1)}% (limit ${(limits.maxSector * 100).toFixed(0)}%).`);
  if (!out.sectorBefore[proposal.sector || 'Unclassified']) out.positives.push(`Adds a new sector (${proposal.sector}) — improves diversification.`);

  // Factor overlap: shared macro sensitivities (rates, commodity, consumer demand, capex cycle, INR…).
  const pf = new Set(proposal.factors || []);
  const factorExposure = {};
  for (const h of afterList) for (const f of h.factors || []) factorExposure[f] = (factorExposure[f] || 0) + h.value / post;
  out.factorExposureAfter = factorExposure;
  const overlapping = holdings.filter((h) => (h.factors || []).some((f) => pf.has(f)));
  out.overlap = overlapping.map((h) => ({ name: h.name, shared: (h.factors || []).filter((f) => pf.has(f)) }));
  out.overlapWeight = total ? sum(overlapping.map((h) => h.value)) / total : 0;
  // Correlation proxy: Jaccard similarity of factor sets, weighted by holding value.
  out.correlationProxy = total ? round(sum(holdings.map((h) => {
    const hs = new Set(h.factors || []);
    const inter = [...hs].filter((f) => pf.has(f)).length;
    const uni = new Set([...hs, ...pf]).size || 1;
    return (inter / uni) * h.value;
  })) / total, 2) : null;
  out.correlationNote = 'Proxy based on shared macro-factor tags, not on price return correlations.';
  if (out.overlapWeight > 0.4) out.warnings.push(`${(out.overlapWeight * 100).toFixed(0)}% of the existing portfolio shares macro factors with this stock (${[...pf].join(', ')}).`);

  // Liquidity: days to exit at 20% participation of average daily traded value.
  if (isNum(proposal.avgDailyValue) && proposal.avgDailyValue > 0) {
    out.daysToExit = ((existing?.value || 0) + amount) / (proposal.avgDailyValue * 0.2);
    if (out.daysToExit > 5) out.warnings.push(`Exiting would take ~${out.daysToExit.toFixed(1)} trading days at 20% of average daily volume.`);
  }

  // Stress: apply a drawdown to the new position and to factor-overlapping holdings.
  const shock = opts.stressDrawdown ?? 0.4;
  const posLoss = ((existing?.value || 0) + amount) * shock;
  const overlapLoss = sum(overlapping.filter((h) => h !== existing).map((h) => h.value)) * shock * 0.5;
  out.stress = { drawdown: shock, portfolioLoss: post ? (posLoss + overlapLoss) / post : null, note: `${(shock * 100).toFixed(0)}% fall in this stock, half that in holdings sharing its macro factors.` };

  let score = 10;
  if (out.positionWeight > limits.maxSingleStock) score -= clamp((out.positionWeight - limits.maxSingleStock) * 40, 1, 4);
  if (sw > limits.maxSector) score -= clamp((sw - limits.maxSector) * 20, 1, 3);
  score -= clamp((out.correlationProxy || 0) * 4, 0, 2);
  if (out.daysToExit > 5) score -= 1;
  if (out.positives.length) score += 0.5;
  out.score = round(clamp(score, 0, 10), 1);
  out.available = true;
  return out;
}

/** Opportunity cost: compares this idea's risk-adjusted expected return with alternatives. */
export function opportunityCost(current, alternatives = [], rates = {}) {
  const idx = rates.indexExpectedReturn ?? 0.11;
  const fi = rates.fixedIncomeReturn ?? 0.07;
  const riskAdj = (er, quality, confidence) => (isNum(er) ? er - (10 - (quality ?? 5)) * 0.005 - (1 - (confidence ?? 0.5)) * 0.02 : null);
  const mine = riskAdj(current.expectedReturn5y, current.quality, current.confidence);
  const options = [
    { name: 'Broad market index fund', expectedReturn: idx, riskAdjusted: idx, type: 'index' },
    { name: 'Fixed income / cash', expectedReturn: fi, riskAdjusted: fi, type: 'fixed_income' },
    ...alternatives.map((a) => ({ name: a.name, ticker: a.ticker, expectedReturn: a.expectedReturn5y, riskAdjusted: riskAdj(a.expectedReturn5y, a.quality, a.confidence), quality: a.quality, type: 'stock' }))
  ].filter((o) => isNum(o.riskAdjusted)).sort((a, b) => b.riskAdjusted - a.riskAdjusted);
  const nextBest = options[0];
  const beats = isNum(mine) && nextBest ? mine > nextBest.riskAdjusted : null;
  return {
    riskAdjustedReturn: mine,
    options,
    nextBest,
    beatsNextBest: beats,
    answer: !isNum(mine) ? 'Expected return cannot be estimated, so the opportunity cost is unknown.'
      : beats ? `Risk-adjusted expected return of ${(mine * 100).toFixed(1)}% beats the next-best alternative (${nextBest.name}, ${(nextBest.riskAdjusted * 100).toFixed(1)}%).`
      : `The next-best alternative (${nextBest.name}, ${(nextBest.riskAdjusted * 100).toFixed(1)}% risk-adjusted) offers more than this idea (${(mine * 100).toFixed(1)}%). This company has not earned the capital yet.`
  };
}
