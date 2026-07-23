// =============================================================================
// views/intel.js — Intelligence sources & informants register.
//
// Omega-1's register of human and technical sources. Each source is a file with
// a reliability grade, a handler, a Need-to-Know classification and a running
// log of intelligence reports (each graded for credibility). Managers open, task
// and close sources; the handler running a source (or a manager) may file a
// report — including into a compartmented source, since running it implies
// need-to-know. Everything routes through the permission checks and audit log,
// and the redaction engine decides who sees which source at all.
// =============================================================================

import {
  INTEL_SOURCE_TYPE, INTEL_SOURCE_TYPE_ORDER, INTEL_STATUS, INTEL_STATUS_ORDER,
  INTEL_RELIABILITY, INTEL_RELIABILITY_ORDER, INTEL_CREDIBILITY, INTEL_CREDIBILITY_ORDER,
  CLEARANCE_ORDER, CLEARANCES, clearanceWeight,
  ORGS,
} from '../constants.js';
import {
  intel, getIntel, upsertIntel, users, getUser, subjects, compartments, newId,
} from '../storage.js';
import {
  canViewIntel, canManageIntel, canLogIntel, isAssignedToIntel, isCL5,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { moderationBar, wireModerationBar } from '../moderation.js';
import { exportSourceFile } from '../export.js';
import {
  esc, linkify, fmtDate, fmtDateTime, relTime, clearanceBadge, toast, openModal, confirmDialog,
} from '../ui.js';

const ORG = 'omega-1';

const typeBadge = (t) => { const m = INTEL_SOURCE_TYPE[t] || { label: t, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const statusBadge = (s) => { const m = INTEL_STATUS[s] || { label: s, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const reliabilityBadge = (r) => { const m = INTEL_RELIABILITY[r]; return m ? `<span class="badge badge--${m.tone}" title="Source reliability">${esc(m.label)}</span>` : ''; };
const credBadge = (c) => { const m = INTEL_CREDIBILITY[c]; return m ? `<span class="badge badge--${m.tone}" title="Information credibility">${esc(m.label)}</span>` : ''; };
const credTone = (c) => (INTEL_CREDIBILITY[c] || { tone: 'muted' }).tone;

const actorWeight = (a) => clearanceWeight(a.clearance);
const omegaRoster = () => users().filter((u) => !u.deleted && u.org === ORG && u.status !== 'discharged');
const lastReportAt = (s) => { const l = s.reports || []; return l.length ? Math.max(...l.map((e) => e.at)) : null; };
const caveat = (s) => (s.compartment ? `<span class="badge badge--warn" title="Need-to-Know">${esc(s.compartmentName || 'COMPARTMENTED')}</span>` : '');

// --- Shared mutation helper -------------------------------------------------
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getIntel(id);
  if (!fresh) { toast('Source no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This source was changed elsewhere. Reloading.', 'warn'); app.refresh(); return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertIntel(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}
function addReport(src, by, credibility, text) {
  src.reports = src.reports || [];
  src.reports.push({ id: newId('ir'), at: Date.now(), by, credibility, text });
}

// ===========================================================================
// LIST — Intelligence register
// ===========================================================================
export function renderList(host, app) {
  const actor = app.user;
  const sources = intel().filter((s) => !s.deleted && canViewIntel(actor, s));
  const canCreate = canManageIntel(actor, { org: ORG });

  const row = (s) => `
    <tr data-id="${esc(s.id)}" tabindex="0">
      <td class="mono">${esc(s.ref)}</td>
      <td class="cell-name">${esc(s.codename)}</td>
      <td>${typeBadge(s.type)}</td>
      <td>${clearanceBadge(s.clearance)} ${caveat(s)}</td>
      <td>${reliabilityBadge(s.reliability)}</td>
      <td>${esc((getUser(s.handler) || {}).designation || '\u2014')}</td>
      <td>${lastReportAt(s) ? relTime(new Date(lastReportAt(s)).toISOString()) : '<span class="muted-text">\u2014</span>'}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`;

  const section = (title, list) => list.length ? `
    <section class="card" style="margin-top:16px">
      <div class="card__title">${esc(title)} <span class="muted-text">(${list.length})</span></div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Codename</th><th>Type</th><th>Classification</th><th>Reliability</th><th>Handler</th><th>Last report</th><th></th></tr></thead>
        <tbody>${list.map(row).join('')}</tbody>
      </table>
    </section>` : '';

  const live = sources.filter((s) => s.status === 'active' || s.status === 'probation').sort((a, b) => (lastReportAt(b) || 0) - (lastReportAt(a) || 0));
  const dormant = sources.filter((s) => s.status === 'dormant').sort((a, b) => (lastReportAt(b) || 0) - (lastReportAt(a) || 0));
  const closed = sources.filter((s) => s.status === 'burned' || s.status === 'closed').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 ${esc(ORGS['omega-1'].short)}</div>
        <h1 class="page-title">Intelligence</h1>
        <div class="page-sub">Sources &amp; informants the regiment is running</div>
      </div>
      ${canCreate ? '<button class="btn btn--primary" id="new-src">+ New source</button>' : ''}
    </div>
    ${sources.length ? '' : '<div class="empty">No sources you are cleared to see.</div>'}
    ${section('Active', live)}
    ${section('Dormant', dormant)}
    ${section('Burned &amp; closed', closed)}
  `;

  const go = (id) => app.navigate(`#/source/${id}`);
  host.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(el.dataset.id); });
  });
  const nb = host.querySelector('#new-src');
  if (nb) nb.addEventListener('click', () => openCreate(app));
}

// ===========================================================================
// DETAIL — Source file
// ===========================================================================
export function renderSource(host, app, id) {
  const actor = app.user;
  const src = getIntel(id);
  if (!src || src.deleted || !canViewIntel(actor, src)) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Source not found</h1>
      <div class="page-sub">It does not exist, has been removed, or is outside your clearance.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Intelligence</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/intel'));
    return;
  }

  const canManage = canManageIntel(actor, src);
  const canLog = canLogIntel(actor, src);
  const handler = getUser(src.handler);
  const targets = (src.linkedSubjectIds || []).map((sid) => (subjects().find((s) => s.id === sid))).filter(Boolean);

  const reps = (src.reports || []).slice().sort((a, b) => b.at - a.at);
  const reportItems = reps.length ? reps.map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(credTone(e.credibility))}"></span>
      <div class="tl__body">
        <div class="tl__text">${credBadge(e.credibility)} <span style="margin-left:6px">${linkify(e.text)}</span></div>
        <div class="tl__meta"><span class="mono">${esc(e.by || '')}</span> \u00b7 ${fmtDateTime(new Date(e.at).toISOString())}</div>
      </div>
    </li>`).join('') : '<div class="empty">No reports filed.</div>';

  // Adaptive action bar.
  let actions = '';
  actions += '<button class="btn btn--sm" data-act="export">\u2913 Export source file</button>';
  if (canLog) actions += '<button class="btn btn--sm btn--primary" data-act="report">File report</button>';
  if (canManage) {
    actions += '<button class="btn btn--sm" data-act="status">Set status</button>';
    actions += '<button class="btn btn--sm" data-act="handler">Assign handler</button>';
    actions += '<button class="btn btn--sm" data-act="targets">Link subjects</button>';
    actions += '<button class="btn btn--sm" data-act="edit">Edit</button>';
    actions += '<button class="btn btn--sm" data-act="classify">Classify</button>';
    actions += '<button class="btn btn--sm btn--danger" data-act="remove">Remove</button>';
  }

  host.innerHTML = `
    <div class="file-actions"><button class="btn btn--ghost btn--sm" id="back">\u2190 Intelligence</button></div>

    <header class="dossier-head">
      <div class="avatar avatar--omega">${esc((INTEL_SOURCE_TYPE[src.type] || {}).short || 'SRC')}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(src.codename)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(src.ref)}</span>
          ${typeBadge(src.type)} ${statusBadge(src.status)} ${clearanceBadge(src.clearance)} ${caveat(src)}
        </div>
      </div>
    </header>

    ${actions ? `<div class="actionbar">${actions}</div>` : ''}
    ${moderationBar(actor, { already: canManage })}
    ${src.compartment ? `<div class="ntk-banner">Need-to-Know \u2014 ${esc(src.compartmentName || 'compartmented source')}. Handling restricted to read-in personnel.</div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Source</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Type</span><span class="kv__v">${typeBadge(src.type)}</span></div>
          <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${statusBadge(src.status)}</span></div>
          <div class="kv"><span class="kv__k">Reliability</span><span class="kv__v">${reliabilityBadge(src.reliability) || '\u2014'}</span></div>
          <div class="kv"><span class="kv__k">Classification</span><span class="kv__v">${clearanceBadge(src.clearance)}</span></div>
          <div class="kv"><span class="kv__k">Handler</span><span class="kv__v">${handler ? `<span class="mono">${esc(handler.designation)}</span> ${esc(handler.codename || '')}` : '\u2014'}</span></div>
          <div class="kv"><span class="kv__k">Cover</span><span class="kv__v">${esc(src.cover || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(src.createdAt)} \u00b7 <span class="mono">${esc(src.createdBy || 'SYSTEM')}</span></span></div>
          ${src.closedAt ? `<div class="kv"><span class="kv__k">Closed</span><span class="kv__v">${fmtDateTime(src.closedAt)}</span></div>` : ''}
        </div>
      </section>

      <div class="dossier-col">
        <section class="card">
          <div class="card__title">Tasking</div>
          <div class="card__body"><p class="subj-summary">${esc(src.tasking || 'No tasking on record.')}</p></div>
        </section>
        ${targets.length ? `<section class="card">
          <div class="card__title">Reporting on</div>
          <div class="card__body"><ul class="plain-list">${targets.map((s) => `<li><a class="rec-link" href="#/subject/${esc(s.id)}"><span class="mono">${esc(s.ref)}</span> ${esc(s.alias || '')}</a></li>`).join('')}</ul></div>
        </section>` : ''}
        <section class="card">
          <div class="card__title">Intelligence Reports</div>
          <div class="card__body">${reps.length ? `<ul class="timeline">${reportItems}</ul>` : reportItems}</div>
        </section>
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/intel'));
  wireModerationBar(host, app, { label: `source ${src.ref}`, get: () => getIntel(src.id), upsert: upsertIntel, backHash: '#/intel' });
  const dispatch = {
    export: () => exportSourceFile(app, src),
    report: () => openReport(app, src),
    status: () => openStatus(app, src),
    handler: () => openHandler(app, src),
    targets: () => openTargets(app, src),
    edit: () => openEdit(app, src),
    classify: () => openClassify(app, src),
    remove: () => removeSource(app, src),
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
function typeOptions(current) {
  return INTEL_SOURCE_TYPE_ORDER.map((k) => `<option value="${esc(k)}" ${current === k ? 'selected' : ''}>${esc(INTEL_SOURCE_TYPE[k].label)}</option>`).join('');
}
function reliabilityOptions(current) {
  return INTEL_RELIABILITY_ORDER.map((r) => `<option value="${esc(r)}" ${current === r ? 'selected' : ''}>${esc(INTEL_RELIABILITY[r].label)}</option>`).join('');
}
function statusOptions(current) {
  return INTEL_STATUS_ORDER.map((s) => `<option value="${esc(s)}" ${current === s ? 'selected' : ''}>${esc(INTEL_STATUS[s].label)}</option>`).join('');
}

function openCreate(app) {
  const actor = app.user;
  if (!canManageIntel(actor, { org: ORG })) { toast('You cannot open sources.', 'error'); return; }
  openModal({
    title: 'New source',
    wide: true,
    body: `
      <div class="field"><label>Source codename</label><input id="sr-name" type="text" placeholder="e.g. GOLDFINCH" /></div>
      <div class="field"><label>Type</label><select id="sr-type">${typeOptions('informant')}</select></div>
      <div class="field"><label>Initial reliability</label><select id="sr-rel">${reliabilityOptions('F')}</select></div>
      <div class="field"><label>Classification</label><select id="sr-clr">${clearanceOptions(actor, 'CL4-J')}</select></div>
      <div class="field"><label>Cover / legend</label><input id="sr-cover" type="text" placeholder="How the source is carried \u2014 kept brief" /></div>
      <div class="field"><label>Tasking</label><textarea id="sr-task" rows="3" placeholder="What this source is being run to obtain\u2026"></textarea></div>
      <div id="sr-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Open source', tone: 'primary', onClick: (c, d) => {
          const codename = d.querySelector('#sr-name').value.trim();
          const err = d.querySelector('#sr-err'); err.hidden = true;
          if (!codename) { err.textContent = 'A source codename is required.'; err.hidden = false; return; }
          const n = intel().length + 1;
          const ref = `SRC-O1-${String(n).padStart(4, '0')}`;
          const now = new Date().toISOString();
          upsertIntel({
            id: newId('src'), ref, codename, type: d.querySelector('#sr-type').value, org: ORG,
            status: 'probation', reliability: d.querySelector('#sr-rel').value,
            clearance: d.querySelector('#sr-clr').value, compartment: null,
            handler: null, cover: d.querySelector('#sr-cover').value.trim(),
            tasking: d.querySelector('#sr-task').value.trim(),
            reports: [{ id: newId('ir'), at: Date.now(), by: actor.designation, credibility: 6, text: `Source opened by ${actor.designation}.` }],
            linkedSubjectIds: [], openedAt: now, closedAt: null,
            createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'CREATE_INTEL', `Opened source ${ref} (${codename}).`);
          c(); toast(`Source ${ref} opened.`, 'success'); app.navigate('#/intel');
        } },
    ],
  });
}

