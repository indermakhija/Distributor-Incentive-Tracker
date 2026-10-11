// Thesis tracking and alert generation (Module N + thesis tracker).

import { isNum, last, pct, round } from './util.js';

export const THESIS_METRICS = {
  revenueGrowth3y: { label: 'Revenue 3y CAGR', get: (a) => a.metrics.growth?.revenue3y, fmt: pct },
  revenueGrowthLatest: { label: 'Latest revenue growth (YoY)', get: (a) => last(a.metrics.growth?.revenueYoY || []), fmt: pct },
  ebitdaMargin: { label: 'EBITDA margin (latest)', get: (a) => a.metrics.latest?.ebitdaMargin, fmt: pct },
  roce: { label: 'ROCE (latest)', get: (a) => a.metrics.latest?.roce, fmt: pct },
  netDebtToEbitda: { label: 'Net debt / EBITDA', get: (a) => a.metrics.latest?.netDebtToEbitda, fmt: (v) => (isNum(v) ? v.toFixed(2) + 'x' : 'n/a') },
  cfoToPat: { label: 'CFO / PAT (5y)', get: (a) => a.metrics.avg5?.cfoToPat, fmt: pct },
  receivableDays: { label: 'Receivable days', get: (a) => last(a.metrics.receivableDays || []), fmt: (v) => (isNum(v) ? v.toFixed(0) + ' d' : 'n/a') },
  promoterHolding: { label: 'Promoter holding', get: (a) => last(a.company.shareholding || [])?.promoter, fmt: pct },
  pledge: { label: 'Promoter pledge', get: (a) => last(a.company.shareholding || [])?.pledgedPctOfPromoter, fmt: pct },
  price: { label: 'Share price', get: (a) => a.company.market?.price, fmt: (v) => (isNum(v) ? '₹' + v.toFixed(0) : 'n/a') },
  marginOfSafety: { label: 'Margin of safety', get: (a) => a.valuation?.marginOfSafety, fmt: pct },
  moatScore: { label: 'Moat score', get: (a) => a.dims.moat?.score, fmt: (v) => v },
  managementScore: { label: 'Management score', get: (a) => a.dims.management?.score, fmt: (v) => v },
  holistic: { label: 'Holistic score', get: (a) => a.aggregate?.holistic, fmt: (v) => v }
};

const cmp = (v, op, t) => (op === '>=' ? v >= t : op === '>' ? v > t : op === '<=' ? v <= t : op === '<' ? v < t : null);

/** Evaluates thesis assumptions against the latest analysis. Each assumption: { text, metric, operator, threshold, critical }. */
export function evaluateThesis(thesis, analysis) {
  if (!thesis) return null;
  const results = (thesis.assumptions || []).map((as) => {
    const def = THESIS_METRICS[as.metric];
    if (!def) return { ...as, status: 'manual', note: 'Qualitative assumption — review manually.' };
    const v = def.get(analysis);
    if (!isNum(v)) return { ...as, status: 'unknown', value: null, note: 'Data unavailable.' };
    const t = Number(as.threshold);
    const holds = cmp(v, as.operator, t);
    const near = holds && Math.abs(v - t) <= Math.abs(t) * 0.1;
    return { ...as, value: v, display: def.fmt(v), status: holds ? (near ? 'at_risk' : 'holding') : 'broken' };
  });
  const broken = results.filter((r) => r.status === 'broken' && r.critical !== false);
  const atRisk = results.filter((r) => r.status === 'at_risk' || (r.status === 'broken' && r.critical === false));
  const manualSell = (thesis.sellTriggers || []).filter((t) => t.triggered);
  return {
    results, broken: [...broken, ...manualSell.map((t) => ({ text: t.text }))], atRisk,
    status: broken.length || manualSell.length ? 'broken' : atRisk.length ? 'at_risk' : 'intact'
  };
}

/** Compact snapshot used for change detection between analyses. */
export function snapshotSummary(a) {
  const sh = last(a.company.shareholding || []) || {};
  return {
    at: new Date().toISOString(),
    holistic: a.aggregate.holistic,
    decision: a.decision.code,
    dims: Object.fromEntries(Object.entries(a.dims).map(([k, d]) => [k, d.score])),
    flags: a.forensic.flags.map((f) => f.id),
    promoter: sh.promoter ?? null,
    pledge: sh.pledgedPctOfPromoter ?? null,
    price: a.company.market?.price ?? null,
    priceDate: a.company.market?.priceDate ?? null,
    marginOfSafety: a.valuation?.marginOfSafety ?? null,
    baseValue: a.valuation?.intrinsic?.base ?? null,
    entryPrice: a.valuation?.entryPrice ?? null,
    thesisStatus: a.thesis?.status ?? null,
    rating: last(a.company.creditRatings || [])?.rating ?? null,
    macroScore: a.macro?.usable ? a.macro.impact.score : null,
    macroRegime: a.macro?.regime ?? null,
    announcementIds: (a.company.announcements || []).map((x) => x.id || x.date + x.title)
  };
}

const ANNOUNCEMENT_SEVERITY = {
  auditor_resignation: 'critical', fraud_allegation: 'critical', default: 'critical', insolvency: 'critical',
  auditor_change: 'high', rating_downgrade: 'high', pledge_increase: 'high', guidance_cut: 'high', regulatory_action: 'high', management_exit: 'high',
  results: 'medium', acquisition: 'medium', capex: 'medium', guidance_raise: 'medium', rating_upgrade: 'medium', competitor_action: 'medium', policy_change: 'medium',
  dividend: 'low', agm: 'low', other: 'low'
};

