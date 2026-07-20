// =============================================================================
// views/tribunals.js — Ethics Committee case docket + case file.
//
// Formal proceedings run by the Committee: containment reviews, inquiries and
// full tribunals. A case carries a sensitivity (hard gate, like a surveillance
// record) and cross-references personnel (respondent, panel) and surveillance
// subjects. Cross-references never bypass the linked record's own access rule:
// a cited subject you are not cleared for shows as sealed, and editing the
// citations preserves links you cannot see. Running a case needs Ethics
// CL4·Senior (or Command); entering a binding ruling is CL5 only.
// =============================================================================

import {
  CASE_KIND, CASE_KIND_ORDER, CASE_STATUS, CASE_STATUS_ORDER,
  RULING_FINDING, RULING_FINDING_ORDER, CLEARANCE_ORDER, CLEARANCES,
  ORGS, clearanceWeight, CASE_VOTE, CASE_VOTE_ORDER, tallyCaseVotes, caseTakesVote,
} from '../constants.js';
import {
  cases, getCase, upsertCase, users, getUser, subjects, getSubject, compartments, getCompartment, newId,
} from '../storage.js';
import {
  canViewCase, canManageTribunal, canRuleTribunal, canClassifyAt, canViewSubject,
  isCL5, readIntoCompartment,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { exportCase, exportSummons } from '../export.js';
import { stalenessBadge } from '../staleness.js';
import { exportCSV } from '../csv.js';
import { renderHistory } from '../record-history.js';
import {
  esc, linkify, fmtDate, fmtDateTime, clearanceBadge, orgTag, monogram,
  toast, openModal, confirmDialog, helpNote,
} from '../ui.js';

const filter = { q: '', kind: '', status: '' };

// --- Local badge renderers --------------------------------------------------
const kindTag = (k) => {
  const m = CASE_KIND[k] || { short: k, tone: 'muted' };
  return `<span class="case-kind case-kind--${m.tone}">${esc(m.short)}</span>`;
};
const caseStatusBadge = (s) => {
  const m = CASE_STATUS[s] || { label: s, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};
const findingBadge = (f) => {
  const m = RULING_FINDING[f] || { label: f, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};

// --- Need-To-Know caveat (kept local so ui.js stays domain-agnostic) --------
function caveatName(rec) {
  if (!rec || !rec.compartment) return null;
  return rec.compartmentName || (getCompartment(rec.compartment) || {}).name || 'COMPARTMENTED';
}
function caveatBanner(rec) {
  const n = caveatName(rec);
  return n ? `<div class="caveat-banner">\u25c8 NEED-TO-KNOW \u00b7 ${esc(n)} \u00b7 handling restricted to read-in personnel</div>` : '';
}
function fileableCompartments(actor) {
  return compartments().filter((c) => !c.deleted
    && (isCL5(actor) || c.access === 'member' || readIntoCompartment(actor, c)));
}
function compartmentField(actor, id, selectedId) {
  const comps = fileableCompartments(actor);
  const opts = ['<option value="">\u2014 None (uncompartmented) \u2014</option>',
    ...comps.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} (${esc(c.codeword || c.name)})</option>`)].join('');
  return `<div class="field"><label>Need-To-Know compartment</label><select id="${id}">${opts}</select>
    <div class="field__hint">Only compartments you are read into are listed.</div></div>`;
}

// --- Reference resolution ---------------------------------------------------
// Respondent / panel display. Personnel links route to the dossier, where that
// record's own redaction applies — no bypass.
function personName(id, fallback = '\u2014') {
  const u = getUser(id);
  return u ? `${u.codename}` : fallback;
}
function personLink(id, fallback) {
  const u = getUser(id);
  if (!u || u.deleted) return `<span>${esc(fallback || '\u2014')}</span>`;
  return `<a class="ref-link" href="#/personnel/${esc(u.id)}"><span class="mono">${esc(u.designation)}</span> ${esc(u.codename)}</a>`;
}

// --- Shared mutation helper -------------------------------------------------
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getCase(id);
  if (!fresh) { toast('Case no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This case was changed elsewhere. Reloading the latest version.', 'warn');
    app.refresh();
    return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertCase(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}

function addEntry(record, type, by, text) {
  record.entries = record.entries || [];
  record.entries.unshift({ id: newId('ent'), ts: new Date().toISOString(), by, type, text });
}

// A seated panel member records (or changes) their own position on a
// deliberative matter. The Worker re-checks: seated, non-tribunal, own vote only.
function castVote(app, c, position) {
  const actor = app.user;
  if (!caseTakesVote(c.kind)) { toast('This matter is not decided by a vote.', 'error'); return; }
  if (!(c.panelIds || []).includes(actor.id)) { toast('Only a seated panel member may vote.', 'error'); return; }
  if (!CASE_VOTE[position]) return;
  mutate(app, c.id, c.version, (rec) => {
    rec.votes = { ...(rec.votes || {}) };
    const prior = rec.votes[actor.id];
    if (prior === position) { delete rec.votes[actor.id]; addEntry(rec, 'filing', actor.designation, 'Withdrew their vote.'); }
    else { rec.votes[actor.id] = position; addEntry(rec, 'filing', actor.designation, `Voted ${CASE_VOTE[position].label}.`); }
  }, { action: 'VOTE_CASE', detail: `Vote recorded on ${c.ref}.` });
  toast('Vote recorded.', 'success');
}

// ===========================================================================
// CASE DOCKET (list)
// ===========================================================================
export function renderList(host, app) {
  const actor = app.user;
  const all = cases().filter((c) => !c.deleted);

  const visible = [];
  const sealed = [];
  for (const c of all) { if (canViewCase(actor, c)) visible.push(c); else sealed.push(c); }

  const shown = visible
    .filter((c) => {
      if (filter.kind && c.kind !== filter.kind) return false;
      if (filter.status && c.status !== filter.status) return false;
      if (filter.q) {
        const hay = `${c.ref} ${c.title}`.toLowerCase();
        if (!hay.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => b.ref.localeCompare(a.ref));

  const kindOpts = ['', ...CASE_KIND_ORDER]
    .map((k) => `<option value="${k}" ${filter.kind === k ? 'selected' : ''}>${k ? esc(CASE_KIND[k].label) : 'All types'}</option>`).join('');
  const statusOpts = ['', ...CASE_STATUS_ORDER]
    .map((s) => `<option value="${s}" ${filter.status === s ? 'selected' : ''}>${s ? esc(CASE_STATUS[s].label) : 'All statuses'}</option>`).join('');

  const rows = shown.length ? shown.map((c) => `
    <tr data-id="${esc(c.id)}" tabindex="0">
      <td class="mono">${esc(c.ref)}</td>
      <td class="cell-name">${esc(c.title)}</td>
      <td>${kindTag(c.kind)}</td>
      <td>${respondentLabel(c)}</td>
      <td>${caseStatusBadge(c.status)} ${stalenessBadge(c, 'case')}</td>
      <td>${clearanceBadge(c.clearance)}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`).join('') : `
    <tr><td colspan="7" class="empty">No cases match the current filters.</td></tr>`;

  const sealedRows = sealed.length ? sealed.map((c) => `
    <tr class="row-locked">
      <td colspan="6" class="locked-cell">\u25a0\u25a0\u25a0 Sealed case \u2014 access restricted</td>
      <td class="cell-right">${clearanceBadge(c.clearance)}</td>
    </tr>`).join('') : '';

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Ethics Committee</div>
        <h1 class="page-title">Case Docket</h1>
        <div class="page-sub">${visible.length} accessible${sealed.length ? ` \u00b7 ${sealed.length} sealed above your clearance` : ''}</div>
      </div>
      ${canManageTribunal(actor) ? `<button class="btn btn--primary" id="add-case">+ New case</button>` : ''}
    </div>

    <div class="toolbar">
      <input id="flt-q" class="toolbar__search" type="search" placeholder="Search reference or title\u2026" value="${esc(filter.q)}" />
      <select id="flt-kind" class="toolbar__select">${kindOpts}</select>
      <select id="flt-status" class="toolbar__select">${statusOpts}</select>
      <button class="btn btn--ghost btn--sm" id="export-csv" title="Export the filtered docket to CSV">⤓ CSV</button>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr><th>Reference</th><th>Matter</th><th>Type</th><th>Respondent</th><th>Status</th><th>Sensitivity</th><th></th></tr>
        </thead>
        <tbody>${rows}${sealedRows}</tbody>
      </table>
    </div>
  `;

  host.querySelector('#export-csv')?.addEventListener('click', () => {
    const respondent = (c) => (c.respondentId ? personName(c.respondentId)
      : (c.respondentName && c.respondentName !== '[UNNAMED]' ? c.respondentName : (c.respondentDept || '')));
    exportCSV('case-docket.csv', [
      { header: 'Reference', value: (c) => c.ref },
      { header: 'Matter', value: (c) => c.title },
      { header: 'Type', value: (c) => c.kind },
      { header: 'Respondent', value: respondent },
      { header: 'Status', value: (c) => (CASE_STATUS[c.status] || {}).label || c.status },
      { header: 'Sensitivity', value: (c) => c.clearance },
      { header: 'Opened', value: (c) => fmtDate(c.createdAt) },
    ], shown);
  });

  const go = (id) => app.navigate(`#/case/${id}`);
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => go(tr.dataset.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(tr.dataset.id); } });
  });

  const q = host.querySelector('#flt-q');
  q.addEventListener('input', () => { filter.q = q.value; renderList(host, app); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
  host.querySelector('#flt-kind').addEventListener('change', (e) => { filter.kind = e.target.value; renderList(host, app); });
  host.querySelector('#flt-status').addEventListener('change', (e) => { filter.status = e.target.value; renderList(host, app); });

  const addBtn = host.querySelector('#add-case');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app));
}

