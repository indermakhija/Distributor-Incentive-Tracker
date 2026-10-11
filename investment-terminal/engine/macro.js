// Macro layer: national (India) and international factors, company sensitivities, current macro regime,
// stress scenarios, and the macro overlay applied to scenario assumptions.
//
// Conventions
// - A factor's SIGNAL is in [-1, 1]: positive = the factor is high versus its neutral level and/or rising.
//   signal = clamp(levelWeight·(current − neutral)/scale + momentumWeight·(current − previous)/scale).
// - A company's SENSITIVITY to a factor is in [-2, 2]: +2 = strongly benefits when the factor rises,
//   −2 = strongly hurt when it rises. Sensitivities are judgments (sector template, tags, balance sheet, or user).
// - Neutral levels and scales below are model assumptions for India-focused analysis, editable per factor.

import { isNum, clamp, round, pct } from './util.js';

const F = (id, scope, name, unit, group, neutral, scale, opts = {}) => ({ id, scope, name, unit, group, neutral, scale, levelWeight: opts.levelWeight ?? 0.5, momentumWeight: opts.momentumWeight ?? 0.5, frequency: opts.frequency || 'monthly', note: opts.note || '' });

export const MACRO_FACTORS = [
  // India
  F('in_repo', 'india', 'RBI repo rate', '%', 'Monetary policy', 6.0, 1.0, { frequency: 'event', note: 'Higher = tighter money; hurts rate-sensitive and leveraged businesses.' }),
  F('in_cpi', 'india', 'CPI inflation (y/y)', '%', 'Prices', 4.0, 1.5, { note: 'RBI target 4%. High inflation squeezes consumer margins and keeps rates high.' }),
  F('in_gdp', 'india', 'Real GDP growth', '%', 'Growth', 6.5, 1.5, { frequency: 'quarterly' }),
  F('in_iip', 'india', 'Industrial production (IIP) growth', '%', 'Growth', 4.5, 3.0),
  F('in_pmi_mfg', 'india', 'Manufacturing PMI', 'index', 'Growth', 55, 3.0, { note: '50 = no change; India typically runs mid-50s.' }),
  F('in_gsec10', 'india', '10-year G-sec yield', '%', 'Monetary policy', 7.0, 0.6, { frequency: 'daily' }),
  F('in_inr', 'india', 'USD/INR', '₹ per $', 'Currency', 85, 3.0, { levelWeight: 0, momentumWeight: 1, frequency: 'daily', note: 'Rising = rupee weakening; helps exporters, hurts importers.' }),
  F('in_fii_flows', 'india', 'FPI net flows (last month)', '₹ \'000 Cr', 'Flows', 0, 20, { levelWeight: 1, momentumWeight: 0, note: 'Positive = foreign buying.' }),
  F('in_credit', 'india', 'Bank credit growth', '%', 'Credit', 12, 3.0),
  F('in_gst', 'india', 'GST collection growth', '%', 'Consumption', 10, 4.0),
  F('in_monsoon', 'india', 'Monsoon rainfall (% of LPA)', '%', 'Rural', 100, 8.0, { frequency: 'seasonal', levelWeight: 1, momentumWeight: 0 }),
  F('in_rural', 'india', 'Real rural wage growth', '%', 'Rural', 1.0, 2.0),
  F('in_govcapex', 'india', 'Central government capex growth', '%', 'Fiscal', 10, 10),
  F('in_fiscal', 'india', 'Fiscal deficit (% of GDP)', '%', 'Fiscal', 4.5, 0.7, { frequency: 'annual' }),
  F('in_vix', 'india', 'India VIX', 'index', 'Risk appetite', 14, 4.0, { frequency: 'daily' }),
  // International
  F('us_fed', 'global', 'US Fed funds rate', '%', 'Monetary policy', 3.0, 1.0, { frequency: 'event' }),
  F('us_10y', 'global', 'US 10-year Treasury yield', '%', 'Monetary policy', 4.0, 0.6, { frequency: 'daily', note: 'Higher US yields pull foreign capital away from emerging markets.' }),
  F('dxy', 'global', 'US dollar index (DXY)', 'index', 'Currency', 100, 4.0, { levelWeight: 0, momentumWeight: 1, frequency: 'daily' }),
  F('brent', 'global', 'Brent crude', '$/bbl', 'Commodities', 75, 12, { frequency: 'daily', note: 'India imports ~85% of its crude: higher oil hurts the CAD, INR, inflation and input costs.' }),
  F('us_cpi', 'global', 'US CPI inflation', '%', 'Prices', 2.5, 1.0),
  F('us_gdp', 'global', 'US real GDP growth', '%', 'Growth', 2.0, 1.0, { frequency: 'quarterly', note: 'Key driver of Indian IT, pharma and specialty-chemical exports.' }),
  F('cn_pmi', 'global', 'China manufacturing PMI', 'index', 'Growth', 50, 1.5),
  F('gl_pmi', 'global', 'Global manufacturing PMI', 'index', 'Growth', 50, 1.5),
  F('copper', 'global', 'Copper (LME)', '$/t', 'Commodities', 9000, 1200, { frequency: 'daily' }),
  F('gold', 'global', 'Gold', '$/oz', 'Commodities', 2400, 250, { levelWeight: 0, momentumWeight: 1, frequency: 'daily' }),
  F('vix', 'global', 'CBOE VIX', 'index', 'Risk appetite', 17, 6, { frequency: 'daily' }),
  F('gpr', 'global', 'Geopolitical risk index', 'index', 'Geopolitics', 100, 40, { note: 'Caldara–Iacoviello style index (100 = long-run average).' })
];
export const FACTOR = Object.fromEntries(MACRO_FACTORS.map((f) => [f.id, f]));

