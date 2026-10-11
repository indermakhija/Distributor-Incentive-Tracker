// Module L: holistic scoring engine. Ten dimensions, each 0–10, weighted to 100.
// Every dimension returns score, evidence, positives, negatives, confidence, missing data and monitoring needs.
// Double-counting rule: valuation risk lives only in "valuation"; governance only in "management"; leverage & accounting
// only in "financial". The risk dimension scores the residual risk register excluding those categories.

import { isNum, clamp, mean, round, scale, pct, last } from './util.js';

export const DIMENSIONS = [
  { id: 'business', label: 'Business quality and business model', weight: 12 },
  { id: 'industry', label: 'Industry structure and prospects', weight: 10 },
  { id: 'financial', label: 'Financial strength and cash generation', weight: 12 },
  { id: 'management', label: 'Management and corporate governance', weight: 10 },
  { id: 'moat', label: 'Competitive advantage and moat', weight: 10 },
  { id: 'growth', label: 'Future growth and strategic execution', weight: 12 },
  { id: 'valuation', label: 'Valuation and expected returns', weight: 14 },
  { id: 'risk', label: 'Risk and downside protection', weight: 8 },
  { id: 'investor', label: 'Investor industry knowledge and conviction', weight: 6 },
  { id: 'portfolio', label: 'Portfolio suitability and opportunity cost', weight: 6 }
];
export const DEFAULT_WEIGHTS = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.weight]));
export const SCORED_ELSEWHERE = ['valuation', 'governance', 'accounting', 'financial leverage', 'liquidity'];

export const BUSINESS_QUALITY_ITEMS = [
  ['clarity', 'Business model clarity'], ['revenuePredictability', 'Revenue predictability'], ['earningsPredictability', 'Earnings predictability'],
  ['pricingPower', 'Pricing power'], ['scalability', 'Scalability'], ['capitalEfficiency', 'Capital efficiency'], ['customerLoyalty', 'Customer loyalty'],
  ['cashGeneration', 'Cash generation'], ['resilience', 'Resilience during downturns'], ['durability', 'Long-term business durability']
];
export const MOAT_SOURCES = [
  ['brand', 'Brand strength'], ['distribution', 'Distribution network'], ['cost', 'Cost advantage'], ['scale', 'Economies of scale'], ['network', 'Network effects'],
  ['switching', 'Switching costs'], ['ip', 'Intellectual property'], ['resources', 'Exclusive access to resources'], ['relationships', 'Customer relationships'],
  ['regulatory', 'Regulatory advantages'], ['data', 'Data / technology'], ['manufacturing', 'Manufacturing capability'], ['supplyChain', 'Supply chain'],
  ['leadership', 'Market leadership'], ['trust', 'Reputation and trust']
];
export const PORTER = [['rivalry', 'Competitive rivalry'], ['newEntrants', 'Threat of new entrants'], ['substitutes', 'Threat of substitutes'], ['buyerPower', 'Buyer power'], ['supplierPower', 'Supplier power']];

const dim = (id) => ({ id, label: DIMENSIONS.find((d) => d.id === id).label, score: null, evidence: [], positives: [], negatives: [], missing: [], monitoring: [], confidence: 0.5, components: [] });
const comp = (d, name, score, weight, source, note) => { if (isNum(score)) d.components.push({ name, score: round(score, 1), weight, source, note }); };
const finish = (d) => {
  const c = d.components.filter((x) => isNum(x.score));
  const w = c.reduce((a, x) => a + x.weight, 0);
  d.score = w ? round(c.reduce((a, x) => a + x.score * x.weight, 0) / w, 1) : null;
  if (d.score == null) d.confidence = 0;
  d.confidence = round(clamp(d.confidence, 0, 1), 2);
  return d;
};

