// Valuation laboratory: multiples, DCF, reverse DCF, comparables, historical bands, normalised earnings,
// P/B-ROE, NAV, DDM and SOTP. Method weights depend on business type so DCF is not forced onto unsuitable businesses.

import { isNum, safeDiv, median, round, clamp, bisect, mean } from './util.js';
import { project, resolveScenarios, SCENARIO_KEYS } from './scenarios.js';

export const DEFAULT_RATES = { riskFree: 0.068, equityRiskPremium: 0.06, terminalGrowth: 0.05, costOfDebt: 0.09, requiredMarginOfSafety: 0.2, indexExpectedReturn: 0.11, fixedIncomeReturn: 0.07 };

export const METHOD_WEIGHTS = {
  compounder: { dcf: 0.5, historical: 0.2, comparables: 0.2, ddm: 0.1 },
  growth: { dcf: 0.6, comparables: 0.3, historical: 0.1 },
  cyclical: { normalized: 0.5, comparables: 0.2, historical: 0.15, nav: 0.1, dcf: 0.05 },
  financial: { pbroe: 0.5, comparables: 0.3, historical: 0.2 },
  asset_heavy: { nav: 0.5, sotp: 0.2, comparables: 0.15, dcf: 0.15 },
  turnaround: { comparables: 0.4, dcf: 0.3, normalized: 0.3 },
  conglomerate: { sotp: 0.6, dcf: 0.2, comparables: 0.2 }
};

export const METHOD_LABELS = {
  dcf: 'Discounted cash flow (FCFF)', historical: 'Historical P/E band', comparables: 'Peer multiples', ddm: 'Dividend discount',
  normalized: 'Normalised (through-cycle) earnings', pbroe: 'P/B–ROE (justified book multiple)', nav: 'Net asset value / replacement cost', sotp: 'Sum of the parts'
};

export function costOfCapital(company, rates) {
  const vi = company.valuationInputs || {};
  const beta = vi.beta ?? 1;
  const ke = vi.costOfEquity ?? rates.riskFree + beta * rates.equityRiskPremium;
  return { ke, wacc: vi.wacc ?? ke * 0.85 + rates.costOfDebt * (1 - 0.25) * 0.15, beta, g: vi.terminalGrowth ?? rates.terminalGrowth };
}

export function currentMultiples(company, metrics) {
  const L = metrics.latest || {};
  const price = company.market?.price;
  const shares = company.market?.sharesOutstanding ?? L.sharesOutstanding;
  if (!isNum(price) || !isNum(shares)) return { available: false };
  const mcap = price * shares;
  const ev = mcap + (L.netDebt ?? 0);
  const pe = L.eps > 0 ? price / L.eps : null;
  const epsG = metrics.growth?.eps5y ?? metrics.growth?.pat5y;
  return {
    available: true, price, shares, marketCap: mcap, enterpriseValue: ev, pe,
    evEbitda: L.ebitda > 0 ? ev / L.ebitda : null,
    pb: L.equity > 0 ? mcap / L.equity : null,
    ps: L.revenue > 0 ? mcap / L.revenue : null,
    pfcf: L.fcf > 0 ? mcap / L.fcf : null,
    dividendYield: isNum(L.dps) ? L.dps / price : null,
    fcfYield: isNum(L.fcf) ? L.fcf / mcap : null,
    earningsYield: isNum(L.pat) ? L.pat / mcap : null,
    peg: pe && epsG > 0 ? pe / (epsG * 100) : null,
    pegNote: 'PEG divides P/E by historical EPS growth; it ignores balance-sheet risk, capital intensity and the durability of growth.',
    bvps: L.equity > 0 ? L.equity / shares : null
  };
}

function dcfValue(metrics, sc, { wacc, g, costOfDebt }, shares) {
  const rows = project(metrics, sc, { years: 10, costOfDebt });
  if (!(wacc > g)) return null;
  let pv = 0;
  rows.forEach((r, i) => { pv += r.fcff / (1 + wacc) ** (i + 1); });
  const lastR = rows[rows.length - 1];
  // Terminal value uses value-driver form: FCFF = NOPAT × (1 − g / RONIC), so reinvestment matches terminal growth
  // rather than year-10 growth. RONIC is floored at WACC (new investment creates no excess value by default).
  const ronic = Math.max(wacc, Math.min(metrics.avg5?.roic ?? wacc, 0.3));
  const nopat = lastR.ebit * (1 - sc.taxRate);
  const terminalFcff = nopat * (1 + g) * (1 - g / ronic);
  const tv = terminalFcff / (wacc - g);
  const pvTv = tv / (1 + wacc) ** rows.length;
  const ev = pv + pvTv;
  const equity = ev - (metrics.latest.netDebt ?? 0);
  return { perShare: equity / shares, ev, pvExplicit: pv, pvTerminal: pvTv, terminalShare: pvTv / ev, terminalFcff, ronic, rows };
}

