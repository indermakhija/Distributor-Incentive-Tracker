// Financial statement analytics: growth, profitability, balance sheet, cash flow.
// Input: company.financials ({ years, income, balance, cashflow }). All values in one unit (₹ Cr by default).

import { isNum, safeDiv, seriesCagr, yoy, mean, stdev, last, lastN, sum, zip, round } from './util.js';

const series = (obj, key, n) => {
  const s = obj?.[key];
  return Array.isArray(s) && s.length === n ? s.map((v) => (isNum(v) ? v : null)) : Array(n).fill(null);
};

/** Normalises raw statements: fills derivable lines (EBIT, PBT, FCF...) and returns aligned arrays. */
export function normalise(fin) {
  const years = fin?.years || [];
  const n = years.length;
  const I = fin?.income || {};
  const B = fin?.balance || {};
  const C = fin?.cashflow || {};
  const s = {
    revenue: series(I, 'revenue', n),
    cogs: series(I, 'cogs', n),
    ebitda: series(I, 'ebitda', n),
    depreciation: series(I, 'depreciation', n),
    ebit: series(I, 'ebit', n),
    interest: series(I, 'interest', n),
    otherIncome: series(I, 'otherIncome', n),
    exceptional: series(I, 'exceptional', n),
    pbt: series(I, 'pbt', n),
    tax: series(I, 'tax', n),
    pat: series(I, 'pat', n),
    eps: series(I, 'eps', n),
    dps: series(I, 'dps', n),
    equity: series(B, 'equity', n),
    totalDebt: series(B, 'totalDebt', n),
    cash: series(B, 'cash', n),
    receivables: series(B, 'receivables', n),
    inventory: series(B, 'inventory', n),
    payables: series(B, 'payables', n),
    totalAssets: series(B, 'totalAssets', n),
    netFixedAssets: series(B, 'netFixedAssets', n),
    goodwill: series(B, 'goodwill', n),
    contingentLiabilities: series(B, 'contingentLiabilities', n),
    leaseLiabilities: series(B, 'leaseLiabilities', n),
    sharesOutstanding: series(B, 'sharesOutstanding', n),
    cfo: series(C, 'cfo', n),
    capex: series(C, 'capex', n),
    dividendsPaid: series(C, 'dividendsPaid', n),
    acquisitions: series(C, 'acquisitions', n),
    equityIssued: series(C, 'equityIssued', n)
  };
  // Derivations (only where the reported line is missing).
  for (let i = 0; i < n; i++) {
    if (!isNum(s.ebit[i]) && isNum(s.ebitda[i]) && isNum(s.depreciation[i])) s.ebit[i] = s.ebitda[i] - s.depreciation[i];
    if (!isNum(s.ebitda[i]) && isNum(s.ebit[i]) && isNum(s.depreciation[i])) s.ebitda[i] = s.ebit[i] + s.depreciation[i];
    if (!isNum(s.pbt[i]) && isNum(s.ebit[i]) && isNum(s.interest[i]))
      s.pbt[i] = s.ebit[i] - s.interest[i] + (s.otherIncome[i] || 0) + (s.exceptional[i] || 0);
    if (!isNum(s.pat[i]) && isNum(s.pbt[i]) && isNum(s.tax[i])) s.pat[i] = s.pbt[i] - s.tax[i];
    if (!isNum(s.eps[i]) && isNum(s.pat[i]) && isNum(s.sharesOutstanding[i]) && s.sharesOutstanding[i] > 0)
      s.eps[i] = s.pat[i] / s.sharesOutstanding[i];
  }
  s.fcf = zip(s.cfo, s.capex, (a, b) => (isNum(a) && isNum(b) ? a - Math.abs(b) : null));
  s.netDebt = zip(s.totalDebt, s.cash, (d, c) => (isNum(d) ? d - (c || 0) : null));
  s.capitalEmployed = zip(s.equity, s.totalDebt, (e, d) => (isNum(e) ? e + (d || 0) : null));
  s.investedCapital = s.capitalEmployed.map((ce, i) => (isNum(ce) ? ce - (s.cash[i] || 0) : null));
  return { years, n, s };
}

const avgPair = (arr, i) => (i > 0 && isNum(arr[i - 1]) && isNum(arr[i]) ? (arr[i - 1] + arr[i]) / 2 : arr[i]);