// ---------------------------------------------------------------- business
export function scoreBusiness(c, m) {
  const d = dim('business');
  const bq = c.businessQuality || {};
  const judged = BUSINESS_QUALITY_ITEMS.map(([k, label]) => ({ k, label, s: bq[k]?.score, ev: bq[k]?.evidence })).filter((x) => isNum(x.s));
  if (judged.length) comp(d, `Analyst judgment (${judged.length}/10 items)`, mean(judged.map((x) => x.s)), 0.55, 'judgment');
  else d.missing.push('Business-quality judgments (0–10 with evidence) not entered.');
  for (const x of judged) { if (x.s >= 7.5) d.positives.push(`${x.label}: ${x.s}/10 — ${x.ev || 'no evidence recorded'}`); if (x.s <= 4) d.negatives.push(`${x.label}: ${x.s}/10 — ${x.ev || 'no evidence recorded'}`); }
  if (!m.empty) {
    const vol = m.stability.revenueGrowthStdev;
    comp(d, 'Revenue predictability (growth volatility)', isNum(vol) ? scale(vol, 0.25, 0.03) : null, 0.1, 'calculated', isNum(vol) ? `σ of revenue growth ${pct(vol)}` : null);
    const roce = m.avg5.roce;
    comp(d, 'Capital efficiency (5y avg ROCE)', scale(roce, 0.08, 0.3), 0.15, 'calculated', `ROCE ${pct(roce)}`);
    comp(d, 'Cash generation (5y CFO/PAT)', scale(m.avg5.cfoToPat, 0.4, 1.1), 0.1, 'calculated', `CFO/PAT ${pct(m.avg5.cfoToPat, 0)}`);
    const worst = m.stability.worstRevenueYoY;
    comp(d, 'Downturn resilience (worst revenue year)', scale(worst, -0.25, 0.05), 0.1, 'calculated', `Worst year ${pct(worst)}`);
    if (roce > 0.2) d.positives.push(`High return on capital: 5y average ROCE ${pct(roce)}.`);
    if (roce < 0.1) d.negatives.push(`Low return on capital: 5y average ROCE ${pct(roce)}.`);
  }
  const bm = c.businessModel || {};
  if (isNum(bm.customerConcentration) && bm.customerConcentration > 0.4) d.negatives.push(`Customer concentration: top customers are ${pct(bm.customerConcentration, 0)} of revenue.`);
  if (isNum(bm.recurringShare) && bm.recurringShare > 0.6) d.positives.push(`Recurring/repeat revenue ~${pct(bm.recurringShare, 0)}.`);
  d.classification = classifyBusiness(c, m, judged);
  d.confidence = 0.35 + (judged.length / 10) * 0.35 + (m.dataCoverage?.score || 0) * 0.3;
  d.monitoring.push('Track ROCE, CFO/PAT and gross margin every year — the quantitative fingerprints of business quality.');
  return finish(d);
}

export function classifyBusiness(c, m, judged) {
  if (c.businessModel?.classification) return c.businessModel.classification;
  if (m.empty) return 'Unclassified';
  const g = m.growth.revenue5y, roce = m.avg5.roce, vol = m.stability.ebitdaMarginStdev;
  if (isNum(g) && g < 0 && roce < 0.1) return 'Structurally declining business';
  if (c.businessType === 'cyclical' || (isNum(vol) && vol > 0.05)) return 'Cyclical opportunity';
  if (m.stability.negativePatYears >= 2 && isNum(last(m.series.pat)) && last(m.series.pat) > 0) return 'Turnaround';
  if (isNum(g) && g > 0.25 && (roce < 0.1 || m.stability.negativeFcfYears >= 3)) return 'Speculative growth story';
  if (roce > 0.2 && m.avg5.cfoToPat > 0.8 && mean(judged.map((x) => x.s)) >= 7) return 'Exceptional business';
  return 'Average business';
}

