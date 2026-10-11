import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NOW = '2026-10-11';
export const sample = (id) => JSON.parse(readFileSync(join(root, 'data', 'sample', `sample-${id}.json`), 'utf8'));

/** A completed, evidence-rich assessment for the DPE sample (clearly labelled test data). */
export const goodAssessment = () => ({
  completedAt: '2026-10-11T00:00:00Z',
  self: { understandModel: 7, explainProfits: 7, knowCompetitors: 6, costDrivers: 7, growthWhy: 7, topRisks: 6, wrongIndicators: 6 },
  evidence: {
    howIndustryMakesMoney: 'Component makers win multi-year orders from railway and defence buyers; revenue depends on order book execution and capacity, with L1 tender pricing and steel pass-through.',
    successFactors: 'Vendor approval, on-time delivery execution, cost competitiveness in L1 tenders and quality tolerance.',
    marginDrivers: 'Steel raw material costs with lagged pass-through, plant utilisation and operating leverage, and mix shift to defence which earns 21% margins.',
    demandDrivers: 'Railway capex budget allocations, Vande Bharat coach and wagon programmes, and defence indigenisation lists.',
    competitorThreats: 'Sample Peer: Konark Rail Systems (fictional) and Sample Peer: Bharat Forge-tech (fictional) could win share.',
    threats: 'Budget cut after elections, L1 tender pricing pressure, imports of cheaper components.',
    warningIndicators: 'Receivable days above 95, book-to-bill below 1, EBITDA margin under 15%, losing L1 status.'
  },
  conviction: {
    reasons: ['research'],
    thesis: 'DPE is an approved vendor with 18-36 month switching costs. An order book of 2.3x revenue supports 15% growth for 5 years. At under 20x earnings the price implies less growth than the base case.',
    supporting: 'Defence revenue beat target by 40%, net cash achieved on time, order book covers 2.3 years of revenue, ROCE above 20%.',
    contradicting: 'Receivable days target missed, government concentration, rail budget could plateau after FY28, plant delays happened before.',
    changeMind: 'Two years of EBITDA margin below 15% or loss of L1 status on repeat tenders.',
    wouldBuyIfNotOwned: 'yes'
  },
  suitability: { amount: 200000, horizonYears: 7, maxDrawdown: 0.5 }
});

export const holdings = () => [
  { name: 'Nifty index fund', sector: 'Diversified', value: 2500000, factors: ['consumer_demand'] },
  { name: 'Private bank', sector: 'Financials', value: 600000, factors: ['rates', 'credit_conditions'] }
];
