// =============================================================================
// views/deployments.js — Omega-1 Operations & Deployment Log.
//
// The regiment's record of the operations it runs. An operation is clearance-
// gated like a surveillance subject and may carry a Need-To-Know caveat; an
// operator ASSIGNED to it (lead or participant) can always see it and file field
// log entries, even without the management right. Running the operation — status,
// outcome, assignments, classification — is a manager task. Every write is
// re-authorised by the Worker (view gating, the manage/log split, the compartment
// write-block, log-only atomicity).
// =============================================================================

import {
  OPERATION_KIND, OPERATION_KIND_ORDER, OPERATION_STATUS, OPERATION_STATUS_ORDER,
  OPERATION_RESULT, OPERATION_RESULT_ORDER, OP_LOG_TYPE, OP_LOG_TYPE_ORDER,
  CLEARANCE_ORDER, CLEARANCES, clearanceWeight, ORGS,
} from '../constants.js';
import {
  operations, getOperation, upsertOperation, users, getUser, subjects, compartments, newId,
} from '../storage.js';
import {
  canViewOperation, canManageOperation, canLogToOperation, isAssignedToOperation, isCL5,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { exportAfterAction } from '../export.js';
import {
  esc, fmtDate, fmtDateTime, relTime, clearanceBadge, orgTag, monogram,
  toast, openModal, confirmDialog,
} from '../ui.js';

const ORG = 'omega-1';

const kindBadge = (k) => { const m = OPERATION_KIND[k] || { label: k, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const statusBadge = (s) => { const m = OPERATION_STATUS[s] || { label: s, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const resultBadge = (rr) => { const m = OPERATION_RESULT[rr]; return m ? `<span class="badge badge--${m.tone}">${esc(m.label)}</span>` : ''; };
const logTone = (t) => (OP_LOG_TYPE[t] || { tone: 'muted' }).tone;
const logLabel = (t) => (OP_LOG_TYPE[t] || { label: t }).label;

const actorWeight = (a) => clearanceWeight(a.clearance);
const omegaRoster = () => users().filter((u) => !u.deleted && u.org === ORG && u.status !== 'discharged');
const nameOf = (id) => { const u = getUser(id); return u ? `${u.designation} ${u.codename || ''}`.trim() : '\u2014'; };
const lastLogAt = (op) => { const l = op.log || []; return l.length ? Math.max(...l.map((e) => e.at)) : null; };
const caveat = (op) => (op.compartment ? `<span class="badge badge--warn" title="Need-to-Know">${esc(op.compartmentName || 'COMPARTMENTED')}</span>` : '');

// --- Shared mutation helper -------------------------------------------------
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getOperation(id);
  if (!fresh) { toast('Operation no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This operation was changed elsewhere. Reloading.', 'warn'); app.refresh(); return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertOperation(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}
function addEntry(op, by, type, text) {
  op.log = op.log || [];
  op.log.push({ id: newId('ol'), at: Date.now(), by, type, text });
}

// ===========================================================================
// LIST — Deployment Log
// ===========================================================================
export function renderList(host, app) {
  const actor = app.user;
  const ops = operations().filter((o) => !o.deleted && canViewOperation(actor, o));
  const canCreate = canManageOperation(actor, { org: ORG });

  const row = (o) => `
    <tr data-id="${esc(o.id)}" tabindex="0">
      <td class="mono">${esc(o.ref)}</td>
      <td class="cell-name">${esc(o.name)}</td>
      <td>${kindBadge(o.kind)}</td>
      <td>${clearanceBadge(o.clearance)} ${caveat(o)}</td>
      <td>${esc((getUser(o.lead) || {}).designation || '\u2014')}</td>
      <td class="cell-num">${(o.participants || []).length}</td>
      <td>${lastLogAt(o) ? relTime(new Date(lastLogAt(o)).toISOString()) : '<span class="muted-text">\u2014</span>'}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`;

  const section = (title, list, showResult) => list.length ? `
    <section class="card" style="margin-top:16px">
      <div class="card__title">${esc(title)} <span class="muted-text">(${list.length})</span></div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Operation</th><th>Kind</th><th>Classification</th><th>Lead</th><th>Team</th><th>Last log</th><th></th></tr></thead>
        <tbody>${list.map(row).join('')}</tbody>
      </table>
    </section>` : '';

  const active = ops.filter((o) => o.status === 'active').sort((a, b) => (lastLogAt(b) || 0) - (lastLogAt(a) || 0));
  const planned = ops.filter((o) => o.status === 'planned').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const closed = ops.filter((o) => o.status === 'concluded' || o.status === 'aborted').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Omega-1</div>
        <h1 class="page-title">Deployment Log</h1>
        <div class="page-sub">Operations the regiment is running</div>
      </div>
      ${canCreate ? '<button class="btn btn--primary" id="new-op">+ New operation</button>' : ''}
    </div>
    ${ops.length ? '' : '<div class="empty">No operations you are cleared to see.</div>'}
    ${section('Active', active)}
    ${section('Planned', planned)}
    ${section('Concluded & closed', closed)}
  `;

  const go = (id) => app.navigate(`#/operation/${id}`);
  host.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(el.dataset.id); });
  });
  const nb = host.querySelector('#new-op');
  if (nb) nb.addEventListener('click', () => openCreate(app));
}

// ===========================================================================
// DETAIL — Operation file
// ===========================================================================
export function renderOperation(host, app, id) {
  const actor = app.user;
  const op = getOperation(id);
  if (!op || op.deleted || !canViewOperation(actor, op)) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Operation not found</h1>
      <div class="page-sub">It does not exist, has been removed, or is outside your clearance.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Deployment Log</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/deployments'));
    return;
  }

  const canManage = canManageOperation(actor, op);
  const canLog = canLogToOperation(actor, op);
  const lead = getUser(op.lead);
  const team = (op.participants || []).map((pid) => getUser(pid)).filter(Boolean);
  const targets = (op.linkedSubjectIds || []).map((sid) => (subjects().find((s) => s.id === sid))).filter(Boolean);

  const log = (op.log || []).slice().sort((a, b) => b.at - a.at);
  const logItems = log.length ? log.map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(logTone(e.type))}"></span>
      <div class="tl__body">
        <div class="tl__text"><span class="badge badge--${esc(logTone(e.type))}" style="margin-right:6px">${esc(logLabel(e.type))}</span>${esc(e.text)}</div>
        <div class="tl__meta"><span class="mono">${esc(e.by || '')}</span> \u00b7 ${fmtDateTime(new Date(e.at).toISOString())}</div>
      </div>
    </li>`).join('') : '<div class="empty">No entries logged.</div>';

  // Adaptive action bar.
  let actions = '';
  actions += '<button class="btn btn--sm" data-act="export">\u2913 Export record</button>';
  if (canLog) actions += '<button class="btn btn--sm btn--primary" data-act="log">Add log entry</button>';
  if (canManage) {
    if (op.status === 'planned') actions += '<button class="btn btn--sm" data-act="activate">Activate</button>';
    if (op.status === 'active') actions += '<button class="btn btn--sm" data-act="conclude">Conclude</button><button class="btn btn--sm btn--danger" data-act="abort">Abort</button>';
    actions += '<button class="btn btn--sm" data-act="assign">Assign</button>';
    actions += '<button class="btn btn--sm" data-act="targets">Link targets</button>';
    actions += '<button class="btn btn--sm" data-act="edit">Edit</button>';
    actions += '<button class="btn btn--sm" data-act="classify">Classify</button>';
    actions += '<button class="btn btn--sm btn--danger" data-act="remove">Remove</button>';
  }

  host.innerHTML = `
    <div class="file-actions"><button class="btn btn--ghost btn--sm" id="back">\u2190 Deployment Log</button></div>

    <header class="dossier-head">
      <div class="avatar avatar--omega">${esc((OPERATION_KIND[op.kind] || {}).short || 'OP')}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(op.name)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(op.ref)}</span>
          ${kindBadge(op.kind)} ${statusBadge(op.status)} ${clearanceBadge(op.clearance)} ${caveat(op)}
        </div>
      </div>
    </header>

    ${actions ? `<div class="actionbar">${actions}</div>` : ''}
    ${op.compartment ? `<div class="ntk-banner">Need-to-Know \u2014 ${esc(op.compartmentName || 'compartmented operation')}. Handling restricted to read-in personnel.</div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Operation</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Kind</span><span class="kv__v">${kindBadge(op.kind)}</span></div>
          <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${statusBadge(op.status)}</span></div>
          <div class="kv"><span class="kv__k">Classification</span><span class="kv__v">${clearanceBadge(op.clearance)}</span></div>
          <div class="kv"><span class="kv__k">Location</span><span class="kv__v">${esc(op.location || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Lead</span><span class="kv__v">${lead ? `<span class="mono">${esc(lead.designation)}</span> ${esc(lead.codename || '')}` : '\u2014'}</span></div>
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(op.createdAt)} \u00b7 <span class="mono">${esc(op.createdBy || 'SYSTEM')}</span></span></div>
          ${op.startedAt ? `<div class="kv"><span class="kv__k">Activated</span><span class="kv__v">${fmtDateTime(op.startedAt)}</span></div>` : ''}
          ${op.concludedAt ? `<div class="kv"><span class="kv__k">Concluded</span><span class="kv__v">${fmtDateTime(op.concludedAt)}</span></div>` : ''}
          ${op.outcome ? `<div class="kv"><span class="kv__k">Outcome</span><span class="kv__v">${resultBadge(op.outcome.result)}</span></div>
          <div class="kv"><span class="kv__k">Debrief</span><span class="kv__v">${esc(op.outcome.text || '\u2014')}</span></div>` : ''}
        </div>
      </section>

      <div class="dossier-col">
        <section class="card">
          <div class="card__title">Objective</div>
          <div class="card__body"><p class="subj-summary">${esc(op.objective || 'No objective on record.')}</p></div>
        </section>
        <section class="card">
          <div class="card__title">Assigned personnel</div>
          <div class="card__body">
            ${team.length ? `<ul class="plain-list">${team.map((u) => `<li><span class="mono">${esc(u.designation)}</span> ${esc(u.codename || '')}</li>`).join('')}</ul>` : '<div class="empty">No operators assigned.</div>'}
          </div>
        </section>
        ${targets.length ? `<section class="card">
          <div class="card__title">Linked PoI / Targets</div>
          <div class="card__body"><ul class="plain-list">${targets.map((s) => `<li><a class="rec-link" href="#/subject/${esc(s.id)}"><span class="mono">${esc(s.ref)}</span> ${esc(s.alias || '')}</a></li>`).join('')}</ul></div>
        </section>` : ''}
        <section class="card">
          <div class="card__title">Operation Log</div>
          <div class="card__body">${log.length ? `<ul class="timeline">${logItems}</ul>` : logItems}</div>
        </section>
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/deployments'));
  const dispatch = {
    export: () => exportAfterAction(app, op),
    log: () => openLogEntry(app, op),
    activate: () => activate(app, op),
    conclude: () => openConclude(app, op),
    abort: () => openAbort(app, op),
    assign: () => openAssign(app, op),
    targets: () => openTargets(app, op),
    edit: () => openEdit(app, op),
    classify: () => openClassify(app, op),
    remove: () => removeOp(app, op),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act] && dispatch[b.dataset.act]()));
}

// ===========================================================================
// MODALS / ACTIONS
// ===========================================================================
function clearanceOptions(actor, current) {
  return CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= actorWeight(actor))
    .map((c) => `<option value="${esc(c)}" ${current === c ? 'selected' : ''}>${esc((CLEARANCES[c] || {}).label || c)}</option>`).join('');
}
function kindOptions(current) {
  return OPERATION_KIND_ORDER.map((k) => `<option value="${esc(k)}" ${current === k ? 'selected' : ''}>${esc(OPERATION_KIND[k].label)}</option>`).join('');
}

function openCreate(app) {
  const actor = app.user;
  if (!canManageOperation(actor, { org: ORG })) { toast('You cannot open operations.', 'error'); return; }
  openModal({
    title: 'New operation',
    wide: true,
    body: `
      <div class="field"><label>Operation name</label><input id="op-name" type="text" placeholder="e.g. IRONWOOD VIGIL" /></div>
      <div class="field"><label>Kind</label><select id="op-kind">${kindOptions('deployment')}</select></div>
      <div class="field"><label>Classification</label><select id="op-clr">${clearanceOptions(actor, 'CL3')}</select></div>
      <div class="field"><label>Objective</label><textarea id="op-obj" rows="3" placeholder="What this operation is to achieve\u2026"></textarea></div>
      <div class="field"><label>Location</label><input id="op-loc" type="text" placeholder="e.g. Sector 9" /></div>
      <div id="op-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Open operation', tone: 'primary', onClick: (c, d) => {
          const name = d.querySelector('#op-name').value.trim();
          const err = d.querySelector('#op-err'); err.hidden = true;
          if (!name) { err.textContent = 'An operation name is required.'; err.hidden = false; return; }
          const n = operations().length + 1;
          const ref = `OP-O1-${String(n).padStart(4, '0')}`;
          const now = new Date().toISOString();
          upsertOperation({
            id: newId('op'), ref, name, kind: d.querySelector('#op-kind').value, org: ORG,
            status: 'planned', clearance: d.querySelector('#op-clr').value, compartment: null,
            lead: null, participants: [], location: d.querySelector('#op-loc').value.trim(),
            objective: d.querySelector('#op-obj').value.trim(),
            log: [{ id: newId('ol'), at: Date.now(), by: actor.designation, type: 'note', text: `Operation opened by ${actor.designation}.` }],
            outcome: null, linkedSubjectIds: [], startedAt: null, concludedAt: null,
            createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'CREATE_OPERATION', `Opened operation ${ref} (${name}).`);
          c(); toast(`Operation ${ref} opened.`, 'success'); app.navigate('#/deployments');
        } },
    ],
  });
}

