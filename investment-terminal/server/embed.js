// Server-rendered analyser card for embedding in the Nifty terminal's analyser page (iframe).
// Self-contained: inline CSS only, no scripts, light/dark aware.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, dp = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const inr = (v) => (Number.isFinite(v) ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—');
const TONE = { BUY: 'pos', BUY_BELOW: 'pos', WAIT: 'warn', WATCHLIST: 'neu', HOLD: 'neu', REDUCE: 'warn', SELL_AVOID: 'neg', INSUFFICIENT: 'neu' };

export function embedHtml(c) {
  const bar = (s) => `<span class="bar"><i style="width:${Number.isFinite(s) ? s * 10 : 0}%"></i></span>`;
  const v = c.valuation;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analyser — ${esc(c.company.ticker || c.company.name)}</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--fg:#0b0b0b;--mut:#6b6a64;--line:#e1e0d9;--chip:#f0efec;--pos:#006300;--pos-s:#e3f4e3;--neg:#b02a2a;--neg-s:#fbe3e3;--warn:#8a5a00;--warn-s:#fdf3dc;--acc:#2a78d6;--acc-s:#e4eefb}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#1a1a19;--fg:#f0efec;--mut:#a3a199;--line:#2c2c2a;--chip:#242422;--pos:#2fc42f;--pos-s:#13281a;--neg:#f07272;--neg-s:#351b1b;--warn:#fab219;--warn-s:#2e2510;--acc:#3987e5;--acc-s:#1b2b40}}
*{box-sizing:border-box}body{margin:0;padding:14px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
h1{font-size:16px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin:14px 0 6px}
.row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}.mut{color:var(--mut)}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:700;font-size:12px;background:var(--chip)}
.pos{background:var(--pos-s);color:var(--pos)}.neg{background:var(--neg-s);color:var(--neg)}.warn{background:var(--warn-s);color:var(--warn)}.neu{background:var(--acc-s);color:var(--acc)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.tile{border:1px solid var(--line);border-radius:8px;padding:8px}
.tile b{display:block;font-size:16px}.bar{display:inline-block;width:70px;height:6px;background:var(--chip);border-radius:3px;vertical-align:middle;margin-left:6px}.bar i{display:block;height:100%;background:var(--acc);border-radius:3px}
table{width:100%;border-collapse:collapse}td{padding:3px 4px;border-bottom:1px solid var(--line);vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums}
.banner{background:var(--warn-s);border:1px solid var(--warn);border-radius:6px;padding:6px 8px;margin-bottom:10px}ul{margin:0;padding-left:18px}
</style></head><body>
${c.company.dataStatus === 'sample' ? '<div class="banner"><b>Illustrative sample company</b> — fictional data, not a real security.</div>' : ''}
<div class="row"><div><h1>${esc(c.company.name)}</h1><div class="mut">${esc(c.company.ticker || '')} · ${esc(c.company.sector || '')}</div></div>
<div style="text-align:right"><span class="chip ${TONE[c.decision.code] || 'neu'}">${esc(c.decision.label)}</span>${c.decision.status === 'provisional' ? ' <span class="chip">provisional</span>' : ''}
<div class="mut">Price ${inr(c.price.value)} · ${esc(c.price.asOf || 'undated')} · ${esc(c.price.type || '')}</div></div></div>
<p>${esc(c.businessVsInvestment)}</p>
<div class="grid">
<div class="tile">Holistic score<b>${c.holistic}/100</b><span class="mut">${esc(c.band)}</span></div>
<div class="tile">Business quality<b>${c.quality ?? '—'}/10</b></div>
<div class="tile">Valuation<b style="font-size:13px">${esc(v?.statusLabel || '—')}</b><span class="mut">MoS ${pct(v?.marginOfSafety)} (need ${pct(v?.requiredMarginOfSafety)})</span></div>
<div class="tile">Bear / Base / Bull<b style="font-size:13px">${inr(v?.bear)} / ${inr(v?.base)} / ${inr(v?.bull)}</b></div>
<div class="tile">Macro<b style="font-size:13px">${esc(c.macro.regime)}</b><span class="mut">${c.macro.score ?? '—'}/10 · ${esc(c.macro.sensitivity)} sensitivity</span></div>
<div class="tile">Confidence<b>${pct(c.decision.confidence)}</b></div>
</div>
${c.decision.entryPrice ? `<p><b>Entry price:</b> ${inr(c.decision.entryPrice)} or lower.</p>` : ''}
<h2>Macro — national &amp; international</h2>
<div class="row"><div style="flex:1;min-width:200px"><b>Tailwinds</b><ul>${c.macro.tailwinds.map((t) => `<li>${esc(t.factor)} <span class="mut">(${t.scope === 'india' ? 'India' : 'global'})</span></li>`).join('') || '<li class="mut">none</li>'}</ul></div>
<div style="flex:1;min-width:200px"><b>Headwinds</b><ul>${c.macro.headwinds.map((t) => `<li>${esc(t.factor)} <span class="mut">(${t.scope === 'india' ? 'India' : 'global'})</span></li>`).join('') || '<li class="mut">none</li>'}</ul></div></div>
<table>${c.macro.stress.filter((s) => Number.isFinite(s.vsBase)).map((s) => `<tr><td>${esc(s.name)}</td><td class="n">${inr(s.value)}</td><td class="n">${pct(s.vsBase)} vs base</td></tr>`).join('')}</table>
<h2>Scores</h2><table>${c.dimensions.map((d) => `<tr><td>${esc(d.label)}</td><td class="n">${d.score ?? 'n/a'}${bar(d.score)}</td></tr>`).join('')}</table>
<h2>Strongest case against</h2><ul>${c.redTeam.map((p) => `<li>${esc(p.claim)}</li>`).join('')}</ul>
${c.overrides.filter((o) => o.cap).length ? `<h2>Overrides applied</h2><ul>${c.overrides.filter((o) => o.cap).map((o) => `<li>${esc(o.title)}</li>`).join('')}</ul>` : ''}
<p class="mut" style="margin-top:12px">${esc(c.disclaimer)} Generated ${esc(c.generatedAt)}.</p>
</body></html>`;
}