// Sector sensitivity templates (judgment). Keys are matched case-insensitively against sector/industry text.
export const SECTOR_TEMPLATES = {
  fmcg: { label: 'FMCG / consumer staples', exp: { in_monsoon: 1.5, in_rural: 1.5, in_gdp: 1, in_cpi: -1, brent: -1, in_gst: 0.5, in_repo: -0.3 } },
  'capital goods': { label: 'Capital goods / engineering', exp: { in_govcapex: 2, in_iip: 1.5, in_pmi_mfg: 1, in_gdp: 1, in_repo: -1, in_gsec10: -0.5, gl_pmi: 0.5, copper: -0.5 } },
  chemical: { label: 'Chemicals', exp: { gl_pmi: 1.5, cn_pmi: 1, us_gdp: 0.5, in_inr: 1, brent: -1, dxy: 0.3 } },
  'real estate': { label: 'Real estate', exp: { in_repo: -2, in_gsec10: -1.5, in_credit: 1, in_gdp: 1, in_cpi: -0.5 } },
  realty: { ref: 'real estate' },
  bank: { label: 'Banks / lenders', exp: { in_credit: 2, in_gdp: 1.5, in_repo: 0.5, in_gsec10: -1, in_fii_flows: 1, in_vix: -1 } },
  financ: { ref: 'bank' },
  nbfc: { ref: 'bank' },
  it: { label: 'IT services', exp: { us_gdp: 2, in_inr: 1.5, us_fed: -0.5, gl_pmi: 0.5, vix: -0.5 } },
  software: { ref: 'it' },
  auto: { label: 'Automobiles', exp: { in_gdp: 1.5, in_rural: 1, in_repo: -1.5, brent: -1, copper: -0.5, in_credit: 0.5 } },
  pharma: { label: 'Pharmaceuticals', exp: { in_inr: 1.5, us_gdp: 0.5, in_cpi: -0.3 } },
  healthcare: { ref: 'pharma' },
  metal: { label: 'Metals & mining', exp: { cn_pmi: 2, copper: 2, gl_pmi: 1.5, in_govcapex: 1, dxy: -1 } },
  steel: { ref: 'metal' },
  'oil & gas': { label: 'Oil & gas', exp: { brent: 1, in_inr: 0.5, gl_pmi: 0.5 } },
  energy: { ref: 'oil & gas' },
  cement: { label: 'Cement & building materials', exp: { in_govcapex: 2, in_monsoon: 0.5, in_gdp: 1, brent: -1, in_repo: -0.5 } },
  power: { label: 'Power & utilities', exp: { in_gdp: 1, in_iip: 1, in_gsec10: -1, in_repo: -1 } },
  utilit: { ref: 'power' },
  'consumer durable': { label: 'Consumer durables', exp: { in_gdp: 1.5, in_repo: -1, copper: -1, in_cpi: -0.5 } },
  retail: { label: 'Retail / discretionary', exp: { in_gdp: 1.5, in_cpi: -1, in_repo: -0.5, in_gst: 0.5 } },
  telecom: { label: 'Telecom', exp: { in_gsec10: -0.5, in_repo: -0.5, in_gdp: 0.5 } },
  diversified: { label: 'Diversified / index', exp: { in_gdp: 1, in_fii_flows: 1, in_vix: -1, us_10y: -0.5 } }
};