// ===========================================================================
// CASE FILE
// ===========================================================================
export function renderCase(host, app, id) {
  const actor = app.user;
  const c = getCase(id);

  if (!c || c.deleted) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Case not found</h1>
      <div class="page-sub">This case does not exist or has been removed.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Docket</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/tribunals'));
    return;
  }

  // HARD ACCESS GATE on direct navigation.
  if (!canViewCase(actor, c)) {
    host.innerHTML = `
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Docket</button>
      <div class="denied">
        <div class="denied__mark">\u25a0\u25a0\u25a0</div>
        <h1 class="denied__title">Access denied</h1>
        <p class="denied__text">This case is sealed at ${esc(CLEARANCES[c.clearance].label)}.
        Your clearance does not permit access. This attempt has been logged.</p>
        ${clearanceBadge(c.clearance)}
      </div>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/tribunals'));
    logAction(actor, 'CASE_ACCESS_DENIED', `Blocked access to sealed case ${c.ref}.`);
    return;
  }

  const canManage = canManageTribunal(actor);
  const canRule = canRuleTribunal(actor);

  // Panel members (links to dossiers).
  const panel = (c.panelIds || []).map((pid) => personLink(pid)).join('') || '<span class="empty-inline">No panel seated.</span>';

  // Record of the Vote — for deliberative (non-tribunal) matters. Each seated
  // panel member shows their position; the actor can cast/change their own.
  let voteBlock = '';
  if (caseTakesVote(c.kind)) {
    const votes = c.votes || {};
    const seated = c.panelIds || [];
    const t = tallyCaseVotes(votes);
    const iAmSeated = seated.includes(actor.id);
    const myVote = votes[actor.id] || null;

    const memberRows = seated.length ? seated.map((pid) => {
      const pos = votes[pid];
      const badge = pos
        ? `<span class="badge badge--${CASE_VOTE[pos].tone}">${esc(CASE_VOTE[pos].label)}</span>`
        : '<span class="muted-text">Not yet voted</span>';
      return `<div class="ack-row"><span class="ack-row__name">${personLink(pid)}</span>${badge}</div>`;
    }).join('') : '<div class="empty">No panel seated to vote.</div>';

    const castRow = iAmSeated ? `
      <div class="vote-cast">
        <span class="vote-cast__label">Your vote:</span>
        ${CASE_VOTE_ORDER.map((v) => `<button class="btn btn--sm ${myVote === v ? 'btn--primary' : ''}" data-vote="${v}">${esc(CASE_VOTE[v].label)}</button>`).join('')}
      </div>` : '<div class="field__hint">Only a seated panel member may vote on this matter.</div>';

    voteBlock = `
      <section class="card">
        <div class="card__title">Record of the Vote</div>
        <div class="card__body">
          <table class="votetbl">
            <thead><tr><th>In Favour</th><th>Opposed</th><th>Abstaining</th><th>Cast</th></tr></thead>
            <tbody><tr><td>${t.favour}</td><td>${t.oppose}</td><td>${t.abstain}</td><td>${t.cast}</td></tr></tbody>
          </table>
          <div class="vote-members">${memberRows}</div>
          ${castRow}
        </div>
      </section>`;
  }

  // Linked subjects — each respects its own sensitivity gate.
  const linkedSubjects = (c.linkedSubjectIds || []).map((sid) => {
    const s = getSubject(sid);
    if (!s || s.deleted) return '<div class="link-row"><span class="empty-inline">Linked record unavailable.</span></div>';
    if (!canViewSubject(actor, s)) {
      return `<div class="link-row link-row--sealed">\u25a0\u25a0\u25a0 Sealed subject \u2014 ${clearanceBadge(s.clearance)}</div>`;
    }
    return `<div class="link-row"><a class="ref-link" href="#/subject/${esc(s.id)}"><span class="mono">${esc(s.ref)}</span> ${esc(s.alias)}</a> ${orgTag(s.org)}</div>`;
  }).join('') || '<span class="empty-inline">No subjects cited.</span>';

  // Summons \u2014 each entry carries its formal instrument, exportable on demand.
  const summonsItems = (c.summons || []).length ? c.summons.map((m) => `
    <div class="summons">
      <div class="summons__who">${summonsWho(m, { link: true })}</div>
      <div class="summons__reason">${esc(m.reason)}</div>
      <div class="summons__meta">Issued ${fmtDate(m.ts)} \u00b7 <span class="mono">${esc(m.by)}</span>
        \u00b7 <button class="btn btn--xs" data-summons-doc="${esc(m.id)}">\u2399 Document</button></div>
    </div>`).join('') : '<div class="empty">No summons issued.</div>';

  // Proceedings docket.
  const entryItems = (c.entries || []).length ? c.entries.map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(e.type)}"></span>
      <div class="tl__body">
        <div class="tl__text">${linkify(e.text)}</div>
        <div class="tl__meta"><span class="tl__type">${esc(e.type)}</span> \u00b7 <span class="mono">${esc(e.by)}</span> \u00b7 ${fmtDate(e.ts)}</div>
      </div>
    </li>`).join('') : '<div class="empty">No proceedings recorded.</div>';

  // Ruling.
  const rulingBlock = c.ruling ? `
    <section class="card card--ruling">
      <div class="card__title">Ruling ${findingBadge(c.ruling.finding)}</div>
      <div class="card__body">
        <div class="ruling__label">Rationale</div>
        <p class="ruling__text">${esc(c.ruling.rationale || '\u2014')}</p>
        <div class="ruling__label">Measures</div>
        <p class="ruling__text">${esc(c.ruling.measures || '\u2014')}</p>
        <div class="ruling__meta">Entered ${fmtDate(c.ruling.ts)} \u00b7 <span class="mono">${esc(c.ruling.by)}</span></div>
      </div>
    </section>` : `
    <section class="card">
      <div class="card__title">Ruling</div>
      <div class="card__body">
        <div class="empty">No ruling entered.</div>
        ${!canRule ? helpNote('A ruling is entered by Command (CL5). You can add docket entries and seat a panel, but the finding is sealed until Command enters it.') : ''}
      </div>
    </section>`;

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Docket</button>
      <button class="btn btn--sm" id="print-record">⎙ Print</button>
      <button class="btn btn--sm" id="export-case">\u2913 Export record</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--ethics">${esc(monogram(c.title))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(c.title)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(c.ref)}</span>
          ${kindTag(c.kind)}
          ${caseStatusBadge(c.status)}
          ${clearanceBadge(c.clearance)}
          ${c.ruling ? findingBadge(c.ruling.finding) : ''}
        </div>
      </div>
    </header>

    ${caveatBanner(c)}

    ${canManage ? `<div class="actionbar">
      <button class="btn btn--sm" data-act="entry">Add docket entry</button>
      <button class="btn btn--sm" data-act="summons">Issue summons</button>
      <button class="btn btn--sm" data-act="panel">Seat panel</button>
      <button class="btn btn--sm" data-act="cite">Cite subject</button>
      <button class="btn btn--sm" data-act="status">Set status</button>
      <button class="btn btn--sm" data-act="reclassify">Reclassify</button>
      <button class="btn btn--sm" data-act="edit">Edit</button>
      ${canRule && !c.ruling ? '<button class="btn btn--sm btn--primary" data-act="ruling">Enter ruling</button>' : ''}
      ${c.status !== 'closed' && c.status !== 'dismissed' ? '<button class="btn btn--sm" data-act="dismiss">Dismiss</button>' : ''}
      <button class="btn btn--sm btn--danger" data-act="remove">Remove</button>
    </div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Case Record</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Reference</span><span class="kv__v mono">${esc(c.ref)}</span></div>
          <div class="kv"><span class="kv__k">Type</span><span class="kv__v">${esc(CASE_KIND[c.kind]?.label || c.kind)}</span></div>
          <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${caseStatusBadge(c.status)}</span></div>
          <div class="kv"><span class="kv__k">Sensitivity</span><span class="kv__v">${clearanceBadge(c.clearance)}</span></div>
          <div class="kv"><span class="kv__k">Respondent</span><span class="kv__v">${respondentLabel(c, { link: true })}</span></div>
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(c.createdAt)} \u00b7 <span class="mono">${esc(c.createdBy || 'SYSTEM')}</span></span></div>
          <div class="kv"><span class="kv__k">Updated</span><span class="kv__v">${fmtDateTime(c.updatedAt)}</span></div>
          <div class="kv kv--stack"><span class="kv__k">Panel</span><span class="kv__v link-list">${panel}</span></div>
          <div class="kv kv--stack"><span class="kv__k">Cited subjects</span><span class="kv__v link-list">${linkedSubjects}</span></div>
        </div>
      </section>
      <div class="dossier-col">
        <section class="card">
          <div class="card__title">Matter Under Review</div>
          <div class="card__body"><p class="subj-summary">${esc(c.summary || 'No summary on record.')}</p></div>
        </section>
        <section class="card">
          <div class="card__title">Summons</div>
          <div class="card__body">${summonsItems}</div>
        </section>
        <section class="card">
          <div class="card__title">Proceedings</div>
          <div class="card__body">${(c.entries || []).length ? `<ul class="timeline">${entryItems}</ul>` : entryItems}</div>
        </section>
        ${voteBlock}
        ${rulingBlock}
        ${renderHistory(actor, c, 'case')}
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/tribunals'));
  host.querySelector('#export-case').addEventListener('click', () => exportCase(app, c));
  host.querySelector('#print-record')?.addEventListener('click', () => window.print());

  const dispatch = {
    entry: () => openEntry(app, c),
    summons: () => openSummons(app, c),
    panel: () => openPanel(app, c),
    cite: () => openCite(app, c),
    status: () => openStatus(app, c),
    reclassify: () => openReclassify(app, c),
    edit: () => openEdit(app, c),
    ruling: () => openRuling(app, c),
    dismiss: () => dismissCase(app, c),
    remove: () => removeCase(app, c),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act]()));
  host.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', () => castVote(app, c, b.dataset.vote)));
  host.querySelectorAll('[data-summons-doc]').forEach((b) => b.addEventListener('click', () => {
    const m = (c.summons || []).find((x) => x.id === b.dataset.summonsDoc);
    if (m) exportSummons(app, c, m);
  }));
}

// ===========================================================================
// ACTION MODALS
// ===========================================================================
function selectField(id, label, options, selected, labeller = (x) => x) {
  const opts = options.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(labeller(o))}</option>`).join('');
  return `<div class="field"><label>${esc(label)}</label><select id="${id}">${opts}</select></div>`;
}

