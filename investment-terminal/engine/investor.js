// Module J: investor self-knowledge & behavioural fit. Scored independently of company quality.

import { isNum, clamp, mean, round } from './util.js';

export const COMPETENCE_SELF = [
  { id: 'understandModel', q: 'I understand the business model.' },
  { id: 'explainProfits', q: 'I can explain how the company earns profits.' },
  { id: 'knowCompetitors', q: 'I can identify its main competitors.' },
  { id: 'costDrivers', q: 'I understand its major cost drivers.' },
  { id: 'growthWhy', q: 'I can explain why the business may grow over the next five years.' },
  { id: 'topRisks', q: 'I can identify the top three thesis-breaking risks.' },
  { id: 'wrongIndicators', q: 'I know which indicators would tell me the thesis is wrong.' }
];

// Evidence questions: answers are checked against the company's knowledge base (keywords), not against confidence.
export const EVIDENCE_QUESTIONS = [
  { id: 'howIndustryMakesMoney', q: 'Explain how this industry makes money.', key: 'revenueDrivers' },
  { id: 'successFactors', q: 'What are the three most important industry success factors?', key: 'successFactors' },
  { id: 'marginDrivers', q: "What determines the company's margins?", key: 'marginDrivers' },
  { id: 'demandDrivers', q: 'What causes demand to increase or decline?', key: 'demandDrivers' },
  { id: 'competitorThreats', q: 'Which competitors could take market share?', key: 'competitors' },
  { id: 'threats', q: 'What are the biggest regulatory or technological threats?', key: 'threats' },
  { id: 'warningIndicators', q: 'Which indicators would warn you that the thesis is failing?', key: 'warningIndicators' }
];

export const BUY_REASONS = [
  { id: 'research', label: 'My own research', emotional: false },
  { id: 'recommendation', label: 'A recommendation (broker, friend, newsletter)', emotional: true },
  { id: 'social', label: 'Social media / online forums', emotional: true },
  { id: 'fomo', label: 'Fear of missing out', emotional: true },
  { id: 'priceMove', label: 'Recent price movement', emotional: true },
  { id: 'previousHigh', label: 'It is far below its previous high', emotional: true },
  { id: 'product', label: 'I use and like the product', emotional: true }
];

/** Builds the knowledge base of concepts the evidence answers are checked against. */
export function knowledgeBase(company) {
  const ind = company.industry || {};
  const kb = { ...(ind.knowledge || {}) };
  kb.successFactors = kb.successFactors || ind.successFactors || [];
  kb.competitors = kb.competitors || (company.competitors || []).filter((c) => !c.isSelf).map((c) => c.name);
  kb.threats = kb.threats || (company.risks || []).filter((r) => ['regulatory', 'technology', 'industry disruption', 'competitive'].includes((r.category || '').toLowerCase())).flatMap((r) => r.keywords || [r.category]);
  kb.warningIndicators = kb.warningIndicators || (company.risks || []).flatMap((r) => r.keywords || []).concat(['margin', 'market share', 'receivable', 'debt', 'volume']);
  return kb;
}

const norm = (s) => String(s || '').toLowerCase();

/** Scores one free-text answer 0–10 by concept coverage, specificity and length. */
export function gradeAnswer(answer, concepts = []) {
  const a = norm(answer);
  const words = a.split(/\s+/).filter(Boolean).length;
  if (words < 4) return { score: 0, matched: [], missed: concepts.slice(0, 5), note: 'No substantive answer.' };
  const matched = [], missed = [];
  for (const c of concepts) {
    const variants = String(c).toLowerCase().split('|');
    (variants.some((v) => v.split(/\s+/).every((tok) => a.includes(tok))) ? matched : missed).push(variants[0]);
  }
  const coverage = concepts.length ? matched.length / Math.min(concepts.length, 4) : 0.5;
  const specificity = /\d/.test(a) ? 1 : 0; // mentions numbers, % or magnitudes
  const lengthScore = clamp(words / 40, 0, 1);
  const score = clamp(coverage * 7 + specificity * 1 + lengthScore * 2, 0, 10);
  return { score: round(score, 1), matched, missed: missed.slice(0, 5) };
}

