// =============================================================================
// views/personnel.js — Roster list + personnel dossier.
//
// The heart of the system. The list is an open, filterable roster; the dossier
// is the full record, with the redaction engine deciding how much each operator
// may see. All record-management actions (edit, clearance, strike, note, leave,
// delete) live here and route through the permission checks and audit log.
// =============================================================================

import {
  ORGS, RANKS, STATUS_ORDER, CLEARANCE_ORDER, CLEARANCES, STRIKE_LIMIT,
  rankUp, rankDown, clearanceForRank,
  TRAINING_CATEGORY, TRAINING_CURRENCY, trainingCurrency, trainingExpiry,
} from '../constants.js';
import { users, getUser, upsertUser, promoReqs, newId, applyServerSnapshot, trainings, getTraining } from '../storage.js';
import {
  canEditPersonnel, canSetClearance, canSetRank, canIssueStrike,
  canDeletePersonnel, canPromote, canDemote, accessLevel, isCL5, canManageOrg, canManageTraining,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { exportPersonnel } from '../export.js';
import {
  esc, fmtDate, fmtDateTime, clearanceBadge, statusBadge, accountBadge,
  orgTag, monogram, redacted, toast, openModal, confirmDialog,
} from '../ui.js';

// Roster filter state, preserved across navigation.
const filter = { q: '', status: '', clearance: '' };

// --- Shared mutation helper -------------------------------------------------
// Applies a change with optimistic conflict detection (version stamps). If the
// record changed since the form was opened, the edit is refused and reloaded.
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getUser(id);
  if (!fresh) { toast('Record no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This record was changed elsewhere. Reloading the latest version.', 'warn');
    app.refresh();
    return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertUser(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}

function addEvent(user, type, text) {
  user.events = user.events || [];
  user.events.unshift({ id: newId('evt'), date: new Date().toISOString(), type, text });
}

// ===========================================================================
// ROSTER LIST
// ===========================================================================
export function renderList(host, app, org) {
  const meta = ORGS[org];
  const actor = app.user;
  const canManage = canEditPersonnel(actor, { org });

  const roster = users()
    .filter((u) => u.org === org && !u.deleted && u.accountStatus !== 'pending')
    .filter((u) => {
      if (filter.status && u.status !== filter.status) return false;
      if (filter.clearance && u.clearance !== filter.clearance) return false;
      if (filter.q) {
        const hay = `${u.designation} ${u.codename} ${u.rank || ''}`.toLowerCase();
        if (!hay.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => (b.clearance ? CLEARANCES[b.clearance].weight : 0) - (a.clearance ? CLEARANCES[a.clearance].weight : 0)
      || a.designation.localeCompare(b.designation));

  const statusOpts = ['', ...STATUS_ORDER]
    .map((s) => `<option value="${s}" ${filter.status === s ? 'selected' : ''}>${s ? esc(s) : 'All statuses'}</option>`).join('');
  const clrOpts = ['', ...CLEARANCE_ORDER]
    .map((c) => `<option value="${c}" ${filter.clearance === c ? 'selected' : ''}>${c ? esc(CLEARANCES[c].label) : 'All clearances'}</option>`).join('');

  const rows = roster.length ? roster.map((u) => `
    <tr data-id="${esc(u.id)}" tabindex="0">
      <td class="mono">${esc(u.designation)}</td>
      <td class="cell-name">${esc(u.codename)}</td>
      <td>${esc(u.rank || '\u2014')}</td>
      <td>${clearanceBadge(u.clearance)}</td>
      <td>${statusBadge(u.status)}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>
  `).join('') : `
    <tr><td colspan="6" class="empty">No personnel match the current filters.</td></tr>
  `;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(meta.name)}</div>
        <h1 class="page-title">Personnel Files</h1>
        <div class="page-sub">${esc(meta.motto)} \u00b7 ${roster.length} on roster</div>
      </div>
      ${canManage ? `<button class="btn btn--primary" id="add-personnel">+ New personnel</button>` : ''}
    </div>

    <div class="toolbar">
      <input id="flt-q" class="toolbar__search" type="search" placeholder="Search designation or codename\u2026" value="${esc(filter.q)}" />
      <select id="flt-status" class="toolbar__select">${statusOpts}</select>
      <select id="flt-clr" class="toolbar__select">${clrOpts}</select>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Designation</th><th>Codename</th><th>Rank</th>
            <th>Clearance</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const go = (id) => app.navigate(`#/personnel/${id}`);
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => go(tr.dataset.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(tr.dataset.id); });
  });

  const q = host.querySelector('#flt-q');
  q.addEventListener('input', () => { filter.q = q.value; renderList(host, app, org); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
  host.querySelector('#flt-status').addEventListener('change', (e) => { filter.status = e.target.value; renderList(host, app, org); });
  host.querySelector('#flt-clr').addEventListener('change', (e) => { filter.clearance = e.target.value; renderList(host, app, org); });

  const addBtn = host.querySelector('#add-personnel');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app, org));
}

// ===========================================================================
// DOSSIER DETAIL
// ===========================================================================
export function renderDossier(host, app, id) {
  const actor = app.user;
  const u = getUser(id);

  if (!u || u.deleted) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Record not found</h1>
      <div class="page-sub">This personnel file does not exist or has been removed.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Back</button>`;
    host.querySelector('#back').addEventListener('click', () => history.back());
    return;
  }

  const level = accessLevel(actor, u);
  const full = level === 'full';
  const partial = level === 'partial';
  const nameOnly = level === 'name-only';

  // Action availability.
  const acts = {
    edit: canEditPersonnel(actor, u),
    clearance: canSetClearance(actor, u, 'CL3') || isCL5(actor),
    strike: canIssueStrike(actor, u),
    note: canEditPersonnel(actor, u),
    leave: canEditPersonnel(actor, u),
    del: canDeletePersonnel(actor, u),
    // Reset an operator's sign-in passphrase: a manager with a stake, and never
    // an operator above your own clearance. Not offered for pending accounts
    // (those are handled by the approval flow).
    passphrase: canManageOrg(actor, u.org)
      && (CLEARANCES[actor.clearance]?.weight || 0) >= (CLEARANCES[u.clearance]?.weight || 0)
      && u.accountStatus !== 'pending' && !!u.username,
  };
  const anyAction = Object.values(acts).some(Boolean);

  const onLeave = !!u.leave;
  const flagged = (u.strikes || []).length >= STRIKE_LIMIT;

  // --- Sections built per access level ---
  const identityRows = `
    <div class="kv"><span class="kv__k">Designation</span><span class="kv__v mono">${esc(u.designation)}</span></div>
    <div class="kv"><span class="kv__k">Codename</span><span class="kv__v">${esc(u.codename)}</span></div>
    <div class="kv"><span class="kv__k">Organisation</span><span class="kv__v">${orgTag(u.org)} ${esc(ORGS[u.org].name)}</span></div>
    <div class="kv"><span class="kv__k">Rank</span><span class="kv__v">${esc(u.rank || '\u2014')}</span></div>
    <div class="kv"><span class="kv__k">Legal name</span><span class="kv__v">${full ? esc(u.realName) : redacted(14)}</span></div>
    <div class="kv"><span class="kv__k">Operator ID</span><span class="kv__v mono">${full ? esc(u.username) : redacted(8)}</span></div>
    <div class="kv"><span class="kv__k">Account</span><span class="kv__v">${accountBadge(u.accountStatus)}</span></div>
    <div class="kv"><span class="kv__k">Record updated</span><span class="kv__v">${fmtDateTime(u.updatedAt)}</span></div>
  `;

  const serviceRecord = nameOnly ? '' : sectionService(u);
  const awardsBlock = nameOnly ? '' : sectionAwards(u);
  const strikesBlock = sectionStrikes(u, full, full && acts.strike);
  const leaveBlock = onLeave ? sectionLeave(u, full) : '';
  const notesBlock = sectionNotes(u, full);
  const promoBlock = nameOnly ? '' : sectionPromotion(u, actor);
  const trainingBlock = nameOnly ? '' : sectionTraining(u, actor);

  const redactBanner = nameOnly ? `
    <div class="redact-banner">
      <strong>Access restricted.</strong> Your clearance permits identity confirmation only.
      The full service record for this operator is withheld.
    </div>` : (partial ? `
    <div class="redact-banner redact-banner--soft">
      Partial access. Disciplinary record, leave details and command notes are
      restricted at your clearance.
    </div>` : '');

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 ${esc(ORGS[u.org].short)} roster</button>
      <button class="btn btn--sm" id="export-personnel">\u2913 Export record</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--${ORGS[u.org].tone}">${esc(monogram(u.codename))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(u.codename)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(u.designation)}</span>
          ${orgTag(u.org)}
          ${clearanceBadge(u.clearance)}
          ${statusBadge(u.status)}
          ${flagged ? '<span class="badge badge--bad">Flagged \u00b7 review</span>' : ''}
          ${onLeave ? '<span class="badge badge--warn">On leave</span>' : ''}
        </div>
      </div>
    </header>

    ${redactBanner}

    ${anyAction ? `<div class="actionbar">
      ${acts.edit ? '<button class="btn btn--sm" data-act="edit">Edit record</button>' : ''}
      ${(isCL5(actor) && actor.id !== u.id) ? '<button class="btn btn--sm" data-act="clearance">Set clearance</button>' : ''}
      ${acts.passphrase ? '<button class="btn btn--sm" data-act="passphrase">Set passphrase</button>' : ''}
      ${acts.strike ? '<button class="btn btn--sm" data-act="strike">Add strike</button>' : ''}
      ${acts.leave ? `<button class="btn btn--sm" data-act="leave">${onLeave ? 'Return from leave' : 'Place on leave'}</button>` : ''}
      ${acts.note ? '<button class="btn btn--sm" data-act="note">Add note</button>' : ''}
      ${acts.del ? '<button class="btn btn--sm btn--danger" data-act="delete">Remove</button>' : ''}
    </div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Identity</div>
        <div class="card__body">${identityRows}</div>
      </section>
      <div class="dossier-col">
        ${promoBlock}
        ${leaveBlock}
        ${strikesBlock}
        ${awardsBlock}
        ${trainingBlock}
        ${serviceRecord}
        ${notesBlock}
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate(`#/${u.org === 'ethics-committee' ? 'ethics' : u.org}`));
  host.querySelector('#export-personnel').addEventListener('click', () => exportPersonnel(app, u));

  const dispatch = {
    edit: () => openEdit(app, u),
    clearance: () => openClearance(app, u),
    passphrase: () => openPassphrase(app, u),
    strike: () => openStrike(app, u),
    note: () => openNote(app, u),
    leave: () => onLeave ? returnFromLeave(app, u) : openLeave(app, u),
    delete: () => removeRecord(app, u),
    promote: () => promote(app, u),
    demote: () => demote(app, u),
    'grant-training': () => openGrantTraining(app, u),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act]()));
  host.querySelectorAll('[data-revoke-training]').forEach((b) => b.addEventListener('click', () => revokeTraining(app, u, b.dataset.revokeTraining)));
  host.querySelectorAll('[data-lift-strike]').forEach((b) => b.addEventListener('click', () => liftStrike(app, u, b.dataset.liftStrike)));
  host.querySelectorAll('[data-req]').forEach((b) => b.addEventListener('change', () => toggleRequirement(app, u, b.dataset.req)));
}

