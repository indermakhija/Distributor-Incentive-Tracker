// Decision engine + non-negotiable override rules (Modules L & M).
// A BUY is never produced from the aggregate score alone: it needs business quality, valuation, no critical failure,
// a completed investor assessment with adequate knowledge, and portfolio suitability. Caps from override rules always win.

import { isNum, round, pct, mean } from './util.js';

export const DECISIONS = {
  BUY: { label: 'BUY / CONSIDER BUYING', rank: 5, tone: 'pos' },
  BUY_BELOW: { label: 'BUY ONLY BELOW A SPECIFIED PRICE', rank: 4, tone: 'pos' },
  WAIT: { label: 'WAIT FOR BETTER VALUATION', rank: 3, tone: 'neutral' },
  WATCHLIST: { label: 'WATCHLIST', rank: 2, tone: 'neutral' },
  HOLD: { label: 'HOLD', rank: 3, tone: 'neutral', holder: true },
  REDUCE: { label: 'REDUCE', rank: 2, tone: 'warn', holder: true },
  SELL_AVOID: { label: 'SELL / AVOID', rank: 1, tone: 'neg' },
  INSUFFICIENT: { label: 'INSUFFICIENT EVIDENCE', rank: 0, tone: 'neutral' }
};

const QUALITY_DIMS = ['business', 'industry', 'financial', 'management', 'moat', 'growth'];

export function qualityScore(dims, weights) {
  let w = 0, s = 0;
  for (const k of QUALITY_DIMS) if (isNum(dims[k]?.score)) { s += dims[k].score * (weights[k] ?? 1); w += weights[k] ?? 1; }
  return w ? round(s / w, 1) : null;
}

