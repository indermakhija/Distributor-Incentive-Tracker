// Red-team review: constructs the strongest case AGAINST the investment from the analysis itself,
// and lists the evidence that would prove the thesis wrong. Optional AI red-team augments (never replaces) this.

import { isNum, pct, round } from './util.js';
import { riskScore } from './scoring.js';

const SEV = { critical: 4, high: 3, medium: 2, low: 1 };

export function redTeam(a) {
  const { company: c, metrics: m, val, dims, forensic, inv } = a;
  const pts = [];
  const add = (severity, claim, evidence, test, source) => pts.push({ severity, claim, evidence, test, source });

  if (val?.reverseDcf && isNum(val.reverseDcf.impliedRevenueCagr10y)) {
    const g = val.reverseDcf.impliedRevenueCagr10y, h = m.growth?.revenue5y;
    if (isNum(h) && g > h + 0.02) add('high', 'The price already assumes the good news — and more.', `The market implies ${pct(g)} revenue growth for 10 years versus ${pct(h)} achieved over the last 5.`, 'Has the company ever compounded revenue at the implied rate for 5+ years? If not, what changes now?', 'valuation');
  }
  if (val?.downsideToBear < -0.35) add('high', 'Asymmetric downside.', `Bear-case value ₹${round(val.intrinsic.bear, 0)} is ${pct(-val.downsideToBear, 0)} below the current price.`, 'Assign an honest probability to the bear case — is it really only 25%?', 'valuation');
  if (val?.status === 'overvalued' || val?.status === 'fair') add('medium', 'No margin of safety.', `Price is ${pct(val.premiumDiscount, 0)} versus base value. Any execution miss flows straight to losses.`, 'What return do you earn if growth matches the base case but the multiple reverts to the historical median?', 'valuation');
  if (!m.empty) {
    if (m.latest.ebitdaMargin > (m.avg5.ebitdaMargin ?? 0) + 0.03) add('high', 'Earnings may be at a cyclical or temporary peak.', `Latest EBITDA margin ${pct(m.latest.ebitdaMargin)} vs 5y average ${pct(m.avg5.ebitdaMargin)}. Valuing peak margins as normal is a classic trap.`, 'Re-run valuation at the 5y average margin. Does the case still work?', 'financial');
    if (m.avg5.fcfToPat < 0.5) add('high', 'Reported profits are not turning into cash.', `Only ${pct(m.avg5.fcfToPat, 0)} of 5y PAT became free cash flow.`, 'Where did the cash go — receivables, inventory, capex? Is that reinvestment earning a return?', 'financial');
    if (m.incrementalRoce < 0.1) add('medium', 'Growth is destroying or barely earning its cost of capital.', `Incremental ROCE over 3 years is ${pct(m.incrementalRoce)}.`, 'Would the business be worth more if it stopped growing?', 'financial');
  }
  for (const f of forensic.flags.filter((x) => SEV[x.severity] >= 2).slice(0, 4))
    add(f.kind === 'confirmed' ? 'high' : 'medium', `Accounting ${f.kind === 'confirmed' ? 'issue' : 'warning'}: ${f.title}.`, f.detail, 'Read the relevant note to accounts and the auditor report; reconcile to cash.', 'forensic');
  for (const r of [...(c.risks || [])].sort((x, y) => riskScore(y) - riskScore(x)).slice(0, 3))
    add(riskScore(r) >= 2 ? 'high' : 'medium', `${r.category}: ${r.description}`, `Probability ${pct(r.probability, 0)}, impact ${r.impact}/5, horizon ${r.horizon || 'n/a'}.`, r.warning ? `Watch: ${r.warning}` : 'Define the early-warning indicator for this risk.', 'risk register');
  const missed = (c.management?.promises || []).filter((p) => p.assessment === 'missed');
  if (missed.length) add('medium', 'Management has missed commitments before.', missed.map((p) => `${p.promise} → ${p.outcome}`).join('; '), 'Discount current guidance by the historical delivery rate.', 'management');
  if (dims.moat?.trend === 'weakening' || dims.moat?.score < 5) add('high', 'The competitive advantage may not be durable.', `Moat score ${dims.moat?.score ?? 'n/a'}/10, trend ${dims.moat?.trend}.`, (c.moat?.disappearanceEvidence || ['Gross margin decline', 'Share loss'])[0], 'moat');
  const p = c.industry?.porter || {};
  for (const [k, v] of Object.entries(p)) if (v?.score >= 7) add('medium', `Industry structure: ${k} is a high threat.`, v.note || '', 'Track pricing behaviour of the top 3 players.', 'industry');
  const spec = (c.catalysts || []).filter((x) => x.status === 'speculative' || x.status === 'announced');
  if (spec.length) add('medium', 'Part of the growth story is not yet real.', spec.map((x) => `${x.name} (${x.status})`).join(', '), 'Value the company excluding unapproved projects.', 'growth');
  if (c.businessModel?.customerConcentration > 0.35) add('high', 'Customer concentration.', `Top customers are ${pct(c.businessModel.customerConcentration, 0)} of revenue.`, 'What happens to margins if the largest customer re-tenders?', 'business');
  if (inv?.completed) {
    for (const b of inv.biases.filter((x) => x.severity === 'high')) add('medium', `Your own process: ${b.label}.`, b.why, b.countermeasure, 'investor');
    if (inv.knowledgeScore < 6) add('medium', 'You may not know enough to hold through volatility.', `Demonstrated knowledge ${inv.knowledgeScore}/10.`, 'Answer the missed evidence questions before buying.', 'investor');
  }
  pts.sort((x, y) => SEV[y.severity] - SEV[x.severity]);
  const top = pts.slice(0, 3);
  const bearThesis = top.length
    ? `The bear case: ${top.map((x) => x.claim.replace(/\.$/, '').toLowerCase()).join('; ')}. If these hold, the realistic outcome is closer to the bear value of ₹${round(val?.intrinsic?.bear, 0) ?? 'n/a'} than the base case.`
    : 'No material counter-arguments were generated from the available evidence — this usually means evidence is missing, not that risk is absent.';
  return { points: pts, strongestThree: top, bearThesis, disconfirmingEvidence: pts.map((x) => x.test).filter(Boolean).slice(0, 8), generatedBy: 'rules' };
}