// --- Dossier sub-sections ---------------------------------------------------
// Promotion requirements for the operator's next rank, with progress and the
// promote/demote controls. The checklist resets whenever the rank changes,
// because the next-rank transition (and therefore its requirements) changes.
function sectionPromotion(u, actor) {
  if (!u.rank) {
    return `<section class="card"><div class="card__title">Promotion</div>
      <div class="card__body"><p class="muted">No rank is assigned to this operator.</p></div></section>`;
  }

  const next = rankUp(u.org, u.rank);
  const set = next ? promoReqs().find((r) => r.org === u.org && r.fromRank === u.rank) : null;
  const items = set?.items || [];
  const checked = new Set(u.promoChecks || []);
  const met = items.filter((it) => checked.has(it.id)).length;
  const canEdit = canPromote(actor, u);
  const canDown = canDemote(actor, u);
  const allMet = items.length > 0 && met === items.length;

  let listHTML;
  if (!next) {
    listHTML = '<p class="muted">This operator holds the most senior rank in the ladder.</p>';
  } else if (!items.length) {
    listHTML = '<p class="muted">No requirements are defined for this transition.</p>';
  } else {
    listHTML = `<ul class="reqs">${items.map((it) => {
      const done = checked.has(it.id);
      const control = canEdit
        ? `<input type="checkbox" class="req__box" data-req="${esc(it.id)}" ${done ? 'checked' : ''} aria-label="Mark requirement met" />`
        : `<span class="req__mark ${done ? 'req__mark--done' : ''}">${done ? '\u2713' : '\u25cb'}</span>`;
      return `<li class="req ${done ? 'req--done' : ''}">${control}<span class="req__text">${esc(it.text)}</span></li>`;
    }).join('')}</ul>`;
  }

  const head = next
    ? `<span class="promo-next"><span class="mono">${esc(u.rank)}</span> <span class="promo-arrow">\u2192</span> <span class="mono">${esc(next)}</span></span>
       ${items.length ? `<span class="promo-progress ${allMet ? 'promo-progress--met' : ''}">${met}/${items.length} met</span>` : ''}`
    : `<span class="promo-next"><span class="mono">${esc(u.rank)}</span> \u00b7 most senior rank</span>`;

  const actions = [
    (next && canEdit) ? '<button class="btn btn--sm" data-act="promote">Promote</button>' : '',
    canDown ? '<button class="btn btn--sm btn--ghost" data-act="demote">Demote</button>' : '',
  ].filter(Boolean).join('');

  return `
    <section class="card promo">
      <div class="card__title">Promotion Requirements</div>
      <div class="card__body">
        <div class="promo-head">${head}</div>
        ${listHTML}
        ${actions ? `<div class="promo-actions">${actions}</div>` : ''}
      </div>
    </section>`;
}