/** All method values for one scenario. Returns { method: {value, note, suitable} }. */
function methodValues(company, metrics, sc, scKey, ctx) {
  const { shares, coc, rates, mult } = ctx;
  const L = metrics.latest;
  const vi = company.valuationInputs || {};
  const out = {};
  const rows = project(metrics, sc, { years: 10, costOfDebt: rates.costOfDebt });
  const fwdEps = rows[0]?.eps;
  const pePick = (lo, med, hi) => (scKey === 'bear' ? lo : scKey === 'bull' ? hi : med);

  // DCF
  const d = dcfValue(metrics, sc, { wacc: coc.wacc, g: coc.g, costOfDebt: rates.costOfDebt }, shares);
  if (d && d.terminalFcff > 0) out.dcf = { value: d.perShare, note: `WACC ${(coc.wacc * 100).toFixed(1)}%, g ${(coc.g * 100).toFixed(1)}%, terminal value ${(d.terminalShare * 100).toFixed(0)}% of EV`, detail: d };
  else out.dcf = { value: null, note: 'Projected free cash flow is negative in the terminal year — DCF not meaningful.' };

  // Historical P/E band
  const h = vi.historicalPE;
  if (h && isNum(fwdEps) && fwdEps > 0) out.historical = { value: fwdEps * pePick(h.min, h.median, h.max), note: `Forward EPS ₹${fwdEps.toFixed(1)} × historical P/E ${pePick(h.min, h.median, h.max)}x` };

  // Peer multiples
  const peers = (company.competitors || []).filter((p) => !p.isSelf);
  const pPE = median(peers.map((p) => p.pe).filter((v) => v > 0));
  const pEV = median(peers.map((p) => p.evEbitda).filter((v) => v > 0));
  const comps = [];
  const adj = scKey === 'bear' ? 0.8 : scKey === 'bull' ? 1.15 : 1;
  if (pPE && fwdEps > 0) comps.push(fwdEps * pPE * adj);
  if (pEV && rows[0]?.ebitda > 0) comps.push((rows[0].ebitda * pEV * adj - (L.netDebt ?? 0)) / shares);
  if (comps.length) out.comparables = { value: mean(comps), note: `Peer median P/E ${pPE ? pPE.toFixed(1) + 'x' : 'n/a'}, EV/EBITDA ${pEV ? pEV.toFixed(1) + 'x' : 'n/a'} (×${adj} for scenario)` };

  // DDM (Gordon on forward DPS)
  const dps1 = rows[0]?.dps;
  if (isNum(dps1) && dps1 > 0 && sc.payoutRatio >= 0.4 && coc.ke > coc.g)
    out.ddm = { value: dps1 / (coc.ke - coc.g), note: `Forward DPS ₹${dps1.toFixed(2)} / (Ke ${(coc.ke * 100).toFixed(1)}% − g ${(coc.g * 100).toFixed(1)}%)` };

  // Normalised earnings (cyclicals)
  const normMargin = metrics.avg5?.ebitMargin;
  const midPE = h?.median ?? pPE;
  if (isNum(normMargin) && isNum(L.revenue) && midPE) {
    const normPat = (L.revenue * normMargin - Math.max(0, L.netDebt ?? 0) * rates.costOfDebt) * (1 - sc.taxRate);
    const mult = scKey === 'bear' ? (h?.min ?? midPE * 0.75) : scKey === 'bull' ? (h?.max ?? midPE * 1.2) : midPE;
    out.normalized = { value: (normPat / shares) * mult, note: `Through-cycle EBIT margin ${(normMargin * 100).toFixed(1)}% on current revenue × ${mult.toFixed(1)}x` };
  }

  // P/B–ROE
  const roe = metrics.avg5?.roe;
  if (isNum(roe) && mult.bvps > 0 && coc.ke > coc.g) {
    const r = scKey === 'bear' ? roe - 0.03 : scKey === 'bull' ? roe + 0.02 : roe;
    const pb = Math.max(0.3, (r - coc.g) / (coc.ke - coc.g));
    out.pbroe = { value: mult.bvps * pb, note: `Justified P/B ${pb.toFixed(2)}x from ROE ${(r * 100).toFixed(1)}%` };
  }

  // NAV / replacement cost (analyst-supplied)
  if (isNum(vi.navPerShare)) {
    const f = scKey === 'bear' ? 0.75 : scKey === 'bull' ? 1.1 : 0.9;
    out.nav = { value: vi.navPerShare * f, note: `Supplied NAV ₹${vi.navPerShare} × ${f} (${scKey === 'base' ? 'holding-company/realisation discount' : scKey + ' realisation'})` };
  }

  // SOTP
  const segs = (company.segments || []).filter((s) => isNum(s.ebitda) && isNum(s.evEbitdaMultiple));
  if (segs.length >= 2) {
    const f = scKey === 'bear' ? 0.8 : scKey === 'bull' ? 1.15 : 1;
    const ev = segs.reduce((a, s) => a + s.ebitda * s.evEbitdaMultiple * f, 0);
    out.sotp = { value: (ev - (L.netDebt ?? 0)) / shares, note: segs.map((s) => `${s.name} ${s.evEbitdaMultiple}x`).join(', ') };
  }
  return out;
}