/** Evaluates all override rules. Each may cap the decision (prospective and holder ladders) and lower confidence. */
export function evaluateRules(a) {
  const { dims, metrics: m, val, dq, inv, fit, thesis } = a;
  const rules = [];
  const r = (id, severity, title, message, cap, holderCap, confidencePenalty = 0) => rules.push({ id, severity, title, message, cap, holderCap, confidencePenalty });

  if (dims.management?.serious)
    r('governance-serious', 'critical', 'Serious governance concern — escalation required', 'Proven misconduct, a material regulatory finding, or an auditor resignation/qualification is on record. No score can offset this; independent verification is required before any capital is committed.', 'SELL_AVOID', 'SELL_AVOID');
  else if (dims.management?.allegationsOnly)
    r('governance-allegation', 'high', 'Unresolved governance allegations', 'Allegations (not proven findings) are on record. Investigate the primary sources and the company response before buying; allegations are not treated as facts.', 'WATCHLIST', 'HOLD');

  if (!m.empty) {
    const nde = m.latest.netDebtToEbitda, ic = m.latest.interestCoverage;
    const debtRising = m.series.totalDebt.length > 1 && m.series.totalDebt.at(-1) > m.series.totalDebt[0] * 1.3;
    const severe = (isNum(ic) && ic < 1) || (isNum(nde) && nde > 6) || (m.latest.ebitda <= 0 && m.latest.totalDebt > 0);
    if (severe || nde > 4 || (isNum(ic) && ic < 1.5) || (m.stability.negativeCfoYears >= 2 && debtRising))
      r('insolvency', severe ? 'critical' : 'high', 'Financial-risk warning: debt sustainability', `Net debt/EBITDA ${isNum(nde) ? nde.toFixed(1) + 'x' : 'n/a'}, interest coverage ${isNum(ic) && ic !== Infinity ? ic.toFixed(1) + 'x' : 'n/a'}${m.stability.negativeCfoYears >= 2 ? `, ${m.stability.negativeCfoYears} years of negative CFO` : ''}. Refinancing or solvency risk could cause permanent loss.`, severe ? 'SELL_AVOID' : 'WATCHLIST', severe ? 'SELL_AVOID' : 'REDUCE');
  }

  if (dq.status === 'sample') r('sample-data', 'medium', 'Illustrative sample data', 'This company is fictional sample data. The decision demonstrates the workflow and must not be acted upon.', null, null, 0);
  if (dq.confidence < 0.5) r('data-unreliable', 'high', 'Unreliable or incomplete data', `Data confidence is ${pct(dq.confidence, 0)}: ${dq.issues.filter((i) => i.severity !== 'critical').slice(0, 3).map((i) => i.text).join(' ')}`, 'WATCHLIST', 'HOLD', 0.15);
  else if (dq.staleCount) r('stale-data', 'medium', 'Stale data in use', dq.issues.filter((i) => /stale|old/.test(i.text)).map((i) => i.text).join(' '), null, null, 0.05 * dq.staleCount);

  const q = a.quality;
  if (val && isNum(val.marginOfSafety) && (val.marginOfSafety < -0.3 || (isNum(val.intrinsic.bull) && val.price > val.intrinsic.bull)))
    r('excessive-valuation', 'high', 'Excessive valuation overrides business quality', `Price ₹${round(val.price, 0)} is ${pct(val.premiumDiscount, 0)} above base value ₹${round(val.intrinsic.base, 0)}${val.price > val.intrinsic.bull ? ' and above even the bull-case value' : ''}. ${q >= 7 ? 'This is a high-quality business, but a great business is not a great investment at any price.' : ''}`, 'WAIT', val.price > val.intrinsic.bull ? 'REDUCE' : 'HOLD');

  if (thesis?.status === 'broken')
    r('thesis-broken', 'critical', 'Investment thesis broken — fresh assessment required', `Broken assumptions: ${thesis.broken.map((b) => b.text).join('; ')}.`, 'WATCHLIST', 'REDUCE');
  else if (thesis?.status === 'at_risk')
    r('thesis-at-risk', 'medium', 'Thesis assumptions under pressure', `${thesis.atRisk.map((b) => b.text).join('; ')}.`, null, null, 0.05);

  if (!inv?.completed) r('investor-pending', 'high', 'Investor self-assessment not completed', 'Module J is mandatory. BUY decisions are blocked until the circle-of-competence, conviction and suitability assessment is completed.', 'WATCHLIST', null);
  else {
    if (inv.knowledgeScore < 4) r('investor-knowledge', 'high', 'Investor understanding is insufficient', `Demonstrated knowledge ${inv.knowledgeScore}/10. Recommend a learning phase (gaps: ${inv.gaps.map((g) => g.question).slice(0, 3).join(' | ')}). This gap is researchable — it does not mean the company is unattractive.`, 'WATCHLIST', null);
    else if (inv.knowledgeScore < 6) r('investor-knowledge-partial', 'medium', 'Partial investor understanding', `Demonstrated knowledge ${inv.knowledgeScore}/10 — consider a smaller starter position while closing the gaps.`, null, null);
    if (!inv.thesisWritten && a.baseDecision === 'BUY') r('thesis-unwritten', 'medium', 'Written thesis required', 'A high-conviction decision requires a written investment thesis of at least three sentences.', 'BUY_BELOW', null);
    const s = inv.suitability || {};
    if (isNum(s.horizonYears) && s.horizonYears < 3) r('horizon', 'high', 'Horizon too short for equity risk', `A ${s.horizonYears}-year horizon (or near-term liquidity need) is too short to ride out a bear case.`, 'WATCHLIST', null);
    if (isNum(s.maxDrawdown) && isNum(val?.downsideToBear) && -val.downsideToBear > s.maxDrawdown)
      r('drawdown', 'medium', 'Bear case exceeds your drawdown tolerance', `Bear-case fall of ${pct(-val.downsideToBear, 0)} exceeds your stated tolerance of ${pct(s.maxDrawdown, 0)} — size down or wait.`, null, null);
  }
  if (fit?.available && fit.warnings.length) r('portfolio', 'medium', 'Portfolio concentration / liquidity', fit.warnings.join(' '), null, null);

  if (dims.risk?.criticalRisk && !(dims.risk.score < 3))
    r('critical-risk', 'high', `Critical risk: ${dims.risk.criticalRisk.category}`, `"${dims.risk.criticalRisk.description}" is rated near-certain and high-impact with high residual risk. Cheapness elsewhere cannot offset a risk of permanent capital loss.`, 'WATCHLIST', 'REDUCE');
  for (const [k, d] of Object.entries(dims))
    if (isNum(d?.score) && d.score < 3 && !d.pending)
      r(`critical-${k}`, 'high', `Critical weakness: ${d.label}`, `Scores ${d.score}/10. A high score elsewhere cannot conceal a critical failure here.`, k === 'valuation' ? 'WAIT' : 'WATCHLIST', k === 'valuation' ? 'REDUCE' : 'HOLD');
  return rules;
}

function baseProspective(q, val, holistic) {
  const st = val?.status;
  if (q >= 6.5) {
    if (st === 'attractive') return holistic >= 65 ? ['BUY', 'High-quality business at a price below the required margin of safety.'] : ['WATCHLIST', 'Price looks attractive but the overall holistic score is mixed.'];
    if (st === 'attractive_below') return ['BUY_BELOW', 'Good business; current price leaves an insufficient margin of safety.'];
    if (st === 'fair') return ['WAIT', 'Good business, fairly valued — wait for a better price.'];
    if (st === 'overvalued') return ['WAIT', 'Good business, but the price already discounts more than the evidence supports.'];
    return ['WATCHLIST', 'Good business but too uncertain to value reliably.'];
  }
  if (q >= 5) {
    if (st === 'attractive' && holistic >= 65) return ['BUY_BELOW', 'Average-quality business at a discount — demand an extra margin of safety.'];
    return ['WATCHLIST', 'Average business quality; no compelling price.'];
  }
  return ['SELL_AVOID', 'Business quality is weak under the current evidence.'];
}

