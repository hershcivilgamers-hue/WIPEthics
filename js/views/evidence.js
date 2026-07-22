// =============================================================================
// views/evidence.js — Omega-1 evidence submissions.
//
// Operators file evidence of their weekly engagement; each *counted* item feeds
// the derived Evidence score on the engagement board (constants.js). A submission
// counts immediately, unless the operator is flagged "review required" — then it
// lands In review until a reviewer counts or rejects it. Self-service: an operator
// files their own; a Sr CL4 reviewer (or CL5) files for anyone, reviews items and
// sets the per-operator review flag. Every write routes through the permission
// engine and is re-authorised by the Worker.
// =============================================================================

import {
  EVIDENCE_STATUS, engagementWeekStart, engagementWeekShift, rankIndex,
  ORGS,
} from '../constants.js';
import {
  users, evidenceFor, getEvidence, upsertEvidence, getUser, upsertUser, newId,
  directives, intel, subjects, getSubject, upsertSubject, getIntel, upsertIntel,
  operations, getOperation, upsertOperation, cases, getCase, upsertCase,
} from '../storage.js';
import {
  isCL5, canManageOrg, canManageSubject, canLogIntel, canLogToOperation,
  canManageTribunal, canViewCase,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, fmtDate, toast, openModal, confirmDialog } from '../ui.js';

const ORG = 'omega-1';
let viewWeek = engagementWeekStart();

// The record kinds an evidence item can point at. `rows` reads the (already
// access-filtered) snapshot, so an operator can only reference what they can see.
const REF_KINDS = {
  directive: { label: 'Order',        rows: () => directives(),  hash: (id) => `#/directive/${id}`, opt: (d) => `${d.ref || ''} ${d.title || ''}`.trim() || d.id },
  intel:     { label: 'Intelligence', rows: () => intel(),       hash: (id) => `#/source/${id}`,     opt: (s) => `${s.ref || ''} ${s.codename || ''}`.trim() || s.id },
  subject:   { label: 'Surveillance', rows: () => subjects(),    hash: (id) => `#/subject/${id}`,     opt: (s) => `${s.ref || ''} ${s.alias || ''}`.trim() || s.id },
  operation: { label: 'Operation',    rows: () => operations(),  hash: (id) => `#/operation/${id}`,   opt: (o) => `${o.ref || ''} ${o.name || ''}`.trim() || o.id },
  case:      { label: 'Case',         rows: () => cases(),       hash: (id) => `#/case/${id}`,        opt: (c) => `${c.ref || ''} ${c.title || ''}`.trim() || c.id },
};
const refHash = (ref) => (ref && REF_KINDS[ref.kind] ? REF_KINDS[ref.kind].hash(ref.id) : '#');

const isReviewer = (actor) => isCL5(actor) || canManageOrg(actor, ORG);

function weekLabel(ws) {
  return `${fmtDate(new Date(ws).toISOString())} – ${fmtDate(new Date(ws + 6 * 86400000).toISOString())}`;
}

function roster() {
  return users()
    .filter((u) => !u.deleted && u.org === ORG && u.accountStatus === 'active' && u.status !== 'discharged')
    .sort((a, b) => (rankIndex(ORG, a.rank) - rankIndex(ORG, b.rank)) || (a.designation || '').localeCompare(b.designation || ''));
}