// Personnel options for a respondent / summons target select.
function personnelOptions(selectedId) {
  const people = users().filter((u) => !u.deleted && u.accountStatus === 'active');
  const opts = people.map((u) => `<option value="${esc(u.id)}" ${u.id === selectedId ? 'selected' : ''}>${esc(u.designation)} \u00b7 ${esc(u.codename)} (${esc(ORGS[u.org].short)})</option>`).join('');
  return `<option value="">\u2014 external / unnamed \u2014</option>${opts}`;
}

// Human-readable respondent: a linked operator, or a free-text person and/or
// department, or a bare department when the matter concerns a whole section.
function respondentLabel(c, { link = false } = {}) {
  if (c.respondentId) return link ? personLink(c.respondentId) : esc(personName(c.respondentId));
  const name = c.respondentName && c.respondentName !== '[UNNAMED]' ? c.respondentName : '';
  const dept = c.respondentDept || '';
  if (name && dept) return `${esc(name)} <span class="muted-text">\u2014 ${esc(dept)}</span>`;
  if (name) return esc(name);
  if (dept) return `${esc(dept)} <span class="badge badge--muted">Department</span>`;
  return '\u2014';
}
function summonsWho(m, { link = false } = {}) {
  if (m.targetId) return link ? personLink(m.targetId, m.targetName) : esc(personName(m.targetId));
  const name = m.targetName || '';
  const dept = m.targetDept || '';
  if (name && dept) return `${esc(name)} <span class="muted-text">\u2014 ${esc(dept)}</span>`;
  if (name) return esc(name);
  if (dept) return `${esc(dept)} <span class="badge badge--muted">Department</span>`;
  return '\u2014';
}