// Thematic tags already used on companies/holdings → sensitivities.
export const TAG_EXPOSURES = {
  consumer_demand: { in_gdp: 0.5, in_gst: 0.5 }, rural_income: { in_monsoon: 1, in_rural: 1 }, commodity_inputs: { brent: -0.5, copper: -0.3 },
  capex_cycle: { in_govcapex: 0.5, in_iip: 0.5 }, government_spending: { in_govcapex: 1 }, rates: { in_repo: -1, in_gsec10: -0.5 },
  credit_conditions: { in_credit: 1 }, global_demand: { gl_pmi: 1 }, inr_usd: { in_inr: 1 }, china_supply: { cn_pmi: -0.5 },
  housing_cycle: { in_repo: -0.5 }, it_spending: { us_gdp: 1 }, crude_oil: { brent: -1 }
};

/** Resolves a company's factor sensitivities with a transparent basis for each. */
export function macroExposure(company, metrics) {
  const acc = {};
  const add = (id, v, basis) => { if (!FACTOR[id] || !v) return; (acc[id] = acc[id] || { value: 0, basis: [] }); acc[id].value += v; acc[id].basis.push(`${basis} ${v > 0 ? '+' : ''}${v}`); };
  const text = `${company.sector || ''} ${company.industry?.name || ''}`.toLowerCase();
  let template = null;
  for (const [key, t] of Object.entries(SECTOR_TEMPLATES)) if (new RegExp(`\\b${key.replace(/[&]/g, '\\$&')}`).test(text)) { template = t.ref ? { key: t.ref, ...SECTOR_TEMPLATES[t.ref] } : { key, ...t }; break; }
  if (template) for (const [id, v] of Object.entries(template.exp)) add(id, v, `sector (${template.label})`);
  for (const tag of company.macroFactors || []) for (const [id, v] of Object.entries(TAG_EXPOSURES[tag] || {})) add(id, v, `tag ${tag}`);
  const nde = metrics?.latest?.netDebtToEbitda;
  if (isNum(nde) && nde > 2) { add('in_repo', -1, 'leverage (net debt/EBITDA > 2x)'); add('in_gsec10', -0.5, 'leverage'); }
  const exportShare = exportShareOf(company);
  if (isNum(exportShare) && exportShare >= 0.2) { add('in_inr', Math.min(1.5, exportShare * 2), `exports ${pct(exportShare, 0)} of revenue`); add('gl_pmi', 0.5, 'export demand'); }
  const out = {};
  for (const [id, x] of Object.entries(acc)) out[id] = { value: round(clamp(x.value, -2, 2), 2), basis: x.basis.join('; '), source: 'judgment (auto)' };
  for (const [id, v] of Object.entries(company.macroExposure || {})) {
    const val = typeof v === 'object' ? v.value : v;
    if (FACTOR[id] && isNum(Number(val))) out[id] = { value: clamp(Number(val), -2, 2), basis: (typeof v === 'object' && v.basis) || 'user override', source: 'user judgment' };
  }
  return { exposures: out, template: template?.label || null };
}

