// Data quality: provenance, staleness and completeness. Stale or sample data lowers confidence and is always disclosed.

import { monthsBetween, daysBetween, round, clamp } from './util.js';

export const STALE_LIMITS = { financialsMonths: 15, priceDays: 7, shareholdingMonths: 6, industryMonths: 24 };

export function dataQuality(company, metrics, now = new Date(), macro = null) {
  const issues = [];
  const prov = company.provenance || {};
  const status = company.dataStatus || 'unknown';
  const items = [];
  const add = (section, asOf, limitMonths, source, type) => {
    const age = monthsBetween(asOf, now);
    const stale = age == null ? null : age > limitMonths;
    items.push({ section, asOf: asOf || null, ageMonths: age == null ? null : round(age, 1), stale, source: source || 'unknown', type: type || status });
    if (age == null) issues.push({ severity: 'medium', text: `${section}: reporting date unknown.` });
    else if (stale) issues.push({ severity: 'high', text: `${section} is stale (${age.toFixed(0)} months old; limit ${limitMonths}).` });
  };
  add('Financial statements', prov.financials?.asOf || company.financials?.asOf, STALE_LIMITS.financialsMonths, prov.financials?.source || company.financials?.source, prov.financials?.type);
  const priceAgeDays = daysBetween(company.market?.priceDate, now);
  items.push({ section: 'Market price', asOf: company.market?.priceDate || null, ageMonths: priceAgeDays == null ? null : round(priceAgeDays / 30.44, 2), stale: priceAgeDays == null ? null : priceAgeDays > STALE_LIMITS.priceDays, source: company.market?.source || 'unknown', type: company.market?.type || status });
  if (priceAgeDays == null) issues.push({ severity: 'high', text: 'Market price date unknown.' });
  else if (priceAgeDays > STALE_LIMITS.priceDays) issues.push({ severity: 'high', text: `Market price is ${priceAgeDays.toFixed(0)} days old — valuation conclusions may not reflect today's price.` });
  const sh = company.shareholding || [];
  add('Shareholding pattern', sh.length ? sh[sh.length - 1].date : null, STALE_LIMITS.shareholdingMonths, prov.shareholding?.source, prov.shareholding?.type);
  add('Industry data', prov.industry?.asOf, STALE_LIMITS.industryMonths, prov.industry?.source, prov.industry?.type);

  if (status === 'sample') issues.unshift({ severity: 'critical', text: 'ILLUSTRATIVE SAMPLE DATA — fictional company. Not real-time and not a real security. Outputs demonstrate the workflow only.' });
  const coverage = metrics?.dataCoverage?.score ?? 0;
  if (metrics?.dataCoverage?.missingRequired?.length) issues.push({ severity: 'medium', text: `Missing required line items: ${metrics.dataCoverage.missingRequired.join(', ')}.` });
  const contradictions = (company.contradictions || []).map((c) => ({ severity: 'medium', text: `Contradiction: ${c}` }));
  issues.push(...contradictions);

  if (macro) {
    const d = macro.dataset;
    items.push({ section: 'Macro factors', asOf: null, ageMonths: null, stale: d.available ? d.stale > 0 : null, source: `${d.live} live · ${d.available - d.live - d.sample} manual · ${d.sample} sample of ${d.total}`, type: d.status });
    if (!d.available) issues.push({ severity: 'medium', text: 'No macro dataset loaded — national/international factors not considered.' });
    else {
      if (d.sample) issues.push({ severity: 'medium', text: `${d.sample} macro readings are illustrative sample values — connect the live feed or update them before relying on the macro overlay.` });
      if (d.stale) issues.push({ severity: 'medium', text: `${d.stale} macro readings are stale.` });
    }
  }
  const staleCount = items.filter((i) => i.stale && i.section !== 'Macro factors').length;
  const unknown = items.filter((i) => i.stale == null).length;
  let confidence = coverage * 0.6 + 0.4;
  confidence -= staleCount * 0.12 + unknown * 0.05;
  if (status === 'sample') confidence = Math.min(confidence, 0.6);
  return { status, items, issues, coverage, confidence: round(clamp(confidence, 0, 1), 2), staleCount };
}