// ---------------------------------------------------------------- industry
export function scoreIndustry(c) {
  const d = dim('industry');
  const ind = c.industry || {};
  comp(d, 'Expected 5y industry growth', scale(ind.growth5y, 0, 0.15), 0.3, ind.growthSource || 'external_forecast', isNum(ind.growth5y) ? pct(ind.growth5y) : null);
  if (!isNum(ind.growth5y)) d.missing.push('Industry growth forecast.');
  const p = ind.porter || {};
  const threats = PORTER.map(([k]) => p[k]?.score).filter(isNum);
  if (threats.length) comp(d, "Porter's Five Forces (10 − average threat)", 10 - mean(threats), 0.35, 'judgment');
  else d.missing.push("Porter's Five Forces assessment.");
  for (const [k, label] of PORTER) { const s = p[k]?.score; if (s >= 7) d.negatives.push(`${label} is high (${s}/10): ${p[k].note || ''}`); if (isNum(s) && s <= 3) d.positives.push(`${label} is low (${s}/10): ${p[k].note || ''}`); }
  const life = { emerging: 6, growth: 8.5, mature: 6, decline: 2 }[ind.lifecycle];
  comp(d, `Life-cycle stage (${ind.lifecycle || 'unknown'})`, life, 0.15, 'judgment');
  const pos = { leader: 9, challenger: 7, niche: 7, disruptor: 6.5, commodity: 4, disadvantaged: 2 }[ind.position];
  comp(d, `Company position (${ind.position || 'unknown'})`, pos, 0.2, 'judgment');
  if (ind.structural === 'structural') d.positives.push('Growth is structural (formalisation, penetration, demographics) rather than cyclical.');
  if (ind.structural === 'cyclical') d.negatives.push('Industry growth is primarily cyclical.');
  for (const x of ind.pestle || []) (x.impact === '+' ? d.positives : d.negatives).push(`PESTLE (${x.factor}): ${x.note}`);
  d.confidence = 0.3 + (threats.length / 5) * 0.3 + (isNum(ind.growth5y) ? 0.2 : 0) + (ind.position ? 0.2 : 0);
  d.monitoring.push(...(ind.indicators || ['Industry volume growth', 'Pricing actions by the leader', 'New capacity announcements']));
  return finish(d);
}

// ---------------------------------------------------------------- financial
export function scoreFinancial(c, m, forensic) {
  const d = dim('financial');
  if (m.empty) { d.missing.push('Financial statements.'); d.confidence = 0; return finish(d); }
  const g = m.growth;
  comp(d, 'Revenue growth (5y CAGR)', scale(g.revenue5y ?? g.revenue3y, 0, 0.2), 0.12, 'calculated', pct(g.revenue5y ?? g.revenue3y));
  comp(d, 'Profit growth (5y PAT CAGR)', scale(g.pat5y ?? g.pat3y, 0, 0.22), 0.1, 'calculated', pct(g.pat5y ?? g.pat3y));
  comp(d, 'Profitability (5y ROE)', scale(m.avg5.roe, 0.06, 0.25), 0.12, 'calculated', pct(m.avg5.roe));
  comp(d, 'Margin level (EBITDA)', scale(m.latest.ebitdaMargin, 0.05, 0.3), 0.08, 'calculated', pct(m.latest.ebitdaMargin));
  const nde = m.latest.netDebtToEbitda;
  comp(d, 'Leverage (net debt / EBITDA)', isNum(nde) ? scale(nde, 4, 0) : null, 0.15, 'calculated', isNum(nde) ? `${nde.toFixed(2)}x` : null);
  const ic = m.latest.interestCoverage;
  comp(d, 'Interest coverage', isNum(ic) ? (ic === Infinity ? 10 : scale(ic, 1.5, 10)) : null, 0.1, 'calculated', ic === Infinity ? 'Debt-free' : isNum(ic) ? `${ic.toFixed(1)}x` : null);
  comp(d, 'Cash conversion (5y FCF/PAT)', scale(m.avg5.fcfToPat, 0, 0.9), 0.15, 'calculated', pct(m.avg5.fcfToPat, 0));
  comp(d, 'Accounting quality score', forensic.score, 0.18, 'calculated', `${forensic.flags.length} flags`);
  if (nde > 3) d.negatives.push(`Net debt is ${nde.toFixed(1)}x EBITDA.`);
  if (isNum(nde) && nde < 0) d.positives.push('Net cash balance sheet.');
  if (m.avg5.fcfToPat > 0.8) d.positives.push(`Strong free cash conversion: FCF ${pct(m.avg5.fcfToPat, 0)} of PAT over 5 years.`);
  if (m.avg5.fcfToPat < 0.3) d.negatives.push(`Weak free cash conversion: FCF ${pct(m.avg5.fcfToPat, 0)} of PAT.`);
  for (const f of forensic.flags.filter((x) => x.severity === 'high')) d.negatives.push(`${f.kind === 'confirmed' ? 'Confirmed' : 'Warning'}: ${f.title}`);
  if (m.dilution > 0.1) d.negatives.push(`Share count up ${pct(m.dilution, 0)} over the period (dilution).`);
  d.missing.push(...m.dataCoverage.missingRequired.map((x) => `Line item: ${x}`));
  d.confidence = 0.2 + 0.8 * (m.dataCoverage.score || 0);
  d.monitoring.push('Receivable days, CFO/PAT, net debt/EBITDA each quarter.');
  return finish(d);
}