function openReport(app, src) {
  if (!canLogIntel(app.user, src)) { toast('You are not the handler of this source.', 'error'); return; }
  const opts = INTEL_CREDIBILITY_ORDER.map((c) => `<option value="${c}" ${c === 3 ? 'selected' : ''}>${esc(INTEL_CREDIBILITY[c].label)}</option>`).join('');
  openModal({
    title: 'File report',
    body: `
      <div class="field"><label>Information credibility</label><select id="rp-cred">${opts}</select></div>
      <div class="field"><label>Report</label><textarea id="rp-text" rows="3" placeholder="What the source reported\u2026"></textarea></div>
      <div id="rp-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'File report', tone: 'primary', onClick: (c, d) => {
          const text = d.querySelector('#rp-text').value.trim();
          const err = d.querySelector('#rp-err'); err.hidden = true;
          if (!text) { err.textContent = 'Enter the report text.'; err.hidden = false; return; }
          const cred = Number(d.querySelector('#rp-cred').value);
          mutate(app, src.id, src.version, (s) => addReport(s, app.user.designation, cred, text),
            { action: 'LOG_INTEL', detail: `Report filed to ${src.ref}.` });
          c(); toast('Report filed.', 'success');
        } },
    ],
  });
}

function openStatus(app, src) {
  openModal({
    title: `Set status \u2014 ${src.ref}`,
    body: `
      <div class="field"><label>Status</label><select id="st-val">${statusOptions(src.status)}</select></div>
      <div class="field__hint">Marking a source burned or closed stands the source down; it can be reactivated later.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply', tone: 'primary', onClick: (c, d) => {
          const next = d.querySelector('#st-val').value;
          if (next === src.status) { c(); return; }
          const now = new Date().toISOString();
          mutate(app, src.id, src.version, (s) => {
            s.status = next;
            s.closedAt = (next === 'burned' || next === 'closed') ? now : null;
            addReport(s, app.user.designation, 6, `Status set to ${INTEL_STATUS[next].label}.`);
          }, { action: 'EDIT_INTEL', detail: `${src.ref} status set to ${next}.` });
          c(); toast('Status updated.', 'success');
        } },
    ],
  });
}