/** Computes the full metric set. Every output here is a "calculated" metric. */
export function computeMetrics(fin, opts = {}) {
  const { years, n, s } = normalise(fin);
  const taxRate = opts.taxRate ?? 0.25;
  const m = { years, n, series: s };
  if (!n) return { ...m, empty: true };

  const margin = (num) => zip(num, s.revenue, (a, r) => safeDiv(a, r));
  m.grossMargin = zip(s.revenue, s.cogs, (r, c) => (isNum(r) && isNum(c) && r ? (r - c) / r : null));
  m.ebitdaMargin = margin(s.ebitda);
  m.ebitMargin = margin(s.ebit);
  m.patMargin = margin(s.pat);
  m.effectiveTaxRate = zip(s.tax, s.pbt, (t, p) => (p > 0 ? safeDiv(t, p) : null));

  m.roe = s.pat.map((p, i) => safeDiv(p, avgPair(s.equity, i)));
  m.roce = s.ebit.map((e, i) => safeDiv(e, avgPair(s.capitalEmployed, i)));
  m.roic = s.ebit.map((e, i) => {
    const ic = avgPair(s.investedCapital, i);
    return isNum(e) && isNum(ic) && ic > 0 ? (e * (1 - taxRate)) / ic : null;
  });
  m.assetTurnover = s.revenue.map((r, i) => safeDiv(r, avgPair(s.totalAssets, i)));

  m.debtToEquity = zip(s.totalDebt, s.equity, safeDiv);
  m.netDebtToEbitda = zip(s.netDebt, s.ebitda, (nd, e) => (isNum(e) && e > 0 ? nd / e : null));
  m.interestCoverage = zip(s.ebit, s.interest, (e, i) => (isNum(i) && i > 0 ? e / i : isNum(e) ? Infinity : null));

  m.receivableDays = zip(s.receivables, s.revenue, (a, r) => (r ? (a / r) * 365 : null));
  m.inventoryDays = s.inventory.map((inv, i) => {
    const base = isNum(s.cogs[i]) ? s.cogs[i] : s.revenue[i];
    return isNum(inv) && base ? (inv / base) * 365 : null;
  });
  m.payableDays = s.payables.map((p, i) => {
    const base = isNum(s.cogs[i]) ? s.cogs[i] : s.revenue[i];
    return isNum(p) && base ? (p / base) * 365 : null;
  });
  m.cashConversionCycle = m.receivableDays.map((r, i) =>
    isNum(r) && isNum(m.inventoryDays[i]) && isNum(m.payableDays[i]) ? r + m.inventoryDays[i] - m.payableDays[i] : null
  );
  m.nwc = s.receivables.map((r, i) =>
    isNum(r) || isNum(s.inventory[i]) ? (r || 0) + (s.inventory[i] || 0) - (s.payables[i] || 0) : null
  );
  m.nwcToRevenue = zip(m.nwc, s.revenue, safeDiv);
  m.cfoToPat = zip(s.cfo, s.pat, (c, p) => (p > 0 ? c / p : null));
  m.fcfToPat = zip(s.fcf, s.pat, (f, p) => (p > 0 ? f / p : null));
  m.capexToRevenue = zip(s.capex, s.revenue, (c, r) => safeDiv(Math.abs(c ?? NaN), r));
  m.depToRevenue = zip(s.depreciation, s.revenue, safeDiv);
  m.payoutRatio = zip(s.dividendsPaid, s.pat, (d, p) => (p > 0 && isNum(d) ? Math.abs(d) / p : null));
  m.otherIncomeToPbt = zip(s.otherIncome, s.pbt, (o, p) => (p > 0 ? safeDiv(o, p) : null));

  // Incremental ROCE: change in EBIT / change in capital employed over trailing 3 years.
  const k = Math.min(3, n - 1);
  m.incrementalRoce =
    k > 0 && isNum(last(s.ebit)) && isNum(s.ebit[n - 1 - k]) && isNum(last(s.capitalEmployed)) && isNum(s.capitalEmployed[n - 1 - k])
      ? safeDiv(last(s.ebit) - s.ebit[n - 1 - k], last(s.capitalEmployed) - s.capitalEmployed[n - 1 - k])
      : null;

  m.growth = {
    revenueYoY: yoy(s.revenue),
    patYoY: yoy(s.pat),
    revenue3y: seriesCagr(s.revenue, 3),
    revenue5y: seriesCagr(s.revenue, 5),
    revenue10y: n > 10 ? seriesCagr(s.revenue, 10) : null,
    ebitda3y: seriesCagr(s.ebitda, 3),
    ebitda5y: seriesCagr(s.ebitda, 5),
    ebit5y: seriesCagr(s.ebit, 5),
    pat3y: seriesCagr(s.pat, 3),
    pat5y: seriesCagr(s.pat, 5),
    eps5y: seriesCagr(s.eps, 5),
    cfo5y: seriesCagr(s.cfo, 5),
    fcf5y: seriesCagr(s.fcf, 5),
    receivables3y: seriesCagr(s.receivables, 3),
    inventory3y: seriesCagr(s.inventory, 3)
  };
  const acq = sum(lastN(s.acquisitions, 5).map((a) => Math.abs(a ?? 0)));
  const revAdded = isNum(last(s.revenue)) && isNum(s.revenue[Math.max(0, n - 6)]) ? last(s.revenue) - s.revenue[Math.max(0, n - 6)] : null;
  m.growth.acquisitionSpend5y = acq;
  m.growth.acquisitionIntensity = isNum(revAdded) && revAdded > 0 ? acq / revAdded : null;

  // Summary (latest / trailing averages).
  const L = (arr) => last(arr);
  const avg5 = (arr) => mean(lastN(arr, 5));
  m.latest = {
    year: L(years),
    revenue: L(s.revenue),
    ebitda: L(s.ebitda),
    ebit: L(s.ebit),
    pat: L(s.pat),
    eps: L(s.eps),
    dps: L(s.dps),
    cfo: L(s.cfo),
    fcf: L(s.fcf),
    netDebt: L(s.netDebt),
    totalDebt: L(s.totalDebt),
    cash: L(s.cash),
    equity: L(s.equity),
    sharesOutstanding: L(s.sharesOutstanding),
    ebitdaMargin: L(m.ebitdaMargin),
    ebitMargin: L(m.ebitMargin),
    patMargin: L(m.patMargin),
    grossMargin: L(m.grossMargin),
    roe: L(m.roe),
    roce: L(m.roce),
    roic: L(m.roic),
    debtToEquity: L(m.debtToEquity),
    netDebtToEbitda: L(m.netDebtToEbitda),
    interestCoverage: L(m.interestCoverage),
    cashConversionCycle: L(m.cashConversionCycle),
    nwcToRevenue: L(m.nwcToRevenue),
    capexToRevenue: L(m.capexToRevenue),
    depToRevenue: L(m.depToRevenue),
    effectiveTaxRate: L(m.effectiveTaxRate),
    payoutRatio: L(m.payoutRatio),
    contingentLiabilities: L(s.contingentLiabilities),
    leaseLiabilities: L(s.leaseLiabilities),
    goodwill: L(s.goodwill)
  };
  m.avg5 = {
    ebitdaMargin: avg5(m.ebitdaMargin),
    ebitMargin: avg5(m.ebitMargin),
    roce: avg5(m.roce),
    roe: avg5(m.roe),
    roic: avg5(m.roic),
    cfoToPat: safeDiv(sum(lastN(s.cfo, 5)), sum(lastN(s.pat, 5))),
    fcfToPat: safeDiv(sum(lastN(s.fcf, 5)), sum(lastN(s.pat, 5))),
    capexToRevenue: avg5(m.capexToRevenue),
    nwcToRevenue: avg5(m.nwcToRevenue),
    depToRevenue: avg5(m.depToRevenue),
    effectiveTaxRate: avg5(m.effectiveTaxRate)
  };
  m.stability = {
    revenueGrowthStdev: stdev(m.growth.revenueYoY.filter(isNum)),
    ebitdaMarginStdev: stdev(m.ebitdaMargin),
    patGrowthStdev: stdev(m.growth.patYoY.filter(isNum)),
    worstRevenueYoY: Math.min(...m.growth.revenueYoY.filter(isNum)),
    negativePatYears: s.pat.filter((p) => isNum(p) && p < 0).length,
    negativeCfoYears: s.cfo.filter((c) => isNum(c) && c < 0).length,
    negativeFcfYears: s.fcf.filter((f) => isNum(f) && f < 0).length
  };
  if (!Number.isFinite(m.stability.worstRevenueYoY)) m.stability.worstRevenueYoY = null;
  m.dilution = (() => {
    const so = s.sharesOutstanding.filter(isNum);
    return so.length >= 2 ? so[so.length - 1] / so[0] - 1 : null;
  })();
  m.externalFundingYears = s.fcf.filter((f, i) => isNum(f) && f < 0 && ((s.equityIssued[i] || 0) > 0 || (i > 0 && (s.totalDebt[i] || 0) > (s.totalDebt[i - 1] || 0)))).length;
  m.dataCoverage = coverage(s, n);
  return m;
}

const REQUIRED = ['revenue', 'ebitda', 'pat', 'equity', 'totalDebt', 'cash', 'cfo', 'capex'];
const USEFUL = ['cogs', 'depreciation', 'interest', 'otherIncome', 'tax', 'receivables', 'inventory', 'payables', 'totalAssets', 'sharesOutstanding', 'dividendsPaid'];

function coverage(s, n) {
  const missingRequired = REQUIRED.filter((k) => s[k].filter(isNum).length < Math.min(n, 3));
  const missingUseful = USEFUL.filter((k) => s[k].filter(isNum).length < Math.min(n, 3));
  const score = n === 0 ? 0 : Math.max(0, 1 - missingRequired.length * 0.12 - missingUseful.length * 0.03) * Math.min(1, n / 5);
  return { years: n, missingRequired, missingUseful, score: round(score, 2) };
}

export const LINE_ITEMS = { REQUIRED, USEFUL };