// ---------------------------------------------------------------- management
export const EVENT_WEIGHTS = { allegation: 0.5, disclosed: 1, regulatory_finding: 2, proven: 3.5 };
export function scoreManagement(c, m, forensic) {
  const d = dim('management');
  const mg = c.management || {};
  const promises = mg.promises || [];
  const assessed = promises.filter((p) => ['met', 'partly', 'missed', 'exceeded'].includes(p.assessment));
  if (assessed.length) {
    const pts = { exceeded: 10, met: 8.5, partly: 5, missed: 1.5 };
    const rate = mean(assessed.map((p) => pts[p.assessment]));
    comp(d, `Credibility tracker (${assessed.length} promises)`, rate, 0.3, 'calculated');
    const missed = assessed.filter((p) => p.assessment === 'missed');
    if (missed.length) d.negatives.push(`Missed ${missed.length} of ${assessed.length} tracked commitments, e.g. "${missed[0].promise}".`);
    if (rate >= 7.5) d.positives.push(`Delivered on most commitments (${assessed.filter((p) => ['met', 'exceeded'].includes(p.assessment)).length}/${assessed.length}).`);
  } else d.missing.push('Management credibility tracker (past promises vs outcomes).');
  const events = (mg.events || []).filter((e) => !e.resolved);
  const evPenalty = events.reduce((a, e) => a + (EVENT_WEIGHTS[e.type] ?? 0.5) * (e.severity === 'high' ? 1.5 : 1), 0);
  comp(d, 'Governance record (allegations, findings, misconduct)', clamp(10 - evPenalty * 1.5, 0, 10), 0.25, 'reported');
  for (const e of events) d.negatives.push(`${e.type.replace('_', ' ')}: ${e.description} (${e.date || 'undated'}; source: ${e.source || 'n/a'})`);
  const sh = c.shareholding || [];
  if (sh.length >= 2) {
    const ch = last(sh).promoter - sh[0].promoter;
    const pledge = last(sh).pledgedPctOfPromoter || 0;
    comp(d, 'Promoter holding trend & pledging', clamp(7 + ch * 40 - pledge * 10, 0, 10), 0.15, 'reported', `Δ promoter ${pct(ch)}, pledged ${pct(pledge, 0)}`);
    if (ch < -0.05) d.negatives.push(`Promoter stake fell ${pct(-ch)} over the period.`);
    if (pledge > 0.2) d.negatives.push(`${pct(pledge, 0)} of promoter shares pledged.`);
  }
  if (!m.empty) {
    const ca = clamp(scale(m.incrementalRoce ?? m.avg5.roce, 0.05, 0.3) - (m.dilution > 0.1 ? 2 : 0) - (m.growth.acquisitionIntensity > 0.5 && m.incrementalRoce < 0.12 ? 2 : 0), 0, 10);
    comp(d, 'Capital allocation (incremental ROCE, dilution, M&A)', ca, 0.15, 'calculated', `Incremental ROCE ${pct(m.incrementalRoce)}`);
  }
  if (isNum(mg.disclosureQuality?.score)) comp(d, 'Transparency of disclosures', mg.disclosureQuality.score, 0.1, 'judgment', mg.disclosureQuality.evidence);
  if (isNum(mg.trackRecord?.score)) comp(d, 'Leadership track record', mg.trackRecord.score, 0.1, 'judgment', mg.trackRecord.evidence);
  if (mg.succession === 'unclear') d.negatives.push('Succession plan not disclosed / unclear.');
  if (isNum(mg.ceoPayToPat) && mg.ceoPayToPat > 0.05) d.negatives.push(`Promoter/KMP remuneration is ${pct(mg.ceoPayToPat)} of PAT.`);
  const rptFlag = forensic.flags.find((f) => f.id === 'rpt');
  if (rptFlag) d.negatives.push(rptFlag.detail);
  d.serious = events.some((e) => e.type === 'proven' || (e.type === 'regulatory_finding' && e.severity === 'high')) || forensic.confirmed.some((f) => f.id.startsWith('auditor-resign') || f.id.startsWith('auditor-qual'));
  d.allegationsOnly = !d.serious && events.some((e) => e.type === 'allegation');
  d.confidence = 0.3 + Math.min(assessed.length, 5) * 0.08 + (sh.length >= 2 ? 0.15 : 0) + (mg.events ? 0.15 : 0);
  d.monitoring.push('Promoter transactions & pledges (quarterly shareholding)', 'Auditor and independent director changes', 'Delivery on current guidance');
  return finish(d);
}