function baseHolder(q, val) {
  const mos = val?.marginOfSafety;
  if (q >= 6) {
    if (isNum(mos) && (mos < -0.3 || val.price > val.intrinsic.bull)) return ['REDUCE', 'The business remains attractive but the price exceeds a reasonable estimate of value — trim.'];
    return ['HOLD', 'The business remains attractive and the price is within a defensible range.'];
  }
  if (q >= 4.5) return isNum(mos) && mos < 0 ? ['REDUCE', 'Average business priced above value.'] : ['HOLD', 'Average business; price provides some support.'];
  return ['SELL_AVOID', 'Business quality no longer justifies holding.'];
}

const capOf = (code, cap, holder) => {
  if (!cap) return code;
  if (holder) return DECISIONS[cap].rank < DECISIONS[code].rank ? cap : code;
  return DECISIONS[cap].rank < DECISIONS[code].rank ? cap : code;
};

export function decide(a) {
  const { dims, agg, val, dq, inv, settings = {} } = a;
  const holder = !!a.holder;
  const q = qualityScore(dims, settings.weights || {});
  a.quality = q;
  const trace = [];
  let code, why;
  if (dq.confidence < 0.35 || agg.confidence < 0.3 || q == null) {
    code = 'INSUFFICIENT';
    why = 'Evidence is too thin or unreliable to support a decision.';
  } else [code, why] = holder ? baseHolder(q, val) : baseProspective(q, val, agg.holistic);
  a.baseDecision = code;
  trace.push({ step: 'Base decision', result: code, why });
  const rules = evaluateRules(a);
  for (const rule of rules) {
    const cap = holder ? rule.holderCap : rule.cap;
    if (cap && code !== 'INSUFFICIENT') {
      const next = capOf(code, cap, holder);
      if (next !== code) { trace.push({ step: `Override: ${rule.title}`, result: next, why: rule.message }); code = next; }
    }
  }
  const confidence = round(Math.max(0, Math.min(agg.confidence, dq.confidence) - rules.reduce((x, r) => x + r.confidencePenalty, 0)), 2);

  const buyChecklist = [
    { item: 'Business quality ≥ 6.5/10', ok: q >= 6.5, value: q },
    { item: 'Valuation attractive (margin of safety ≥ required)', ok: val?.status === 'attractive', value: val?.status },
    { item: 'Holistic score ≥ 65', ok: agg.holistic >= 65, value: agg.holistic },
    { item: 'No critical override (governance, solvency, broken thesis, critical weakness)', ok: !rules.some((r) => r.cap && ['SELL_AVOID', 'WATCHLIST'].includes(r.cap)), value: rules.filter((r) => r.severity === 'critical').length },
    { item: 'Investor self-assessment completed with knowledge ≥ 4', ok: !!inv?.completed && inv.knowledgeScore >= 4, value: inv?.knowledgeScore ?? 'pending' },
    { item: 'Data confidence ≥ 50%', ok: dq.confidence >= 0.5, value: dq.confidence }
  ];
  const gates = [];
  if (!inv?.completed) gates.push('Complete the investor self-assessment (Module J).');
  if (['BUY', 'BUY_BELOW'].includes(code) && !a.redTeamAcknowledged) gates.push('Review and respond to the red-team case before finalising.');
  const sizing = positionSizing(a, code);
  return {
    code, label: DECISIONS[code].label, tone: DECISIONS[code].tone, holder, quality: q, rules, trace, confidence,
    status: gates.length ? 'provisional' : 'final', gates, buyChecklist, sizing,
    entryPrice: code === 'BUY_BELOW' || code === 'WAIT' ? val?.entryPrice * (q < 6.5 ? 0.9 : 1) : null,
    entryRange: val?.entryRange || null,
    greatBusiness: q >= 7,
    greatInvestment: code === 'BUY'
  };
}

function positionSizing(a, code) {
  const s = a.inv?.suitability || {};
  const limit = a.fit?.limits?.maxSingleStock ?? 0.1;
  if (!['BUY', 'BUY_BELOW'].includes(code)) return { suggestedWeight: 0, note: 'No new purchase suggested.' };
  let w = limit;
  const notes = [];
  if (a.inv?.knowledgeScore < 6) { w *= 0.5; notes.push('halved for partial understanding'); }
  if (a.agg.confidence < 0.6) { w *= 0.75; notes.push('reduced for evidence confidence'); }
  if (isNum(s.maxDrawdown) && isNum(a.val?.downsideToBear) && -a.val.downsideToBear > s.maxDrawdown) { w *= 0.6; notes.push('reduced for drawdown tolerance'); }
  if (code === 'BUY_BELOW') notes.push('only at or below the entry price');
  const total = a.fit?.totalAfter;
  return { suggestedWeight: round(w, 3), suggestedAmount: isNum(total) ? round(total * w, 0) : null, note: notes.length ? notes.join(', ') : 'Full position up to the single-stock limit; consider staging entries.' };
}

export const horizonFor = (c, dims) => (c.businessType === 'cyclical' ? '2–4 years (one cycle); reassess at cycle peaks' : dims.moat?.score >= 7 ? '5–10+ years' : '3–5 years');
