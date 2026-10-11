// Accounting-quality and forensic checks.
// Each flag is classified as:
//   'confirmed' — a disclosed fact (e.g. auditor qualification recorded in filings)
//   'warning'   — a statistical signal that needs investigation, NOT proof of wrongdoing.

import { isNum, safeDiv, sum, lastN, last, mean, clamp, round, pct } from './util.js';

const flag = (id, title, kind, severity, detail, evidence, penalty) => ({ id, title, kind, severity, detail, evidence, penalty });

export function runForensics(company, metrics) {
  const flags = [];
  const s = metrics?.series;
  const n = metrics?.n || 0;
  const mgmt = company.management || {};
  const share = company.shareholding || [];

  if (s && n >= 3) {
    // 1. Profit without cash.
    const cfoPat = metrics.avg5.cfoToPat;
    if (isNum(cfoPat) && cfoPat < 0.7)
      flags.push(flag('cash-conversion', 'Profit growth not matched by operating cash flow', 'warning', cfoPat < 0.4 ? 'high' : 'medium',
        `Cumulative CFO is only ${pct(cfoPat, 0)} of cumulative PAT over the last ${Math.min(5, n)} years (healthy: >80%).`,
        'Calculated from cash-flow and income statements', cfoPat < 0.4 ? 2 : 1.2));

    // 2. Receivables outgrowing sales.
    const rg = metrics.growth.receivables3y, sg = metrics.growth.revenue3y;
    if (isNum(rg) && isNum(sg) && rg - sg > 0.08)
      flags.push(flag('receivables', 'Receivables rising faster than sales', 'warning', rg - sg > 0.15 ? 'high' : 'medium',
        `Receivables 3y CAGR ${pct(rg)} vs revenue 3y CAGR ${pct(sg)}. Receivable days: ${round(metrics.receivableDays[n - 4] ?? metrics.receivableDays[0], 0)} → ${round(last(metrics.receivableDays), 0)}.`,
        'Calculated from balance sheet', rg - sg > 0.15 ? 1.5 : 0.8));

    // 3. Inventory build-up.
    const ig = metrics.growth.inventory3y;
    if (isNum(ig) && isNum(sg) && ig - sg > 0.08)
      flags.push(flag('inventory', 'Inventory accumulating faster than sales', 'warning', 'medium',
        `Inventory 3y CAGR ${pct(ig)} vs revenue ${pct(sg)}. Possible demand slowdown or obsolescence risk.`, 'Calculated', 0.8));

    // 4. Other income dependence.
    const oi = mean(lastN(metrics.otherIncomeToPbt, 3));
    if (isNum(oi) && oi > 0.2)
      flags.push(flag('other-income', 'High dependence on other income', 'warning', oi > 0.35 ? 'high' : 'medium',
        `Other income averages ${pct(oi, 0)} of PBT over 3 years — core operating profit is weaker than reported PAT suggests.`, 'Calculated', oi > 0.35 ? 1.2 : 0.6));

    // 5. Recurring "exceptional" items.
    const exYears = lastN(s.exceptional, 5).filter((e) => isNum(e) && Math.abs(e) > 0.02 * (last(s.pbt) || 1)).length;
    if (exYears >= 3)
      flags.push(flag('exceptional', 'Frequent exceptional items', 'warning', 'medium',
        `Material exceptional items in ${exYears} of the last 5 years — "one-offs" that recur may be part of normal business.`, 'Calculated', 0.8));

    // 6. Possible capitalisation of expenses / useful-life changes.
    const depRate = s.depreciation.map((d, i) => safeDiv(d, s.netFixedAssets[i]));
    const dr0 = mean(depRate.slice(0, 2)), dr1 = mean(lastN(depRate, 2));
    const capexRising = isNum(last(metrics.capexToRevenue)) && isNum(metrics.capexToRevenue[0]) && last(metrics.capexToRevenue) > metrics.capexToRevenue[0] * 1.3;
    if (isNum(dr0) && isNum(dr1) && dr1 < dr0 * 0.75 && capexRising)
      flags.push(flag('capitalisation', 'Depreciation rate falling while capex rises', 'warning', 'medium',
        `Depreciation / net fixed assets fell from ${pct(dr0)} to ${pct(dr1)} while capex intensity rose. Check for expense capitalisation or useful-life extensions.`, 'Calculated', 0.8));

    // 7. Tax-rate swings.
    const etr = metrics.effectiveTaxRate.filter(isNum);
    let maxSwing = 0;
    for (let i = 1; i < etr.length; i++) maxSwing = Math.max(maxSwing, Math.abs(etr[i] - etr[i - 1]));
    if (maxSwing > 0.1)
      flags.push(flag('tax-rate', 'Unexplained effective tax-rate changes', 'warning', 'low',
        `Effective tax rate moved by up to ${pct(maxSwing, 0)} year-on-year. Confirm the reason in the annual report (regime change, MAT credit, deferred tax).`, 'Calculated', 0.4));

    // 8. Goodwill.
    const gw = safeDiv(last(s.goodwill), last(s.equity));
    if (isNum(gw) && gw > 0.3)
      flags.push(flag('goodwill', 'Large goodwill relative to equity', 'warning', gw > 0.6 ? 'high' : 'medium',
        `Goodwill is ${pct(gw, 0)} of net worth — impairment risk if acquisitions underperform.`, 'Balance sheet', gw > 0.6 ? 1 : 0.5));

    // 9. Large cash alongside large debt.
    const cashA = safeDiv(last(s.cash), last(s.totalAssets)), debtA = safeDiv(last(s.totalDebt), last(s.totalAssets));
    if (isNum(cashA) && isNum(debtA) && cashA > 0.15 && debtA > 0.2)
      flags.push(flag('cash-and-debt', 'High cash and high debt at the same time', 'warning', 'medium',
        `Cash is ${pct(cashA, 0)} of assets while debt is ${pct(debtA, 0)}. Verify cash is unencumbered and accessible (not trapped or pledged).`, 'Balance sheet', 0.8));

    // 10. Contingent liabilities.
    const cl = safeDiv(last(s.contingentLiabilities), last(s.equity));
    if (isNum(cl) && cl > 0.2)
      flags.push(flag('contingent', 'Large contingent liabilities', 'warning', cl > 0.5 ? 'high' : 'medium',
        `Contingent liabilities equal ${pct(cl, 0)} of net worth.`, 'Notes to accounts', cl > 0.5 ? 1 : 0.5));

    // 11. Negative operating cash flow years.
    if (metrics.stability.negativeCfoYears >= 2)
      flags.push(flag('negative-cfo', 'Repeated negative operating cash flow', 'warning', 'high',
        `${metrics.stability.negativeCfoYears} years of negative CFO in the dataset.`, 'Cash-flow statement', 1.2));

    // 12. Repeated reliance on external funding.
    if (metrics.externalFundingYears >= 3)
      flags.push(flag('external-funding', 'Repeated dependence on external funding', 'warning', 'medium',
        `Negative free cash flow funded by new debt or equity in ${metrics.externalFundingYears} years.`, 'Calculated', 0.8));
  }

  // Disclosed facts from governance records.
  for (const ev of mgmt.auditorEvents || []) {
    if (ev.type === 'resignation')
      flags.push(flag('auditor-resign-' + (ev.date || ''), 'Auditor resignation', 'confirmed', 'high',
        `${ev.date || ''}: ${ev.description || 'Statutory auditor resigned before term completion.'}`, ev.source || 'Exchange filing', 2));
    if (ev.type === 'qualification')
      flags.push(flag('auditor-qual-' + (ev.date || ''), 'Qualified audit opinion', 'confirmed', 'high',
        `${ev.date || ''}: ${ev.description || 'Auditor issued a qualified opinion.'}`, ev.source || 'Annual report', 2));
    if (ev.type === 'emphasis')
      flags.push(flag('auditor-eom-' + (ev.date || ''), 'Emphasis of matter / CARO remark', 'confirmed', 'medium',
        `${ev.date || ''}: ${ev.description || ''}`, ev.source || 'Annual report', 0.6));
  }
  if (isNum(mgmt.policyChanges3y) && mgmt.policyChanges3y >= 2)
    flags.push(flag('policy-changes', 'Frequent accounting-policy changes', 'confirmed', 'medium',
      `${mgmt.policyChanges3y} accounting-policy changes disclosed in 3 years.`, 'Annual reports', 0.8));
  const rpt = mgmt.relatedPartyPctRevenue;
  if (isNum(rpt) && rpt > 0.1)
    flags.push(flag('rpt', 'Material related-party transactions', rpt > 0.25 ? 'confirmed' : 'warning', rpt > 0.25 ? 'high' : 'medium',
      `Related-party transactions equal ${pct(rpt, 0)} of revenue.`, 'Related-party note', rpt > 0.25 ? 1.5 : 0.8));
  const latestShare = last(share);
  if (latestShare && isNum(latestShare.pledgedPctOfPromoter) && latestShare.pledgedPctOfPromoter > 0.1)
    flags.push(flag('pledge', 'Promoter share pledging', 'confirmed', latestShare.pledgedPctOfPromoter > 0.5 ? 'high' : 'medium',
      `${pct(latestShare.pledgedPctOfPromoter, 0)} of promoter holding pledged (as of ${latestShare.date}).`, 'Shareholding pattern', latestShare.pledgedPctOfPromoter > 0.5 ? 1.5 : 0.7));
  for (const loan of mgmt.promoterLoans || [])
    flags.push(flag('promoter-loan', 'Loans/advances to promoter entities', 'confirmed', 'high', loan.description, loan.source || 'Filings', 1.2));

  const penalty = sum(flags.map((f) => f.penalty));
  const dataOk = n >= 3;
  const score = dataOk ? round(clamp(10 - penalty, 0, 10), 1) : null;
  return {
    score,
    flags,
    confirmed: flags.filter((f) => f.kind === 'confirmed'),
    warnings: flags.filter((f) => f.kind === 'warning'),
    note: dataOk ? null : 'Fewer than 3 years of statements — statistical forensic checks not run.'
  };
}