// ---------------------------------------------------------------- moat
export function scoreMoat(c, m, rates) {
  const d = dim('moat');
  const mo = c.moat || {};
  const src = MOAT_SOURCES.map(([k, label]) => ({ k, label, s: mo.sources?.[k]?.score, ev: mo.sources?.[k]?.evidence })).filter((x) => isNum(x.s));
  if (src.length) {
    const top = src.map((x) => x.s).sort((a, b) => b - a).slice(0, 3);
    comp(d, 'Strongest moat sources (top-3 average)', mean(top), 0.45, 'judgment');
    for (const x of src.filter((y) => y.s >= 7)) d.positives.push(`${x.label} (${x.s}/10): ${x.ev || ''}`);
  } else d.missing.push('Moat source assessment.');
  if (!m.empty) {
    const coc = (rates?.riskFree ?? 0.068) + (rates?.equityRiskPremium ?? 0.06);
    const roic = m.roic.filter(isNum);
    const yearsAbove = roic.filter((r) => r > coc).length;
    comp(d, 'Evidence: years ROIC > cost of capital', roic.length ? (yearsAbove / roic.length) * 10 : null, 0.35, 'calculated', `${yearsAbove}/${roic.length} years above ${pct(coc)}`);
    comp(d, 'Evidence: margin stability', scale(m.stability.ebitdaMarginStdev, 0.06, 0.01), 0.2, 'calculated');
    if (roic.length && yearsAbove / roic.length < 0.5) d.negatives.push(`ROIC exceeded the cost of capital in only ${yearsAbove} of ${roic.length} years — the moat is not visible in the numbers.`);
  }
  const trendAdj = { strengthening: 0.7, stable: 0, weakening: -1.2 }[mo.trend] ?? 0;
  d.trend = mo.trend || 'unknown';
  if (mo.trend === 'weakening') d.negatives.push('Moat assessed as weakening.');
  finish(d);
  if (isNum(d.score)) d.score = round(clamp(d.score + trendAdj, 0, 10), 1);
  const s = d.score ?? 0;
  const decay = mo.trend === 'weakening' ? 0.15 : mo.trend === 'strengthening' ? -0.03 : 0.05;
  d.durability = { y3: round(clamp(s / 10 - decay, 0, 1), 2), y5: round(clamp(s / 10 - decay * 2, 0, 1), 2), y10: round(clamp(s / 10 - decay * 4 - 0.1, 0, 1), 2) };
  d.durabilityNote = 'Probability the advantage persists, derived from moat score and trend (judgment-based, not a forecast).';
  d.width = s >= 7.5 ? 'Wide' : s >= 5.5 ? 'Narrow' : 'None / unproven';
  d.disappearanceEvidence = mo.disappearanceEvidence || [];
  d.confidence = 0.25 + (src.length ? 0.35 : 0) + (m.empty ? 0 : 0.4);
  d.monitoring.push(...(mo.disappearanceEvidence || ['Gross margin erosion', 'Market-share loss to a named competitor']));
  return d;
}