function openHandler(app, src) {
  const roster = omegaRoster();
  const opts = `<option value="">\u2014 No handler \u2014</option>` + roster.map((u) => `<option value="${esc(u.id)}" ${src.handler === u.id ? 'selected' : ''}>${esc(u.designation)} ${esc(u.codename || '')}</option>`).join('');
  openModal({
    title: `Assign handler \u2014 ${src.ref}`,
    body: `
      <div class="field"><label>Handler</label><select id="hd-user">${opts}</select></div>
      <div class="field__hint">The handler can file reports on this source, including when it is compartmented.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save', tone: 'primary', onClick: (c, d) => {
          const handler = d.querySelector('#hd-user').value || null;
          mutate(app, src.id, src.version, (s) => { s.handler = handler; },
            { action: 'EDIT_INTEL', detail: `${src.ref} handler updated.` });
          c(); toast('Handler assigned.', 'success');
        } },
    ],
  });
}

function openTargets(app, src) {
  const subs = subjects().filter((s) => !s.deleted);
  if (!subs.length) { toast('No surveillance subjects to link.', 'error'); return; }
  const checks = subs.map((s) => `<label class="tag-opt"><input type="checkbox" class="tg" data-id="${esc(s.id)}" ${(src.linkedSubjectIds || []).includes(s.id) ? 'checked' : ''} /> <span class="mono">${esc(s.ref)}</span> ${esc(s.alias || '')}</label>`).join('');
  openModal({
    title: `Link subjects \u2014 ${src.ref}`,
    wide: true,
    body: `<div class="field"><label>Subjects this source reports on</label><div class="tag-list">${checks}</div></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save links', tone: 'primary', onClick: (c, d) => {
          const ids = [...d.querySelectorAll('.tg:checked')].map((cb) => cb.dataset.id);
          mutate(app, src.id, src.version, (s) => { s.linkedSubjectIds = ids; },
            { action: 'EDIT_INTEL', detail: `${src.ref} subject links updated.` });
          c(); toast('Subjects linked.', 'success');
        } },
    ],
  });
}