function suggestCaseRef() {
  const yy = new Date().getFullYear().toString().slice(-2);
  const n = cases().filter((c) => c.ref.includes(`-${yy}-`)).length + 1;
  return `EC-CASE-${yy}-${String(n).padStart(3, '0')}`;
}

function openCreate(app) {
  const actor = app.user;
  const ceiling = clearanceWeight(actor.clearance);
  const allowedClr = CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= ceiling);
  const body = `
    <p class="modal__message">Open a Committee case. Sensitivity cannot exceed your own clearance.</p>
    <div class="field"><label>Reference</label><input id="cs-ref" type="text" value="${esc(suggestCaseRef())}" /></div>
    <div class="field"><label>Matter (title)</label><input id="cs-title" type="text" placeholder="e.g. Containment Review \u2014 Sector 9" /></div>
    ${selectField('cs-kind', 'Type', CASE_KIND_ORDER, 'review', (k) => CASE_KIND[k].label)}
    ${selectField('cs-clr', 'Sensitivity', allowedClr, allowedClr[allowedClr.length - 1], (c) => CLEARANCES[c].label)}
    <div class="field"><label>Respondent</label><select id="cs-resp">${personnelOptions(null)}</select></div>
    <div class="field field--split"><div><label>If external \u2014 name <span class="muted-text">(optional)</span></label><input id="cs-resp-name" type="text" placeholder="e.g. Dr. Halloran, or leave blank" /></div><div><label>Department <span class="muted-text">(optional)</span></label><input id="cs-resp-dept" type="text" placeholder="e.g. Site-19 Research Division" /></div></div>
    <div class="field__hint">Leave the respondent as \u201cexternal / unnamed\u201d to name a person or department by hand \u2014 a department alone is fine when the matter concerns a whole section.</div>
    <div class="field"><label>Matter under review</label><textarea id="cs-summary" rows="3" placeholder="State the matter\u2026"></textarea></div>
    ${compartmentField(actor, 'cs-comp', '')}
    <div id="cs-err" class="auth__error" hidden></div>
  `;
  openModal({
    title: 'New tribunal case',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Open case', tone: 'primary', onClick: (c, d) => {
          const ref = d.querySelector('#cs-ref').value.trim() || suggestCaseRef();
          const title = d.querySelector('#cs-title').value.trim();
          const kind = d.querySelector('#cs-kind').value;
          const clr = d.querySelector('#cs-clr').value;
          const respId = d.querySelector('#cs-resp').value || null;
          const respName = (d.querySelector('#cs-resp-name').value || '').trim();
          const respDept = (d.querySelector('#cs-resp-dept').value || '').trim();
          const summary = d.querySelector('#cs-summary').value.trim();
          const comp = d.querySelector('#cs-comp').value || null;
          const err = d.querySelector('#cs-err');
          err.hidden = true;
          if (!title) { err.textContent = 'A matter title is required.'; err.hidden = false; return; }
          if (!canClassifyAt(actor, clr)) { err.textContent = 'Sensitivity cannot exceed your own clearance.'; err.hidden = false; return; }
          if (cases().some((x) => !x.deleted && x.ref.toLowerCase() === ref.toLowerCase())) { err.textContent = 'That reference is already in use.'; err.hidden = false; return; }
          const now = new Date().toISOString();
          upsertCase({
            id: newId('case'), ref, title, kind, clearance: clr, status: 'open', summary,
            respondentId: respId, respondentName: respId ? null : (respName || (respDept ? null : '[UNNAMED]')), respondentDept: respId ? null : (respDept || null),
            panelIds: [], votes: {}, linkedSubjectIds: [], summons: [],
            compartment: comp,
            entries: [{ id: newId('ent'), ts: now, by: actor.designation, type: 'filing', text: `Case opened by ${actor.designation}.` }],
            ruling: null, createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'OPEN_CASE', `Opened ${ref} (${title}).`);
          c();
          toast(`Case ${ref} opened.`, 'success');
          app.refresh();
        } },
    ],
  });
}