export function valuation(company, metrics, settings = {}) {
  const rates = { ...DEFAULT_RATES, ...(settings.rates || {}) };
  const mult = currentMultiples(company, metrics);
  const shares = company.market?.sharesOutstanding ?? metrics.latest?.sharesOutstanding;
  const price = company.market?.price;
  const result = { multiples: mult, rates, warnings: [] };
  if (!isNum(shares) || !isNum(price) || metrics.empty) {
    result.status = 'too_uncertain';
    result.warnings.push('Price, share count or financial statements missing — valuation not possible.');
    return result;
  }
  const coc = costOfCapital(company, rates);
  const type = company.businessType || 'compounder';
  const weights = METHOD_WEIGHTS[type] || METHOD_WEIGHTS.compounder;
  const scenarios = resolveScenarios(company, metrics);
  const ctx = { shares, coc, rates, mult };
  result.coc = coc;
  result.businessType = type;
  result.methodWeights = weights;
  result.scenarios = {};
  if (type === 'financial') result.warnings.push('DCF on free cash flow is not used for lenders/insurers — book-value and earnings methods apply.');

  // The method set is fixed by the base case so bear/base/bull are comparable; a method that turns negative in a
  // scenario counts as zero equity value rather than silently dropping out.
  const allMv = Object.fromEntries(SCENARIO_KEYS.map((k) => [k, methodValues(company, metrics, scenarios[k], k, ctx)]));
  const baseUsed = Object.keys(weights).filter((meth) => isNum(allMv.base[meth]?.value) && allMv.base[meth].value > 0);
  for (const k of SCENARIO_KEYS) {
    const sc = scenarios[k];
    const mv = allMv[k];
    let wsum = 0, vsum = 0;
    const used = [];
    for (const meth of baseUsed) {
      const v = mv[meth]?.value;
      if (isNum(v)) { wsum += weights[meth]; vsum += weights[meth] * Math.max(0, v); used.push(meth); }
    }
    const rows = project(metrics, sc, { years: 10, costOfDebt: rates.costOfDebt });
    result.scenarios[k] = {
      assumptions: sc,
      methods: mv,
      methodsUsed: used,
      intrinsicValue: wsum > 0 ? vsum / wsum : null,
      weightCoverage: round(wsum, 2),
      projection: rows,
      expectedReturn3y: expectedReturn(rows, price, sc.exitPE, 3),
      expectedReturn5y: expectedReturn(rows, price, sc.exitPE, 5)
    };
  }
  const iv = (k) => result.scenarios[k].intrinsicValue;
  const base = iv('base'), bear = iv('bear'), bull = iv('bull');
  result.intrinsic = { bear, base, bull, probabilityWeighted: SCENARIO_KEYS.reduce((a, k) => a + (iv(k) || 0) * scenarios[k].probability, 0) };
  result.price = price;
  result.marginOfSafety = isNum(base) ? (base - price) / base : null;
  result.premiumDiscount = isNum(base) ? price / base - 1 : null;
  result.downsideToBear = isNum(bear) ? bear / price - 1 : null;
  result.upsideToBull = isNum(bull) ? bull / price - 1 : null;
  result.uncertainty = isNum(base) && base > 0 && isNum(bear) && isNum(bull) ? (bull - bear) / base : null;
  result.hurdle = rates.riskFree + rates.equityRiskPremium;
  result.benchmark = { index: rates.indexExpectedReturn, riskFree: rates.riskFree, fixedIncome: rates.fixedIncomeReturn };
  result.reverseDcf = reverseDcf(metrics, scenarios.base, coc, rates, shares, price);
  result.sensitivity = sensitivity(metrics, scenarios.base, coc, rates, shares, price);
  result.dividendContribution5y = (() => {
    const r = result.scenarios.base.projection.slice(0, 5);
    const d = r.reduce((a, x) => a + (x.dps || 0), 0);
    return isNum(d) ? d / price : null;
  })();
  result.dilutionImpact = metrics.dilution;

  const reqMoS = settings.requiredMarginOfSafety ?? rates.requiredMarginOfSafety;
  result.requiredMarginOfSafety = reqMoS;
  result.entryPrice = isNum(base) ? base * (1 - reqMoS) : null;
  result.entryRange = isNum(base) && isNum(bear) ? { low: Math.min(bear, base * (1 - reqMoS - 0.1)), high: base * (1 - reqMoS) } : null;
  result.status = valuationStatus(result);
  return result;
}