function openEdit(app, src) {
  openModal({
    title: `Edit ${src.ref}`,
    wide: true,
    body: `
      <div class="field"><label>Source codename</label><input id="ed-name" type="text" value="${esc(src.codename)}" /></div>
      <div class="field"><label>Type</label><select id="ed-type">${typeOptions(src.type)}</select></div>
      <div class="field"><label>Reliability</label><select id="ed-rel">${reliabilityOptions(src.reliability)}</select></div>
      <div class="field"><label>Cover / legend</label><input id="ed-cover" type="text" value="${esc(src.cover || '')}" /></div>
      <div class="field"><label>Tasking</label><textarea id="ed-task" rows="3">${esc(src.tasking || '')}</textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save', tone: 'primary', onClick: (c, d) => {
          const codename = d.querySelector('#ed-name').value.trim();
          if (!codename) { toast('A codename is required.', 'error'); return; }
          mutate(app, src.id, src.version, (s) => {
            s.codename = codename; s.type = d.querySelector('#ed-type').value;
            s.reliability = d.querySelector('#ed-rel').value;
            s.cover = d.querySelector('#ed-cover').value.trim(); s.tasking = d.querySelector('#ed-task').value.trim();
          }, { action: 'EDIT_INTEL', detail: `Updated source ${src.ref}.` });
          c(); toast('Source updated.', 'success');
        } },
    ],
  });
}

function openClassify(app, src) {
  const actor = app.user;
  const comps = compartments().filter((cc) => !cc.deleted && (isCL5(actor) || (cc.members || []).includes(actor.id)));
  const compOpts = `<option value="">\u2014 No compartment \u2014</option>` + comps.map((cc) => `<option value="${esc(cc.id)}" ${src.compartment === cc.id ? 'selected' : ''}>${esc(cc.name)}</option>`).join('');
  openModal({
    title: `Classify ${src.ref}`,
    body: `
      <div class="field"><label>Classification</label><select id="cl-clr">${clearanceOptions(actor, src.clearance)}</select></div>
      <div class="field"><label>Need-to-Know compartment</label><select id="cl-comp">${compOpts}</select></div>
      <div class="field__hint">You can only file into a compartment you are read into.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply', tone: 'primary', onClick: (c, d) => {
          mutate(app, src.id, src.version, (s) => { s.clearance = d.querySelector('#cl-clr').value; s.compartment = d.querySelector('#cl-comp').value || null; },
            { action: 'EDIT_INTEL', detail: `${src.ref} classification updated.` });
          c(); toast('Classification updated.', 'success');
        } },
    ],
  });
}

async function removeSource(app, src) {
  const ok = await confirmDialog({ title: 'Remove source', message: `Move ${src.codename} (${src.ref}) to the recycle bin?`, confirmLabel: 'Remove', danger: true });
  if (!ok) return;
  mutate(app, src.id, src.version, (s) => { s.deleted = true; s.deletedAt = new Date().toISOString(); },
    { action: 'REMOVE_INTEL', detail: `Removed source ${src.ref}.` });
  toast('Source moved to recycle bin.', 'success');
  app.navigate('#/intel');
}