function openLogEntry(app, op) {
  if (!canLogToOperation(app.user, op)) { toast('You are not assigned to this operation.', 'error'); return; }
  const opts = OP_LOG_TYPE_ORDER.map((t) => `<option value="${t}">${esc(OP_LOG_TYPE[t].label)}</option>`).join('');
  openModal({
    title: 'Log entry',
    body: `
      <div class="field"><label>Type</label><select id="le-type">${opts}</select></div>
      <div class="field"><label>Entry</label><textarea id="le-text" rows="3" placeholder="e.g. Team in position; contact with subject at grid 114."></textarea></div>
      <div id="le-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Log entry', tone: 'primary', onClick: (c, d) => {
          const text = d.querySelector('#le-text').value.trim();
          const err = d.querySelector('#le-err'); err.hidden = true;
          if (!text) { err.textContent = 'Enter the log text.'; err.hidden = false; return; }
          mutate(app, op.id, op.version, (o) => addEntry(o, app.user.designation, d.querySelector('#le-type').value, text),
            { action: 'LOG_OPERATION', detail: `Entry logged to ${op.ref}.` });
          c(); toast('Entry logged.', 'success');
        } },
    ],
  });
}

function activate(app, op) {
  mutate(app, op.id, op.version, (o) => { o.status = 'active'; o.startedAt = new Date().toISOString(); addEntry(o, app.user.designation, 'status', 'Operation activated.'); },
    { action: 'ACTIVATE_OPERATION', detail: `${op.ref} activated.` });
  toast('Operation activated.', 'success');
}

function openConclude(app, op) {
  const opts = OPERATION_RESULT_ORDER.map((r) => `<option value="${r}">${esc(OPERATION_RESULT[r].label)}</option>`).join('');
  openModal({
    title: `Conclude ${op.ref}`,
    body: `
      <div class="field"><label>Result</label><select id="cc-res">${opts}</select></div>
      <div class="field"><label>Debrief</label><textarea id="cc-text" rows="3" placeholder="Summary of the outcome\u2026"></textarea></div>
      <div id="cc-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Conclude', tone: 'primary', onClick: (c, d) => {
          const text = d.querySelector('#cc-text').value.trim();
          const err = d.querySelector('#cc-err'); err.hidden = true;
          if (!text) { err.textContent = 'A debrief note is required to conclude.'; err.hidden = false; return; }
          const result = d.querySelector('#cc-res').value;
          const now = new Date().toISOString();
          mutate(app, op.id, op.version, (o) => {
            o.status = 'concluded'; o.concludedAt = now;
            o.outcome = { result, text, at: now, by: app.user.designation };
            addEntry(o, app.user.designation, 'status', `Operation concluded \u2014 ${OPERATION_RESULT[result].label}.`);
          }, { action: 'CONCLUDE_OPERATION', detail: `${op.ref} concluded (${result}).` });
          c(); toast('Operation concluded.', 'success');
        } },
    ],
  });
}

