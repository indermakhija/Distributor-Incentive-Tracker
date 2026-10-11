// Screen 17: research documents & source library — upload, parse, review findings, apply.
import { html, mount, $, $$, toast, busy, dt, list, num, modal } from '../../ui.js';
import { get, post, upload, del } from '../../api.js';

export default async function documents(el, { app }) {
  const { company: c } = app.co;
  const docs = await get(`/api/companies/${c.id}/documents`);
  mount(el, html`
    <div class="grid g2">
      <div class="card"><h3>Upload research</h3>
        <div class="drop" id="drop">Drop a file here or <label style="display:inline;color:var(--accent);cursor:pointer">browse<input type="file" id="file" accept=".csv,.xlsx,.pdf,.txt,.md" hidden></label><br>
          <small>Financial statements (CSV/XLSX) · annual reports, quarterly results, investor presentations, earnings-call transcripts, credit-rating, broker or industry reports (PDF/TXT). Max 25 MB.</small></div>
        <p style="margin-top:10px"><a href="/api/templates/financials.csv" download>Download the financial-statements CSV template</a> — rows are line items, columns are fiscal years (oldest → newest), values in ₹ Cr.</p>
        <p class="muted">Parsing is deterministic: unrecognised rows are reported, never guessed. Scanned PDFs without a text layer are flagged (no OCR). Nothing is applied to the analysis until you confirm it.</p>
        <div id="upResult"></div></div>
      <div class="card"><h3>Source library</h3>
        ${(c.sources || []).length ? html`<div class="table-wrap"><table><thead><tr><th>Source</th><th>Type</th><th>Date</th><th>Note</th></tr></thead><tbody>${c.sources.map((s) => html`<tr><td>${s.url ? html`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a>` : s.title}</td><td>${s.type}</td><td>${s.date || '—'}</td><td class="muted">${s.note || ''}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No sources recorded.</p>`}
        <h4 style="margin-top:12px">Data provenance</h4>
        <dl class="kv">${Object.entries(c.provenance || {}).map(([k, p]) => html`<dt>${k}</dt><dd><span class="prov ${p.type}">${p.type}</span> ${p.source || ''} ${p.asOf ? '· as of ' + p.asOf : ''}</dd>`)}</dl></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Uploaded documents</h3>
      ${docs.length ? html`<div class="table-wrap"><table><thead><tr><th>File</th><th>Kind</th><th>Status</th><th class="num">Size</th><th>Findings / mapping</th><th>Uploaded</th><th></th></tr></thead><tbody>
        ${docs.map((d) => html`<tr><td>${d.filename}</td><td>${d.kind}</td><td><span class="chip ${d.status === 'parsed' ? 'pos' : 'neg'}">${d.status}</span>${d.applied ? html` <span class="chip neutral">applied</span>` : ''}</td><td class="num">${num(d.size / 1024)} KB</td>
          <td>${d.error ? html`<span class="muted">${d.error}</span>` : d.report ? `${d.report.recognised.length} rows mapped, ${d.report.unrecognised.length} unrecognised` : d.findings != null ? `${d.findings} signals${d.tone ? ' · tone ' + d.tone.label : ''}` : ''}</td>
          <td>${dt(d.created_at)}</td><td class="btn-row"><button class="btn ghost small" data-open="${d.id}">Review</button><button class="btn ghost small" data-del="${d.id}" aria-label="Delete document">✕</button></td></tr>`)}</tbody></table></div>` : html`<p class="muted">No documents uploaded yet.</p>`}
    </div>`);

  const handle = async (file) => {
    if (!file) return;
    const r = await busy(null, () => upload(`/api/companies/${c.id}/documents?filename=${encodeURIComponent(file.name)}`, file));
    if (r.status === 'error') { mount($('#upResult'), html`<p class="banner crit">${r.error}</p>`); return; }
    toast(`Parsed ${file.name}.`);
    await reviewDoc(r.id, app, () => documents(el, { app }));
  };
  $('#file').onchange = (e) => handle(e.target.files[0]);
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
  $$('[data-open]', el).forEach((b) => (b.onclick = () => reviewDoc(b.dataset.open, app, () => documents(el, { app }))));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (!confirm('Delete this document? Data already applied to the company is kept.')) return; await del(`/api/documents/${b.dataset.del}`); documents(el, { app }); }));
}

const KIND_OPTIONS = { promise: 'Add to management credibility tracker', auditorEvent: 'Record as auditor event', event: 'Record as governance event (disclosed)', catalyst: 'Add as catalyst (announced)', announcement: 'Record as announcement' };

async function reviewDoc(id, app, done) {
  const d = await get(`/api/documents/${id}`);
  const p = d.parsed || {};
  const c = app.co.company;
  if (p.type === 'financials') {
    const s = p.statements, rep = p.report;
    modal(html`<h2>Financial statements: ${d.filename}</h2>
      <p>Years: <b>${s.years.join(', ')}</b></p>
      <h4>Mapped rows (${rep.recognised.length})</h4>${list(rep.recognised.map((r) => `${r.label} → ${r.mappedTo} (${r.filled} values)`))}
      ${rep.unrecognised.length ? html`<h4>Unrecognised rows (ignored)</h4>${list(rep.unrecognised)}` : ''}
      ${rep.missingRequired.length ? html`<p class="banner crit">Missing required items: ${rep.missingRequired.join(', ')}</p>` : ''}
      ${rep.warnings.length ? html`<p class="banner sample">${rep.warnings.join(' ')}</p>` : ''}
      <p class="banner sample">Applying replaces the company's financial statements with this file${c.dataStatus === 'sample' ? ' and marks the company as uploaded data' : ''}.</p>
      <form id="af"><div class="grid g2"><div class="field"><label>Reporting date (as of)</label><input type="date" name="asOf" required></div><div class="field"><label>Unit</label><input name="unit" value="₹ Cr"></div></div>
      <div class="btn-row"><button class="btn" type="submit" ${p.status === 'error' ? 'disabled' : ''}>Apply statements</button><button class="btn ghost" type="button" data-close>Close</button></div></form>`, (m, close) => {
      $('#af', m).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        await busy(e.submitter, () => post(`/api/documents/${id}/apply`, { financials: true, asOf: f.asOf, unit: f.unit }));
        toast('Statements applied — analysis recomputed.'); close(); await app.loadCompany(c.id, true); done();
      };
    });
    return;
  }
  const findings = p.analysis?.findings || [];
  modal(html`<h2>${d.filename}</h2><p class="muted">Detected: <b>${d.kind}</b> · ${p.pages ?? '?'} pages${p.truncated ? ' (first 400 parsed)' : ''}${p.analysis?.tone ? html` · Tone <b>${p.analysis.tone.label}</b> (net ${p.analysis.tone.net}, uncertainty ${p.analysis.tone.uncertaintyPer1k}/1k words) <span class="prov calculated">indicator</span>` : ''}</p>
    ${p.warning ? html`<p class="banner sample">${p.warning}</p>` : ''}
    <h4>Extracted signals — tick the ones to apply (each keeps a page reference)</h4>
    ${findings.length ? html`<form id="ff">${findings.map((f, i) => html`<div class="field" style="border-bottom:1px solid var(--grid);padding-bottom:6px">
      <div><b>${f.label}</b> <small class="muted">p.${f.page}</small></div><div>"${f.text}"</div>
      ${f.suggest ? html`<label style="font-weight:400;margin-top:4px"><input type="checkbox" data-f="${i}"> ${KIND_OPTIONS[f.suggest.kind]}${f.suggest.type ? ` (${f.suggest.type})` : ''}</label>` : html`<small class="muted">Informational — review manually.</small>`}</div>`)}
      <div class="btn-row"><button class="btn" type="submit">Apply selected</button><button class="btn ghost" type="button" data-close>Close</button></div></form>` : html`<p class="muted">No signals detected.</p><button class="btn ghost" data-close>Close</button>`}
    <details style="margin-top:10px"><summary>Extracted text (first 20,000 characters)</summary><div class="pre" style="max-height:300px;overflow:auto">${(d.text || '').slice(0, 20000)}</div></details>`, (m, close) => {
    const ff = $('#ff', m);
    if (!ff) return;
    ff.onsubmit = async (e) => {
      e.preventDefault();
      const sel = $$('[data-f]:checked', m).map((cb) => { const f = findings[Number(cb.dataset.f)]; return { kind: f.suggest.kind, type: f.suggest.type, text: f.text, page: f.page }; });
      if (!sel.length) return toast('Select at least one finding.', true);
      await busy(e.submitter, () => post(`/api/documents/${id}/apply`, { findings: sel }));
      toast(`Applied ${sel.length} finding(s).`); close(); await app.loadCompany(c.id, true); done();
    };
  });
}
