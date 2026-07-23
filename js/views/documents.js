// =============================================================================
// views/documents.js — Custom document composer.
//
// Exposes the shared document-rendering engine through a form: an operator
// assembles a document from typed blocks (heading, paragraph, numbered clauses,
// bulleted list, key-value fields, dated log entries, quotation, notice,
// withheld section, signature, rule), saves it as a draft or issues it, and
// exports it in full house style. Classification is capped at the composer's clearance;
// once issued, a document is a record and its content is frozen (supersede,
// don't rewrite). Visibility follows org + clearance, like directives.
// =============================================================================

import { ORGS, CLEARANCE_ORDER, CLEARANCES, clearanceWeight } from '../constants.js';
import { documents, getDocument, upsertDocument, newId } from '../storage.js';
import { moderationBar, wireModerationBar } from '../moderation.js';
import { canComposeDocument, canViewDocument, canManageOrg, isCL5 } from '../permissions.js';
import { logAction } from '../audit.js';
import { exportCustomDocument, buildCustomDocumentHTML } from '../export.js';
import { esc, fmtDate, clearanceBadge, orgTag, toast, confirmDialog } from '../ui.js';

// Working copy of the document currently open in the composer.
let draft = null;

const composableOrgs = (actor) => Object.keys(ORGS).filter((o) => canComposeDocument(actor, o));
const allowedClasses = (actor) => CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= clearanceWeight(actor.clearance));

function nextRef(org) {
  const code = org === 'omega-1' ? 'O1' : org === 'ethics-committee' ? 'EC' : 'CMD';
  const nums = documents()
    .filter((d) => d.org === org && /-DOC-(\d+)$/.test(d.ref || ''))
    .map((d) => parseInt(d.ref.split('-DOC-')[1], 10));
  return `${code}-DOC-${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

// --- List -------------------------------------------------------------------
export function render(host, app) {
  const actor = app.user;
  const canCompose = composableOrgs(actor).length > 0;
  const visible = documents()
    .filter((d) => !d.deleted && !d.redacted && canViewDocument(actor, d))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const sealed = documents().filter((d) => !d.deleted && d.redacted).length;

  const rows = visible.length ? visible.map((d) => `
    <tr data-id="${esc(d.id)}" tabindex="0">
      <td class="mono">${esc(d.ref)}</td>
      <td class="cell-name">${esc(d.title || 'Untitled')}</td>
      <td>${orgTag(d.org)}</td>
      <td>${clearanceBadge(d.classification)}</td>
      <td>${d.status === 'issued' ? '<span class="badge badge--ok">Issued</span>' : '<span class="badge badge--muted">Draft</span>'}</td>
      <td class="muted-text">${fmtDate(d.updatedAt)}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">No documents yet.${canCompose ? ' Use \u201cNew document\u201d to compose one.' : ''}</td></tr>`;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Records</div>
        <h1 class="page-title">Documents</h1>
        <div class="page-sub">Compose and issue custom records in house style${sealed ? ` \u00b7 ${sealed} sealed above your clearance` : ''}</div>
      </div>
      ${canCompose ? '<button class="btn btn--primary" id="doc-new">+ New document</button>' : ''}
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Reference</th><th>Title</th><th>Body</th><th>Classification</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const nb = host.querySelector('#doc-new');
  if (nb) nb.addEventListener('click', () => {
    const org = composableOrgs(actor)[0];
    draft = {
      id: newId('doc'), ref: nextRef(org), org,
      classification: allowedClasses(actor)[0], title: '', office: 'Office of Record',
      distribution: '', status: 'draft', blocks: [{ type: 'paragraph', text: '' }],
      createdBy: actor.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      version: 1, deleted: false, deletedAt: null, _new: true,
    };
    app.navigate(`#/document/${draft.id}`);
  });
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => app.navigate(`#/document/${tr.dataset.id}`));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.navigate(`#/document/${tr.dataset.id}`); });
  });
}