async function openAbort(app, op) {
  const ok = await confirmDialog({ title: 'Abort operation', message: `Abort ${op.name} (${op.ref})? This closes the operation without a full outcome.`, confirmLabel: 'Abort', danger: true });
  if (!ok) return;
  const now = new Date().toISOString();
  mutate(app, op.id, op.version, (o) => { o.status = 'aborted'; o.concludedAt = now; addEntry(o, app.user.designation, 'status', 'Operation aborted.'); },
    { action: 'ABORT_OPERATION', detail: `${op.ref} aborted.` });
  toast('Operation aborted.', 'warn');
}

function openAssign(app, op) {
  const roster = omegaRoster();
  const leadOpts = `<option value="">\u2014 No lead \u2014</option>` + roster.map((u) => `<option value="${esc(u.id)}" ${op.lead === u.id ? 'selected' : ''}>${esc(u.designation)} ${esc(u.codename || '')}</option>`).join('');
  const checks = roster.map((u) => `<label class="tag-opt"><input type="checkbox" class="pp" data-id="${esc(u.id)}" ${(op.participants || []).includes(u.id) ? 'checked' : ''} /> <span class="mono">${esc(u.designation)}</span> ${esc(u.codename || '')}</label>`).join('');
  openModal({
    title: `Assign \u2014 ${op.ref}`,
    wide: true,
    body: `
      <div class="field"><label>Operation lead</label><select id="as-lead">${leadOpts}</select></div>
      <div class="field"><label>Participants</label><div class="tag-list">${checks || '<div class="muted-text">No operators.</div>'}</div></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save assignments', tone: 'primary', onClick: (c, d) => {
          const lead = d.querySelector('#as-lead').value || null;
          const participants = [...d.querySelectorAll('.pp:checked')].map((cb) => cb.dataset.id);
          mutate(app, op.id, op.version, (o) => { o.lead = lead; o.participants = participants; },
            { action: 'EDIT_OPERATION', detail: `${op.ref} assignments updated.` });
          c(); toast('Assignments saved.', 'success');
        } },
    ],
  });
}

function openTargets(app, op) {
  const subs = subjects().filter((s) => !s.deleted);
  if (!subs.length) { toast('No surveillance subjects to link.', 'error'); return; }
  const checks = subs.map((s) => `<label class="tag-opt"><input type="checkbox" class="tg" data-id="${esc(s.id)}" ${(op.linkedSubjectIds || []).includes(s.id) ? 'checked' : ''} /> <span class="mono">${esc(s.ref)}</span> ${esc(s.alias || '')}</label>`).join('');
  openModal({
    title: `Link PoI / Targets \u2014 ${op.ref}`,
    wide: true,
    body: `<div class="field"><label>Surveillance subjects</label><div class="tag-list">${checks}</div></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save links', tone: 'primary', onClick: (c, d) => {
          const ids = [...d.querySelectorAll('.tg:checked')].map((cb) => cb.dataset.id);
          mutate(app, op.id, op.version, (o) => { o.linkedSubjectIds = ids; },
            { action: 'EDIT_OPERATION', detail: `${op.ref} target links updated.` });
          c(); toast('Targets linked.', 'success');
        } },
    ],
  });
}

