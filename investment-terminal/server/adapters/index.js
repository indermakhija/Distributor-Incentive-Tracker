// Data-source adapters. Each reports its REAL status; nothing is presented as live unless it is.
import { aiStatus } from '../ai/claude.js';

const market = { lastCall: null };

/**
 * Generic licensed-quote adapter. Configure MARKET_DATA_ENDPOINT (+ MARKET_DATA_API_KEY) to point at an authorised
 * provider that returns JSON { price, timestamp } for GET {endpoint}?symbol=TICKER. No scraping fallback exists by design.
 */
export async function fetchQuote(ticker, exchange) {
  const endpoint = process.env.MARKET_DATA_ENDPOINT;
  if (!endpoint) return { ok: false, status: 'not_configured', error: 'No licensed market-data provider configured. Enter the price manually with its date.' };
  if (/^SAMPLE-/.test(ticker)) return { ok: false, status: 'skipped', error: 'Sample companies have no live quotes.' };
  try {
    const url = new URL(endpoint);
    url.searchParams.set('symbol', ticker);
    if (exchange) url.searchParams.set('exchange', exchange);
    const res = await fetch(url, { headers: process.env.MARKET_DATA_API_KEY ? { Authorization: `Bearer ${process.env.MARKET_DATA_API_KEY}` } : {}, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Provider returned no valid price');
    const ts = body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString();
    market.lastCall = { ok: true, at: new Date().toISOString(), ticker };
    return { ok: true, status: 'live', price, priceDate: ts.slice(0, 10), source: url.host };
  } catch (e) {
    market.lastCall = { ok: false, at: new Date().toISOString(), ticker, error: e.message };
    return { ok: false, status: 'error', error: `Market-data request failed: ${e.message}` };
  }
}

export function integrationStatus(counts = {}, bridge = null) {
  const ai = aiStatus();
  return [
    { id: 'sample', name: 'Illustrative sample dataset', status: 'active', detail: `${counts.sample ?? 0} fictional companies, clearly labelled SAMPLE. Not real securities.` },
    { id: 'manual', name: 'Manual upload (CSV / XLSX / PDF / TXT)', status: 'active', detail: 'Financial statements, annual reports, transcripts, rating reports. Parsed locally on the server.' },
    { id: 'market', name: 'Live market prices', status: process.env.MARKET_DATA_ENDPOINT ? (market.lastCall?.ok === false ? 'error' : 'configured') : 'not_configured',
      detail: process.env.MARKET_DATA_ENDPOINT ? `Licensed endpoint configured. Last call: ${market.lastCall ? `${market.lastCall.ok ? 'OK' : 'FAILED — ' + market.lastCall.error} at ${market.lastCall.at}` : 'none yet'}.` : 'Not configured. Set MARKET_DATA_ENDPOINT to a licensed provider. Prices shown are manually entered or sample, with their dates.' },
    { id: 'nifty_bridge', name: 'Nifty terminal bridge (live macro & quotes)', status: bridge?.lastUsed ? (Date.now() - Date.parse(bridge.lastUsed) < 2 * 864e5 ? 'live' : 'configured') : bridge?.tokens ? 'configured' : 'not_configured',
      detail: bridge?.tokens ? `${bridge.tokens} active token(s). Last push/pull: ${bridge.lastUsed || 'never'}. Live macro readings: ${bridge.liveMacro}/${bridge.totalMacro}.` : 'Create a bridge token in Settings and add it to the Nifty terminal backend to stream live macro readings and quotes, and to embed the analyser.' },
    { id: 'filings', name: 'NSE/BSE filings & shareholding', status: 'not_configured', detail: 'Requires an authorised data licence. Restricted sources are not scraped. Upload filings manually or record announcements.' },
    { id: 'news', name: 'News & sentiment feed', status: 'not_configured', detail: 'No licensed news API configured. Earnings-call tone is computed from uploaded transcripts.' },
    { id: 'ai', name: 'AI explanation & red-team layer (Claude)', status: ai.configured ? (ai.last.ok === false ? 'error' : 'configured') : 'not_configured',
      detail: ai.configured ? `Model ${ai.model}. Last call: ${ai.last.at ? (ai.last.ok ? 'OK' : 'FAILED — ' + ai.last.error) + ' at ' + ai.last.at : 'none yet'}.` : 'Set ANTHROPIC_API_KEY on the server to enable. Rule-based explanations and red-team always run.' }
  ];
}