const statusBadge = (e) => {
  const m = EVIDENCE_STATUS[e.status] || { label: e.status, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};

// One evidence item. `controls` is a trailing HTML string of action buttons.
function itemRow(e, controls) {
  return `
    <div class="ev-item" data-ev="${esc(e.id)}">
      <div class="ev-item__head">
        <span class="ev-item__title">${esc(e.title)}</span>
        ${e.ref && e.ref.id ? `<a class="rec-link" href="${esc(refHash(e.ref))}">${esc((REF_KINDS[e.ref.kind] || {}).label || 'record')}: ${esc(e.ref.label || e.ref.id)}</a>` : ''}
        ${e.link ? `<a class="rec-link" href="${esc(e.link)}" target="_blank" rel="noopener">link ↗</a>` : ''}
        ${statusBadge(e)}
      </div>
      ${e.note ? `<div class="ev-item__note">${esc(e.note)}</div>` : ''}
      <div class="ev-item__meta"><span class="mono">${esc(e.submittedBy || '—')}</span> · ${fmtDate(e.createdAt)}${e.reviewedBy ? ` · reviewed by ${esc(e.reviewedBy)}` : ''}</div>
      ${controls ? `<div class="ev-item__actions">${controls}</div>` : ''}
    </div>`;
}

export function render(host, app) {
  const actor = app.user;
  const reviewer = isReviewer(actor);
  const member = actor.org === ORG;

  // --- my own submissions (any Omega operator) ---
  const meFull = getUser(actor.id) || actor;
  const mine = member ? evidenceFor(actor.id, viewWeek).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
  const myReviewNote = meFull.evidenceReviewRequired
    ? '<div class="ntk-banner">Your evidence is under review — new items are held until a reviewer counts them.</div>'
    : '';
  const mineHTML = member ? `
    <section class="card">
      <div class="card__title">Your evidence — ${esc(weekLabel(viewWeek))}</div>
      <div class="card__body">
        ${myReviewNote}
        <button class="btn btn--sm btn--primary" id="ev-add-mine">+ Submit evidence</button>
        <div class="ev-list">${mine.length ? mine.map((e) => itemRow(e, `<button class="btn btn--xs btn--danger" data-ev-withdraw="${esc(e.id)}">Withdraw</button>`)).join('') : '<div class="empty">No evidence filed for this week yet.</div>'}</div>
      </div>
    </section>` : '';

  // --- reviewer roster ---
  let reviewHTML = '';
  if (reviewer) {
    const rows = roster().map((u) => {
      const items = evidenceFor(u.id, viewWeek).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const counted = items.filter((e) => e.status === 'counted').length;
      const pending = items.filter((e) => e.status === 'pending').length;
      const reviewChip = u.evidenceReviewRequired ? '<span class="badge badge--warn">review required</span>' : '';
      const itemsHTML = items.length ? items.map((e) => {
        const btns = [];
        if (e.status !== 'counted') btns.push(`<button class="btn btn--xs" data-ev-count="${esc(e.id)}">Count</button>`);
        if (e.status !== 'rejected') btns.push(`<button class="btn btn--xs btn--danger" data-ev-reject="${esc(e.id)}">Reject</button>`);
        return itemRow(e, btns.join(' '));
      }).join('') : '<div class="empty">No submissions.</div>';
      return `
        <div class="ev-op">
          <div class="ev-op__head">
            <div><span class="mono">${esc(u.designation)}</span> ${esc(u.codename || '')} ${reviewChip}</div>
            <div class="ev-op__right">
              <span class="muted-text">${counted} counted${pending ? ` · ${pending} in review` : ''}</span>
              <button class="btn btn--xs" data-ev-file="${esc(u.id)}">File for…</button>
              <button class="btn btn--xs" data-ev-toggle="${esc(u.id)}">${u.evidenceReviewRequired ? 'Clear review' : 'Require review'}</button>
            </div>
          </div>
          <div class="ev-list">${itemsHTML}</div>
        </div>`;
    }).join('');
    reviewHTML = `
      <section class="card">
        <div class="card__title">Review — ${esc(weekLabel(viewWeek))}</div>
        <div class="card__body">${roster().length ? rows : `<div class="empty">No active ${esc(ORGS['omega-1'].short)} operators.</div>`}</div>
      </section>`;
  }

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · ${esc(ORGS['omega-1'].short)}</div>
        <h1 class="page-title">Evidence</h1>
        <div class="page-sub">Submit evidence of your weekly engagement · counted items feed the Evidence score</div>
      </div>
    </div>

    <div class="toolbar eng-weeknav">
      <button class="btn btn--sm" id="ev-prev">◀ Previous week</button>
      <span class="eng-week">${esc(weekLabel(viewWeek))}</span>
      <button class="btn btn--sm" id="ev-next" ${engagementWeekShift(viewWeek, 1) > engagementWeekStart() ? 'disabled' : ''}>Next week ▶</button>
      ${viewWeek !== engagementWeekStart() ? '<button class="btn btn--sm btn--ghost" id="ev-now">This week</button>' : ''}
    </div>

    ${mineHTML}
    ${reviewHTML}
    ${!member && !reviewer ? `<div class="card"><div class="card__body"><div class="empty">Evidence submission is for ${esc(ORGS['omega-1'].short)} personnel.</div></div></div>` : ''}
  `;

  // Week nav
  host.querySelector('#ev-prev').addEventListener('click', () => { viewWeek = engagementWeekShift(viewWeek, -1); render(host, app); });
  const nx = host.querySelector('#ev-next');
  if (nx) nx.addEventListener('click', () => { viewWeek = engagementWeekShift(viewWeek, 1); render(host, app); });
  const now = host.querySelector('#ev-now');
  if (now) now.addEventListener('click', () => { viewWeek = engagementWeekStart(); render(host, app); });

  // My submit / withdraw
  const addMine = host.querySelector('#ev-add-mine');
  if (addMine) addMine.addEventListener('click', () => openSubmit(app, meFull));
  host.querySelectorAll('[data-ev-withdraw]').forEach((b) => b.addEventListener('click', () => withdraw(app, b.dataset.evWithdraw)));

  // Reviewer actions
  host.querySelectorAll('[data-ev-count]').forEach((b) => b.addEventListener('click', () => review(app, b.dataset.evCount, 'counted')));
  host.querySelectorAll('[data-ev-reject]').forEach((b) => b.addEventListener('click', () => review(app, b.dataset.evReject, 'rejected')));
  host.querySelectorAll('[data-ev-file]').forEach((b) => b.addEventListener('click', () => { const u = getUser(b.dataset.evFile); if (u) openSubmit(app, u); }));
  host.querySelectorAll('[data-ev-toggle]').forEach((b) => b.addEventListener('click', () => toggleReview(app, b.dataset.evToggle)));
}

// --- Actions ----------------------------------------------------------------
function openSubmit(app, targetUser) {
  const self = targetUser.id === app.user.id;
  const kindOpts = Object.entries(REF_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  const dialog = openModal({
    title: self ? 'Submit evidence' : `File evidence — ${targetUser.designation}`,
    wide: true,
    body: `
      <p class="modal__message">Week of ${esc(weekLabel(viewWeek))}. ${targetUser.evidenceReviewRequired ? 'This operator is under review — the item will be held until a reviewer counts it.' : 'The item counts toward the Evidence score straight away.'}</p>
      <div class="field"><label>Title</label><input id="ev-title" type="text" placeholder="What the evidence shows…" /></div>
      <div class="field"><label>Link to a record <span class="muted-text">(optional)</span></label>
        <div class="ev-ref-row">
          <select id="ev-ref-kind"><option value="">— none —</option>${kindOpts}</select>
          <select id="ev-ref-id" disabled><option value="">Select a record…</option></select>
        </div>
      </div>
      <div class="field"><label>External link <span class="muted-text">(optional)</span></label><input id="ev-link" type="text" placeholder="https://… (clip, screenshot)" /></div>
      <div class="field"><label>Note <span class="muted-text">(optional)</span></label><textarea id="ev-note" rows="2" placeholder="Any context for the reviewer…"></textarea></div>
      <div id="ev-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Submit', tone: 'primary', onClick: (c, d) => {
          const title = d.querySelector('#ev-title').value.trim();
          const link = d.querySelector('#ev-link').value.trim();
          const note = d.querySelector('#ev-note').value.trim();
          if (!title) { const e = d.querySelector('#ev-err'); e.textContent = 'A title is required.'; e.hidden = false; return; }
          const kind = d.querySelector('#ev-ref-kind').value;
          const refId = d.querySelector('#ev-ref-id').value;
          let ref = null;
          if (kind && refId && REF_KINDS[kind]) {
            const row = REF_KINDS[kind].rows().find((r) => r.id === refId);
            if (row) ref = { kind, id: refId, label: REF_KINDS[kind].opt(row) };
          }
          submit(app, targetUser, { title, link, note, ref });
          c();
          toast('Evidence submitted.', 'success');
        } },
    ],
  });

  // Populate the record dropdown from the chosen kind's visible records.
  const kindSel = dialog.querySelector('#ev-ref-kind');
  const idSel = dialog.querySelector('#ev-ref-id');
  kindSel.addEventListener('change', () => {
    const k = REF_KINDS[kindSel.value];
    if (!k) { idSel.innerHTML = '<option value="">Select a record…</option>'; idSel.disabled = true; return; }
    const rows = k.rows().filter((r) => !r.deleted);
    idSel.innerHTML = '<option value="">Select a record…</option>'
      + rows.map((r) => `<option value="${esc(r.id)}">${esc(k.opt(r))}</option>`).join('');
    idSel.disabled = false;
  });
}