function openEdit(app, op) {
  openModal({
    title: `Edit ${op.ref}`,
    wide: true,
    body: `
      <div class="field"><label>Operation name</label><input id="ed-name" type="text" value="${esc(op.name)}" /></div>
      <div class="field"><label>Kind</label><select id="ed-kind">${kindOptions(op.kind)}</select></div>
      <div class="field"><label>Objective</label><textarea id="ed-obj" rows="3">${esc(op.objective || '')}</textarea></div>
      <div class="field"><label>Location</label><input id="ed-loc" type="text" value="${esc(op.location || '')}" /></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save', tone: 'primary', onClick: (c, d) => {
          const name = d.querySelector('#ed-name').value.trim();
          if (!name) { toast('A name is required.', 'error'); return; }
          mutate(app, op.id, op.version, (o) => {
            o.name = name; o.kind = d.querySelector('#ed-kind').value;
            o.objective = d.querySelector('#ed-obj').value.trim(); o.location = d.querySelector('#ed-loc').value.trim();
          }, { action: 'EDIT_OPERATION', detail: `Updated operation ${op.ref}.` });
          c(); toast('Operation updated.', 'success');
        } },
    ],
  });
}

function openClassify(app, op) {
  const actor = app.user;
  const comps = compartments().filter((cc) => !cc.deleted && (isCL5(actor) || (cc.members || []).includes(actor.id)));
  const compOpts = `<option value="">\u2014 No compartment \u2014</option>` + comps.map((cc) => `<option value="${esc(cc.id)}" ${op.compartment === cc.id ? 'selected' : ''}>${esc(cc.name)}</option>`).join('');
  openModal({
    title: `Classify ${op.ref}`,
    body: `
      <div class="field"><label>Classification</label><select id="cl-clr">${clearanceOptions(actor, op.clearance)}</select></div>
      <div class="field"><label>Need-to-Know compartment</label><select id="cl-comp">${compOpts}</select></div>
      <div class="field__hint">You can only file into a compartment you are read into.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply', tone: 'primary', onClick: (c, d) => {
          mutate(app, op.id, op.version, (o) => { o.clearance = d.querySelector('#cl-clr').value; o.compartment = d.querySelector('#cl-comp').value || null; },
            { action: 'EDIT_OPERATION', detail: `${op.ref} classification updated.` });
          c(); toast('Classification updated.', 'success');
        } },
    ],
  });
}

async function removeOp(app, op) {
  const ok = await confirmDialog({ title: 'Remove operation', message: `Move ${op.name} (${op.ref}) to the recycle bin?`, confirmLabel: 'Remove', danger: true });
  if (!ok) return;
  mutate(app, op.id, op.version, (o) => { o.deleted = true; o.deletedAt = new Date().toISOString(); },
    { action: 'REMOVE_OPERATION', detail: `Removed operation ${op.ref}.` });
  toast('Operation moved to recycle bin.', 'success');
  app.navigate('#/deployments');
}