// --- Composer / viewer ------------------------------------------------------
export function renderOne(host, app, id) {
  const actor = app.user;
  // Prefer the in-memory draft when composing a brand-new (unsaved) document.
  let doc = (draft && draft.id === id) ? draft : getDocument(id);
  if (!doc) { host.innerHTML = '<div class="empty">Document not found.</div>'; app.navigate('#/documents'); return; }
  if (!canViewDocument(actor, doc)) { host.innerHTML = '<div class="empty">You are not cleared to view this document.</div>'; return; }

  const isAuthorEditable = doc.status === 'draft' && (doc.createdBy === actor.id || canManageOrg(actor, doc.org)) && canComposeDocument(actor, doc.org);
  if (isAuthorEditable) { draft = draft && draft.id === id ? draft : JSON.parse(JSON.stringify(doc)); renderComposer(host, app); }
  else renderReadonly(host, app, doc);
}

function renderReadonly(host, app, doc) {
  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(doc.ref)}</div>
        <h1 class="page-title">${esc(doc.title || 'Untitled')}</h1>
        <div class="page-sub">${ORGS[doc.org].name} \u00b7 ${(CLEARANCES[doc.classification] || {}).label || doc.classification} \u00b7 ${doc.status === 'issued' ? 'Issued' : 'Draft'}</div>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--ghost" id="doc-back">\u2190 All documents</button>
        <button class="btn btn--primary" id="doc-export">Export</button>
      </div>
    </div>
    ${moderationBar(actor, { already: false })}
    <div class="card"><div class="card__body"><iframe class="doc-preview" title="Document preview"></iframe></div></div>`;
  const frame = host.querySelector('.doc-preview');
  if (frame) frame.srcdoc = buildCustomDocumentHTML(doc, app.user);
  host.querySelector('#doc-back').addEventListener('click', () => app.navigate('#/documents'));
  host.querySelector('#doc-export').addEventListener('click', () => exportCustomDocument(app, doc));
  wireModerationBar(host, app, { label: `document ${doc.ref}`, get: () => getDocument(doc.id), upsert: upsertDocument, backHash: '#/documents' });
}

const BLOCK_LABELS = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  clauses: 'Numbered clauses',
  list: 'Bulleted list',
  fields: 'Fields',
  log: 'Log entries',
  quote: 'Quotation',
  notice: 'Notice',
  withheld: 'Withheld section',
  signature: 'Signature',
  rule: 'Rule (divider)',
};

// The starting shape of each freshly-added block.
const BLOCK_DEFAULTS = {
  heading: { text: '' },
  paragraph: { text: '' },
  clauses: { items: [''] },
  list: { items: [''] },
  fields: { rows: [{ k: '', v: '' }] },
  log: { entries: [{ date: '', text: '' }] },
  quote: { text: '', by: '' },
  notice: { tone: 'warning', text: '' },
  withheld: { reason: '' },
  signature: { name: '', role: '', dated: '' },
  rule: {},
};

function blockEditor(b, i) {
  const head = `<div class="blk__head"><span class="blk__label">${BLOCK_LABELS[b.type] || b.type}</span>
    <span class="blk__ctrls">
      <button class="btn btn--xs" data-move="up" data-i="${i}" title="Move up">\u2191</button>
      <button class="btn btn--xs" data-move="down" data-i="${i}" title="Move down">\u2193</button>
      <button class="btn btn--xs btn--danger" data-del="${i}" title="Remove">\u2715</button>
    </span></div>`;
  let body = '';
  if (b.type === 'heading') body = `<input class="blk__in" data-f="text" data-i="${i}" value="${esc(b.text || '')}" placeholder="Section heading" maxlength="120" />`;
  else if (b.type === 'paragraph') body = `<textarea class="blk__in" data-f="text" data-i="${i}" rows="3" placeholder="Paragraph text\u2026">${esc(b.text || '')}</textarea>`;
  else if (b.type === 'clauses') body = `<textarea class="blk__in" data-f="items" data-i="${i}" rows="4" placeholder="One clause per line \u2014 each is auto-numbered.">${esc((b.items || []).join('\n'))}</textarea>`;
  else if (b.type === 'list') body = `<textarea class="blk__in" data-f="items" data-i="${i}" rows="4" placeholder="One item per line \u2014 rendered as bullets.">${esc((b.items || []).join('\n'))}</textarea>`;
  else if (b.type === 'quote') {
    body = `<textarea class="blk__in" data-f="text" data-i="${i}" rows="3" placeholder="Quoted material \u2014 testimony, an excerpt, a radio log\u2026">${esc(b.text || '')}</textarea>
      <input class="blk__in" data-f="by" data-i="${i}" value="${esc(b.by || '')}" placeholder="Attribution (optional) \u2014 e.g. Testimony of O1-7" maxlength="120" />`;
  } else if (b.type === 'notice') {
    body = `<select class="blk__in" data-f="tone" data-i="${i}">
        <option value="warning" ${b.tone !== 'advisory' ? 'selected' : ''}>Warning (red border)</option>
        <option value="advisory" ${b.tone === 'advisory' ? 'selected' : ''}>Advisory (grey border)</option>
      </select>
      <textarea class="blk__in" data-f="text" data-i="${i}" rows="2" placeholder="Notice text \u2014 e.g. UNAUTHORISED DISCLOSURE IS A MATTER FOR THE ETHICS COMMITTEE.">${esc(b.text || '')}</textarea>`;
  } else if (b.type === 'withheld') {
    body = `<input class="blk__in" data-f="reason" data-i="${i}" value="${esc(b.reason || '')}" placeholder="Requirement shown in the bar \u2014 e.g. REQUIRES LEVEL 4 CLEARANCE (blank = BY ORDER OF SITE COMMAND)" maxlength="120" />`;
  } else if (b.type === 'log') {
    const rows = (b.entries && b.entries.length ? b.entries : [{ date: '', text: '' }]).map((r, ri) => `
      <div class="blk__fieldrow">
        <input class="blk__in" data-f="ld" data-i="${i}" data-ri="${ri}" value="${esc(r.date || '')}" placeholder="Date / time" maxlength="60" style="flex:0 0 140px" />
        <input class="blk__in" data-f="lt" data-i="${i}" data-ri="${ri}" value="${esc(r.text || '')}" placeholder="Entry" maxlength="300" />
        <button class="btn btn--xs btn--danger" data-lrow-del data-i="${i}" data-ri="${ri}">\u2715</button>
      </div>`).join('');
    body = `${rows}<button class="btn btn--xs" data-lrow-add data-i="${i}">+ Entry</button>`;
  } else if (b.type === 'rule') {
    body = '<div class="muted-text">A horizontal rule \u2014 separates sections. No content.</div>';
  } else if (b.type === 'fields') {
    const rows = (b.rows && b.rows.length ? b.rows : [{ k: '', v: '' }]).map((r, ri) => `
      <div class="blk__fieldrow">
        <input class="blk__in" data-f="fk" data-i="${i}" data-ri="${ri}" value="${esc(r.k || '')}" placeholder="Label" maxlength="60" />
        <input class="blk__in" data-f="fv" data-i="${i}" data-ri="${ri}" value="${esc(r.v || '')}" placeholder="Value" maxlength="200" />
        <button class="btn btn--xs btn--danger" data-frow-del data-i="${i}" data-ri="${ri}">\u2715</button>
      </div>`).join('');
    body = `${rows}<button class="btn btn--xs" data-frow-add data-i="${i}">+ Row</button>`;
  } else if (b.type === 'signature') {
    body = `<div class="blk__fieldrow"><input class="blk__in" data-f="name" data-i="${i}" value="${esc(b.name || '')}" placeholder="Name / designation" /><input class="blk__in" data-f="role" data-i="${i}" value="${esc(b.role || '')}" placeholder="Role / office" /></div>
      <input class="blk__in" data-f="dated" data-i="${i}" value="${esc(b.dated || '')}" placeholder="Dated (optional)" />`;
  }
  return `<div class="blk">${head}${body}</div>`;
}

function renderComposer(host, app) {
  const actor = app.user;
  const d = draft;
  const orgs = composableOrgs(actor);
  const classes = allowedClasses(actor);

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(d.ref)} \u00b7 Draft</div>
        <h1 class="page-title">Compose document</h1>
        <div class="page-sub">Build the body from blocks. Classification is capped at your clearance; issuing freezes the record.</div>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--ghost" id="doc-back">\u2190 All documents</button>
        <button class="btn" id="doc-save">Save draft</button>
        <button class="btn btn--primary" id="doc-issue">Issue</button>
      </div>
    </div>
    <div class="doc-composer">
      <div class="doc-composer__form">
        <div class="card"><div class="card__body">
          <div class="field"><label>Title</label><input id="d-title" value="${esc(d.title || '')}" placeholder="Document title" maxlength="140" /></div>
          <div class="field"><label>Issuing body</label><select id="d-org">${orgs.map((o) => `<option value="${o}" ${o === d.org ? 'selected' : ''}>${esc(ORGS[o].name)}</option>`).join('')}</select></div>
          <div class="field"><label>Office</label><input id="d-office" value="${esc(d.office || '')}" placeholder="e.g. Office of the Commander" maxlength="80" /></div>
          <div class="field"><label>Classification</label><select id="d-class">${classes.map((c) => `<option value="${c}" ${c === d.classification ? 'selected' : ''}>${esc((CLEARANCES[c] || {}).label || c)}</option>`).join('')}</select></div>
          <div class="field"><label>Distribution <span class="muted-text">(optional)</span></label><input id="d-dist" value="${esc(d.distribution || '')}" placeholder="Defaults to the issuing body's standard list" maxlength="200" /></div>
        </div></div>
        <div class="card"><div class="card__body">
          <div class="blk-list">${d.blocks.map((b, i) => blockEditor(b, i)).join('')}</div>
          <div class="blk-add">
            ${Object.keys(BLOCK_LABELS).map((t) => `<button class="btn btn--xs" data-add="${t}">+ ${BLOCK_LABELS[t]}</button>`).join('')}
          </div>
        </div></div>
      </div>
      <div class="doc-composer__preview">
        <div class="card"><div class="card__body">
          <div class="doc-preview__bar"><span class="muted-text">Live preview</span><button class="btn btn--xs" id="doc-export">Export</button></div>
          <iframe class="doc-preview" title="Document preview"></iframe>
        </div></div>
      </div>
    </div>`;

  const refresh = () => { const f = host.querySelector('.doc-preview'); if (f) f.srcdoc = buildCustomDocumentHTML(d, actor); };
  refresh();

  // Metadata bindings.
  host.querySelector('#d-title').addEventListener('input', (e) => { d.title = e.target.value; refresh(); });
  host.querySelector('#d-office').addEventListener('input', (e) => { d.office = e.target.value; refresh(); });
  host.querySelector('#d-dist').addEventListener('input', (e) => { d.distribution = e.target.value; refresh(); });
  host.querySelector('#d-org').addEventListener('change', (e) => {
    d.org = e.target.value;
    if (d._new) d.ref = nextRef(d.org); // keep an unsaved ref aligned to the org
    renderComposer(host, app);
  });
  host.querySelector('#d-class').addEventListener('change', (e) => { d.classification = e.target.value; refresh(); });

  // Block field bindings.
  host.querySelectorAll('.blk__in').forEach((el) => {
    el.addEventListener('input', () => {
      const i = +el.dataset.i; const f = el.dataset.f; const b = d.blocks[i];
      if (!b) return;
      if (f === 'items') b.items = el.value.split('\n');
      else if (f === 'fk' || f === 'fv') {
        b.rows = b.rows || [];
        const ri = +el.dataset.ri;
        b.rows[ri] = b.rows[ri] || { k: '', v: '' };
        b.rows[ri][f === 'fk' ? 'k' : 'v'] = el.value;
      } else if (f === 'ld' || f === 'lt') {
        b.entries = b.entries || [];
        const ri = +el.dataset.ri;
        b.entries[ri] = b.entries[ri] || { date: '', text: '' };
        b.entries[ri][f === 'ld' ? 'date' : 'text'] = el.value;
      } else b[f] = el.value;
      refresh();
    });
  });

  // Block controls.
  host.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    const t = btn.dataset.add;
    const fresh = { type: t, ...JSON.parse(JSON.stringify(BLOCK_DEFAULTS[t] || { text: '' })) };
    d.blocks.push(fresh); renderComposer(host, app);
  }));
  host.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => { d.blocks.splice(+btn.dataset.del, 1); renderComposer(host, app); }));
  host.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', () => {
    const i = +btn.dataset.i; const dir = btn.dataset.move === 'up' ? -1 : 1; const j = i + dir;
    if (j < 0 || j >= d.blocks.length) return;
    [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]]; renderComposer(host, app);
  }));
  host.querySelectorAll('[data-frow-add]').forEach((btn) => btn.addEventListener('click', () => {
    const b = d.blocks[+btn.dataset.i]; b.rows = b.rows || []; b.rows.push({ k: '', v: '' }); renderComposer(host, app);
  }));
  host.querySelectorAll('[data-frow-del]').forEach((btn) => btn.addEventListener('click', () => {
    const b = d.blocks[+btn.dataset.i]; if (b.rows) b.rows.splice(+btn.dataset.ri, 1); renderComposer(host, app);
  }));
  host.querySelectorAll('[data-lrow-add]').forEach((btn) => btn.addEventListener('click', () => {
    const b = d.blocks[+btn.dataset.i]; b.entries = b.entries || []; b.entries.push({ date: '', text: '' }); renderComposer(host, app);
  }));
  host.querySelectorAll('[data-lrow-del]').forEach((btn) => btn.addEventListener('click', () => {
    const b = d.blocks[+btn.dataset.i]; if (b.entries) b.entries.splice(+btn.dataset.ri, 1); renderComposer(host, app);
  }));

  host.querySelector('#doc-back').addEventListener('click', () => app.navigate('#/documents'));
  host.querySelector('#doc-export').addEventListener('click', () => exportCustomDocument(app, d));
  host.querySelector('#doc-save').addEventListener('click', () => save(app, 'draft'));
  host.querySelector('#doc-issue').addEventListener('click', () => save(app, 'issue'));
}