/**
 * Compares previous vs current snapshot and returns classified alerts.
 * Ordinary price moves never alert unless prefs.priceAlerts is on; entry-price triggers alert when crossed.
 */
export function generateAlerts(prev, cur, analysis, prefs = {}) {
  const alerts = [];
  const add = (severity, title, what, why, reassess) => alerts.push({ severity, title, what, why, reassess });
  if (!prev) return alerts;
  const scoreDrop = (prev.holistic ?? 0) - (cur.holistic ?? 0);
  if (scoreDrop >= 8) add('high', 'Holistic score deteriorated', `Score fell from ${prev.holistic} to ${cur.holistic}.`, 'Material change in the evidence base.', true);
  else if (Math.abs(scoreDrop) >= 4) add('medium', `Holistic score ${scoreDrop > 0 ? 'down' : 'up'} ${Math.abs(scoreDrop).toFixed(1)}`, `${prev.holistic} → ${cur.holistic}.`, 'Meaningful change in prospects or valuation.', false);
  for (const [k, v] of Object.entries(cur.dims)) {
    const p = prev.dims?.[k];
    if (isNum(p) && isNum(v) && p - v >= 1.5) add(k === 'management' || k === 'financial' ? 'high' : 'medium', `${k} score fell ${(p - v).toFixed(1)} points`, `${p} → ${v}.`, 'A component of the investment case weakened.', k === 'management');
  }
  if (prev.decision !== cur.decision) add('medium', 'Recommendation changed', `${prev.decision} → ${cur.decision}.`, 'Decision engine output changed after new data.', true);
  const newFlags = cur.flags.filter((f) => !prev.flags.includes(f));
  for (const id of newFlags) {
    const f = analysis.forensic.flags.find((x) => x.id === id);
    add(f?.kind === 'confirmed' && f.severity === 'high' ? 'critical' : 'high', `New accounting flag: ${f?.title || id}`, f?.detail || '', 'Accounting quality affects the reliability of every other number.', true);
  }
  if (isNum(cur.pledge) && isNum(prev.pledge) && cur.pledge - prev.pledge >= 0.05) add(cur.pledge > 0.5 ? 'critical' : 'high', 'Promoter pledging increased', `${pct(prev.pledge, 0)} → ${pct(cur.pledge, 0)} of promoter holding.`, 'Pledged shares can be force-sold, and pledging can signal financial stress at the promoter level.', true);
  if (isNum(cur.promoter) && isNum(prev.promoter) && prev.promoter - cur.promoter >= 0.02) add('high', 'Promoter stake reduced', `${pct(prev.promoter)} → ${pct(cur.promoter)}.`, 'Insiders selling may signal reduced confidence.', false);
  if (isNum(cur.macroScore) && isNum(prev.macroScore) && Math.abs(cur.macroScore - prev.macroScore) >= 1.5)
    add(cur.macroScore < prev.macroScore && cur.macroScore <= 3.5 ? 'high' : 'medium', `Macro regime ${cur.macroScore < prev.macroScore ? 'deteriorated' : 'improved'} for this company`, `Macro score ${prev.macroScore} → ${cur.macroScore} (${prev.macroRegime} → ${cur.macroRegime}).`, 'National/international factors this business is sensitive to have moved materially.', cur.macroScore < prev.macroScore);
  else if (cur.macroRegime && prev.macroRegime && cur.macroRegime !== prev.macroRegime && prev.macroRegime !== 'No macro data')
    add('low', 'Macro regime label changed', `${prev.macroRegime} → ${cur.macroRegime}.`, 'Informational.', false);
  if (cur.rating && prev.rating && cur.rating !== prev.rating) add('high', 'Credit rating changed', `${prev.rating} → ${cur.rating}.`, 'Rating actions change borrowing costs and signal lender views.', true);
  if (cur.thesisStatus !== prev.thesisStatus && cur.thesisStatus === 'broken') add('critical', 'Thesis-breaking event', 'One or more critical thesis assumptions failed.', 'The original reason to own the stock no longer holds.', true);
  else if (cur.thesisStatus !== prev.thesisStatus && cur.thesisStatus === 'at_risk') add('high', 'Thesis assumption under pressure', 'An assumption is within 10% of its failure threshold.', 'Early warning before the thesis breaks.', false);
  if (isNum(cur.entryPrice) && isNum(cur.price) && isNum(prev.price) && prev.price > cur.entryPrice && cur.price <= cur.entryPrice)
    add('medium', 'Entry-price trigger reached', `Price ₹${round(cur.price, 0)} is at/below the entry price ₹${round(cur.entryPrice, 0)}.`, 'Valuation now offers the required margin of safety — re-check that the thesis is intact.', true);
  if (prefs.priceAlerts && isNum(cur.price) && isNum(prev.price) && Math.abs(cur.price / prev.price - 1) >= (prefs.priceMovePct ?? 0.1))
    add('low', 'Price move', `₹${round(prev.price, 0)} → ₹${round(cur.price, 0)}.`, 'Price alert requested by user (not a fundamental signal).', false);
  for (const ann of analysis.company.announcements || []) {
    const id = ann.id || ann.date + ann.title;
    if (prev.announcementIds?.includes(id)) continue;
    const sev = ANNOUNCEMENT_SEVERITY[ann.type] || 'low';
    add(sev, `Announcement: ${ann.title}`, `${ann.date || ''} ${ann.detail || ''}`.trim(), ann.why || `Classified as ${ann.type || 'other'}.`, ['critical', 'high'].includes(sev));
  }
  return alerts;
}