export function scoreAssessment(assessment, company) {
  if (!assessment || !assessment.completedAt) return { completed: false, note: 'Investor self-assessment not completed. A BUY decision cannot be finalised until it is.' };
  const kb = knowledgeBase(company);
  const self = mean(COMPETENCE_SELF.map((q) => assessment.self?.[q.id]).filter(isNum));
  const graded = {};
  for (const q of EVIDENCE_QUESTIONS) graded[q.id] = assessment.aiGrades?.[q.id] ?? gradeAnswer(assessment.evidence?.[q.id], kb[q.key] || []);
  const evidence = mean(Object.values(graded).map((g) => g.score));
  const knowledge = isNum(self) && isNum(evidence) ? 0.35 * self + 0.65 * evidence : evidence ?? self;
  const overconfidence = isNum(self) && isNum(evidence) && self - evidence >= 3;

  // Conviction quality.
  const c = assessment.conviction || {};
  const reasons = c.reasons || [];
  const emotional = reasons.filter((r) => BUY_REASONS.find((b) => b.id === r)?.emotional);
  const thesisWords = norm(c.thesis).split(/\s+/).filter(Boolean).length;
  const sentences = String(c.thesis || '').split(/[.!?]+/).filter((s) => s.trim().length > 10).length;
  let conviction = 0;
  conviction += reasons.includes('research') ? 2 : 0;
  conviction += thesisWords >= 25 && sentences >= 2 ? 2 : thesisWords >= 10 ? 1 : 0;
  conviction += norm(c.supporting).split(/\s+/).length >= 15 ? 2 : norm(c.supporting).length > 10 ? 1 : 0;
  conviction += norm(c.contradicting).split(/\s+/).length >= 10 ? 2 : norm(c.contradicting).length > 5 ? 1 : 0;
  conviction += norm(c.changeMind).split(/\s+/).length >= 8 ? 1.5 : 0;
  conviction += c.wouldBuyIfNotOwned === 'yes' ? 0.5 : 0;
  conviction -= emotional.length * 0.75;
  conviction = clamp(conviction, 0, 10);
  const convictionType = conviction >= 6.5 && emotional.length <= 1 ? 'evidence-backed' : emotional.length >= 2 || conviction < 4 ? 'emotional / borrowed' : 'mixed';

  const biases = detectBiases(assessment, { overconfidence, emotional, graded });
  const score = clamp(0.7 * (knowledge ?? 0) + 0.3 * conviction - Math.min(2, biases.filter((b) => b.severity === 'high').length * 0.5), 0, 10);
  return {
    completed: true,
    completedAt: assessment.completedAt,
    selfScore: round(self, 1),
    evidenceScore: round(evidence, 1),
    knowledgeScore: round(knowledge, 1),
    overconfidence,
    graded,
    convictionScore: round(conviction, 1),
    convictionType,
    emotionalReasons: emotional,
    biases,
    score: round(score, 1),
    knowledgeGap: (knowledge ?? 0) < 5,
    gapResearchable: true,
    gaps: Object.entries(graded).filter(([, g]) => g.score < 5).map(([id, g]) => ({ question: EVIDENCE_QUESTIONS.find((q) => q.id === id)?.q, missed: g.missed })),
    suitability: assessment.suitability || {},
    thesisWritten: thesisWords >= 25
  };
}

const COUNTER = {
  confirmation: 'Write down the three strongest facts against the thesis before buying; read the most bearish report you can find.',
  recency: 'Look at 10-year data, not the last 2–3 quarters. Would the case hold through a full cycle?',
  overconfidence: 'Size the position as if you are wrong about one key assumption; ask what you could not answer in the evidence test.',
  anchoring: 'Ignore the previous high and your purchase price. Value the business from cash flows; only intrinsic value vs price matters.',
  herd: 'Re-derive the thesis independently. If the only reason is that others are buying, wait.',
  lossAversion: 'Ask: would I buy this today at this price with fresh cash? If not, holding is the same as buying.',
  sunkCost: 'Past losses are irrelevant to future returns. Re-underwrite the position from scratch.',
  familiarity: 'Liking the product is not the same as owning a good investment. Check unit economics and valuation.',
  narrative: 'Translate the story into numbers: what growth, margin and return on capital must happen, and how likely is it?',
  overtrading: 'Commit to a holding horizon and pre-defined sell triggers; avoid reacting to price moves.'
};

export function detectBiases(a, ctx) {
  const c = a.conviction || {};
  const reasons = c.reasons || [];
  const s = a.suitability || {};
  const out = [];
  const add = (id, label, severity, why) => out.push({ id, label, severity, why, countermeasure: COUNTER[id] });
  if (norm(c.contradicting).split(/\s+/).filter(Boolean).length < 6) add('confirmation', 'Confirmation bias', 'high', 'Little or no contradicting evidence written down.');
  if (reasons.includes('priceMove') || reasons.includes('fomo')) add('recency', 'Recency bias / FOMO', 'medium', 'Decision partly driven by recent price action.');
  if (ctx.overconfidence) add('overconfidence', 'Overconfidence', 'high', 'Self-rated understanding is ≥3 points above demonstrated understanding.');
  if (reasons.includes('previousHigh') || /previous high|52.?week high|fallen from|down \d+%/.test(norm(c.thesis))) add('anchoring', 'Anchoring', 'medium', 'Thesis references a previous price level.');
  if (reasons.includes('social') || reasons.includes('recommendation')) add('herd', 'Herd behaviour', 'medium', 'Idea sourced from others rather than own research.');
  if (s.existingHolder && s.unrealisedLossPct > 0.2 && c.wouldBuyIfNotOwned === 'no') add('lossAversion', 'Loss aversion', 'high', 'Holding a loss-making position you would not buy today.');
  if (s.existingHolder && /average|averag|recover|get back|break.?even/.test(norm(c.thesis + ' ' + c.supporting))) add('sunkCost', 'Sunk-cost fallacy', 'medium', 'Thesis references averaging down or recovering a loss.');
  if (reasons.includes('product') && !reasons.includes('research')) add('familiarity', 'Familiarity bias', 'medium', 'Primary reason is familiarity with the product.');
  if (c.thesis && !/\d/.test(c.thesis)) add('narrative', 'Narrative fallacy', 'low', 'Thesis contains no numbers — story without quantification.');
  if (isNum(s.horizonYears) && s.horizonYears < 1) add('overtrading', 'Overtrading risk', 'medium', 'Horizon under one year for a fundamental investment.');
  return out;
}