async function promote(app, u) {
  const next = rankUp(u.org, u.rank);
  if (!next) { toast('Already at the most senior rank.', 'warn'); return; }
  if (!canPromote(app.user, u)) { toast('You are not permitted to promote this operator.', 'error'); return; }

  // If a checklist exists and isn't complete, confirm before overriding it.
  const set = promoReqs().find((r) => r.org === u.org && r.fromRank === u.rank);
  const items = set?.items || [];
  const met = items.filter((it) => (u.promoChecks || []).includes(it.id)).length;
  if (items.length && met < items.length) {
    const ok = await confirmDialog({
      title: 'Promote before all requirements met?',
      message: `${met} of ${items.length} requirements are checked for ${u.rank} \u2192 ${next}. Promote anyway?`,
      confirmLabel: 'Promote',
    });
    if (!ok) return;
  }

  const fromRank = u.rank;
  const newClr = clearanceForRank(u.org, next);
  const done = mutate(app, u.id, u.version, (fresh) => {
    fresh.rank = next;
    if (newClr) fresh.clearance = newClr;
    fresh.promoChecks = [];
    addEvent(fresh, 'promotion', `Promoted ${fromRank} \u2192 ${next}${newClr ? ` \u00b7 clearance ${CLEARANCES[newClr].label}` : ''}.`);
  }, { action: 'PROMOTE', detail: `${u.designation} promoted ${fromRank} \u2192 ${next}.` });
  if (done) toast(`Promoted to ${next}.`, 'success');
}

async function demote(app, u) {
  const down = rankDown(u.org, u.rank);
  if (!down) { toast('Already at the most junior rank.', 'warn'); return; }
  if (!canDemote(app.user, u)) { toast('You are not permitted to demote this operator.', 'error'); return; }

  const ok = await confirmDialog({
    title: 'Demote operator?',
    message: `Reduce ${u.designation} from ${u.rank} to ${down}? Their promotion checklist will reset.`,
    confirmLabel: 'Demote',
    danger: true,
  });
  if (!ok) return;

  const fromRank = u.rank;
  const newClr = clearanceForRank(u.org, down);
  const done = mutate(app, u.id, u.version, (fresh) => {
    fresh.rank = down;
    if (newClr) fresh.clearance = newClr;
    fresh.promoChecks = [];
    addEvent(fresh, 'demotion', `Reduced in rank ${fromRank} \u2192 ${down}${newClr ? ` \u00b7 clearance ${CLEARANCES[newClr].label}` : ''}.`);
  }, { action: 'DEMOTE', detail: `${u.designation} reduced ${fromRank} \u2192 ${down}.` });
  if (done) toast(`Reduced to ${down}.`, 'success');
}

function toggleRequirement(app, u, reqId) {
  if (!canPromote(app.user, u)) { toast('You are not permitted to update this checklist.', 'error'); app.refresh(); return; }
  mutate(app, u.id, u.version, (fresh) => {
    const set = new Set(fresh.promoChecks || []);
    if (set.has(reqId)) set.delete(reqId); else set.add(reqId);
    fresh.promoChecks = [...set];
  }, { action: 'PROMO_CHECK', detail: `Updated promotion checklist for ${u.designation}.` });
}

