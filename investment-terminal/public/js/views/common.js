// Shared editors for company sections: editable tables and 0–10 score editors with evidence.
import { patch } from '../api.js';
import { html, esc, $, $$, toast, isNum } from '../ui.js';

export async function saveSection(app, fields) {
  const res = await patch(`/api/companies/${encodeURIComponent(app.co.id)}`, fields);
  app.co.company = res.company;
  app.recompute();
  toast('Saved. Analysis recomputed.');
  if (res.alerts?.length) { toast(`${res.alerts.length} new alert(s) generated.`); app.refreshAlerts(); }
  return res;
}

/** columns: [{ key, label, type: text|number|pct|select|textarea, options, width }] */
export function editTable(id, columns, rows = [], { addLabel = 'Add row' } = {}) {
  const cell = (c, v) => {
    const val = c.type === 'pct' && isNum(v) ? +(v * 100).toFixed(2) : v ?? '';
    if (c.type === 'select') return html`<select data-k="${c.key}">${c.options.map((o) => html`<option value="${o}" ${String(o) === String(v ?? '') ? 'selected' : ''}>${o}</option>`)}</select>`;
    if (c.type === 'textarea') return html`<textarea data-k="${c.key}" rows="2">${val}</textarea>`;
    return html`<input data-k="${c.key}" type="${c.type === 'text' ? 'text' : 'number'}" step="any" value="${val}" ${c.placeholder ? html`placeholder="${c.placeholder}"` : ''}>`;
  };
  const row = (r) => html`<tr>${columns.map((c) => html`<td style="${c.width ? 'min-width:' + c.width : ''}">${cell(c, r[c.key])}</td>`)}<td><button class="btn ghost small" data-del-row type="button" aria-label="Delete row">✕</button></td></tr>`;
  return html`<div class="table-wrap"><table class="edit-table" id="${id}" data-cols="${esc(JSON.stringify(columns))}">
    <thead><tr>${columns.map((c) => html`<th>${c.label}${c.type === 'pct' ? ' (%)' : ''}</th>`)}<th></th></tr></thead>
    <tbody>${rows.map(row)}</tbody></table></div>
    <button class="btn ghost small" type="button" data-add-row="${id}">+ ${addLabel}</button>`;
}

export function bindEditTables(root) {
  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-row]');
    if (del) { del.closest('tr').remove(); return; }
    const add = e.target.closest('[data-add-row]');
    if (add) {
      const table = $('#' + add.dataset.addRow, root);
      const cols = JSON.parse(table.dataset.cols);
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map((c) => `<td>${c.type === 'select' ? `<select data-k="${c.key}">${c.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : c.type === 'textarea' ? `<textarea data-k="${c.key}" rows="2"></textarea>` : `<input data-k="${c.key}" type="${c.type === 'text' ? 'text' : 'number'}" step="any">`}</td>`).join('') + '<td><button class="btn ghost small" data-del-row type="button">✕</button></td>';
      table.querySelector('tbody').appendChild(tr);
    }
  });
}

export function readTable(root, id) {
  const table = $('#' + id, root);
  const cols = JSON.parse(table.dataset.cols);
  return $$('tbody tr', table).map((tr) => {
    const o = {};
    for (const c of cols) {
      const el = tr.querySelector(`[data-k="${c.key}"]`);
      const v = el?.value ?? '';
      if (c.type === 'number') o[c.key] = v === '' ? null : Number(v);
      else if (c.type === 'pct') o[c.key] = v === '' ? null : Number(v) / 100;
      else o[c.key] = v;
    }
    return o;
  }).filter((o) => Object.values(o).some((v) => v !== '' && v != null));
}

export function scoreEditor(id, items, values = {}, { evidence = true, hint = '' } = {}) {
  return html`<div id="${id}" class="score-editor">${hint ? html`<p class="muted">${hint}</p>` : ''}
    ${items.map(([k, label]) => {
      const s = values[k]?.score;
      return html`<div class="score-edit" data-k="${k}">
        <span>${label}</span>
        <input type="range" min="0" max="10" step="0.5" value="${isNum(s) ? s : 5}" data-score aria-label="${label} score" ${isNum(s) ? '' : 'data-unset'}>
        <output>${isNum(s) ? s : '—'}</output>
        ${evidence ? html`<input type="text" data-evidence placeholder="Evidence / source for this score" value="${values[k]?.evidence || values[k]?.note || ''}">` : ''}
      </div>`;
    })}</div>`;
}

export function bindScoreEditors(root) {
  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-score]')) { e.target.removeAttribute('data-unset'); e.target.nextElementSibling.textContent = e.target.value; }
  });
}

/** Returns { key: {score, evidence} } for scored rows; untouched rows are omitted (unscored ≠ 5). */
export function readScores(root, id, evidenceKey = 'evidence') {
  const out = {};
  for (const row of $$('.score-edit', $('#' + id, root))) {
    const r = row.querySelector('[data-score]');
    const ev = row.querySelector('[data-evidence]')?.value?.trim() || '';
    if (r.hasAttribute('data-unset') && !ev) continue;
    out[row.dataset.k] = { score: Number(r.value), [evidenceKey]: ev };
  }
  return out;
}

export const dimCard = (d) => html`<div class="card">
  <div class="card-head"><h3>${d.label}</h3><span><span class="score-pill">${d.score ?? 'n/a'}</span><small>/10 · confidence ${Math.round((d.confidence || 0) * 100)}%</small></span></div>
  ${d.components?.length ? html`<div class="table-wrap"><table><thead><tr><th>Component</th><th class="num">Score</th><th>Basis</th><th>Detail</th></tr></thead><tbody>
    ${d.components.map((c) => html`<tr><td>${c.name}</td><td class="num">${c.score}</td><td><span class="prov ${c.source}">${c.source}</span></td><td class="muted">${c.note || ''}</td></tr>`)}</tbody></table></div>` : ''}
  <div class="grid g2" style="margin-top:10px"><div><h4>Positive factors</h4>${listOr(d.positives)}</div><div><h4>Negative factors</h4>${listOr(d.negatives)}</div></div>
  ${d.missing?.length ? html`<h4>Missing data</h4>${listOr(d.missing)}` : ''}
  ${d.monitoring?.length ? html`<h4>Monitor</h4>${listOr(d.monitoring)}` : ''}
  ${d.evidence?.length ? html`<p class="muted">${d.evidence.join(' ')}</p>` : ''}
</div>`;
const listOr = (items) => (items?.length ? html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>` : html`<p class="muted">None.</p>`);
