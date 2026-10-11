// Bear / base / bull operating projections. All outputs are model assumptions, never facts.

import { isNum, clamp, round, mean, lastN } from './util.js';

export const SCENARIO_KEYS = ['bear', 'base', 'bull'];

/** Builds default scenario assumptions from history + industry outlook, with a rationale for each. */
export function defaultScenarios(company, metrics) {
  const g5 = metrics.growth?.revenue5y ?? metrics.growth?.revenue3y;
  const ind = company.industry?.growth5y;
  const histMargin = metrics.avg5?.ebitdaMargin ?? metrics.latest?.ebitdaMargin ?? 0.15;
  const latestMargin = metrics.latest?.ebitdaMargin ?? histMargin;
  // Base growth: blend own history with industry growth (mean reversion), clipped to a plausible range.
  const parts = [g5, ind].filter(isNum);
  const baseG = clamp(parts.length ? mean(parts) : 0.08, -0.05, 0.3);
  const baseM = clamp((histMargin + latestMargin) / 2, -0.2, 0.6);
  const common = {
    capexToRevenue: round(metrics.avg5?.capexToRevenue ?? 0.05, 4),
    nwcToRevenue: round(metrics.avg5?.nwcToRevenue ?? 0.15, 4),
    depToRevenue: round(metrics.avg5?.depToRevenue ?? 0.03, 4),
    taxRate: round(clamp(metrics.avg5?.effectiveTaxRate ?? 0.25, 0.15, 0.35), 4),
    payoutRatio: round(clamp(metrics.latest?.payoutRatio ?? 0.25, 0, 1), 4),
    dilutionPerYear: 0
  };
  const histPE = company.valuationInputs?.historicalPE || {};
  const curPE = company.market?.price && metrics.latest?.eps > 0 ? company.market.price / metrics.latest.eps : null;
  const peLow = histPE.min ?? (curPE ? curPE * 0.6 : 12);
  const peMed = histPE.median ?? (curPE ? curPE * 0.85 : 18);
  const peHigh = histPE.max ?? (curPE ?? 25);
  const mk = (dg, dm, probability, exitPE, rationale) => ({
    revenueCagr5: round(baseG + dg, 4),
    revenueCagr10: round(Math.max(0.03, (baseG + dg) * 0.6), 4),
    ebitdaMarginTarget: round(baseM + dm, 4),
    exitPE: round(exitPE, 1),
    probability,
    ...common,
    rationale
  });
  return {
    bear: mk(-0.05, -0.03, 0.25, Math.min(peLow, curPE ? curPE * 0.8 : peLow), 'Growth 5pp below base, EBITDA margin 3pp lower, exit at the low end of the historical P/E range.'),
    base: mk(0, 0, 0.5, curPE ? Math.min(curPE, peMed) : peMed, `Revenue growth blends ${isNum(g5) ? 'own 5y CAGR (' + (g5 * 100).toFixed(1) + '%)' : 'default 8%'}${isNum(ind) ? ' with industry growth (' + (ind * 100).toFixed(1) + '%)' : ''}; margin = average of 5y mean and latest; exit at the lower of current and median historical P/E.`),
    bull: mk(0.04, 0.02, 0.25, peHigh, 'Growth 4pp above base from share gains/new categories, margin 2pp higher on operating leverage, exit at the historical high P/E.')
  };
}

/** Merges user/analyst scenario overrides onto defaults. */
export function resolveScenarios(company, metrics) {
  const defs = defaultScenarios(company, metrics);
  const user = company.scenarios || {};
  const out = {};
  for (const k of SCENARIO_KEYS) {
    out[k] = { ...defs[k], ...(user[k] || {}) };
    out[k].source = user[k] && Object.keys(user[k]).length ? 'user assumption' : 'auto-derived assumption';
  }
  const tot = SCENARIO_KEYS.reduce((a, k) => a + (out[k].probability || 0), 0) || 1;
  for (const k of SCENARIO_KEYS) out[k].probability = (out[k].probability || 0) / tot;
  return out;
}

/**
 * Projects a scenario forward `years` years.
 * Margin glides linearly from latest to target over 5 years; growth uses revenueCagr5 for years 1–5 and revenueCagr10 thereafter.
 */
export function project(metrics, sc, { years = 10, costOfDebt = 0.09 } = {}) {
  const L = metrics.latest || {};
  let revenue = L.revenue ?? 0;
  const m0 = L.ebitdaMargin ?? sc.ebitdaMarginTarget;
  let netDebt = L.netDebt ?? 0;
  let shares = L.sharesOutstanding ?? null;
  let prevNwc = revenue * sc.nwcToRevenue;
  const rows = [];
  for (let t = 1; t <= years; t++) {
    const g = t <= 5 ? sc.revenueCagr5 : sc.revenueCagr10;
    revenue = revenue * (1 + g);
    const margin = t <= 5 ? m0 + ((sc.ebitdaMarginTarget - m0) * t) / 5 : sc.ebitdaMarginTarget;
    const ebitda = revenue * margin;
    const dep = revenue * sc.depToRevenue;
    const ebit = ebitda - dep;
    const interest = Math.max(0, netDebt) * costOfDebt;
    const pbt = ebit - interest;
    const tax = Math.max(0, pbt) * sc.taxRate;
    const pat = pbt - tax;
    const capex = revenue * sc.capexToRevenue;
    const nwc = revenue * sc.nwcToRevenue;
    const dNwc = nwc - prevNwc;
    prevNwc = nwc;
    const fcff = ebit * (1 - sc.taxRate) + dep - capex - dNwc;
    const fcfe = pat + dep - capex - dNwc;
    const dividends = Math.max(0, pat) * sc.payoutRatio;
    netDebt = netDebt - (fcfe - dividends);
    if (isNum(shares)) shares = shares * (1 + (sc.dilutionPerYear || 0));
    rows.push({
      year: t, revenue, growth: g, ebitdaMargin: margin, ebitda, ebit, interest, pat, capex, dNwc, fcff, fcfe, dividends, netDebt,
      eps: isNum(shares) && shares > 0 ? pat / shares : null,
      dps: isNum(shares) && shares > 0 ? dividends / shares : null,
      shares
    });
  }
  return rows;
}

/** Compact projection summary at 3, 5 and 10 years. */
export function projectionSummary(rows) {
  const at = (y) => rows.find((r) => r.year === y) || null;
  const pick = (r) => r && {
    revenue: round(r.revenue, 0), ebitda: round(r.ebitda, 0), ebitdaMargin: round(r.ebitdaMargin, 4), pat: round(r.pat, 0),
    fcff: round(r.fcff, 0), netDebt: round(r.netDebt, 0), eps: round(r.eps, 2), cumulativeCapex: round(rows.filter((x) => x.year <= r.year).reduce((a, x) => a + x.capex, 0), 0)
  };
  return { y3: pick(at(3)), y5: pick(at(5)), y10: pick(at(10)) };
}

export const avgCapexNeed = (rows, n = 5) => mean(lastN(rows.slice(0, n).map((r) => r.capex), n));