// ---------------------------------------------------------------- growth
export const CATALYST_STATUS_WEIGHT = { executing: 1, approved: 0.75, announced: 0.45, speculative: 0.2 };
export function scoreGrowth(c, m, val, mgmtDim) {
  const d = dim('growth');
  const base = val?.scenarios?.base?.assumptions;
  comp(d, 'Base-case revenue growth (5y)', isNum(base?.revenueCagr5) ? scale(base.revenueCagr5, 0, 0.2) : null, 0.35, 'assumption', base ? pct(base.revenueCagr5) : null);
  const cats = c.catalysts || [];
  if (cats.length) {
    const wImpact = cats.reduce((a, x) => a + (x.impactRevenuePct || 0) * (x.probability ?? 0.5) * (CATALYST_STATUS_WEIGHT[x.status] ?? 0.3), 0);
    comp(d, `Probability-weighted catalysts (${cats.length})`, scale(wImpact, 0, 0.4), 0.3, 'judgment', `Risk-weighted revenue uplift ${pct(wImpact)}`);
    for (const x of cats.filter((y) => y.status === 'executing' || y.status === 'approved')) d.positives.push(`${x.name} (${x.status}, ${x.timeline || 'timeline n/a'})`);
    const spec = cats.filter((y) => y.status === 'speculative');
    if (spec.length && spec.length >= cats.length / 2) d.negatives.push(`${spec.length} of ${cats.length} catalysts are speculative.`);
  } else d.missing.push('Growth catalysts with status, timeline and probability.');
  const exec = mgmtDim?.components.find((x) => x.name.startsWith('Credibility'))?.score;
  comp(d, 'Execution capability (management delivery record)', exec, 0.2, 'calculated');
  if (!m.empty) comp(d, 'Reinvestment runway (incremental ROCE)', scale(m.incrementalRoce, 0.05, 0.3), 0.15, 'calculated', pct(m.incrementalRoce));
  d.confidence = 0.3 + (cats.length ? 0.3 : 0) + (isNum(exec) ? 0.2 : 0) + (c.scenarios ? 0.2 : 0.1);
  d.monitoring.push(...cats.flatMap((x) => x.indicators || []).slice(0, 6));
  return finish(d);
}