function submit(app, targetUser, { title, link, note, ref }) {
  const nowIso = new Date().toISOString();
  // The server re-derives status from the operator's review flag; this is the
  // optimistic local value so the UI reads right before the snapshot returns.
  const status = targetUser.evidenceReviewRequired ? 'pending' : 'counted';
  upsertEvidence({
    id: newId('ev'), org: ORG, userId: targetUser.id, weekStart: viewWeek,
    title, link: link || '', note: note || '', ref: ref || null, status,
    submittedBy: app.user.designation, reviewedBy: null, reviewedAt: null,
    createdAt: nowIso, updatedAt: nowIso, version: 1, deleted: false, deletedAt: null,
  });
  logAction(app.user, 'SUBMIT_EVIDENCE', `Evidence filed for ${targetUser.designation}: ${title}.`);
  if (ref) crossPost(app, ref, { title, note, link });
  app.refresh();
}

// Mirror the citation onto the linked record's own thread — but only where a
// thread exists AND the submitter is cleared to write it (the same gate the
// Worker enforces, so this never 403s). Surveillance subjects and operations
// take a log entry, intel sources take a report, and tribunal cases take a
// docket entry (only where the submitter can run that case). Standing Orders
// are immutable and have no thread, so an Order stays a one-way link.
// Compartmented records are skipped to avoid the need-to-know write block.
function crossPost(app, ref, ev) {
  if (!ref || !ref.id) return;
  const actor = app.user;
  const nowIso = new Date().toISOString();
  // Copy the evidence itself onto the thread: the title, the operator's note,
  // and any link (clip / screenshot / video URL). Threads render entry text with
  // linkify(), so a pasted URL becomes clickable where the reader is cleared.
  const bits = [`Cited as engagement evidence by ${actor.designation}: ${ev.title}`];
  if (ev.note) bits.push(ev.note);
  if (ev.link) bits.push(ev.link);
  const cite = bits.join(' — ');
  if (ref.kind === 'subject') {
    const s = getSubject(ref.id);
    if (!s || s.deleted || s.compartment || !canManageSubject(actor, s)) return;
    s.logs = [...(s.logs || []), { id: newId('log'), ts: nowIso, by: actor.designation, type: 'note', text: cite }];
    s.updatedAt = nowIso; s.version = (s.version || 1) + 1;
    upsertSubject(s);
    logAction(actor, 'ADD_SURVEILLANCE_LOG', `Evidence citation added to ${s.ref}.`);
  } else if (ref.kind === 'intel') {
    const s = getIntel(ref.id);
    if (!s || s.deleted || !canLogIntel(actor, s)) return;
    s.reports = [...(s.reports || []), { id: newId('ir'), at: Date.now(), by: actor.designation, text: cite }];
    s.updatedAt = nowIso; s.version = (s.version || 1) + 1;
    upsertIntel(s);
    logAction(actor, 'LOG_INTEL', `Evidence citation added to ${s.ref}.`);
  } else if (ref.kind === 'operation') {
    const o = getOperation(ref.id);
    if (!o || o.deleted || o.compartment || !canLogToOperation(actor, o)) return;
    o.log = [...(o.log || []), { id: newId('ol'), at: Date.now(), by: actor.designation, type: 'note', text: cite }];
    o.updatedAt = nowIso; o.version = (o.version || 1) + 1;
    upsertOperation(o);
    logAction(actor, 'LOG_OPERATION', `Evidence citation added to ${o.ref}.`);
  } else if (ref.kind === 'case') {
    const c = getCase(ref.id);
    if (!c || c.deleted || c.compartment || !canViewCase(actor, c) || !canManageTribunal(actor)) return;
    // Docket entries read newest-first, so prepend (matches tribunals.js addEntry).
    c.entries = [{ id: newId('ent'), ts: nowIso, by: actor.designation, type: 'note', text: cite }, ...(c.entries || [])];
    c.updatedAt = nowIso; c.version = (c.version || 1) + 1;
    upsertCase(c);
    logAction(actor, 'ADD_CASE_ENTRY', `Evidence citation added to ${c.ref}.`);
  }
}

