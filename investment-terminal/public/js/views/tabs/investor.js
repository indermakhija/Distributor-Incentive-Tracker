// Screen 12: investor self-assessment — circle of competence, conviction, suitability, behavioural risk (Module J).
import { html, mount, $, $$, pct, toast, busy, list, sev } from '../../ui.js';
import { put, post } from '../../api.js';
import { COMPETENCE_SELF, EVIDENCE_QUESTIONS, BUY_REASONS } from '/engine/investor.js';

export default function investor(el, { app }) {
  const { company: c, analysis: a, ctx } = app.co;
  const as = ctx.assessment || {};
  const cv = as.conviction || {};
  const sv = as.suitability || {};
  const inv = a.investor;
  const n = (v) => (v == null ? '' : v);
  mount(el, html`
    <p class="banner info">This assessment is scored <b>independently</b> of the company. It tests demonstrated understanding (your written answers are checked against the company's knowledge base) rather than how confident you feel. A knowledge gap is researchable — it means "learn first or start small", not "bad company".</p>
    ${inv.completed ? html`<div class="grid g4">
      <div class="tile"><div class="label">Demonstrated knowledge</div><div class="value">${inv.knowledgeScore}/10</div><div class="sub">Self ${inv.selfScore} · evidence ${inv.evidenceScore}${inv.overconfidence ? ' · ⚠ overconfidence' : ''}</div></div>
      <div class="tile"><div class="label">Conviction quality</div><div class="value">${inv.convictionScore}/10</div><div class="sub">${inv.convictionType}</div></div>
      <div class="tile"><div class="label">Behavioural flags</div><div class="value">${inv.biases.length}</div><div class="sub">${inv.biases.filter((b) => b.severity === 'high').length} high severity</div></div>
      <div class="tile"><div class="label">Investor dimension</div><div class="value">${inv.score}/10</div><div class="sub">Completed ${new Date(inv.completedAt).toLocaleDateString()}</div></div></div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Evidence answers — graded</h3><div class="table-wrap"><table><thead><tr><th>Question</th><th class="num">Score</th><th>Concepts covered</th><th>Missed</th></tr></thead><tbody>
          ${EVIDENCE_QUESTIONS.map((q) => { const g = inv.graded[q.id] || {}; return html`<tr><td>${q.q}</td><td class="num"><b>${g.score ?? '—'}</b>${g.source === 'ai' ? html` <span class="prov ai">AI</span>` : ''}</td><td>${(g.matched || []).join(', ')}</td><td class="muted">${(g.missed || []).join(', ')}${g.feedback ? html`<br>${g.feedback}` : ''}</td></tr>`; })}</tbody></table></div>
          <div class="btn-row"><button class="btn ghost small" id="aiGrade">Grade with AI (if configured)</button></div>
          ${inv.gaps.length ? html`<h4 style="margin-top:10px">Knowledge gaps to research</h4>${list(inv.gaps.map((g) => `${g.question} — consider: ${g.missed.join(', ') || 'more specifics'}`))}` : ''}</div>
        <div class="card"><h3>Behavioural risks & countermeasures</h3>${inv.biases.length ? html`<ul>${inv.biases.map((b) => html`<li>${sev(b.severity)} <b>${b.label}</b> — ${b.why}<br><span class="muted">Countermeasure: ${b.countermeasure}</span></li>`)}</ul>` : html`<p class="muted">No behavioural flags from your answers.</p>`}</div>
      </div>` : html`<div class="banner sample"><b>Not completed.</b> ${inv.note}</div>`}
    <form id="assessForm" class="stack" style="margin-top:16px">
      <div class="card"><h3>A. Circle of competence — self-assessment (0 = not at all, 10 = completely)</h3>
        ${COMPETENCE_SELF.map((q) => html`<div class="slider-row"><label style="margin:0" for="s-${q.id}">${q.q}</label><input type="range" id="s-${q.id}" min="0" max="10" step="1" value="${n(as.self?.[q.id] ?? 5)}" data-self="${q.id}"><output>${n(as.self?.[q.id] ?? 5)}</output></div>`)}</div>
      <div class="card"><h3>Evidence questions — answer in your own words</h3>
        ${EVIDENCE_QUESTIONS.map((q) => html`<div class="field"><label for="e-${q.id}">${q.q}</label><textarea id="e-${q.id}" data-ev="${q.id}" rows="3">${as.evidence?.[q.id] || ''}</textarea></div>`)}</div>
      <div class="card"><h3>B. Conviction quality</h3>
        <div class="field"><label>Why do I want to buy this company? (select all that apply — be honest)</label>
          <div class="btn-row">${BUY_REASONS.map((r) => html`<label style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" data-reason="${r.id}" ${(cv.reasons || []).includes(r.id) ? 'checked' : ''}> ${r.label}</label>`)}</div></div>
        <div class="field"><label>My investment thesis in three sentences (include numbers)</label><textarea id="thesis" rows="3">${cv.thesis || ''}</textarea></div>
        <div class="grid g2"><div class="field"><label>Evidence that supports my thesis</label><textarea id="supporting">${cv.supporting || ''}</textarea></div>
          <div class="field"><label>Evidence that contradicts my thesis</label><textarea id="contradicting">${cv.contradicting || ''}</textarea></div></div>
        <div class="field"><label>What evidence would change my mind?</label><textarea id="changeMind" rows="2">${cv.changeMind || ''}</textarea></div>
        <div class="field"><label>Would I buy this business today if I did not already own it?</label><select id="wouldBuy">${['unsure', 'yes', 'no'].map((o) => html`<option ${o === (cv.wouldBuyIfNotOwned || 'unsure') ? 'selected' : ''}>${o}</option>`)}</select></div></div>
      <div class="card"><h3>C. Personal suitability</h3><div class="grid g3">
        <div class="field"><label>Investment amount (₹)</label><input id="amount" type="number" value="${n(sv.amount)}"></div>
        <div class="field"><label>Investment horizon (years)</label><input id="horizonYears" type="number" step="any" value="${n(sv.horizonYears)}"></div>
        <div class="field"><label>Money needed within (months), if any</label><input id="liquidityNeedMonths" type="number" value="${n(sv.liquidityNeedMonths)}"></div>
        <div class="field"><label>Drawdown I can tolerate (%)</label><input id="maxDrawdown" type="number" value="${sv.maxDrawdown != null ? sv.maxDrawdown * 100 : ''}"></div>
        <div class="field"><label>Max acceptable permanent loss (%)</label><input id="maxPermanentLoss" type="number" value="${sv.maxPermanentLoss != null ? sv.maxPermanentLoss * 100 : ''}"></div>
        <div class="field"><label>Style preference</label><select id="style">${['', 'growth', 'value', 'income', 'special situations'].map((o) => html`<option ${o === (sv.style || '') ? 'selected' : ''}>${o}</option>`)}</select></div>
        <div class="field"><label><input type="checkbox" id="incomeNeed" ${sv.incomeNeed ? 'checked' : ''}> I need income from this investment</label></div>
        <div class="field"><label><input type="checkbox" id="willingToMonitor" ${sv.willingToMonitor ? 'checked' : ''}> I will monitor results every quarter</label></div>
        <div class="field"><label><input type="checkbox" id="existingHolder" ${sv.existingHolder ? 'checked' : ''}> I already own this stock</label></div>
        <div class="field"><label>Unrealised loss on existing holding (%)</label><input id="unrealisedLossPct" type="number" value="${sv.unrealisedLossPct != null ? sv.unrealisedLossPct * 100 : ''}"></div>
        <div class="field" style="grid-column:1/-1"><label>Tax & transaction-cost notes</label><input id="taxNotes" value="${sv.taxNotes || ''}"></div></div>
        <p class="muted">Your risk tolerance is not the same thing as the company's business risk — both are assessed separately.</p></div>
      <div class="btn-row"><button class="btn ghost" type="button" id="saveDraft">Save draft</button><button class="btn" type="submit">Complete assessment</button></div>
    </form>`);
  el.addEventListener('input', (e) => { if (e.target.dataset.self) e.target.nextElementSibling.textContent = e.target.value; });
  const collect = () => {
    const pctOrNull = (id) => ($('#' + id).value === '' ? null : Number($('#' + id).value) / 100);
    return {
      self: Object.fromEntries($$('[data-self]', el).map((i) => [i.dataset.self, Number(i.value)])),
      evidence: Object.fromEntries($$('[data-ev]', el).map((i) => [i.dataset.ev, i.value])),
      conviction: { reasons: $$('[data-reason]:checked', el).map((i) => i.dataset.reason), thesis: $('#thesis').value, supporting: $('#supporting').value, contradicting: $('#contradicting').value, changeMind: $('#changeMind').value, wouldBuyIfNotOwned: $('#wouldBuy').value },
      suitability: { amount: $('#amount').value, horizonYears: $('#horizonYears').value, liquidityNeedMonths: $('#liquidityNeedMonths').value, maxDrawdown: pctOrNull('maxDrawdown'), maxPermanentLoss: pctOrNull('maxPermanentLoss'), style: $('#style').value, incomeNeed: $('#incomeNeed').checked, willingToMonitor: $('#willingToMonitor').checked, existingHolder: $('#existingHolder').checked, unrealisedLossPct: pctOrNull('unrealisedLossPct'), taxNotes: $('#taxNotes').value },
      aiGrades: as.aiGrades
    };
  };
  const save = async (complete, btn) => {
    await busy(btn, () => put(`/api/companies/${c.id}/assessment`, { ...collect(), complete }));
    toast(complete ? 'Assessment completed — decision recomputed.' : 'Draft saved.');
    await app.loadCompany(c.id, true);
    dispatchEvent(new HashChangeEvent('hashchange'));
  };
  $('#saveDraft').onclick = (e) => save(false, e.target);
  $('#assessForm').onsubmit = (e) => { e.preventDefault(); save(true, e.submitter); };
  const ai = $('#aiGrade');
  if (ai) ai.onclick = (e) => busy(e.target, async () => {
    const r = await post(`/api/ai/grade/${c.id}`);
    if (!r.available) return toast(r.note, true);
    toast(`AI graded ${Object.keys(r.grades).length} answers.`);
    await app.loadCompany(c.id, true); dispatchEvent(new HashChangeEvent('hashchange'));
  });
  void pct;
}