function openEdit(app, c) {
  const body = `
    <div class="field"><label>Matter (title)</label><input id="ed-title" type="text" value="${esc(c.title)}" /></div>
    ${selectField('ed-kind', 'Type', CASE_KIND_ORDER, c.kind, (k) => CASE_KIND[k].label)}
    <div class="field"><label>Respondent</label><select id="ed-resp">${personnelOptions(c.respondentId)}</select></div>
    <div class="field field--split"><div><label>If external \u2014 name</label><input id="ed-resp-name" type="text" value="${esc(c.respondentId ? '' : (c.respondentName && c.respondentName !== '[UNNAMED]' ? c.respondentName : ''))}" placeholder="optional" /></div><div><label>Department</label><input id="ed-resp-dept" type="text" value="${esc(c.respondentDept || '')}" placeholder="optional" /></div></div>
    <div class="field"><label>Matter under review</label><textarea id="ed-summary" rows="4">${esc(c.summary || '')}</textarea></div>
    ${compartmentField(app.user, 'ed-comp', c.compartment)}
  `;
  openModal({
    title: `Edit \u2014 ${c.ref}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Save changes', tone: 'primary', onClick: (x, d) => {
          const title = d.querySelector('#ed-title').value.trim() || c.title;
          const kind = d.querySelector('#ed-kind').value;
          const respId = d.querySelector('#ed-resp').value || null;
          const respName = (d.querySelector('#ed-resp-name').value || '').trim();
          const respDept = (d.querySelector('#ed-resp-dept').value || '').trim();
          const summary = d.querySelector('#ed-summary').value.trim();
          const comp = d.querySelector('#ed-comp').value || null;
          mutate(app, c.id, c.version, (rec) => {
            rec.title = title; rec.kind = kind; rec.summary = summary;
            rec.respondentId = respId;
            rec.respondentName = respId ? null : (respName || (respDept ? null : (rec.respondentName || '[UNNAMED]')));
            rec.respondentDept = respId ? null : (respDept || null);
            rec.compartment = comp;
          }, { action: 'EDIT_CASE', detail: `${c.ref} updated.` });
          x();
          toast('Case updated.', 'success');
        } },
    ],
  });
}

function openEntry(app, c) {
  openModal({
    title: `Add docket entry \u2014 ${c.ref}`,
    body: `
      ${selectField('en-type', 'Entry type', ['filing', 'testimony', 'motion', 'note'], 'note', (t) => t[0].toUpperCase() + t.slice(1))}
      <div class="field"><label>Entry</label><textarea id="en-text" rows="3" placeholder="Record the proceeding\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Add entry', tone: 'primary', onClick: (x, d) => {
          const type = d.querySelector('#en-type').value;
          const text = d.querySelector('#en-text').value.trim();
          if (!text) { toast('An entry is required.', 'error'); return; }
          mutate(app, c.id, c.version, (rec) => addEntry(rec, type, app.user.designation, text),
            { action: 'ADD_CASE_ENTRY', detail: `Docket entry added to ${c.ref}.` });
          x();
          toast('Entry recorded.', 'success');
        } },
    ],
  });
}

