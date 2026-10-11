// Optional AI explanation layer (Claude). Runs only on the backend; the API key never reaches the browser.
// All AI output is labelled "AI-generated" and is grounded strictly in the computed analysis passed in.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
let client = null;
let lastStatus = { ok: null, at: null, error: null };

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const aiStatus = () => ({ configured: aiConfigured(), model: MODEL, last: lastStatus });

const SYSTEM = `You are the AI research layer of an investment decision-support terminal for Indian listed equities.
Rules you must follow:
- Use ONLY the JSON evidence supplied. Never invent company figures, management statements, prices, forecasts or sources.
- Label every statement as [FACT] (reported data in the evidence), [CALC] (computed metric in the evidence), [ESTIMATE] (model assumption) or [OPINION] (your judgment).
- If the evidence is marked as sample/illustrative data, say so at the top.
- Never predict share prices with certainty and never claim risk can be eliminated.
- Challenge the investor's thesis rather than confirming it. Be concise and specific.`;

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

async function complete(task, evidence, maxTokens = 4000) {
  if (!aiConfigured()) return { available: false, text: null, note: 'AI layer not configured (set ANTHROPIC_API_KEY on the server).' };
  try {
    const res = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${task}\n\n<evidence>\n${JSON.stringify(evidence)}\n</evidence>` }]
    });
    if (res.stop_reason === 'refusal') {
      lastStatus = { ok: false, at: new Date().toISOString(), error: 'refusal' };
      return { available: true, text: null, note: 'The AI model declined this request.' };
    }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    lastStatus = { ok: true, at: new Date().toISOString(), error: null };
    return { available: true, text, model: res.model, label: 'AI-generated — verify against sources', truncated: res.stop_reason === 'max_tokens' };
  } catch (e) {
    lastStatus = { ok: false, at: new Date().toISOString(), error: e?.status ? `HTTP ${e.status}` : e.message };
    return { available: true, text: null, error: `AI request failed: ${lastStatus.error}` };
  }
}

/** Reduces the analysis to the evidence the model needs (keeps prompts small and grounded). */
export function evidenceFrom(a) {
  return {
    company: a.company, dataQuality: { status: a.dataQuality.status, confidence: a.dataQuality.confidence, issues: a.dataQuality.issues.map((i) => i.text) },
    latestMetrics: a.metrics.latest, growth: a.metrics.growth && { revenue5y: a.metrics.growth.revenue5y, pat5y: a.metrics.growth.pat5y },
    forensicFlags: a.forensic.flags.map((f) => ({ title: f.title, kind: f.kind, detail: f.detail })),
    dimensions: Object.fromEntries(Object.entries(a.dims).map(([k, d]) => [k, { score: d.score, positives: d.positives.slice(0, 4), negatives: d.negatives.slice(0, 4), missing: d.missing }])),
    valuation: a.valuation && { status: a.valuation.status, price: a.valuation.price, intrinsic: a.valuation.intrinsic, marginOfSafety: a.valuation.marginOfSafety, reverseDcf: a.valuation.reverseDcf, multiples: a.valuation.multiples },
    decision: { code: a.decision.code, rules: a.decision.rules.map((r) => r.title), trace: a.decision.trace },
    redTeamRules: a.redTeam.strongestThree, investor: a.investor.completed ? { knowledge: a.investor.knowledgeScore, conviction: a.investor.convictionType, biases: a.investor.biases.map((b) => b.label) } : 'not completed'
  };
}

export const explain = (a) => complete('Explain this analysis to a non-specialist investor in under 350 words: what the business does, whether it is a good business, whether the price is attractive, and why the decision engine reached its decision. Distinguish a great business from a great investment.', evidenceFrom(a), 2500);

export const aiRedTeam = (a) => complete('Act as a red team. Build the strongest possible case AGAINST buying this stock, using only the evidence. List the 5 most damaging arguments, each with the evidence that supports it and the specific evidence that would disprove it. Then state which assumptions must hold for the bull case.', evidenceFrom(a), 3000);

export async function gradeKnowledge(question, answer, concepts) {
  const r = await complete(`Grade this investor's answer for demonstrated understanding (not confidence). Return ONLY JSON: {"score":0-10,"matched":[...],"missed":[...],"feedback":"one sentence"}.\nQuestion: ${question}\nAnswer: ${answer}`, { referenceConcepts: concepts }, 800);
  if (!r.text) return null;
  try { const m = r.text.match(/\{[\s\S]*\}/); const g = JSON.parse(m[0]); return { score: Math.max(0, Math.min(10, Number(g.score))), matched: g.matched || [], missed: g.missed || [], feedback: g.feedback, source: 'ai' }; } catch { return null; }
}