export function valuationStatus(v) {
  if (!isNum(v.intrinsic?.base) || v.intrinsic.base <= 0) return 'too_uncertain';
  if (isNum(v.uncertainty) && v.uncertainty > 1.8) return 'too_uncertain';
  const mos = v.marginOfSafety;
  if (mos >= v.requiredMarginOfSafety) return 'attractive';
  if (mos >= 0) return 'attractive_below';
  if (mos >= -0.15) return 'fair';
  return 'overvalued';
}

export const VALUATION_STATUS_LABEL = {
  attractive: 'Attractive at current price', attractive_below: 'Attractive only below entry price', fair: 'Fairly valued', overvalued: 'Overvalued', too_uncertain: 'Too uncertain to value reliably'
};

/** Annualised total return from buying today, exiting at exitPE × EPS(N) and collecting dividends. */
export function expectedReturn(rows, price, exitPE, years) {
  const r = rows[years - 1];
  if (!r || !isNum(r.eps) || r.eps <= 0 || !isNum(exitPE) || !isNum(price) || price <= 0) return null;
  const exit = Math.max(0, r.eps * exitPE);
  const divs = rows.slice(0, years).reduce((a, x) => a + (x.dps || 0), 0);
  const total = exit + divs;
  if (total <= 0) return -1;
  return (total / price) ** (1 / years) - 1;
}

/** Solves for the 10-year revenue growth the market price implies, holding base-case margins and reinvestment. */
export function reverseDcf(metrics, baseSc, coc, rates, shares, price) {
  const f = (g) => {
    const sc = { ...baseSc, revenueCagr5: g, revenueCagr10: g };
    const d = dcfValue(metrics, sc, { wacc: coc.wacc, g: coc.g, costOfDebt: rates.costOfDebt }, shares);
    return d ? d.perShare - price : null;
  };
  const g = bisect(f, -0.2, 0.6, 1e-4);
  return {
    impliedRevenueCagr10y: g,
    baseCaseCagr: baseSc.revenueCagr5,
    historicalCagr5y: metrics.growth?.revenue5y,
    interpretation: g == null ? 'The price cannot be reconciled with the base-case margin structure within −20%…60% growth.'
      : `At the current price the market is pricing ~${(g * 100).toFixed(1)}% annual revenue growth for 10 years at base-case margins.`
  };
}

export function sensitivity(metrics, baseSc, coc, rates, shares, price) {
  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => round(coc.wacc + d, 4));
  const gs = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => round(coc.g + d, 4));
  const waccG = waccs.map((w) => gs.map((g) => {
    const d = dcfValue(metrics, baseSc, { wacc: w, g, costOfDebt: rates.costOfDebt }, shares);
    return d && w > g ? round(d.perShare, 0) : null;
  }));
  const growths = [-0.04, -0.02, 0, 0.02, 0.04].map((d) => round(baseSc.revenueCagr5 + d, 4));
  const margins = [-0.03, -0.015, 0, 0.015, 0.03].map((d) => round(baseSc.ebitdaMarginTarget + d, 4));
  const growthMargin = growths.map((g) => margins.map((m) => {
    const d = dcfValue(metrics, { ...baseSc, revenueCagr5: g, revenueCagr10: Math.max(0.03, g * 0.6), ebitdaMarginTarget: m }, { wacc: coc.wacc, g: coc.g, costOfDebt: rates.costOfDebt }, shares);
    return d ? round(d.perShare, 0) : null;
  }));
  return { waccG: { rows: waccs, cols: gs, values: waccG, price }, growthMargin: { rows: growths, cols: margins, values: growthMargin, price } };
}

export { clamp, safeDiv };