function exportShareOf(c) {
  if (isNum(c.businessModel?.exportShare)) return c.businessModel.exportShare;
  const geo = (c.businessModel?.geographic || []).join(' ');
  const m = geo.match(/exports?\s*(\d{1,3})\s*%/i) || geo.match(/(\d{1,3})\s*%\s*exports?/i);
  return m ? Number(m[1]) / 100 : null;
}

/** Signal per factor from a dataset { factorId: { value, previous, asOf, source, type } }. */
export function macroSignals(dataset = {}, now = new Date()) {
  const out = {};
  for (const f of MACRO_FACTORS) {
    const r = dataset[f.id];
    if (!r || !isNum(r.value)) { out[f.id] = { ...f, available: false, signal: 0 }; continue; }
    const neutral = isNum(r.neutral) ? r.neutral : f.neutral;
    const lvl = (r.value - neutral) / f.scale;
    const mom = isNum(r.previous) ? (r.value - r.previous) / f.scale : 0;
    const raw = f.levelWeight * lvl + f.momentumWeight * mom;
    const ageDays = r.asOf ? (now - new Date(r.asOf)) / 864e5 : null;
    const staleLimit = { daily: 5, event: 120, monthly: 75, quarterly: 150, seasonal: 400, annual: 500 }[f.frequency] || 90;
    out[f.id] = { ...f, available: true, value: r.value, previous: r.previous ?? null, neutral, asOf: r.asOf || null, source: r.source || 'unknown', type: r.type || 'manual', signal: round(clamp(raw, -1, 1), 3), ageDays: ageDays == null ? null : round(ageDays, 0), stale: ageDays == null ? null : ageDays > staleLimit, direction: !isNum(r.previous) ? 'n/a' : r.value > r.previous ? 'rising' : r.value < r.previous ? 'falling' : 'flat' };
  }
  return out;
}

/** Current macro impact on a company: −1 (strong headwind) … +1 (strong tailwind); score 0–10. */
export function macroImpact(exposures, signals) {
  const rows = [];
  let num = 0, den = 0;
  for (const [id, e] of Object.entries(exposures)) {
    const s = signals[id];
    if (!s?.available) { rows.push({ id, name: FACTOR[id].name, scope: FACTOR[id].scope, sensitivity: e.value, signal: null, contribution: null, basis: e.basis, missing: true }); continue; }
    const c = e.value * s.signal;
    num += c; den += Math.abs(e.value);
    rows.push({ id, name: s.name, scope: s.scope, sensitivity: e.value, signal: s.signal, contribution: round(c, 3), basis: e.basis, value: s.value, unit: s.unit, direction: s.direction, stale: s.stale });
  }
  rows.sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0));
  const impact = den ? clamp(num / Math.max(den, 2), -1, 1) : 0;
  const totalSens = Object.values(exposures).reduce((a, e) => a + Math.abs(e.value), 0);
  const sensitivity = totalSens >= 7 ? 'high' : totalSens >= 3.5 ? 'medium' : 'low';
  const coverage = rows.length ? rows.filter((r) => !r.missing).length / rows.length : 0;
  return {
    impact: round(impact, 3), score: round(5 + 5 * impact, 1), sensitivity, sensitivityTotal: round(totalSens, 1), coverage: round(coverage, 2), rows,
    tailwinds: rows.filter((r) => r.contribution > 0.05), headwinds: rows.filter((r) => r.contribution < -0.05),
    national: rows.filter((r) => r.scope === 'india' && !r.missing).reduce((a, r) => a + r.contribution, 0),
    international: rows.filter((r) => r.scope === 'global' && !r.missing).reduce((a, r) => a + r.contribution, 0)
  };
}

/**
 * Overlay of the current macro regime onto operating assumptions (years 1–5): growth ±3pp and margin ±1.5pp at most,
 * scaled by how macro-sensitive the business is. Applied only to auto-derived scenarios unless macroOverlay is forced.
 */
export function macroOverlay(mi) {
  const sens = Math.min(1, (mi.sensitivityTotal || 0) / 7);
  return { growth: round(mi.impact * 0.03 * Math.max(0.35, sens), 4), margin: round(mi.impact * 0.015 * Math.max(0.35, sens), 4) };
}