function persist(app, status) {
  const d = draft;
  const now = new Date().toISOString();
  const rec = {
    id: d.id, ref: d.ref, org: d.org, classification: d.classification,
    title: (d.title || '').trim() || 'Untitled Document', office: d.office || 'Office of Record',
    distribution: (d.distribution || '').trim(), status,
    blocks: d.blocks, createdBy: d.createdBy, createdAt: d.createdAt,
    updatedAt: now, version: (getDocument(d.id) ? (getDocument(d.id).version || 1) + 1 : 1),
    deleted: false, deletedAt: null,
  };
  upsertDocument(rec);
  logAction(app.user, status === 'issued' ? 'ISSUE_DOCUMENT' : (d._new ? 'CREATE_DOCUMENT' : 'EDIT_DOCUMENT'), `${status === 'issued' ? 'Issued' : 'Saved'} ${rec.ref}.`);
  d._new = false; d.version = rec.version;
  return rec;
}

async function save(app, mode) {
  const d = draft;
  if (!d.blocks.length) { toast('Add at least one block.', 'error'); return; }
  if (mode === 'issue') {
    const ok = await confirmDialog({ title: 'Issue document', message: `Issue ${d.ref}? Once issued it becomes a record and its content is locked \u2014 you would supersede it with a new document rather than edit it.`, confirmLabel: 'Issue', danger: false });
    if (!ok) return;
    persist(app, 'issued');
    draft = null;
    toast('Document issued.', 'success');
    app.navigate('#/documents');
    return;
  }
  persist(app, 'draft');
  toast('Draft saved.', 'success');
}