function openSummons(app, c) {
  openModal({
    title: `Issue summons \u2014 ${c.ref}`,
    body: `
      <div class="field"><label>Summoned party</label><select id="sm-target">${personnelOptions(null)}</select></div>
      <div class="field field--split"><div><label>If external \u2014 name</label><input id="sm-name" type="text" placeholder="optional" /></div><div><label>Department</label><input id="sm-dept" type="text" placeholder="e.g. Research Division" /></div></div>
      <div class="field"><label>Reason</label><textarea id="sm-reason" rows="2" placeholder="Why are they summoned?"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Issue summons', tone: 'primary', onClick: (x, d) => {
          const targetId = d.querySelector('#sm-target').value || null;
          const targetName = d.querySelector('#sm-name').value.trim();
          const targetDept = d.querySelector('#sm-dept').value.trim();
          const reason = d.querySelector('#sm-reason').value.trim();
          if (!reason) { toast('A reason is required.', 'error'); return; }
          if (!targetId && !targetName && !targetDept) { toast('Name a person or department to summon.', 'error'); return; }
          const who = targetId ? personName(targetId) : (targetName || targetDept);
          const entry = { id: newId('sum'), ts: new Date().toISOString(), by: app.user.designation, targetId, targetName: targetId ? null : (targetName || null), targetDept: targetId ? null : (targetDept || null), reason };
          const ok = mutate(app, c.id, c.version, (rec) => {
            rec.summons = rec.summons || [];
            rec.summons.unshift(entry);
            addEntry(rec, 'filing', app.user.designation, `Summons issued to ${who}.`);
          }, { action: 'ISSUE_SUMMONS', detail: `Summons issued in ${c.ref}.` });
          x();
          if (ok) {
            toast('Summons issued.', 'success');
            // The instrument itself: open the formal Summons to Appear for service.
            exportSummons(app, c, entry);
          }
        } },
    ],
  });
}

function openPanel(app, c) {
  const people = users().filter((u) => !u.deleted && u.accountStatus === 'active' && (u.org === 'ethics-committee' || u.org === 'command'));
  const seated = new Set(c.panelIds || []);
  const list = people.map((u) => `
    <label class="check">
      <input type="checkbox" value="${esc(u.id)}" ${seated.has(u.id) ? 'checked' : ''} />
      <span><span class="mono">${esc(u.designation)}</span> ${esc(u.codename)} ${orgTag(u.org)}</span>
    </label>`).join('') || '<div class="empty">No eligible members.</div>';

  openModal({
    title: `Seat panel \u2014 ${c.ref}`,
    body: `<p class="modal__message">Select the Committee members seated on this case.</p><div class="check-list">${list}</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Save panel', tone: 'primary', onClick: (x, d) => {
          const ids = [...d.querySelectorAll('.check input:checked')].map((i) => i.value);
          mutate(app, c.id, c.version, (rec) => {
            rec.panelIds = ids;
            addEntry(rec, 'note', app.user.designation, `Panel updated (${ids.length} seated).`);
          }, { action: 'SET_PANEL', detail: `Panel set for ${c.ref}.` });
          x();
          toast('Panel updated.', 'success');
        } },
    ],
  });
}