// Stress scenarios: shocks in each factor's own units (judgment; editable in code/settings).
export const STRESS_SCENARIOS = [
  { id: 'oil_shock', name: 'Oil shock', scope: 'global', shocks: { brent: 35, in_cpi: 1.5, in_inr: 4, in_repo: 0.5 }, note: 'Brent +$35/bbl with second-round inflation and a weaker rupee.' },
  { id: 'rate_hike', name: 'Rate-hike cycle', scope: 'india', shocks: { in_repo: 1.0, in_gsec10: 0.6, us_fed: 0.75, us_10y: 0.6 }, note: 'RBI +100bp, US +75bp.' },
  { id: 'inr_slide', name: 'Rupee depreciation & FPI outflows', scope: 'india', shocks: { in_inr: 8, dxy: 6, in_fii_flows: -30 }, note: 'USD/INR +₹8, sustained foreign selling.' },
  { id: 'global_recession', name: 'Global recession', scope: 'global', shocks: { gl_pmi: -5, us_gdp: -3, cn_pmi: -4, brent: -25, copper: -2500, vix: 15, in_gdp: -2, in_iip: -4, in_fii_flows: -40 }, note: 'Synchronised downturn; commodities fall, risk-off.' },
  { id: 'weak_monsoon', name: 'Weak monsoon', scope: 'india', shocks: { in_monsoon: -18, in_cpi: 1.2, in_rural: -2 }, note: 'Rainfall 18% below normal; food inflation, weaker rural demand.' },
  { id: 'china_slowdown', name: 'China slowdown & dumping', scope: 'global', shocks: { cn_pmi: -3, copper: -1500, gl_pmi: -1.5 }, note: 'Weak Chinese demand, excess capacity exported.' },
  { id: 'capex_cut', name: 'Government capex cut', scope: 'india', shocks: { in_govcapex: -20, in_iip: -2, in_fiscal: -0.5 }, note: 'Fiscal consolidation via capex cuts.' },
  { id: 'geopolitical', name: 'Geopolitical shock', scope: 'global', shocks: { gpr: 80, brent: 20, vix: 12, in_vix: 8, in_fii_flows: -25 }, note: 'Conflict escalation: oil up, risk-off.' },
  { id: 'easing', name: 'Easing & risk-on (upside)', scope: 'global', shocks: { in_repo: -1, us_fed: -1, us_10y: -0.5, in_fii_flows: 30, vix: -6, in_gdp: 1 }, note: 'Coordinated rate cuts and inflows.' }
];

/** Impact of a shock on the company in [-1, 1], then translated to growth/margin deltas (years 1–5). */
export function stressImpact(exposures, shocks) {
  let num = 0;
  const parts = [];
  for (const [id, shock] of Object.entries(shocks)) {
    const e = exposures[id];
    if (!e || !FACTOR[id]) continue;
    const s = clamp(shock / FACTOR[id].scale, -2, 2);
    num += e.value * s;
    parts.push({ id, name: FACTOR[id].name, shock, sensitivity: e.value, effect: round(e.value * s, 2) });
  }
  const impact = clamp(num / 4, -1, 1);
  return { impact: round(impact, 3), growthDelta: round(impact * 0.06, 4), marginDelta: round(impact * 0.03, 4), parts: parts.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)) };
}

export function regimeLabel(score) {
  if (score >= 7) return 'Strong macro tailwind';
  if (score >= 5.75) return 'Mild tailwind';
  if (score > 4.25) return 'Neutral';
  if (score > 3) return 'Mild headwind';
  return 'Strong macro headwind';
}

/** Dataset-level summary, independent of any company. */
export function macroDatasetQuality(signals) {
  const vals = Object.values(signals);
  const available = vals.filter((s) => s.available);
  const sample = available.filter((s) => s.type === 'sample').length;
  const stale = available.filter((s) => s.stale).length;
  const live = available.filter((s) => s.type === 'live').length;
  return { total: vals.length, available: available.length, sample, stale, live, status: !available.length ? 'missing' : sample === available.length ? 'sample' : live ? 'live' : 'manual' };
}