// ---------------------------------------------------------------- valuation
export function scoreValuation(c, val) {
  const d = dim('valuation');
  if (!val || !isNum(val.marginOfSafety)) { d.missing.push(...(val?.warnings || ['Valuation inputs.'])); d.confidence = 0; return finish(d); }
  comp(d, 'Margin of safety vs base intrinsic value', scale(val.marginOfSafety, -0.5, 0.4), 0.4, 'calculated', pct(val.marginOfSafety, 0));
  const er = val.scenarios.base.expectedReturn5y;
  comp(d, 'Base-case 5y expected return vs hurdle', isNum(er) ? scale(er - val.hurdle, -0.12, 0.1) : null, 0.35, 'calculated', isNum(er) ? `${pct(er)} vs hurdle ${pct(val.hurdle)}` : null);
  const rd = val.reverseDcf;
  if (isNum(rd?.impliedRevenueCagr10y)) {
    const gap = (rd.baseCaseCagr ?? 0) - rd.impliedRevenueCagr10y;
    comp(d, 'Market-implied growth vs base case', scale(gap, -0.1, 0.06), 0.25, 'calculated', `Implied ${pct(rd.impliedRevenueCagr10y)} vs base ${pct(rd.baseCaseCagr)}`);
    if (gap < -0.04) d.negatives.push(`The price implies ${pct(rd.impliedRevenueCagr10y)} growth for a decade — well above the evidence-based base case (${pct(rd.baseCaseCagr)}).`);
    if (gap > 0.03) d.positives.push(`The market implies only ${pct(rd.impliedRevenueCagr10y)} growth vs a base case of ${pct(rd.baseCaseCagr)}.`);
  }
  if (val.marginOfSafety > 0.25) d.positives.push(`Trading ${pct(val.marginOfSafety, 0)} below base intrinsic value.`);
  if (val.marginOfSafety < -0.2) d.negatives.push(`Trading ${pct(val.premiumDiscount, 0)} above base intrinsic value.`);
  if (val.uncertainty > 1.2) d.negatives.push(`Very wide bear–bull range (${pct(val.uncertainty, 0)} of base value).`);
  d.status = val.status;
  d.confidence = 0.4 + (val.scenarios.base.weightCoverage || 0) * 0.4 + (val.uncertainty < 0.8 ? 0.2 : 0);
  d.monitoring.push(`Entry trigger: ₹${round(val.entryPrice, 0)} (base value less ${pct(val.requiredMarginOfSafety, 0)} margin of safety).`);
  return finish(d);
}

// ---------------------------------------------------------------- risk
export function riskScore(r) { return (r.probability ?? 0.3) * (r.impact ?? 3); } // 0–5
export function scoreRisk(c, val) {
  const d = dim('risk');
  const risks = (c.risks || []).filter((r) => !SCORED_ELSEWHERE.includes((r.category || '').toLowerCase()));
  const excluded = (c.risks || []).length - risks.length;
  if (risks.length) {
    const residual = risks.map((r) => riskScore(r) * ({ low: 0.5, medium: 0.8, high: 1 }[r.residual] ?? 0.85));
    const worst = Math.max(...residual), total = residual.reduce((a, b) => a + b, 0);
    comp(d, 'Residual risk register (worst risk)', scale(worst, 3.5, 0.3), 0.35, 'judgment');
    comp(d, 'Residual risk register (aggregate)', scale(total, 8, 1), 0.25, 'judgment');
    const worstRisk = risks[residual.indexOf(worst)];
    if (worst >= 3.2) d.criticalRisk = { description: worstRisk.description, category: worstRisk.category, score: worst };
    for (const r of risks.filter((x) => riskScore(x) >= 2)) d.negatives.push(`${r.category}: ${r.description} (p=${pct(r.probability, 0)}, impact ${r.impact}/5)`);
  } else d.missing.push('Risk register.');
  if (excluded) d.evidence.push(`${excluded} risk(s) in categories scored elsewhere (valuation, governance, accounting, leverage) excluded to avoid double counting.`);
  if (isNum(val?.downsideToBear)) {
    comp(d, 'Downside to bear-case value', scale(val.downsideToBear, -0.6, 0.1), 0.4, 'calculated', pct(val.downsideToBear, 0));
    if (val.downsideToBear < -0.4) d.negatives.push(`Bear case implies a ${pct(-val.downsideToBear, 0)} fall from the current price.`);
    if (val.downsideToBear > -0.1) d.positives.push('Limited downside even in the bear case.');
  }
  d.confidence = 0.3 + (risks.length >= 4 ? 0.4 : risks.length * 0.1) + (isNum(val?.downsideToBear) ? 0.3 : 0);
  d.monitoring.push(...risks.map((r) => r.warning).filter(Boolean).slice(0, 6));
  return finish(d);
}