function review(app, id, status) {
  const fresh = getEvidence(id);
  if (!fresh) { toast('That item no longer exists.', 'error'); app.refresh(); return; }
  const nowIso = new Date().toISOString();
  fresh.status = status;
  fresh.reviewedBy = app.user.designation;
  fresh.reviewedAt = nowIso;
  fresh.updatedAt = nowIso;
  fresh.version = (fresh.version || 1) + 1;
  upsertEvidence(fresh);
  logAction(app.user, 'REVIEW_EVIDENCE', `Evidence ${status}: ${fresh.title}.`);
  app.refresh();
  toast(status === 'counted' ? 'Evidence counted.' : 'Evidence rejected.', 'success');
}

async function withdraw(app, id) {
  const fresh = getEvidence(id);
  if (!fresh) return;
  const ok = await confirmDialog({ title: 'Withdraw evidence', message: `Withdraw “${fresh.title}”?`, confirmLabel: 'Withdraw', danger: true });
  if (!ok) return;
  const nowIso = new Date().toISOString();
  fresh.deleted = true; fresh.deletedAt = nowIso; fresh.updatedAt = nowIso;
  fresh.version = (fresh.version || 1) + 1;
  upsertEvidence(fresh);
  logAction(app.user, 'REMOVE_EVIDENCE', `Evidence withdrawn: ${fresh.title}.`);
  app.refresh();
  toast('Evidence withdrawn.', 'success');
}

function toggleReview(app, userId) {
  const fresh = getUser(userId);
  if (!fresh) return;
  fresh.evidenceReviewRequired = !fresh.evidenceReviewRequired;
  fresh.updatedAt = new Date().toISOString();
  fresh.version = (fresh.version || 1) + 1;
  upsertUser(fresh);
  logAction(app.user, 'SET_EVIDENCE_REVIEW', `${fresh.designation}: evidence review ${fresh.evidenceReviewRequired ? 'required' : 'cleared'}.`);
  app.refresh();
  toast(fresh.evidenceReviewRequired ? 'Evidence review required for this operator.' : 'Evidence review cleared.', 'success');
}
