// Screen 8: competitive advantage & economic moat (Module E).
import { html, mount, $, pct } from '../../ui.js';
import { MOAT_SOURCES } from '/engine/scoring.js';
import { scoreEditor, bindScoreEditors, readScores, saveSection, dimCard } from '../common.js';

export default function moat(el, { app }) {
  const { company: c, analysis: a } = app.co;
  const mo = c.moat || {};
  const d = a.dims.moat;
  mount(el, html`
    <div class="grid g3">
      <div class="tile"><div class="label">Moat score</div><div class="value">${d.score ?? 'n/a'}/10</div><div class="sub">${d.width} · trend: ${d.trend}</div></div>
      <div class="tile"><div class="label">Probability advantage persists</div><div class="value" style="font-size:18px">3y ${pct(d.durability.y3, 0)} · 5y ${pct(d.durability.y5, 0)} · 10y ${pct(d.durability.y10, 0)}</div><div class="sub">${d.durabilityNote}</div></div>
      <div class="tile"><div class="label">Evidence in the numbers</div><div class="value" style="font-size:18px">${d.components.find((x) => x.name.includes('ROIC'))?.note || 'n/a'}</div><div class="sub">A moat should show up as returns above the cost of capital.</div></div>
    </div>
    <p class="banner info" style="margin-top:12px">A famous brand or high market share is not automatically a moat. Score a source only when there is evidence competitors cannot replicate it.</p>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Moat sources (0–10)</h3><button class="btn small" id="saveM">Save</button></div>
        ${scoreEditor('moatSrc', MOAT_SOURCES, mo.sources || {})}
        <div class="field" style="margin-top:10px"><label>Is the moat strengthening or weakening?</label><select id="trend">${['', 'strengthening', 'stable', 'weakening'].map((o) => html`<option ${o === (mo.trend || '') ? 'selected' : ''}>${o}</option>`)}</select></div>
        <div class="field"><label>What makes it difficult to compete against? Can competitors replicate it?</label><textarea id="replicable">${mo.replicable || ''}</textarea></div>
        <div class="field"><label>Evidence that would prove the moat is disappearing (one per line)</label><textarea id="disappear">${(mo.disappearanceEvidence || []).join('\n')}</textarea></div>
      </div>
      ${dimCard(d)}
    </div>`);
  bindScoreEditors(el);
  $('#saveM').onclick = () => saveSection(app, { moat: { ...mo, sources: readScores(el, 'moatSrc'), trend: $('#trend').value || null, replicable: $('#replicable').value, disappearanceEvidence: $('#disappear').value.split('\n').map((s) => s.trim()).filter(Boolean) } }).then(() => moat(el, { app }));
}