function sectionService(u) {
  const items = (u.events || []).map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(e.type)}"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(e.text)}</div>
        <div class="tl__meta"><span class="tl__type">${esc(e.type)}</span> \u00b7 ${fmtDate(e.date)}</div>
      </div>
    </li>`).join('');
  return `
    <section class="card">
      <div class="card__title">Service Record</div>
      <div class="card__body">
        ${items ? `<ul class="timeline">${items}</ul>` : '<div class="empty">No recorded events.</div>'}
      </div>
    </section>`;
}

function sectionAwards(u) {
  if (!(u.awards || []).length) return '';
  const items = u.awards.map((a) => `
    <div class="award">
      <div class="award__title">${esc(a.title)}</div>
      <div class="award__meta">${fmtDate(a.date)}${a.note ? ` \u00b7 ${esc(a.note)}` : ''}</div>
    </div>`).join('');
  return `<section class="card"><div class="card__title">Awards & Commendations</div><div class="card__body">${items}</div></section>`;
}

// Training currency: the operator's held courses with derived status, plus a
// manager's grant/revoke controls. Granting writes a completion onto the file
// (a personnel edit, authorised by the personnel gate). Currency is derived, so
// nothing needs recomputing over time.
function sectionTraining(u, actor) {
  const now = Date.now();
  const canManage = canManageTraining(actor, u.org);
  // Latest completion per course.
  const byCourse = new Map();
  for (const t of (u.trainings || [])) {
    const prev = byCourse.get(t.courseId);
    if (!prev || new Date(t.awardedAt) > new Date(prev.awardedAt)) byCourse.set(t.courseId, t);
  }
  const rows = [...byCourse.values()].map((t) => {
    const course = getTraining(t.courseId);
    const state = trainingCurrency(t, now);
    const m = TRAINING_CURRENCY[state];
    const name = course ? `${esc(course.code)} \u00b7 ${esc(course.title)}` : '<span class="muted-text">(course withdrawn)</span>';
    return `<div class="trn-row">
      <span class="trn-row__name">${name}</span>
      <span class="badge badge--${m.tone}">${esc(m.label)}</span>
      <span class="muted-text trn-row__exp">${t.expiresAt ? `exp. ${fmtDate(t.expiresAt)}` : 'no expiry'}</span>
      ${canManage ? `<button class="btn btn--xs btn--danger" data-revoke-training="${esc(t.id)}">Revoke</button>` : ''}
    </div>`;
  }).sort().join('');

  const header = `Training <span class="muted-text">(${byCourse.size})</span>`;
  const grant = canManage ? '<button class="btn btn--xs" data-act="grant-training" style="float:right;margin-top:-2px">+ Record completion</button>' : '';
  return `<section class="card"><div class="card__title">${header}${grant}</div><div class="card__body">${rows || '<div class="empty">No training on record.</div>'}</div></section>`;
}

function openGrantTraining(app, u) {
  const actor = app.user;
  if (!canManageTraining(actor, u.org)) { toast('You cannot record training for this operator.', 'error'); return; }
  const courses = trainings().filter((c) => !c.deleted && c.active && c.org === u.org)
    .filter((c) => !c.clearanceFloor || CLEARANCES[u.clearance].weight >= CLEARANCES[c.clearanceFloor].weight)
    .sort((a, b) => a.code.localeCompare(b.code));
  if (!courses.length) { toast('No eligible courses for this operator\u2019s unit and clearance.', 'error'); return; }
  const opts = courses.map((c) => `<option value="${esc(c.id)}">${esc(c.code)} \u2014 ${esc(c.title)}${c.validityMonths ? ` (valid ${c.validityMonths} mo)` : ''}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);
  openModal({
    title: `Record completion \u2014 ${u.designation}`,
    body: `
      <div class="field"><label>Course</label><select id="gt-course">${opts}</select></div>
      <div class="field"><label>Date completed</label><input id="gt-date" type="date" value="${today}" max="${today}" /></div>
      <div class="field"><label>Note (optional)</label><input id="gt-note" type="text" placeholder="e.g. passed with distinction" /></div>
      <div class="field__hint">The expiry is set automatically from the course's validity period.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Record', tone: 'primary', onClick: (c, d) => {
          const courseId = d.querySelector('#gt-course').value;
          const course = getTraining(courseId);
          if (!course) { toast('Course no longer exists.', 'error'); return; }
          const dateStr = d.querySelector('#gt-date').value || today;
          const awardedAt = new Date(`${dateStr}T12:00:00`).toISOString();
          const fresh = getUser(u.id);
          if (!fresh) { toast('Record no longer exists.', 'error'); c(); app.refresh(); return; }
          fresh.trainings = [...(fresh.trainings || []), {
            id: newId('cmp'), courseId, awardedBy: actor.designation, awardedAt,
            expiresAt: trainingExpiry(awardedAt, course.validityMonths), note: d.querySelector('#gt-note').value.trim(),
          }];
          fresh.version = (fresh.version || 1) + 1; fresh.updatedAt = new Date().toISOString();
          upsertUser(fresh);
          logAction(actor, 'EDIT_PERSONNEL', `Recorded ${course.code} for ${u.designation}.`);
          toast('Completion recorded.', 'success'); c(); app.refresh();
        } },
    ],
  });
}

async function revokeTraining(app, u, completionId) {
  const actor = app.user;
  if (!canManageTraining(actor, u.org)) return;
  const ok = await confirmDialog({ title: 'Revoke completion', message: 'Remove this training completion from the operator\u2019s file?', confirmLabel: 'Revoke', danger: true });
  if (!ok) return;
  const fresh = getUser(u.id);
  if (!fresh) { toast('Record no longer exists.', 'error'); app.refresh(); return; }
  fresh.trainings = (fresh.trainings || []).filter((t) => t.id !== completionId);
  fresh.version = (fresh.version || 1) + 1; fresh.updatedAt = new Date().toISOString();
  upsertUser(fresh);
  logAction(actor, 'EDIT_PERSONNEL', `Revoked a training completion for ${u.designation}.`);
  toast('Completion revoked.', 'success'); app.refresh();
}

function sectionStrikes(u, full, canLift) {
  const count = (u.strikes || []).length;
  if (!count) return '';
  let body;
  if (full) {
    body = u.strikes.map((s) => `
      <div class="strike">
        <div class="strike__reason">${esc(s.reason)}</div>
        <div class="strike__meta">${fmtDate(s.date)} \u00b7 issued by <span class="mono">${esc(s.by)}</span>${s.liftedNote ? ` \u00b7 <span class="muted-text">${esc(s.liftedNote)}</span>` : ''}</div>
        ${canLift ? `<button class="btn btn--xs" data-lift-strike="${esc(s.id)}">Lift</button>` : ''}
      </div>`).join('');
  } else {
    body = `<div class="restricted-line">${count} strike${count > 1 ? 's' : ''} on file \u2014 detail ${redacted(10)}</div>`;
  }
  const flagged = count >= STRIKE_LIMIT;
  return `
    <section class="card ${flagged ? 'card--alert' : ''}">
      <div class="card__title">Disciplinary Record ${flagged ? '<span class="badge badge--bad">At limit</span>' : ''}</div>
      <div class="card__body">${body}</div>
    </section>`;
}

function sectionLeave(u, full) {
  return `
    <section class="card card--warn">
      <div class="card__title">Active Leave</div>
      <div class="card__body">
        <div class="kv"><span class="kv__k">Type</span><span class="kv__v">${esc(u.leave.type)}</span></div>
        <div class="kv"><span class="kv__k">From</span><span class="kv__v">${fmtDate(u.leave.from)}</span></div>
        <div class="kv"><span class="kv__k">Until</span><span class="kv__v">${fmtDate(u.leave.to)}</span></div>
        <div class="kv"><span class="kv__k">Reason</span><span class="kv__v">${full ? esc(u.leave.reason || '\u2014') : redacted(18)}</span></div>
      </div>
    </section>`;
}

function sectionNotes(u, full) {
  const count = (u.notes || []).length;
  if (!full) {
    if (!count) return '';
    return `<section class="card"><div class="card__title">Command Notes</div><div class="card__body"><div class="restricted-line">${count} note${count > 1 ? 's' : ''} \u2014 ${redacted(12)}</div></div></section>`;
  }
  const items = count ? u.notes.map((n) => `
    <div class="note">
      <div class="note__text">${esc(n.text)}</div>
      <div class="note__meta">${esc(n.by)} \u00b7 ${fmtDate(n.date)}</div>
    </div>`).join('') : '<div class="empty">No command notes.</div>';
  return `<section class="card"><div class="card__title">Command Notes</div><div class="card__body">${items}</div></section>`;
}

// ===========================================================================
// ACTION MODALS
// ===========================================================================
function fieldSelect(id, label, options, selected) {
  const opts = options.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('');
  return `<div class="field"><label>${esc(label)}</label><select id="${id}">${opts}</select></div>`;
}

function openEdit(app, u) {
  const actor = app.user;
  // A rank not on the operator's own org ladder is a data error (typically an
  // Omega rank left on an Ethics/Command file after an org move). Offer a direct
  // correction to any valid rank the actor is cleared to assign.
  const ladder = RANKS[u.org] || [];
  const rankOffLadder = !!u.rank && !ladder.includes(u.rank);
  const canFixRank = canSetRank(actor, u) && rankOffLadder;
  const rankField = canFixRank ? `
    <div class="field">
      <label>Correct rank <span class="muted-text">(current \u201c${esc(u.rank)}\u201d is not a ${esc(ORGS[u.org].short)} rank)</span></label>
      <select id="ed-rank"><option value="">\u2014 choose a ${esc(ORGS[u.org].short)} rank \u2014</option>${ladder.map((r) => {
        const clr = clearanceForRank(u.org, r);
        return `<option value="${esc(r)}">${esc(r)}${clr ? ` \u2014 ${esc(clr)}` : ''}</option>`;
      }).join('')}</select>
      <div class="field__hint">Sets clearance to match the corrected rank.</div>
    </div>` : '';

  const body = `
    <div class="field"><label>Codename</label><input id="ed-codename" type="text" value="${esc(u.codename)}" /></div>
    <div class="field"><label>Legal name</label><input id="ed-real" type="text" value="${esc(u.realName)}" /></div>
    ${fieldSelect('ed-status', 'Status', STATUS_ORDER, u.status)}
    ${rankField}
  `;
  openModal({
    title: `Edit \u2014 ${u.designation}`,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save changes', tone: 'primary', onClick: (c, d) => {
          const codename = d.querySelector('#ed-codename').value.trim() || u.codename;
          const realName = d.querySelector('#ed-real').value.trim() || u.realName;
          const status = d.querySelector('#ed-status').value;
          const newRank = canFixRank ? (d.querySelector('#ed-rank').value || '') : '';
          // A rank correction is authorised as its own operation, so it can't be
          // combined with other edits in one write. Do it alone, then return.
          if (newRank && newRank !== u.rank) {
            const tier = clearanceForRank(u.org, newRank);
            mutate(app, u.id, u.version, (rec) => {
              rec.rank = newRank;
              if (tier) rec.clearance = tier;
              rec.promoChecks = [];
              addEvent(rec, 'edit', `Rank corrected to ${newRank}${tier ? ` \u00b7 clearance ${CLEARANCES[tier].label}` : ''}.`);
            }, { action: 'SET_RANK', detail: `${u.designation} rank corrected to ${newRank}.` });
            c();
            toast('Rank corrected.', 'success');
            return;
          }
          mutate(app, u.id, u.version, (rec) => {
            const changes = [];
            if (rec.status !== status) changes.push(`status \u2192 ${status}`);
            rec.codename = codename; rec.realName = realName; rec.status = status;
            if (changes.length) addEvent(rec, 'edit', `Record updated: ${changes.join(', ')}.`);
          }, { action: 'EDIT_RECORD', detail: `${u.designation} record updated.` });
          c();
          toast('Record updated.', 'success');
        } },
    ],
  });
}

// Set a new sign-in passphrase for an operator. In server mode the Worker hashes
// and stores it (the only authorised path — sync can't touch credentials); in
// local mode we hash here and write the record directly. The authority rule is
// mirrored from the server: a manager with a stake, never above your own level.
function openPassphrase(app, u) {
  const actor = app.user;
  const weight = (x) => (CLEARANCES[x?.clearance]?.weight || 0);
  if (!canManageOrg(actor, u.org) || weight(actor) < weight(u)) { toast('Not permitted.', 'error'); return; }
  const body = `
    <p class="modal__message">Set a new sign-in passphrase for <strong>${esc(u.designation)} \u00b7 ${esc(u.codename)}</strong>.
    They sign in with operator ID <span class="mono">${esc(u.username || '\u2014')}</span>. Share the passphrase over a secure channel; they can change it later.</p>
    <div class="field"><label>New passphrase</label><input id="pp-new" type="text" placeholder="at least 6 characters" spellcheck="false" autocomplete="off" /></div>
    <div class="field"><label>Confirm passphrase</label><input id="pp-confirm" type="text" placeholder="re-enter" spellcheck="false" autocomplete="off" /></div>
    <div id="pp-err" class="auth__error" hidden></div>
  `;
  openModal({
    title: `Set passphrase \u2014 ${u.designation}`,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Set passphrase', tone: 'primary', onClick: async (c, d) => {
          const pass = d.querySelector('#pp-new').value;
          const confirm = d.querySelector('#pp-confirm').value;
          const err = d.querySelector('#pp-err');
          err.hidden = true;
          if (!pass || pass.length < 6) { err.textContent = 'A passphrase must be at least 6 characters.'; err.hidden = false; return; }
          if (pass !== confirm) { err.textContent = 'The passphrases do not match.'; err.hidden = false; return; }
          try {
            const api = await import('../api.js');
            if (api.serverMode()) {
              await api.resetPassphrase(u.id, pass);
              // Reconcile the version the server just bumped, so later edits don't conflict.
              try { applyServerSnapshot(await api.fetchSnapshot()); } catch (_e) { /* non-fatal */ }
            } else {
              const { makeCredential } = await import('../crypto.js');
              const { salt, hash } = await makeCredential(pass);
              const fresh = getUser(u.id);
              if (!fresh) { toast('Record no longer exists.', 'error'); c(); app.refresh(); return; }
              fresh.salt = salt; fresh.passwordHash = hash;
              fresh.version = (fresh.version || 1) + 1;
              fresh.updatedAt = new Date().toISOString();
              fresh.events = fresh.events || [];
              fresh.events.unshift({ id: newId('evt'), date: fresh.updatedAt, type: 'security', text: `Passphrase reset by ${actor.designation}.` });
              upsertUser(fresh);
              logAction(actor, 'RESET_PASSPHRASE', `Passphrase reset for ${u.designation}.`);
            }
            c();
            toast(`Passphrase updated for ${u.designation}.`, 'success');
            app.refresh();
          } catch (e) {
            err.textContent = (e && e.message) || 'Could not update the passphrase.'; err.hidden = false;
          }
        } },
    ],
  });
}

// Self-service passphrase change for the signed-in operator, reachable from the
// topbar by every role. Requires the current passphrase; the Worker verifies and
// rehashes in server mode, we verify and rehash locally otherwise.
export function openChangePassphrase(app) {
  const me = app.user;
  const body = `
    <p class="modal__message">Change the sign-in passphrase for your own account (<span class="mono">${esc(me.username || me.designation)}</span>).</p>
    <div class="field"><label>Current passphrase</label><input id="cp-cur" type="password" autocomplete="current-password" spellcheck="false" /></div>
    <div class="field"><label>New passphrase</label><input id="cp-new" type="password" autocomplete="new-password" placeholder="at least 6 characters" spellcheck="false" /></div>
    <div class="field"><label>Confirm new passphrase</label><input id="cp-confirm" type="password" autocomplete="new-password" spellcheck="false" /></div>
    <div id="cp-err" class="auth__error" hidden></div>
    <div class="modal__aside"><button class="btn btn--ghost btn--sm" id="cp-signout-all">Sign out of all devices</button></div>
  `;
  const bindSignOutAll = (d) => {
    const b = d.querySelector('#cp-signout-all');
    if (!b) return;
    b.addEventListener('click', async () => {
      const api = await import('../api.js');
      if (!api.serverMode()) { toast('Nothing to do \u2014 sessions are only kept in server mode.', 'info'); return; }
      const ok = await confirmDialog({ title: 'Sign out everywhere', message: 'End every active session for your account, including this one? You will need to sign in again.', confirmLabel: 'Sign out everywhere', danger: true });
      if (!ok) return;
      try { await api.signOutEverywhere(); } catch (_) { /* clear locally regardless */ }
      window.location.reload();
    });
  };
  openModal({
    title: 'Change passphrase',
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Change passphrase', tone: 'primary', onClick: async (c, d) => {
          const cur = d.querySelector('#cp-cur').value;
          const next = d.querySelector('#cp-new').value;
          const confirm = d.querySelector('#cp-confirm').value;
          const err = d.querySelector('#cp-err');
          err.hidden = true;
          if (!cur) { err.textContent = 'Enter your current passphrase.'; err.hidden = false; return; }
          if (!next || next.length < 6) { err.textContent = 'The new passphrase must be at least 6 characters.'; err.hidden = false; return; }
          if (next !== confirm) { err.textContent = 'The new passphrases do not match.'; err.hidden = false; return; }
          try {
            const api = await import('../api.js');
            if (api.serverMode()) {
              await api.changeMyPassphrase(cur, next);
              try { applyServerSnapshot(await api.fetchSnapshot()); } catch (_e) { /* non-fatal */ }
            } else {
              const { makeCredential, verifyPassword } = await import('../crypto.js');
              const fresh = getUser(me.id);
              if (!fresh) { toast('Your record could not be found.', 'error'); c(); return; }
              if (!(await verifyPassword(cur, fresh.salt, fresh.passwordHash))) { err.textContent = 'Your current passphrase is incorrect.'; err.hidden = false; return; }
              const { salt, hash } = await makeCredential(next);
              fresh.salt = salt; fresh.passwordHash = hash;
              fresh.version = (fresh.version || 1) + 1;
              fresh.updatedAt = new Date().toISOString();
              fresh.events = fresh.events || [];
              fresh.events.unshift({ id: newId('evt'), date: fresh.updatedAt, type: 'security', text: 'Passphrase changed by the operator.' });
              upsertUser(fresh);
              logAction(me, 'CHANGE_PASSPHRASE', `${me.designation} changed their passphrase.`);
            }
            c();
            toast('Your passphrase has been changed.', 'success');
          } catch (e) {
            err.textContent = (e && e.message) || 'Could not change the passphrase.'; err.hidden = false;
          }
        } },
    ],
  });
}

function openClearance(app, u) {
  const ceiling = CLEARANCES[app.user.clearance].weight;
  const allowed = CLEARANCE_ORDER.filter((c) => CLEARANCES[c].weight <= ceiling);
  const body = `
    <p class="modal__message">Assign clearance for <strong>${esc(u.designation)} \u00b7 ${esc(u.codename)}</strong>.
    You cannot grant a level above your own.</p>
    ${fieldSelect('cl-level', 'Clearance', allowed, u.clearance || allowed[0])}
  `;
  openModal({
    title: 'Set clearance',
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply clearance', tone: 'primary', onClick: (c, d) => {
          const next = d.querySelector('#cl-level').value;
          if (!canSetClearance(app.user, u, next)) { toast('Not permitted.', 'error'); c(); return; }
          mutate(app, u.id, u.version, (rec) => {
            const from = rec.clearance || 'none';
            rec.clearance = next;
            addEvent(rec, 'clearance', `Clearance changed ${from} \u2192 ${next} by ${app.user.designation}.`);
          }, { action: 'SET_CLEARANCE', detail: `${u.designation} set to ${next}.` });
          c();
          toast(`Clearance set to ${CLEARANCES[next].label}.`, 'success');
        } },
    ],
  });
}

function openStrike(app, u) {
  openModal({
    title: `Add strike \u2014 ${u.designation}`,
    body: `<div class="field"><label>Reason</label><textarea id="st-reason" rows="3" placeholder="State the infraction\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Record strike', tone: 'danger', onClick: (c, d) => {
          const reason = d.querySelector('#st-reason').value.trim();
          if (!reason) { toast('A reason is required.', 'error'); return; }
          let count = 0;
          mutate(app, u.id, u.version, (rec) => {
            rec.strikes = rec.strikes || [];
            rec.strikes.push({ id: newId('stk'), reason, date: new Date().toISOString(), by: app.user.designation });
            count = rec.strikes.length;
            addEvent(rec, 'strike', `Strike recorded: ${reason}`);
          }, { action: 'ADD_STRIKE', detail: `Strike on ${u.designation}.` });
          c();
          if (count >= STRIKE_LIMIT) toast(`Strike recorded \u2014 ${u.designation} is now at the ${STRIKE_LIMIT}-strike limit.`, 'warn', 4500);
          else toast('Strike recorded.', 'success');
        } },
    ],
  });
}