function openCite(app, c) {
  const actor = app.user;
  // Only subjects the actor may see are offered; links the actor cannot see are
  // preserved untouched so editing never silently drops a sealed citation.
  const viewable = subjects().filter((s) => !s.deleted && canViewSubject(actor, s));
  const viewableIds = new Set(viewable.map((s) => s.id));
  const preserved = (c.linkedSubjectIds || []).filter((idv) => !viewableIds.has(idv));
  const linkedNow = new Set(c.linkedSubjectIds || []);

  const list = viewable.length ? viewable.map((s) => `
    <label class="check">
      <input type="checkbox" value="${esc(s.id)}" ${linkedNow.has(s.id) ? 'checked' : ''} />
      <span><span class="mono">${esc(s.ref)}</span> ${esc(s.alias)} ${orgTag(s.org)}</span>
    </label>`).join('') : '<div class="empty">No subjects you can cite.</div>';

  const note = preserved.length ? `<p class="modal__message">${preserved.length} sealed citation${preserved.length > 1 ? 's are' : ' is'} above your clearance and will be kept as-is.</p>` : '';

  openModal({
    title: `Cite surveillance subjects \u2014 ${c.ref}`,
    body: `<p class="modal__message">Link subjects relevant to this case.</p>${note}<div class="check-list">${list}</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Save citations', tone: 'primary', onClick: (x, d) => {
          const chosen = [...d.querySelectorAll('.check input:checked')].map((i) => i.value);
          const next = [...preserved, ...chosen];
          mutate(app, c.id, c.version, (rec) => {
            rec.linkedSubjectIds = next;
            addEntry(rec, 'motion', app.user.designation, `Cited subjects updated (${next.length} on file).`);
          }, { action: 'CITE_SUBJECT', detail: `Citations updated for ${c.ref}.` });
          x();
          toast('Citations updated.', 'success');
        } },
    ],
  });
}

function openStatus(app, c) {
  openModal({
    title: `Set status \u2014 ${c.ref}`,
    body: selectField('cst-status', 'Status', CASE_STATUS_ORDER, c.status, (x) => CASE_STATUS[x].label),
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Update status', tone: 'primary', onClick: (x, d) => {
          const status = d.querySelector('#cst-status').value;
          mutate(app, c.id, c.version, (rec) => {
            const from = rec.status; rec.status = status;
            addEntry(rec, 'note', app.user.designation, `Status ${CASE_STATUS[from].label} \u2192 ${CASE_STATUS[status].label}.`);
          }, { action: 'SET_CASE_STATUS', detail: `${c.ref} status \u2192 ${status}.` });
          x();
          toast('Status updated.', 'success');
        } },
    ],
  });
}

function openReclassify(app, c) {
  const ceiling = clearanceWeight(app.user.clearance);
  const allowed = CLEARANCE_ORDER.filter((x) => clearanceWeight(x) <= ceiling);
  openModal({
    title: `Reclassify \u2014 ${c.ref}`,
    body: `<p class="modal__message">Set case sensitivity. You cannot raise it above your own clearance.</p>
      ${selectField('rcs-clr', 'Sensitivity', allowed, allowed.includes(c.clearance) ? c.clearance : allowed[allowed.length - 1], (x) => CLEARANCES[x].label)}`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Apply', tone: 'primary', onClick: (x, d) => {
          const clr = d.querySelector('#rcs-clr').value;
          if (!canClassifyAt(app.user, clr)) { toast('Sensitivity cannot exceed your own clearance.', 'error'); return; }
          mutate(app, c.id, c.version, (rec) => {
            const from = rec.clearance; rec.clearance = clr;
            if (from !== clr) addEntry(rec, 'note', app.user.designation, `Sensitivity ${CLEARANCES[from].label} \u2192 ${CLEARANCES[clr].label}.`);
          }, { action: 'RECLASSIFY_CASE', detail: `${c.ref} reclassified.` });
          x();
          toast('Case reclassified.', 'success');
        } },
    ],
  });
}

function openRuling(app, c) {
  if (!canRuleTribunal(app.user)) { toast('Only CL5 may enter a ruling.', 'error'); return; }
  const body = `
    <p class="modal__message">Enter the Committee's binding ruling. This sets the case to <strong>Ruled</strong>.</p>
    ${selectField('rl-finding', 'Finding', RULING_FINDING_ORDER, 'upheld', (f) => RULING_FINDING[f].label)}
    <div class="field"><label>Rationale</label><textarea id="rl-rationale" rows="3" placeholder="Basis for the finding\u2026"></textarea></div>
    <div class="field"><label>Measures</label><textarea id="rl-measures" rows="2" placeholder="Directed measures, if any\u2026"></textarea></div>
  `;
  openModal({
    title: `Enter ruling \u2014 ${c.ref}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (x) => x() },
      { label: 'Enter ruling', tone: 'primary', onClick: (x, d) => {
          const finding = d.querySelector('#rl-finding').value;
          const rationale = d.querySelector('#rl-rationale').value.trim();
          const measures = d.querySelector('#rl-measures').value.trim();
          if (!rationale) { toast('A rationale is required.', 'error'); return; }
          mutate(app, c.id, c.version, (rec) => {
            rec.ruling = { ts: new Date().toISOString(), by: app.user.designation, finding, rationale, measures };
            rec.status = 'ruled';
            addEntry(rec, 'ruling', app.user.designation, `Ruling entered: ${RULING_FINDING[finding].label}.`);
          }, { action: 'ENTER_RULING', detail: `Ruling entered in ${c.ref}: ${finding}.` });
          x();
          toast('Ruling entered.', 'success');
        } },
    ],
  });
}