// ---------------------------------------------------------------- investor & portfolio
export function scoreInvestor(inv) {
  const d = dim('investor');
  if (!inv?.completed) { d.missing.push('Investor self-assessment (mandatory before a final decision).'); d.confidence = 0; d.pending = true; return finish(d); }
  comp(d, 'Demonstrated knowledge (evidence-weighted)', inv.knowledgeScore, 0.6, 'calculated');
  comp(d, `Conviction quality (${inv.convictionType})`, inv.convictionScore, 0.4, 'calculated');
  if (inv.overconfidence) d.negatives.push('Self-rated understanding exceeds demonstrated understanding by 3+ points.');
  for (const b of inv.biases.filter((x) => x.severity === 'high')) d.negatives.push(`${b.label}: ${b.why}`);
  if (inv.knowledgeScore >= 7) d.positives.push('Strong demonstrated understanding of the industry and thesis risks.');
  d.confidence = 0.8;
  finish(d);
  d.score = inv.score;
  return d;
}

export function scorePortfolio(fit, opp) {
  const d = dim('portfolio');
  if (!fit?.available) { d.missing.push('Portfolio holdings and proposed amount.'); d.confidence = 0; d.pending = true; }
  else { comp(d, 'Concentration, overlap & liquidity fit', fit.score, 0.6, 'calculated'); d.negatives.push(...fit.warnings); d.positives.push(...fit.positives); }
  if (isNum(opp?.riskAdjustedReturn) && opp.nextBest) {
    comp(d, 'Opportunity cost vs next-best alternative', scale(opp.riskAdjustedReturn - opp.nextBest.riskAdjusted, -0.06, 0.06), 0.4, 'calculated', opp.answer);
    (opp.beatsNextBest ? d.positives : d.negatives).push(opp.answer);
  }
  d.confidence = fit?.available ? 0.75 : 0.3;
  return finish(d);
}

// ---------------------------------------------------------------- aggregate
export function aggregate(dims, weights = DEFAULT_WEIGHTS) {
  const totalW = DIMENSIONS.reduce((a, d) => a + (weights[d.id] ?? 0), 0) || 100;
  let score = 0, coveredW = 0, conf = 0;
  const rows = DIMENSIONS.map((meta) => {
    const d = dims[meta.id];
    const w = ((weights[meta.id] ?? 0) / totalW) * 100;
    const contribution = isNum(d?.score) ? (d.score / 10) * w : null;
    if (isNum(contribution)) { score += contribution; coveredW += w; conf += (d.confidence || 0) * w; }
    return { ...d, weight: round(w, 1), contribution: round(contribution, 1) };
  });
  // Unscored dimensions are scored at a neutral 5/10 (not zero, not excluded) so missing data neither hides nor inflates.
  const neutralFill = rows.filter((r) => !isNum(r.contribution)).reduce((a, r) => a + 0.5 * r.weight, 0);
  const holistic = round(score + neutralFill, 1);
  return {
    rows,
    holistic,
    scoredWeight: round(coveredW, 1),
    neutralFilledWeight: round(100 - coveredW, 1),
    confidence: round((conf / 100) + 0, 2),
    band: interpretScore(holistic)
  };
}

export function interpretScore(s) {
  if (s >= 85) return { label: 'Exceptional candidate', note: 'Valuation and risk checks still required.' };
  if (s >= 75) return { label: 'Strong candidate', note: 'Assess entry price and key risks.' };
  if (s >= 65) return { label: 'Potentially attractive', note: 'Resolve material uncertainties.' };
  if (s >= 50) return { label: 'Mixed proposition', note: 'Further research or a better entry price may be needed.' };
  return { label: 'Weak candidate', note: 'Weak under the current evidence and assumptions.' };
}