async function liftStrike(app, u, strikeId) {
  const actor = app.user;
  if (!canIssueStrike(actor, u)) { toast('You cannot amend this operator\u2019s record.', 'error'); return; }
  const strike = (u.strikes || []).find((s) => s.id === strikeId);
  if (!strike) return;
  const ok = await confirmDialog({
    title: 'Lift strike',
    message: `Lift this strike against ${u.designation}? It will be removed from the disciplinary record on appeal.`,
    confirmLabel: 'Lift strike',
    danger: true,
  });
  if (!ok) return;
  mutate(app, u.id, u.version, (rec) => {
    rec.strikes = (rec.strikes || []).filter((s) => s.id !== strikeId);
    addEvent(rec, 'strike', `Strike lifted on appeal: ${strike.reason}`);
  }, { action: 'LIFT_STRIKE', detail: `Strike lifted for ${u.designation}.` });
  toast('Strike lifted.', 'success');
}

function openNote(app, u) {
  openModal({
    title: `Add command note \u2014 ${u.designation}`,
    body: `<div class="field"><label>Note</label><textarea id="nt-text" rows="3" placeholder="Visible to full-access reviewers only\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save note', tone: 'primary', onClick: (c, d) => {
          const text = d.querySelector('#nt-text').value.trim();
          if (!text) { toast('Nothing to save.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.notes = rec.notes || [];
            rec.notes.unshift({ id: newId('nte'), text, by: app.user.designation, date: new Date().toISOString() });
          }, { action: 'ADD_NOTE', detail: `Note added to ${u.designation}.` });
          c();
          toast('Note saved.', 'success');
        } },
    ],
  });
}

function openLeave(app, u) {
  const today = new Date().toISOString().slice(0, 10);
  const body = `
    ${fieldSelect('lv-type', 'Leave type', ['LoA', 'RoA'], 'LoA')}
    <div class="field"><label>From</label><input id="lv-from" type="date" value="${today}" /></div>
    <div class="field"><label>Until</label><input id="lv-to" type="date" value="${today}" /></div>
    <div class="field"><label>Reason</label><textarea id="lv-reason" rows="2" placeholder="Restricted to full-access reviewers\u2026"></textarea></div>
  `;
  openModal({
    title: `Place on leave \u2014 ${u.designation}`,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Place on leave', tone: 'primary', onClick: (c, d) => {
          const type = d.querySelector('#lv-type').value;
          const from = d.querySelector('#lv-from').value;
          const to = d.querySelector('#lv-to').value;
          const reason = d.querySelector('#lv-reason').value.trim();
          mutate(app, u.id, u.version, (rec) => {
            rec.leave = { type, from, to, reason };
            rec.status = 'loa';
            addEvent(rec, 'leave', `Placed on ${type} (${fmtDate(from)} \u2013 ${fmtDate(to)}).`);
          }, { action: 'SET_LEAVE', detail: `${u.designation} placed on leave.` });
          c();
          toast('Operator placed on leave.', 'success');
        } },
    ],
  });
}

async function returnFromLeave(app, u) {
  const ok = await confirmDialog({
    title: 'Return from leave',
    message: `Mark ${u.designation} \u00b7 ${u.codename} as returned to active duty?`,
    confirmLabel: 'Return to active',
  });
  if (!ok) return;
  mutate(app, u.id, u.version, (rec) => {
    rec.leave = null;
    rec.status = 'active';
    addEvent(rec, 'leave', 'Returned from leave to active duty.');
  }, { action: 'END_LEAVE', detail: `${u.designation} returned to active duty.` });
  toast('Operator returned to active duty.', 'success');
}

async function removeRecord(app, u) {
  const ok = await confirmDialog({
    title: 'Remove personnel record',
    message: `Move ${u.designation} \u00b7 ${u.codename} to the recycle bin? This revokes their access. The record can be restored by Command.`,
    confirmLabel: 'Remove record',
    danger: true,
  });
  if (!ok) return;
  const fresh = getUser(u.id);
  if (!fresh) { app.refresh(); return; }
  fresh.deleted = true;
  fresh.deletedAt = new Date().toISOString();
  fresh.version += 1;
  upsertUser(fresh);
  logAction(app.user, 'REMOVE_RECORD', `${u.designation} moved to recycle bin.`);
  toast('Record moved to recycle bin.', 'success');
  app.navigate(`#/${u.org === 'ethics-committee' ? 'ethics' : u.org}`);
}

// --- Create personnel (CL4·S+ / Command) ------------------------------------
function openCreate(app, org) {
  const ranks = RANKS[org] || [];
  const ceiling = CLEARANCES[app.user.clearance].weight;
  const allowedClr = CLEARANCE_ORDER.filter((c) => CLEARANCES[c].weight <= ceiling);
  const body = `
    <p class="modal__message">Create a personnel record in <strong>${esc(ORGS[org].name)}</strong>. An operator ID and passphrase are set so the person can sign in.</p>
    <div class="field"><label>Codename</label><input id="cr-codename" type="text" placeholder="e.g. Marshal" /></div>
    <div class="field"><label>Legal name</label><input id="cr-real" type="text" placeholder="optional" /></div>
    ${fieldSelect('cr-rank', 'Rank', ranks, ranks[0])}
    ${fieldSelect('cr-clr', 'Clearance', allowedClr, allowedClr[0])}
    <div class="field"><label>Operator ID</label><input id="cr-user" type="text" placeholder="login name" spellcheck="false" /></div>
    <div class="field"><label>Passphrase</label><input id="cr-pass" type="text" placeholder="initial passphrase" /></div>
    <div id="cr-err" class="auth__error" hidden></div>
  `;
  openModal({
    title: 'New personnel',
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Create record', tone: 'primary', onClick: async (c, d) => {
          const codename = d.querySelector('#cr-codename').value.trim();
          const real = d.querySelector('#cr-real').value.trim() || '[REDACTED]';
          const rank = d.querySelector('#cr-rank').value;
          const clr = d.querySelector('#cr-clr').value;
          const username = d.querySelector('#cr-user').value.trim();
          const pass = d.querySelector('#cr-pass').value;
          const err = d.querySelector('#cr-err');
          err.hidden = true;
          if (!codename || !username || !pass) { err.textContent = 'Codename, operator ID and passphrase are required.'; err.hidden = false; return; }
          if (users().some((x) => (x.username || '').toLowerCase() === username.toLowerCase())) { err.textContent = 'That operator ID is already in use.'; err.hidden = false; return; }
          if (!canSetClearance(app.user, { id: '_new', org }, clr) && !isCL5(app.user) && CLEARANCES[clr].weight > ceiling) {
            err.textContent = 'You cannot assign a clearance above your own.'; err.hidden = false; return;
          }
          const { makeCredential } = await import('../crypto.js');
          const { salt, hash } = await makeCredential(pass);
          const now = new Date().toISOString();
          // Designation: next free number in the org's prefix.
          const prefix = org === 'omega-1' ? 'O1' : org === 'ethics-committee' ? 'EC' : 'CMD';
          const nums = users().filter((x) => x.org === org && /\-(\d+)$/.test(x.designation)).map((x) => parseInt(x.designation.split('-')[1], 10));
          const next = (nums.length ? Math.max(...nums) : 0) + 1;
          upsertUser({
            id: newId('usr'), designation: `${prefix}-${next}`, codename, realName: real,
            org, rank, clearance: clr, status: 'active', username, salt, passwordHash: hash,
            accountStatus: 'active', requestedOrg: null,
            awards: [], strikes: [], leave: null, notes: [],
            events: [{ id: newId('evt'), date: now, type: 'appointment', text: `Record created by ${app.user.designation}.` }],
            createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
          });
          logAction(app.user, 'CREATE_RECORD', `Created ${prefix}-${next} (${codename}) in ${ORGS[org].short}.`);
          c();
          toast(`Personnel record ${prefix}-${next} created.`, 'success');
          app.refresh();
        } },
    ],
  });
}