async function dismissCase(app, c) {
  const ok = await confirmDialog({
    title: 'Dismiss case',
    message: `Dismiss ${c.ref} \u00b7 ${c.title}? It stays on the docket marked dismissed.`,
    confirmLabel: 'Dismiss case',
  });
  if (!ok) return;
  mutate(app, c.id, c.version, (rec) => {
    rec.status = 'dismissed';
    addEntry(rec, 'note', app.user.designation, 'Case dismissed.');
  }, { action: 'SET_CASE_STATUS', detail: `${c.ref} dismissed.` });
  toast('Case dismissed.', 'success');
}

async function removeCase(app, c) {
  const ok = await confirmDialog({
    title: 'Remove case',
    message: `Move ${c.ref} \u00b7 ${c.title} to the recycle bin? It can be restored by Command.`,
    confirmLabel: 'Remove case',
    danger: true,
  });
  if (!ok) return;
  const fresh = getCase(c.id);
  if (!fresh) { app.refresh(); return; }
  fresh.deleted = true;
  fresh.deletedAt = new Date().toISOString();
  fresh.version += 1;
  upsertCase(fresh);
  logAction(app.user, 'REMOVE_CASE', `${c.ref} moved to recycle bin.`);
  toast('Case moved to recycle bin.', 'success');
  app.navigate('#/tribunals');
}
