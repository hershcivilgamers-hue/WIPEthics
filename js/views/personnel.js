// =============================================================================
// views/personnel.js — Roster list + personnel dossier.
//
// The heart of the system. The list is an open, filterable roster; the dossier
// is the full record, with the redaction engine deciding how much each operator
// may see. All record-management actions (edit, clearance, strike, note, leave,
// delete) live here and route through the permission checks and audit log.
// =============================================================================

import {
  ORGS, RANKS, STATUS_ORDER, CLEARANCE_ORDER, CLEARANCES, STRIKE_LIMIT, strikeActive, activeStrikeCount, strikeVoided,
  rankUp, rankDown, clearanceForRank,
  TRAINING_CATEGORY, TRAINING_CURRENCY, trainingCurrency, trainingExpiry,
  PERSONNEL_TAGS_SETTING_ID, normalizeTagCatalog,
  MEDALS_SETTING_ID, normalizeMedalCatalog,
} from '../constants.js';
import { users, getUser, upsertUser, promoReqs, newId, applyServerSnapshot, trainings, getTraining, getSetting, cases } from '../storage.js';
import { orgLogo } from '../logos.js';
import {
  canEditPersonnel, canSetClearance, canSetRank, canIssueStrike,
  canDeletePersonnel, canPromote, canDemote, accessLevel, isCL5, canManageOrg, canManageTraining, canViewCase, canDischarge, canManageLeave,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { exportPersonnel, exportIdCard, exportMedalCertificate } from '../export.js';
import { exportCSV } from '../csv.js';
import { rankInsignia } from '../insignia.js';
import { renderHistory } from '../record-history.js';
import {
  esc, fmtDate, fmtDateTime, clearanceBadge, statusBadge, accountBadge,
  orgTag, monogram, redacted, toast, openModal, confirmDialog,
} from '../ui.js';

// Roster filter state, preserved across navigation.
const filter = { q: '', status: '', clearance: '' };
// Roster bulk-selection state (cleared when the viewed org changes).
const rosterSel = new Set();
let rosterSelOrg = null;

// --- Personnel tags ---------------------------------------------------------
function tagCatalog() {
  const rec = getSetting(PERSONNEL_TAGS_SETTING_ID);
  return normalizeTagCatalog(rec && rec.data);
}
// Render a user's assigned tags as chips (ignores ids no longer in the catalogue).
function tagChips(u, { compact = false } = {}) {
  const cat = tagCatalog();
  const held = (Array.isArray(u.tags) ? u.tags : [])
    .map((id) => cat.find((t) => t.id === id))
    .filter(Boolean);
  if (!held.length) return '';
  return `<span class="tag-chips${compact ? ' tag-chips--compact' : ''}">${held.map((t) => `<span class="badge tag-badge tag-badge--${esc(t.color)}">${esc(t.label)}</span>`).join('')}</span>`;
}

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
  // Bulk selection is scoped to the viewed org.
  if (rosterSelOrg !== org) { rosterSel.clear(); rosterSelOrg = org; }

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

  // Prune selection of ids no longer visible in the full org roster.
  const orgIds = new Set(users().filter((u) => u.org === org && !u.deleted && u.accountStatus !== 'pending').map((u) => u.id));
  [...rosterSel].forEach((id) => { if (!orgIds.has(id)) rosterSel.delete(id); });

  const rows = roster.length ? roster.map((u) => `
    <tr data-id="${esc(u.id)}" tabindex="0">
      ${canManage ? `<td class="cell-check"><input type="checkbox" data-row-check="${esc(u.id)}" ${rosterSel.has(u.id) ? 'checked' : ''} /></td>` : ''}
      <td class="mono">${esc(u.designation)}</td>
      <td class="cell-name">${esc(u.codename)}${u.accountStatus === 'suspended' ? ' <span class="badge badge--bad">Suspended</span>' : ''}${tagChips(u, { compact: true })}</td>
      <td>${rankInsignia(u.org, u.rank)} ${esc(u.rank || '\u2014')}</td>
      <td>${clearanceBadge(u.clearance)}</td>
      <td>${statusBadge(u.status)}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>
  `).join('') : `
    <tr><td colspan="${canManage ? 7 : 6}" class="empty">No personnel match the current filters.</td></tr>
  `;

  host.innerHTML = `
    <div class="page-head">
      <div class="page-head__lead">
        ${orgLogo(org) ? `<span class="org-crest" style="--crest:url('${orgLogo(org)}')" role="img" aria-label="${esc(meta.name)} crest"></span>` : ''}
        <div>
          <div class="eyebrow">${esc(meta.name)}</div>
          <h1 class="page-title">Personnel Files</h1>
          <div class="page-sub">${esc(meta.motto)} \u00b7 ${roster.length} on roster</div>
        </div>
      </div>
      ${canManage ? `<button class="btn btn--primary" id="add-personnel">+ New personnel</button>` : ''}
    </div>

    <div class="toolbar">
      <input id="flt-q" class="toolbar__search" type="search" placeholder="Search designation or codename\u2026" value="${esc(filter.q)}" />
      <select id="flt-status" class="toolbar__select">${statusOpts}</select>
      <select id="flt-clr" class="toolbar__select">${clrOpts}</select>
      <button class="btn btn--ghost btn--sm" id="export-csv" title="Export the filtered roster to CSV">⤓ CSV</button>
    </div>

    ${canManage ? `<div class="bulk-bar ${rosterSel.size ? 'is-active' : ''}">
      <span class="bulk-bar__count">${rosterSel.size} selected</span>
      <div class="bulk-bar__actions">
        <button class="btn btn--sm" id="bulk-clr" ${rosterSel.size ? '' : 'disabled'}>Set clearance</button>
        <button class="btn btn--sm" id="bulk-status" ${rosterSel.size ? '' : 'disabled'}>Change status</button>
        <button class="btn btn--sm btn--danger" id="bulk-recycle" ${rosterSel.size ? '' : 'disabled'}>Move to recycle bin</button>
      </div>
    </div>` : ''}

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            ${canManage ? '<th class="cell-check"><input type="checkbox" id="roster-all" /></th>' : ''}
            <th>Designation</th><th>Codename</th><th>Rank</th>
            <th>Clearance</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  host.querySelector('#export-csv')?.addEventListener('click', () => {
    exportCSV(`${org}-roster.csv`, [
      { header: 'Designation', value: (u) => u.designation },
      { header: 'Codename', value: (u) => u.codename },
      { header: 'Rank', value: (u) => u.rank || '' },
      { header: 'Clearance', value: (u) => u.clearance || '' },
      { header: 'Status', value: (u) => u.status || '' },
      { header: 'Account', value: (u) => u.accountStatus || '' },
    ], roster);
  });

  const go = (id) => app.navigate(`#/personnel/${id}`);
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', (e) => { if (e.target.closest('.cell-check')) return; go(tr.dataset.id); });
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(tr.dataset.id); } });
  });

  // Bulk selection.
  host.querySelectorAll('[data-row-check]').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) rosterSel.add(cb.dataset.rowCheck); else rosterSel.delete(cb.dataset.rowCheck);
      renderList(host, app, org);
    });
  });
  const allCb = host.querySelector('#roster-all');
  if (allCb) {
    allCb.checked = roster.length > 0 && roster.every((u) => rosterSel.has(u.id));
    allCb.addEventListener('change', () => {
      if (allCb.checked) roster.forEach((u) => rosterSel.add(u.id)); else roster.forEach((u) => rosterSel.delete(u.id));
      renderList(host, app, org);
    });
  }
  const selected = () => [...rosterSel].map((id) => getUser(id)).filter(Boolean);
  const bClr = host.querySelector('#bulk-clr');
  if (bClr) bClr.addEventListener('click', () => bulkSetClearance(app, selected(), () => renderList(host, app, org)));
  const bSt = host.querySelector('#bulk-status');
  if (bSt) bSt.addEventListener('click', () => bulkSetStatus(app, selected(), () => renderList(host, app, org)));
  const bRec = host.querySelector('#bulk-recycle');
  if (bRec) bRec.addEventListener('click', () => bulkRecycle(app, selected(), () => renderList(host, app, org)));

  const q = host.querySelector('#flt-q');
  q.addEventListener('input', () => { filter.q = q.value; renderList(host, app, org); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
  host.querySelector('#flt-status').addEventListener('change', (e) => { filter.status = e.target.value; renderList(host, app, org); });
  host.querySelector('#flt-clr').addEventListener('change', (e) => { filter.clearance = e.target.value; renderList(host, app, org); });

  const addBtn = host.querySelector('#add-personnel');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app, org));
}

// --- Bulk roster actions ----------------------------------------------------
// Each acts as a loop over the same gated single-record writes, so a bulk action
// can never exceed the actor's individual authority — records they cannot act on
// are skipped and reported. Writes are direct (version-bumped) to avoid firing a
// per-item toast/refresh mid-loop.
function bulkSetClearance(app, list, done) {
  if (!list.length) return;
  const actor = app.user;
  const ceiling = CLEARANCES[actor.clearance].weight;
  const allowed = CLEARANCE_ORDER.filter((c) => CLEARANCES[c].weight <= ceiling);
  openModal({
    title: `Set clearance \u2014 ${list.length} selected`,
    body: `<p class="modal__message">Apply a clearance level to the ${list.length} selected operator${list.length === 1 ? '' : 's'}. Any above your own clearance are skipped.</p>${fieldSelect('bulk-cl', 'Clearance', allowed, allowed[0])}`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply clearance', tone: 'primary', onClick: (c, d) => {
          const level = d.querySelector('#bulk-cl').value;
          c();
          let applied = 0; let skipped = 0;
          for (const u of list) {
            const fresh = getUser(u.id);
            if (!fresh || fresh.deleted) continue;
            if (!canSetClearance(actor, fresh, level)) { skipped += 1; continue; }
            if (fresh.clearance === level) continue;
            const from = fresh.clearance || 'none';
            fresh.clearance = level;
            addEvent(fresh, 'clearance', `Clearance changed ${from} \u2192 ${level} by ${actor.designation}.`);
            fresh.version += 1; fresh.updatedAt = new Date().toISOString();
            upsertUser(fresh);
            logAction(actor, 'SET_CLEARANCE', `${fresh.designation} set to ${level}.`);
            applied += 1;
          }
          rosterSel.clear();
          toast(`Clearance applied to ${applied}${skipped ? ` \u00b7 ${skipped} skipped` : ''}.`, 'success', 4000);
          if (done) done();
        } },
    ],
  });
}

function bulkSetStatus(app, list, done) {
  if (!list.length) return;
  const actor = app.user;
  openModal({
    title: `Change status \u2014 ${list.length} selected`,
    body: `<p class="modal__message">Set the duty status for the ${list.length} selected operator${list.length === 1 ? '' : 's'}. Records you cannot edit are skipped.</p>${fieldSelect('bulk-st', 'Status', STATUS_ORDER, STATUS_ORDER[0])}`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply status', tone: 'primary', onClick: (c, d) => {
          const status = d.querySelector('#bulk-st').value;
          c();
          let applied = 0; let skipped = 0;
          for (const u of list) {
            const fresh = getUser(u.id);
            if (!fresh || fresh.deleted) continue;
            if (!canEditPersonnel(actor, fresh)) { skipped += 1; continue; }
            if (fresh.status === status) continue;
            fresh.status = status;
            addEvent(fresh, 'edit', `Status set to ${status} by ${actor.designation}.`);
            fresh.version += 1; fresh.updatedAt = new Date().toISOString();
            upsertUser(fresh);
            logAction(actor, 'EDIT_PERSONNEL', `${fresh.designation} status \u2192 ${status}.`);
            applied += 1;
          }
          rosterSel.clear();
          toast(`Status applied to ${applied}${skipped ? ` \u00b7 ${skipped} skipped` : ''}.`, 'success', 4000);
          if (done) done();
        } },
    ],
  });
}

async function bulkRecycle(app, list, done) {
  if (!list.length) return;
  const actor = app.user;
  const ok = await confirmDialog({
    title: 'Move to recycle bin',
    message: `Move ${list.length} selected operator${list.length === 1 ? '' : 's'} to the recycle bin? This revokes their access. Records can be restored by Command. Any you cannot remove are skipped.`,
    confirmLabel: 'Move to recycle bin', danger: true,
  });
  if (!ok) return;
  let applied = 0; let skipped = 0;
  for (const u of list) {
    const fresh = getUser(u.id);
    if (!fresh || fresh.deleted) continue;
    if (!canDeletePersonnel(actor, fresh)) { skipped += 1; continue; }
    fresh.deleted = true; fresh.deletedAt = new Date().toISOString();
    fresh.version += 1; fresh.updatedAt = new Date().toISOString();
    upsertUser(fresh);
    logAction(actor, 'REMOVE_RECORD', `${fresh.designation} moved to recycle bin.`);
    applied += 1;
  }
  rosterSel.clear();
  toast(`Moved ${applied} to the recycle bin${skipped ? ` \u00b7 ${skipped} skipped` : ''}.`, 'success', 4000);
  if (done) done();
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
    tags: canEditPersonnel(actor, u),
    medal: canEditPersonnel(actor, u),
    // Unit transfer: the actor must be able to manage the operator's current org
    // AND at least one other org to move them into. Never yourself.
    transfer: actor.id !== u.id && canManageOrg(actor, u.org)
      && Object.keys(ORGS).some((o) => o !== u.org && canManageOrg(actor, o)),
    // Suspension: an administrative hold on the account's sign-in. Managers
    // only, never yourself, and only for accounts that are active or held.
    suspend: actor.id !== u.id && canEditPersonnel(actor, u)
      && (u.accountStatus === 'active' || u.accountStatus === 'suspended'),
    // Request leave on your own record: active account, not already on leave,
    // and no request already pending.
    requestLeave: actor.id === u.id && u.accountStatus === 'active' && !u.leave
      && !(u.leaveRequest && u.leaveRequest.status === 'pending'),
    requestAdvancement: actor.id === u.id && u.accountStatus === 'active'
      && !!rankUp(u.org, u.rank)
      && !(u.advancementRequest && u.advancementRequest.status === 'pending'),
    requestTransfer: actor.id === u.id && u.accountStatus === 'active'
      && !(u.transferRequest && u.transferRequest.status === 'pending'),
    leave: canManageLeave(actor, u),
    discharge: canDischarge(actor, u),
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
  const flagged = activeStrikeCount(u.strikes) >= STRIKE_LIMIT;

  // --- Sections built per access level ---
  const identityRows = `
    <div class="kv"><span class="kv__k">Designation</span><span class="kv__v mono">${esc(u.designation)}</span></div>
    <div class="kv"><span class="kv__k">Codename</span><span class="kv__v">${esc(u.codename)}</span></div>
    <div class="kv"><span class="kv__k">Organisation</span><span class="kv__v">${orgTag(u.org)} ${esc(ORGS[u.org].name)}</span></div>
    <div class="kv"><span class="kv__k">Rank</span><span class="kv__v">${rankInsignia(u.org, u.rank, { size: 18 })} ${esc(u.rank || '\u2014')}</span></div>
    <div class="kv"><span class="kv__k">Legal name</span><span class="kv__v">${full ? esc(u.realName) : redacted(14)}</span></div>
    <div class="kv"><span class="kv__k">Operator ID</span><span class="kv__v mono">${full ? esc(u.username) : redacted(8)}</span></div>
    <div class="kv"><span class="kv__k">Account</span><span class="kv__v">${accountBadge(u.accountStatus)}</span></div>
    <div class="kv"><span class="kv__k">Record updated</span><span class="kv__v">${fmtDateTime(u.updatedAt)}</span></div>
    ${tagChips(u) ? `<div class="kv"><span class="kv__k">Tags</span><span class="kv__v">${tagChips(u)}</span></div>` : ''}
  `;

  const serviceRecord = nameOnly ? '' : sectionService(u);
  const awardsBlock = nameOnly ? '' : sectionAwards(u, acts.medal, full);

  // Cross-reference: matters before the Committee involving this operator —
  // derived at render, inherently clearance-safe (only cases already in the
  // viewer's own snapshot can appear), and shown on full-access files only.
  let mattersBlock = '';
  if (full) {
    const matters = cases().filter((c) => !c.deleted && !c.redacted
      && (c.respondentId === u.id || (c.panelIds || []).includes(u.id))
      && canViewCase(actor, c));
    if (matters.length) {
      mattersBlock = `<section class="card">
        <div class="card__title">Matters before the Committee</div>
        <div class="card__body link-list">${matters.map((c) => `<a href="#/case/${esc(c.id)}">${esc(c.ref)} \u2014 ${esc(c.title)} <span class="muted-text">(${esc(c.kind)} \u00b7 ${esc(c.status)} \u00b7 ${c.respondentId === u.id ? 'respondent' : 'panel'})</span></a>`).join('')}</div>
      </section>`;
    }
  }
  // Shared renderer for the self-service request cards (advancement, transfer).
  const requestCard = (title, r, lines, ruleBtns) => `<section class="card ${r.status === 'pending' ? 'card--alert' : ''}">
      <div class="card__title">${title} ${r.status === 'pending' ? '<span class="badge badge--warn">Pending</span>' : `<span class="badge badge--${r.status === 'declined' ? 'muted' : 'ok'}">${esc(r.status)}</span>`}</div>
      <div class="card__body">
        ${lines}
        <div class="strike__appeal-head" style="margin-top:6px">${r.status === 'pending' ? `Requested ${fmtDate(r.at)} \u2014 awaiting review` : `${esc(r.status)} by <span class="mono">${esc(r.resolvedBy || '')}</span> \u00b7 ${fmtDate(r.resolvedAt)}`}</div>
        ${r.resolution ? `<div class="strike__appeal-res">${esc(r.resolution)}</div>` : ''}
        ${r.status === 'pending' && ruleBtns ? `<div class="strike__actions">${ruleBtns}</div>` : ''}
      </div>
    </section>`;

  let advReqBlock = '';
  if (full && u.advancementRequest) {
    const r = u.advancementRequest;
    const canRule = canPromote(actor, u);
    advReqBlock = requestCard('Advancement Review Request', r,
      `<div class="muted-text">\u201c${esc(r.note || '')}\u201d</div>
       <div class="muted-text" style="margin-top:4px">Checklist items recorded: ${(u.promoChecks || []).length}</div>`,
      canRule ? `<button class="btn btn--xs" data-decline-adv>Decline</button><button class="btn btn--xs" data-action-adv>Close as actioned</button><span class="muted-text">Promoting closes this automatically.</span>` : '');
  }

  let trReqBlock = '';
  if (full && u.transferRequest) {
    const r = u.transferRequest;
    const canRule = canManageOrg(actor, u.org);
    trReqBlock = requestCard('Transfer Request', r,
      `<div>To ${orgTag(r.toOrg)} ${esc((ORGS[r.toOrg] || {}).name || r.toOrg)}</div>
       <div class="muted-text">\u201c${esc(r.note || '')}\u201d</div>`,
      canRule ? `${acts.transfer && canManageOrg(actor, r.toOrg) ? '<button class="btn btn--xs btn--primary" data-approve-transfer>Approve \u2014 open transfer</button>' : '<span class="muted-text">Approval needs authority over both organisations.</span>'}<button class="btn btn--xs" data-decline-transfer>Decline</button>` : '');
  }

  const strikesBlock = sectionStrikes(u, full, actor, full && acts.strike);

  // Leave request: visible on full-access files only (the reason is personal).
  // The operator sees their own pending/resolved request; an authority gets
  // Approve / Decline on a pending one.
  let leaveReqBlock = '';
  if (full && u.leaveRequest) {
    const r = u.leaveRequest;
    const canRule = canManageLeave(actor, u) && r.status === 'pending';
    const head = r.status === 'pending'
      ? `Requested ${fmtDate(r.at)} \u2014 awaiting review`
      : `${r.status === 'approved' ? 'Approved' : 'Declined'} by <span class="mono">${esc(r.resolvedBy || '')}</span> \u00b7 ${fmtDate(r.resolvedAt)}`;
    leaveReqBlock = `<section class="card ${r.status === 'pending' ? 'card--alert' : ''}">
      <div class="card__title">Leave Request ${r.status === 'pending' ? '<span class="badge badge--warn">Pending</span>' : `<span class="badge badge--${r.status === 'approved' ? 'ok' : 'muted'}">${esc(r.status)}</span>`}</div>
      <div class="card__body">
        <div>${esc(r.type || 'LoA')} \u00b7 ${fmtDate(r.from)} \u2013 ${fmtDate(r.to)}</div>
        <div class="muted-text">\u201c${esc(r.reason || '')}\u201d</div>
        <div class="strike__appeal-head" style="margin-top:6px">${head}</div>
        ${r.note ? `<div class="strike__appeal-res">Note: ${esc(r.note)}</div>` : ''}
        ${canRule ? `<div class="strike__actions"><button class="btn btn--xs btn--primary" data-approve-leave>Approve</button><button class="btn btn--xs" data-decline-leave>Decline</button></div>` : ''}
      </div>
    </section>`;
  }
  const leaveBlock = onLeave ? sectionLeave(u, full) : '';

  // Dual control (REC-10): a discharge is FILED by one authority and only takes
  // effect when a DIFFERENT discharging authority co-signs it. This banner is
  // the pending state; the co-sign / reject is a second person's action.
  let dischargeReqBlock = '';
  if (full && u.pendingDischarge && u.status !== 'discharged') {
    const pd = u.pendingDischarge;
    const isRequester = actor.id === pd.requestedBy;
    const canCosign = canDischarge(actor, u) && !isRequester;
    const chip = pd.type === 'dishonourable' ? '<span class="badge badge--bad">Dishonourable</span>' : '<span class="badge badge--muted">Honourable</span>';
    dischargeReqBlock = `<section class="card card--alert">
      <div class="card__title">Discharge \u2014 Second Signature Required <span class="badge badge--warn">Pending</span></div>
      <div class="card__body">
        <div>${chip} discharge</div>
        <div class="muted-text">\u201c${esc(pd.reason || '')}\u201d</div>
        <div class="strike__appeal-head" style="margin-top:6px">Filed ${fmtDate(pd.requestedAt)} by <span class="mono">${esc(pd.requestedByLabel || '')}</span></div>
        ${canCosign
          ? '<div class="strike__actions"><button class="btn btn--xs btn--danger" data-cosign-discharge>Co-sign &amp; discharge</button><button class="btn btn--xs" data-reject-discharge>Reject</button></div>'
          : (isRequester
            ? '<p class="field__hint" style="margin-top:6px">You filed this discharge. A second discharging authority must co-sign before it takes effect \u2014 you cannot co-sign your own request. <button class="btn btn--xs" data-reject-discharge style="margin-left:4px">Withdraw</button></p>'
            : '')}
      </div>
    </section>`;
  }

  const dischargeBlock = (u.status === 'discharged' && u.discharge && full) ? `
    <section class="card card--warn">
      <div class="card__title">Service Termination</div>
      <div class="card__body">
        <div class="kv"><span class="kv__k">Character</span><span class="kv__v">${u.discharge.type === 'dishonourable' ? '<span class="badge badge--bad">Dishonourable</span>' : '<span class="badge badge--muted">Honourable</span>'}</span></div>
        <div class="kv"><span class="kv__k">Filed by</span><span class="kv__v mono">${esc(u.discharge.by || '')}</span></div>
        ${u.discharge.cosignedBy ? `<div class="kv"><span class="kv__k">Co-signed by</span><span class="kv__v mono">${esc(u.discharge.cosignedBy)}</span></div>` : ''}
        <div class="kv"><span class="kv__k">Date</span><span class="kv__v">${fmtDate(u.discharge.at)}</span></div>
        <div class="kv kv--stack"><span class="kv__k">Citation</span><span class="kv__v">${esc(u.discharge.reason || '\u2014')}</span></div>
      </div>
    </section>` : '';
  const notesBlock = sectionNotes(u, full);
  const promoBlock = nameOnly ? '' : sectionPromotion(u, actor);
  const trainingBlock = nameOnly ? '' : sectionTraining(u, actor);
  const myServiceBlock = full ? sectionMyService(u, actor) : '';

  const redactBanner = nameOnly ? `
    <div class="redact-banner">
      <strong>Access restricted.</strong> Your clearance permits identity confirmation only.
      The full service record opens at CL4 with a role in this operator's organisation, or at CL5.
    </div>` : (partial ? `
    <div class="redact-banner redact-banner--soft">
      <strong>Partial access.</strong> The disciplinary record, leave details and command notes are
      sealed at your clearance. They open at CL4&middot;S within this operator's chain of command, or at CL5.
    </div>` : '');

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 ${esc(ORGS[u.org].short)} roster</button>
      <button class="btn btn--sm" id="print-record">⎙ Print</button>
      <button class="btn btn--sm" id="export-personnel">\u2913 Export record</button>
      ${full && u.accountStatus === 'active' ? '<button class="btn btn--sm" id="export-idcard">\u2913 ID card</button>' : ''}
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
          ${u.status === 'discharged' && u.discharge ? `<span class="badge badge--${u.discharge.type === 'dishonourable' ? 'bad' : 'muted'}">${u.discharge.type === 'dishonourable' ? 'Dishonourable' : 'Honourable'} discharge</span>` : ''}
          ${u.accountStatus === 'suspended' ? '<span class="badge badge--bad">Account suspended</span>' : ''}
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
      ${acts.discharge && !u.pendingDischarge ? `<button class="btn btn--sm ${u.status === 'discharged' ? '' : 'btn--danger'}" data-act="discharge">${u.status === 'discharged' ? 'Reinstate' : 'Request discharge'}</button>` : ''}
      ${acts.note ? '<button class="btn btn--sm" data-act="note">Add note</button>' : ''}
      ${acts.tags ? '<button class="btn btn--sm" data-act="tags">Manage tags</button>' : ''}
      ${acts.medal ? '<button class="btn btn--sm" data-act="medal">Award medal</button>' : ''}
      ${acts.transfer ? '<button class="btn btn--sm" data-act="transfer">Transfer unit</button>' : ''}
      ${acts.suspend ? `<button class="btn btn--sm ${u.accountStatus === 'suspended' ? '' : 'btn--danger'}" data-act="suspend">${u.accountStatus === 'suspended' ? 'Reinstate account' : 'Suspend account'}</button>` : ''}
      ${acts.requestLeave ? '<button class="btn btn--sm" data-act="request-leave">Request leave</button>' : ''}
      ${acts.requestAdvancement ? '<button class="btn btn--sm" data-act="request-advancement">Request advancement review</button>' : ''}
      ${acts.requestTransfer ? '<button class="btn btn--sm" data-act="request-transfer">Request transfer</button>' : ''}
      ${acts.del ? '<button class="btn btn--sm btn--danger" data-act="delete">Remove</button>' : ''}
    </div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Identity</div>
        <div class="card__body">${identityRows}</div>
      </section>
      <div class="dossier-col">
        ${myServiceBlock}
        ${promoBlock}
        ${leaveBlock}
        ${dischargeReqBlock}
        ${dischargeBlock}
        ${leaveReqBlock}
        ${advReqBlock}
        ${trReqBlock}
        ${strikesBlock}
        ${awardsBlock}
        ${mattersBlock}
        ${trainingBlock}
        ${serviceRecord}
        ${notesBlock}
        ${renderHistory(actor, u, 'personnel')}
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate(`#/${u.org === 'ethics-committee' ? 'ethics' : u.org}`));
  host.querySelector('#export-personnel').addEventListener('click', () => exportPersonnel(app, u));
  host.querySelector('#print-record')?.addEventListener('click', () => window.print());
  const idBtn = host.querySelector('#export-idcard');
  if (idBtn) idBtn.addEventListener('click', () => exportIdCard(app, u));

  const dispatch = {
    edit: () => openEdit(app, u),
    tags: () => openTags(app, u),
    medal: () => openAward(app, u),
    transfer: () => openTransfer(app, u),
    suspend: () => toggleSuspension(app, u),
    'request-leave': () => openRequestLeave(app, u),
    'request-advancement': () => openRequestAdvancement(app, u),
    'request-transfer': () => openRequestTransfer(app, u),
    clearance: () => openClearance(app, u),
    passphrase: () => openPassphrase(app, u),
    strike: () => openStrike(app, u),
    note: () => openNote(app, u),
    leave: () => onLeave ? returnFromLeave(app, u) : openLeave(app, u),
    discharge: () => u.status === 'discharged' ? reinstate(app, u) : openRequestDischarge(app, u),
    delete: () => removeRecord(app, u),
    promote: () => promote(app, u),
    demote: () => demote(app, u),
    'grant-training': () => openGrantTraining(app, u),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act]()));
  host.querySelectorAll('[data-revoke-training]').forEach((b) => b.addEventListener('click', () => revokeTraining(app, u, b.dataset.revokeTraining)));
  host.querySelectorAll('[data-lift-strike]').forEach((b) => b.addEventListener('click', () => liftStrike(app, u, b.dataset.liftStrike)));
  host.querySelectorAll('[data-appeal-strike]').forEach((b) => b.addEventListener('click', () => openAppealStrike(app, u, b.dataset.appealStrike)));
  host.querySelectorAll('[data-resolve-appeal]').forEach((b) => b.addEventListener('click', () => openResolveAppeal(app, u, b.dataset.resolveAppeal)));
  const coD = host.querySelector('[data-cosign-discharge]');
  if (coD) coD.addEventListener('click', () => coSignDischarge(app, u));
  const rjD = host.querySelector('[data-reject-discharge]');
  if (rjD) rjD.addEventListener('click', () => rejectDischarge(app, u));
  const apL = host.querySelector('[data-approve-leave]');
  if (apL) apL.addEventListener('click', () => resolveLeaveRequest(app, u, 'approved'));
  const dcL = host.querySelector('[data-decline-leave]');
  if (dcL) dcL.addEventListener('click', () => resolveLeaveRequest(app, u, 'declined'));
  const dcA = host.querySelector('[data-decline-adv]');
  if (dcA) dcA.addEventListener('click', () => resolveAdvancement(app, u, 'declined'));
  const acA = host.querySelector('[data-action-adv]');
  if (acA) acA.addEventListener('click', () => resolveAdvancement(app, u, 'actioned'));
  const apT = host.querySelector('[data-approve-transfer]');
  if (apT) apT.addEventListener('click', () => openTransfer(app, u, u.transferRequest && u.transferRequest.toOrg));
  const dcT = host.querySelector('[data-decline-transfer]');
  if (dcT) dcT.addEventListener('click', () => resolveTransferRequest(app, u, 'declined'));
  host.querySelectorAll('[data-remove-award]').forEach((b) => b.addEventListener('click', () => removeAward(app, u, b.dataset.removeAward)));
  host.querySelectorAll('[data-cert-award]').forEach((b) => b.addEventListener('click', () => {
    const a = (u.awards || []).find((x) => x.id === b.dataset.certAward);
    if (a) exportMedalCertificate(app, u, a);
  }));
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
  if (u.advancementRequest && u.advancementRequest.status === 'pending') {
    resolveAdvancement(app, u, 'actioned', `Promoted to ${next}.`);
  }
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

function sectionAwards(u, canManage, full) {
  if (!(u.awards || []).length) return '';
  const items = u.awards.map((a) => `
    <div class="award">
      <div class="award__title">${esc(a.title)}${full ? ` <button class="btn btn--xs" data-cert-award="${esc(a.id)}">Certificate</button>` : ''}${canManage ? ` <button class="btn btn--xs" data-remove-award="${esc(a.id)}">Remove</button>` : ''}</div>
      <div class="award__meta">${fmtDate(a.date)}${a.note ? ` \u00b7 ${esc(a.note)}` : ''}${a.by ? ` \u00b7 ${esc(a.by)}` : ''}</div>
    </div>`).join('');
  return `<section class="card"><div class="card__title">Awards & Commendations</div><div class="card__body">${items}</div></section>`;
}

// Human-readable service length from a start date to now (years + months).
function serviceDuration(fromISO) {
  if (!fromISO) return '\u2014';
  const from = new Date(fromISO).getTime();
  if (Number.isNaN(from)) return '\u2014';
  let months = Math.max(0, Math.floor((Date.now() - from) / (30.44 * 24 * 3600000)));
  const years = Math.floor(months / 12); months %= 12;
  if (!years && !months) return 'Under a month';
  return [years ? `${years} yr${years === 1 ? '' : 's'}` : '', months ? `${months} mo` : ''].filter(Boolean).join(', ');
}

// A personal at-a-glance service summary (distinct from the Service Record
// timeline below): tenure, rank longevity, decorations and standing, all derived
// from the record. Shown to full-access viewers; headed "My Service" for the
// operator viewing their own file.
function sectionMyService(u, actor) {
  const isSelf = actor && actor.id === u.id;
  const lastPromo = (u.events || []).filter((e) => e.type === 'promotion')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const inRankSince = lastPromo ? lastPromo.date : u.createdAt;
  const active = activeStrikeCount(u.strikes);
  const standing = active === 0
    ? '<span class="svc-stat__v svc-good">Good standing</span>'
    : `<span class="svc-stat__v svc-flag">${active} active</span>`;
  const stat = (label, valueHtml) => `<div class="svc-stat">${valueHtml}<div class="svc-stat__l">${label}</div></div>`;
  return `
    <section class="card card--service">
      <div class="card__title">${isSelf ? 'My Service' : 'Service Summary'}</div>
      <div class="card__body">
        <div class="svc-grid">
          ${stat('Unit', `<div class="svc-stat__v">${orgTag(u.org)} ${esc((ORGS[u.org] || {}).short || '')}</div>`)}
          ${stat('Rank', `<div class="svc-stat__v">${esc(u.rank || '\u2014')}</div>`)}
          ${stat('Clearance', `<div class="svc-stat__v">${clearanceBadge(u.clearance)}</div>`)}
          ${stat('Time in service', `<div class="svc-stat__v">${esc(serviceDuration(u.createdAt))}</div>`)}
          ${stat('Time in rank', `<div class="svc-stat__v">${esc(serviceDuration(inRankSince))}</div>`)}
          ${stat('Decorations', `<div class="svc-stat__v">${(u.awards || []).length}</div>`)}
          ${stat('Standing', standing)}
        </div>
      </div>
    </section>`;
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

function sectionStrikes(u, full, actor, canManageStrikes) {
  const count = (u.strikes || []).length;
  if (!count) return '';
  const activeCount = activeStrikeCount(u.strikes);
  const isSelf = actor && actor.id === u.id;
  let body;
  if (full) {
    body = u.strikes.map((s) => {
      const voided = strikeVoided(s);
      const active = strikeActive(s);
      // State badge: appealed-and-overturned takes precedence, then lifted, then expired.
      let badge = '';
      if (s.appeal && s.appeal.status === 'overturned') badge = ' <span class="badge badge--ok">Overturned on appeal</span>';
      else if (s.lifted) badge = ' <span class="badge badge--muted">Lifted</span>';
      else if (!active) badge = ` <span class="badge badge--muted">Expired</span>${s.appeal && s.appeal.status === 'pending' ? ' <span class="badge badge--warn">Appeal pending</span>' : ''}`;
      else if (s.appeal && s.appeal.status === 'pending') badge = ' <span class="badge badge--warn">Appeal pending</span>';
      else if (s.appeal && s.appeal.status === 'upheld') badge = ' <span class="badge badge--bad">Appeal upheld</span>';

      const expiryLine = s.expiresAt
        ? (new Date(s.expiresAt).getTime() > Date.now() ? `expires ${fmtDate(s.expiresAt)}` : `expired ${fmtDate(s.expiresAt)}`)
        : 'permanent';

      // The appeal, laid out under the strike: grounds, then the resolution.
      let appealBlock = '';
      if (s.appeal) {
        const ap = s.appeal;
        const head = ap.status === 'pending'
          ? `Appeal filed ${fmtDate(ap.at)} \u2014 awaiting a ruling.`
          : `Appeal ${ap.status} by <span class="mono">${esc(ap.resolvedBy || '')}</span> \u00b7 ${fmtDate(ap.resolvedAt)}`;
        appealBlock = `
        <div class="strike__appeal">
          <div class="strike__appeal-head">${head}</div>
          <div class="strike__appeal-text">\u201c${esc(ap.text)}\u201d</div>
          ${ap.resolution ? `<div class="strike__appeal-res">Resolution: ${esc(ap.resolution)}</div>` : ''}
        </div>`;
      }
      if (s.lifted) {
        appealBlock += `<div class="strike__appeal-res">Lifted by <span class="mono">${esc(s.lifted.by)}</span> \u00b7 ${fmtDate(s.lifted.at)}${s.lifted.note ? ` \u2014 ${esc(s.lifted.note)}` : ''}</div>`;
      }

      // Controls: the operator may appeal their own active, un-appealed strike;
      // an authority may lift, or rule a pending appeal (issuer recused).
      const recused = !isCL5(actor) && s.by && actor && actor.designation === s.by;
      const buttons = [];
      if (isSelf && active && !s.appeal) buttons.push(`<button class="btn btn--xs" data-appeal-strike="${esc(s.id)}">Appeal</button>`);
      if (canManageStrikes && s.appeal && s.appeal.status === 'pending') {
        buttons.push(recused
          ? '<span class="muted-text">Recused \u2014 issuing authority</span>'
          : `<button class="btn btn--xs btn--primary" data-resolve-appeal="${esc(s.id)}">Rule on appeal</button>`);
      }
      if (canManageStrikes && active && !s.lifted) buttons.push(`<button class="btn btn--xs" data-lift-strike="${esc(s.id)}">Lift</button>`);

      return `
      <div class="strike ${voided || !active ? 'strike--expired' : ''}">
        <div class="strike__reason">${esc(s.reason)}${badge}</div>
        <div class="strike__meta">${fmtDate(s.date)} \u00b7 issued by <span class="mono">${esc(s.by)}</span> \u00b7 ${esc(expiryLine)}</div>
        ${appealBlock}
        ${buttons.length ? `<div class="strike__actions">${buttons.join(' ')}</div>` : ''}
      </div>`;
    }).join('');
  } else {
    body = `<div class="restricted-line">${activeCount} active strike${activeCount === 1 ? '' : 's'} on file \u2014 detail ${redacted(10)}</div>`;
  }
  const flagged = activeCount >= STRIKE_LIMIT;
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

async function removeAward(app, u, awardId) {
  const a = (u.awards || []).find((x) => x.id === awardId);
  if (!a) return;
  const ok = await confirmDialog({ title: 'Remove award', message: `Remove \u201c${a.title}\u201d from ${u.designation}'s record?`, confirmLabel: 'Remove', danger: true });
  if (!ok) return;
  mutate(app, u.id, u.version, (r) => {
    r.awards = (r.awards || []).filter((x) => x.id !== awardId);
    addEvent(r, 'award', `Award removed: ${a.title}.`);
  }, { action: 'SET_AWARDS', detail: `Removed award from ${u.designation}.` });
  toast('Award removed.', 'success');
}

// Award a medal from the organisation's catalogue (or a one-off commendation).
function openAward(app, u) {
  const rec = getSetting(MEDALS_SETTING_ID);
  const cat = normalizeMedalCatalog(rec && rec.data);
  const medals = cat[u.org] || [];
  const opts = medals.length
    ? `<option value="">\u2014 select a medal \u2014</option>${medals.map((m) => `<option value="${esc(m.id)}" data-label="${esc(m.label)}">${esc(m.label)}</option>`).join('')}<option value="__custom">Other / one-off commendation\u2026</option>`
    : '<option value="__custom">One-off commendation (no catalogue medals defined)</option>';
  const body = `
    <p class="modal__message">Award a decoration to ${esc(u.designation)}. Medals for ${esc(ORGS[u.org].short)} are defined in Administration \u2192 Medals.</p>
    <div class="field"><label>Medal</label><select id="aw-medal">${opts}</select></div>
    <div class="field" id="aw-custom-wrap" hidden><label>Commendation title</label><input id="aw-custom" type="text" placeholder="e.g. Commendation for Valour" maxlength="80" /></div>
    <div class="field"><label>Citation <span class="muted-text">(optional)</span></label><textarea id="aw-note" rows="2" placeholder="Reason for the award\u2026"></textarea></div>`;
  const dlg = openModal({
    title: `Award medal \u2014 ${u.designation}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Award', tone: 'primary', onClick: (c, d) => {
          const sel = d.querySelector('#aw-medal');
          const val = sel.value;
          const note = d.querySelector('#aw-note').value.trim();
          let title; let medalId = null;
          if (val === '__custom' || !medals.length) {
            title = d.querySelector('#aw-custom').value.trim();
            if (!title) { toast('Enter a commendation title.', 'error'); return; }
          } else if (val) {
            const m = medals.find((x) => x.id === val);
            title = m ? m.label : null; medalId = m ? m.id : null;
            if (!title) { toast('Select a medal.', 'error'); return; }
          } else { toast('Select a medal.', 'error'); return; }
          mutate(app, u.id, u.version, (r) => {
            r.awards = r.awards || [];
            r.awards.push({ id: newId('awd'), title, note, medalId, date: new Date().toISOString(), by: app.user.designation });
            addEvent(r, 'award', `Awarded: ${title}.`);
          }, { action: 'SET_AWARDS', detail: `Awarded ${title} to ${u.designation}.` });
          c();
          toast('Medal awarded.', 'success');
        } },
    ],
  });
  // Toggle the custom-title field.
  const selEl = dlg && dlg.querySelector('#aw-medal');
  if (selEl) selEl.addEventListener('change', () => {
    const wrap = dlg.querySelector('#aw-custom-wrap');
    if (wrap) wrap.hidden = selEl.value !== '__custom';
  });
}

// Mint the next free designation for an organisation (e.g. O1-5, EC-9).
function nextDesignationFor(org) {
  const prefix = org === 'omega-1' ? 'O1' : org === 'ethics-committee' ? 'EC' : 'CMD';
  const nums = users()
    .filter((x) => x.org === org && /-(\d+)$/.test(x.designation || ''))
    .map((x) => parseInt(x.designation.split('-')[1], 10));
  return `${prefix}-${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

// Suspend or reinstate an account: sign-in is refused and live sessions are
// dropped while suspended; the personnel record itself is untouched.
async function toggleSuspension(app, u) {
  const actor = app.user;
  const suspending = u.accountStatus !== 'suspended';
  const ok = await confirmDialog({
    title: suspending ? 'Suspend account' : 'Reinstate account',
    message: suspending
      ? `Suspend ${u.designation} \u00b7 ${u.codename}? They will be signed out everywhere and unable to sign in until reinstated. Their record, rank and history are untouched.`
      : `Reinstate ${u.designation} \u00b7 ${u.codename}? They will be able to sign in again immediately.`,
    confirmLabel: suspending ? 'Suspend account' : 'Reinstate account',
    danger: suspending,
  });
  if (!ok) return;
  mutate(app, u.id, u.version, (rec) => {
    rec.accountStatus = suspending ? 'suspended' : 'active';
    addEvent(rec, 'security', suspending
      ? `Account suspended by ${actor.designation}.`
      : `Account reinstated by ${actor.designation}.`);
  }, { action: suspending ? 'SUSPEND_ACCOUNT' : 'REINSTATE_ACCOUNT', detail: `${u.designation} ${suspending ? 'suspended' : 'reinstated'}.` });
  toast(suspending ? 'Account suspended \u2014 all sessions ended.' : 'Account reinstated.', 'success');
}

// Transfer an operator to another organisation. Re-slots rank + clearance for the
// new ladder, re-mints the designation, resets the promotion checklist, and
// records the move. Disciplinary history, tags and awards carry over unchanged.
function openTransfer(app, u, presetOrg) {
  const actor = app.user;
  const dests = Object.keys(ORGS).filter((o) => o !== u.org && canManageOrg(actor, o));
  if (!dests.length) { toast('There is no destination organisation you can manage.', 'error'); return; }
  const rankOptionsFor = (o) => (RANKS[o] || []).map((r) => {
    const clr = clearanceForRank(o, r);
    return `<option value="${esc(r)}">${esc(r)}${clr ? ` \u2014 ${esc(clr)}` : ''}</option>`;
  }).join('');

  const body = `
    <p class="modal__message">Transfer <strong>${esc(u.designation)} \u00b7 ${esc(u.codename)}</strong> from ${esc(ORGS[u.org].short)} to another organisation. A new designation is issued; strikes, tags and awards carry over; the promotion checklist resets.</p>
    <div class="field"><label>Destination organisation</label><select id="tr-org">${dests.map((o) => `<option value="${o}" ${o === presetOrg ? 'selected' : ''}>${esc(ORGS[o].name)}</option>`).join('')}</select></div>
    <div class="field"><label>New rank</label><select id="tr-rank">${rankOptionsFor(dests[0])}</select></div>
    <div class="field"><label>Clearance</label><input id="tr-clr" type="text" readonly /><div class="field__hint">Set automatically from the new rank.</div></div>
    <div class="ntk-banner" style="border-color:var(--warn)"><strong>Reminder:</strong> a transfer does not remove this operator from their current unit's Need-To-Know compartments. Review and read them out manually if that access should not follow them.</div>
    <div id="tr-err" class="auth__error" hidden></div>`;

  const dlg = openModal({
    title: `Transfer \u2014 ${u.designation}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Transfer', tone: 'primary', onClick: (c, d) => {
          const org = d.querySelector('#tr-org').value;
          const rank = d.querySelector('#tr-rank').value;
          const clr = clearanceForRank(org, rank);
          const err = d.querySelector('#tr-err');
          err.hidden = true;
          if (!canManageOrg(actor, org)) { err.textContent = 'You cannot manage that organisation.'; err.hidden = false; return; }
          if (!(RANKS[org] || []).includes(rank)) { err.textContent = 'Select a valid rank for the destination.'; err.hidden = false; return; }
          if (clr && (CLEARANCES[clr]?.weight || 0) > (CLEARANCES[actor.clearance]?.weight || 0) && !isCL5(actor)) {
            err.textContent = 'That rank\u2019s clearance is above your own ceiling.'; err.hidden = false; return;
          }
          const designation = nextDesignationFor(org);
          const fromOrg = u.org; const fromDesig = u.designation;
          mutate(app, u.id, u.version, (rec) => {
            rec.org = org;
            rec.rank = rank;
            if (clr) rec.clearance = clr;
            rec.designation = designation;
            rec.promoChecks = [];
            addEvent(rec, 'appointment', `Transferred from ${ORGS[fromOrg].short} (${fromDesig}) to ${ORGS[org].short}; assigned ${rank}${clr ? `, ${CLEARANCES[clr].label}` : ''}.`);
          }, { action: 'TRANSFER_UNIT', detail: `${fromDesig} transferred to ${ORGS[org].short} as ${designation}.` });
          if (u.transferRequest && u.transferRequest.status === 'pending') {
            resolveTransferRequest(app, u, 'transferred', `Transferred to ${ORGS[org].short} as ${designation}.`);
          }
          c();
          toast(`Transferred to ${ORGS[org].short} as ${designation}. Review compartment access.`, 'success', 5200);
          app.navigate(`#/personnel/${u.id}`);
        } },
    ],
  });

  const orgSel = dlg.querySelector('#tr-org');
  const rankSel = dlg.querySelector('#tr-rank');
  const clrField = dlg.querySelector('#tr-clr');
  const syncClr = () => { const clr = clearanceForRank(orgSel.value, rankSel.value); clrField.value = clr ? CLEARANCES[clr].label : '\u2014'; };
  orgSel.addEventListener('change', () => { rankSel.innerHTML = rankOptionsFor(orgSel.value); syncClr(); });
  rankSel.addEventListener('change', syncClr);
  syncClr();
}

// Assign catalogue tags to an operator via checkboxes.
function openTags(app, u) {
  const cat = tagCatalog();
  if (!cat.length) {
    toast('No tags defined yet. Create them in Administration \u2192 Personnel Tags.', 'info');
    return;
  }
  const held = new Set(Array.isArray(u.tags) ? u.tags : []);
  const body = `
    <p class="modal__message">Assign tags to ${esc(u.designation)}. Tags are defined in Administration.</p>
    <div class="tag-pick">
      ${cat.map((t) => `
        <label class="check-line">
          <input type="checkbox" value="${esc(t.id)}" ${held.has(t.id) ? 'checked' : ''} />
          <span class="badge tag-badge tag-badge--${esc(t.color)}">${esc(t.label)}</span>
        </label>`).join('')}
    </div>`;
  openModal({
    title: `Tags \u2014 ${u.designation}`,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save tags', tone: 'primary', onClick: (c, d) => {
          const chosen = [...d.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
          // Keep only ids that exist in the catalogue, preserving catalogue order.
          const next = cat.filter((t) => chosen.includes(t.id)).map((t) => t.id);
          mutate(app, u.id, u.version, (rec) => {
            rec.tags = next;
            addEvent(rec, 'edit', `Tags updated (${next.length ? cat.filter((t) => next.includes(t.id)).map((t) => t.label).join(', ') : 'none'}).`);
          }, { action: 'SET_TAGS', detail: `Tags updated on ${u.designation}.` });
          c();
          toast('Tags updated.', 'success');
        } },
    ],
  });
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
              toast('Their sessions were ended; they must set a new passphrase at next sign-in.', 'info', 5200);
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
export function openChangePassphrase(app, opts = {}) {
  const me = app.user;
  const forced = !!opts.forced;
  const body = `
    ${forced ? '<div class="ntk-banner" style="border-color:var(--warn)"><strong>Action required:</strong> an administrator has reset your passphrase. Set a new one of your own to continue \u2014 the temporary passphrase goes in \u201cCurrent passphrase\u201d.</div>' : ''}
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
  const dlg = openModal({
    title: forced ? 'Set a new passphrase' : 'Change passphrase',
    body,
    actions: [
      ...(forced ? [] : [{ label: 'Cancel', tone: 'ghost', onClick: (c) => c() }]),
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
            // The server clears the forced-change requirement when the operator
            // sets their own passphrase; mirror that locally at once.
            if (app.user) app.user.mustChangePassphrase = false;
            const mine = getUser(me.id);
            if (mine && mine.mustChangePassphrase) { mine.mustChangePassphrase = false; }
            c();
            toast('Your passphrase has been changed.', 'success');
            if (forced) app.refresh();
          } catch (e) {
            err.textContent = (e && e.message) || 'Could not change the passphrase.'; err.hidden = false;
          }
        } },
    ],
  });
  bindSignOutAll(dlg);
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
    body: `
      <div class="field"><label>Reason</label><textarea id="st-reason" rows="3" placeholder="State the infraction\u2026"></textarea></div>
      <div class="field"><label>Expires <span class="muted-text">(optional \u2014 leave blank for a permanent strike)</span></label><input id="st-expiry" type="date" /></div>
      <div class="field__hint">An expired strike stays on the record as history but no longer counts toward the ${STRIKE_LIMIT}-strike limit.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Record strike', tone: 'danger', onClick: (c, d) => {
          const reason = d.querySelector('#st-reason').value.trim();
          if (!reason) { toast('A reason is required.', 'error'); return; }
          const expRaw = d.querySelector('#st-expiry').value;
          const expiresAt = expRaw ? new Date(`${expRaw}T23:59:59`).toISOString() : null;
          let count = 0;
          mutate(app, u.id, u.version, (rec) => {
            rec.strikes = rec.strikes || [];
            rec.strikes.push({ id: newId('stk'), reason, date: new Date().toISOString(), by: app.user.designation, expiresAt });
            count = activeStrikeCount(rec.strikes);
            addEvent(rec, 'strike', `Strike recorded: ${reason}${expiresAt ? ` (expires ${fmtDate(expiresAt)})` : ''}`);
          }, { action: 'ADD_STRIKE', detail: `Strike on ${u.designation}.` });
          c();
          if (count >= STRIKE_LIMIT) toast(`Strike recorded \u2014 ${u.designation} is now at the ${STRIKE_LIMIT}-strike limit.`, 'warn', 4500);
          else toast('Strike recorded.', 'success');
        } },
    ],
  });
}

function liftStrike(app, u, strikeId) {
  const actor = app.user;
  if (!canIssueStrike(actor, u)) { toast('You cannot amend this operator\u2019s record.', 'error'); return; }
  const strike = (u.strikes || []).find((s) => s.id === strikeId);
  if (!strike || strike.lifted) return;
  openModal({
    title: `Lift strike \u2014 ${u.designation}`,
    body: `
      <p class="modal__message">Lift this strike? It remains on the record, marked as lifted, and no longer counts toward the ${STRIKE_LIMIT}-strike limit. Nothing on a disciplinary record is erased.</p>
      <div class="field"><label>Note <span class="muted-text">(optional \u2014 recorded with the lift)</span></label><textarea id="ls-note" rows="2" placeholder="Reason for lifting\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Lift strike', tone: 'danger', onClick: (c, d) => {
          const note = d.querySelector('#ls-note').value.trim();
          mutate(app, u.id, u.version, (rec) => {
            rec.strikes = (rec.strikes || []).map((x) => (x.id === strikeId
              ? { ...x, lifted: { by: actor.designation, at: new Date().toISOString(), note: note || null } }
              : x));
            addEvent(rec, 'strike', `Strike lifted: ${strike.reason}${note ? ` \u2014 ${note}` : ''}`);
          }, { action: 'LIFT_STRIKE', detail: `Strike lifted for ${u.designation}.` });
          c();
          toast('Strike lifted \u2014 it stays on the record as history.', 'success');
        } },
    ],
  });
}

// The struck operator files an appeal against their own active strike. One
// appeal per strike; the grounds become immutable once filed.
function openAppealStrike(app, u, strikeId) {
  const actor = app.user;
  const strike = (u.strikes || []).find((s) => s.id === strikeId);
  if (!strike || strike.appeal || actor.id !== u.id || !strikeActive(strike)) return;
  openModal({
    title: 'Appeal strike',
    wide: true,
    body: `
      <p class="modal__message">You are appealing the strike issued ${fmtDate(strike.date)} by <span class="mono">${esc(strike.by)}</span>: \u201c${esc(strike.reason)}\u201d.</p>
      <div class="field"><label>Grounds of appeal</label><textarea id="ap-grounds" rows="4" placeholder="State why this strike should be overturned\u2026"></textarea></div>
      <div class="field__hint">Your grounds cannot be edited once filed. An authority other than the issuer will rule on the appeal; the outcome is recorded either way.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'File appeal', tone: 'primary', onClick: (c, d) => {
          const text = d.querySelector('#ap-grounds').value.trim();
          if (!text) { toast('State the grounds of your appeal.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.strikes = (rec.strikes || []).map((x) => (x.id === strikeId
              ? { ...x, appeal: { text, at: new Date().toISOString(), status: 'pending' } }
              : x));
            addEvent(rec, 'strike', 'Appeal filed against a strike.');
          }, { action: 'APPEAL_STRIKE', detail: `${u.designation} appealed a strike.` });
          c();
          toast('Appeal filed \u2014 awaiting a ruling.', 'success');
        } },
    ],
  });
}

// An authority rules on a pending appeal. The issuing authority is recused
// (CL5, as Command, may always rule). Overturning voids the strike in place.
function openResolveAppeal(app, u, strikeId) {
  const actor = app.user;
  const strike = (u.strikes || []).find((s) => s.id === strikeId);
  if (!strike || !strike.appeal || strike.appeal.status !== 'pending') return;
  if (!canIssueStrike(actor, u)) { toast('You cannot rule on this appeal.', 'error'); return; }
  if (!isCL5(actor) && strike.by && actor.designation === strike.by) {
    toast('You issued this strike \u2014 another authority must rule on the appeal.', 'error');
    return;
  }
  openModal({
    title: `Rule on appeal \u2014 ${u.designation}`,
    wide: true,
    body: `
      <p class="modal__message">Strike (${fmtDate(strike.date)}, issued by <span class="mono">${esc(strike.by)}</span>): \u201c${esc(strike.reason)}\u201d</p>
      <p class="modal__message">Grounds of appeal: \u201c${esc(strike.appeal.text)}\u201d</p>
      <label class="radio-row"><input type="radio" name="ap-ruling" value="overturned" checked /> <span><strong>Overturn</strong> \u2014 the appeal succeeds. The strike stays on the record marked \u201cOverturned on appeal\u201d and no longer counts.</span></label>
      <label class="radio-row"><input type="radio" name="ap-ruling" value="upheld" /> <span><strong>Uphold</strong> \u2014 the strike stands. The appeal and this ruling remain on the record.</span></label>
      <div class="field" style="margin-top:10px"><label>Resolution</label><textarea id="ap-res" rows="3" placeholder="Reasoning for the ruling\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Enter ruling', tone: 'primary', onClick: (c, d) => {
          const ruling = (d.querySelector('input[name="ap-ruling"]:checked') || {}).value;
          const resolution = d.querySelector('#ap-res').value.trim();
          if (!resolution) { toast('A ruling must state its reasoning.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.strikes = (rec.strikes || []).map((x) => (x.id === strikeId
              ? { ...x, appeal: { ...x.appeal, status: ruling, resolvedBy: actor.designation, resolvedAt: new Date().toISOString(), resolution } }
              : x));
            addEvent(rec, 'strike', `Strike appeal ${ruling}: ${resolution}`);
          }, { action: 'RESOLVE_APPEAL', detail: `Appeal ${ruling} for ${u.designation}.` });
          c();
          toast(ruling === 'overturned' ? 'Appeal overturned \u2014 the strike is voided but remains on record.' : 'Appeal upheld \u2014 the strike stands.', 'success');
        } },
    ],
  });
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

// The operator asks their chain to review the promotion checklist.
function openRequestAdvancement(app, u) {
  openModal({
    title: 'Request advancement review',
    body: `
      <p class="modal__message">Ask your chain of command to review you for advancement from <strong>${esc(u.rank || '')}</strong>. Your checklist currently records ${(u.promoChecks || []).length} completed item${(u.promoChecks || []).length === 1 ? '' : 's'}.</p>
      <div class="field"><label>Your case</label><textarea id="ra-note" rows="3" placeholder="Why you believe you are ready\u2026"></textarea></div>
      <div class="field__hint">Immutable once filed; the outcome lands in your notifications.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Submit request', tone: 'primary', onClick: (c, d) => {
          const note = d.querySelector('#ra-note').value.trim();
          if (!note) { toast('State your case.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.advancementRequest = { note, at: new Date().toISOString(), status: 'pending' };
            addEvent(rec, 'appointment', 'Advancement review requested.');
          }, { action: 'REQUEST_ADVANCEMENT', detail: `${u.designation} requested an advancement review.` });
          c(); toast('Request submitted \u2014 awaiting review.', 'success');
        } },
    ],
  });
}

function resolveAdvancement(app, u, ruling, autoNote) {
  const actor = app.user;
  const r = u.advancementRequest;
  if (!r || r.status !== 'pending' || !canPromote(actor, u)) return;
  const finish = (resolution) => {
    const fresh = getUser(u.id);
    if (!fresh || !fresh.advancementRequest || fresh.advancementRequest.status !== 'pending') return;
    mutate(app, fresh.id, fresh.version, (rec) => {
      rec.advancementRequest = { ...rec.advancementRequest, status: ruling, resolvedBy: actor.designation, resolvedAt: new Date().toISOString(), resolution: resolution || null };
      addEvent(rec, 'appointment', `Advancement review ${ruling}.`);
    }, { action: 'RESOLVE_ADVANCEMENT', detail: `Advancement review ${ruling} for ${u.designation}.` });
  };
  if (autoNote !== undefined) { finish(autoNote); return; }
  openModal({
    title: ruling === 'declined' ? 'Decline advancement request' : 'Close advancement request',
    body: `<p class="modal__message">\u201c${esc(r.note)}\u201d \u2014 requested ${fmtDate(r.at)}.</p>
      <div class="field"><label>Resolution <span class="muted-text">(optional)</span></label><textarea id="rv-adv" rows="2"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: ruling === 'declined' ? 'Decline' : 'Close as actioned', tone: ruling === 'declined' ? 'danger' : 'primary', onClick: (c, d) => {
          finish(d.querySelector('#rv-adv').value.trim());
          c(); toast(ruling === 'declined' ? 'Request declined.' : 'Request closed.', 'success');
        } },
    ],
  });
}

// The operator asks to move units; approval runs the real transfer.
function openRequestTransfer(app, u) {
  const dests = Object.keys(ORGS).filter((o) => o !== u.org);
  openModal({
    title: 'Request transfer',
    body: `
      <div class="field"><label>Destination organisation</label><select id="rt-org">${dests.map((o) => `<option value="${o}">${esc(ORGS[o].name)}</option>`).join('')}</select></div>
      <div class="field"><label>Reason</label><textarea id="rt-note" rows="3" placeholder="Why you are requesting the move\u2026"></textarea></div>
      <div class="field__hint">A transfer needs approval by an authority over both organisations. Immutable once filed.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Submit request', tone: 'primary', onClick: (c, d) => {
          const toOrg = d.querySelector('#rt-org').value;
          const note = d.querySelector('#rt-note').value.trim();
          if (!note) { toast('State your reason.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.transferRequest = { toOrg, note, at: new Date().toISOString(), status: 'pending' };
            addEvent(rec, 'appointment', `Transfer to ${ORGS[toOrg].short} requested.`);
          }, { action: 'REQUEST_TRANSFER', detail: `${u.designation} requested transfer to ${ORGS[toOrg].short}.` });
          c(); toast('Request submitted \u2014 awaiting review.', 'success');
        } },
    ],
  });
}

function resolveTransferRequest(app, u, ruling, autoNote) {
  const actor = app.user;
  const finish = (resolution) => {
    const fresh = getUser(u.id);
    if (!fresh || !fresh.transferRequest || fresh.transferRequest.status !== 'pending') return;
    mutate(app, fresh.id, fresh.version, (rec) => {
      rec.transferRequest = { ...rec.transferRequest, status: ruling, resolvedBy: actor.designation, resolvedAt: new Date().toISOString(), resolution: resolution || null };
      addEvent(rec, 'appointment', `Transfer request ${ruling}.`);
    }, { action: 'RESOLVE_TRANSFER_REQUEST', detail: `Transfer request ${ruling} for ${u.designation}.` });
  };
  if (autoNote !== undefined) { finish(autoNote); return; }
  const r = u.transferRequest;
  if (!r || r.status !== 'pending' || !canManageOrg(actor, u.org)) return;
  openModal({
    title: 'Decline transfer request',
    body: `<p class="modal__message">To ${esc((ORGS[r.toOrg] || {}).name || r.toOrg)}: \u201c${esc(r.note)}\u201d</p>
      <div class="field"><label>Resolution <span class="muted-text">(optional)</span></label><textarea id="rv-tr" rows="2"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Decline', tone: 'danger', onClick: (c, d) => { finish(d.querySelector('#rv-tr').value.trim()); c(); toast('Request declined.', 'success'); } },
    ],
  });
}

// The operator requests their own leave; an authority answers from the same
// card or from Notifications. The request's substance is immutable once filed.
function openRequestLeave(app, u) {
  const today = new Date().toISOString().slice(0, 10);
  openModal({
    title: 'Request leave',
    body: `
      ${fieldSelect('rl-type', 'Leave type', ['LoA', 'RoA'], 'LoA')}
      <div class="field"><label>From</label><input id="rl-from" type="date" value="${today}" /></div>
      <div class="field"><label>Until</label><input id="rl-to" type="date" value="${today}" /></div>
      <div class="field"><label>Reason</label><textarea id="rl-reason" rows="2" placeholder="Visible to full-access reviewers only\u2026"></textarea></div>
      <div class="field__hint">Your request cannot be edited once filed \u2014 an authority will approve or decline it, and the outcome lands in your notifications.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Submit request', tone: 'primary', onClick: (c, d) => {
          const type = d.querySelector('#rl-type').value;
          const from = d.querySelector('#rl-from').value;
          const to = d.querySelector('#rl-to').value;
          const reason = d.querySelector('#rl-reason').value.trim();
          if (!from || !to || to < from) { toast('Enter a valid date range.', 'error'); return; }
          if (!reason) { toast('State the reason for your leave.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.leaveRequest = { type, from, to, reason, at: new Date().toISOString(), status: 'pending' };
            addEvent(rec, 'leave', `Leave requested (${fmtDate(from)} \u2013 ${fmtDate(to)}).`);
          }, { action: 'REQUEST_LEAVE', detail: `${u.designation} requested leave.` });
          c();
          toast('Leave request submitted \u2014 awaiting review.', 'success');
        } },
    ],
  });
}

function resolveLeaveRequest(app, u, ruling) {
  const actor = app.user;
  const r = u.leaveRequest;
  if (!r || r.status !== 'pending' || !canManageLeave(actor, u)) return;
  const approving = ruling === 'approved';
  openModal({
    title: approving ? 'Approve leave request' : 'Decline leave request',
    body: `
      <p class="modal__message">${esc(u.designation)} \u00b7 ${esc(u.codename)} requests ${esc(r.type || 'LoA')} ${fmtDate(r.from)} \u2013 ${fmtDate(r.to)}: \u201c${esc(r.reason)}\u201d</p>
      ${approving ? `
      <div class="field"><label>From</label><input id="rv-from" type="date" value="${esc(r.from)}" /></div>
      <div class="field"><label>Until</label><input id="rv-to" type="date" value="${esc(r.to)}" /></div>
      <div class="field__hint">Adjust the dates if needed \u2014 the record keeps both what was asked and what was granted.</div>` : ''}
      <div class="field"><label>Note <span class="muted-text">(optional)</span></label><textarea id="rv-note" rows="2"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: approving ? 'Approve \u2014 place on leave' : 'Decline request', tone: approving ? 'primary' : 'danger', onClick: (c, d) => {
          const note = d.querySelector('#rv-note').value.trim();
          let from = r.from; let to = r.to;
          if (approving) {
            from = d.querySelector('#rv-from').value || r.from;
            to = d.querySelector('#rv-to').value || r.to;
            if (to < from) { toast('Enter a valid date range.', 'error'); return; }
          }
          mutate(app, u.id, u.version, (rec) => {
            rec.leaveRequest = { ...rec.leaveRequest, status: ruling, resolvedBy: actor.designation, resolvedAt: new Date().toISOString(), note: note || null };
            if (approving) {
              rec.leave = { type: r.type || 'LoA', from, to, reason: r.reason };
              rec.status = 'loa';
              addEvent(rec, 'leave', `Leave request approved; placed on ${r.type || 'LoA'} (${fmtDate(from)} \u2013 ${fmtDate(to)}).`);
            } else {
              addEvent(rec, 'leave', 'Leave request declined.');
            }
          }, { action: 'RESOLVE_LEAVE_REQUEST', detail: `Leave request ${ruling} for ${u.designation}.` });
          c();
          toast(approving ? 'Approved \u2014 operator placed on leave.' : 'Request declined.', 'success');
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
          const pendingReq = u.leaveRequest && u.leaveRequest.status === 'pending';
          mutate(app, u.id, u.version, (rec) => {
            // Direct placement while a request is pending counts as approving it,
            // so the request never lingers unresolved in anyone's notifications.
            if (rec.leaveRequest && rec.leaveRequest.status === 'pending') {
              rec.leaveRequest = { ...rec.leaveRequest, status: 'approved', resolvedBy: app.user.designation, resolvedAt: new Date().toISOString(), note: 'Approved by direct placement.' };
            }
            rec.leave = { type, from, to, reason };
            rec.status = 'loa';
            addEvent(rec, 'leave', `Placed on ${type} (${fmtDate(from)} \u2013 ${fmtDate(to)}).`);
          }, { action: pendingReq ? 'RESOLVE_LEAVE_REQUEST' : 'SET_LEAVE', detail: `${u.designation} placed on leave.` });
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

// Discharge an operator, honourably or dishonourably. The character of the
// discharge and a citation are recorded; the record stays on file (discharged
// personnel drop out of active rosters but the dossier is preserved).
// Dual control (REC-10): discharge is a two-signature action. This FILES it;
// it does not take effect until a different discharging authority co-signs.
function openRequestDischarge(app, u) {
  const actor = app.user;
  if (u.pendingDischarge) { toast('A discharge is already filed and awaiting co-signature.', 'error'); return; }
  openModal({
    title: `Request discharge \u2014 ${u.designation}`,
    wide: true,
    body: `
      <p class="modal__message">File a discharge for <strong>${esc(u.designation)} \u00b7 ${esc(u.codename)}</strong> from ${esc(ORGS[u.org].short)}. This does <strong>not</strong> take effect immediately \u2014 a second discharging authority must co-sign it, and you cannot co-sign your own request.</p>
      <label class="radio-row"><input type="radio" name="dc-type" value="honourable" checked /> <span><strong>Honourable discharge</strong> \u2014 service concluded in good standing.</span></label>
      <label class="radio-row"><input type="radio" name="dc-type" value="dishonourable" /> <span><strong>Dishonourable discharge</strong> \u2014 service terminated for cause.</span></label>
      <div class="field" style="margin-top:10px"><label>Citation / grounds</label><textarea id="dc-reason" rows="3" placeholder="Reason for discharge (recorded on the service record)\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'File for co-signature', tone: 'primary', onClick: (c, d) => {
          const type = (d.querySelector('input[name="dc-type"]:checked') || {}).value;
          const reason = d.querySelector('#dc-reason').value.trim();
          if (!reason) { toast('Record the grounds for discharge.', 'error'); return; }
          mutate(app, u.id, u.version, (rec) => {
            rec.pendingDischarge = { type, reason, requestedBy: actor.id, requestedByLabel: actor.designation, requestedAt: new Date().toISOString(), status: 'pending' };
            addEvent(rec, 'edit', `Discharge (${type}) filed for co-signature by ${actor.designation}: ${reason}`);
          }, { action: 'REQUEST_DISCHARGE', detail: `${u.designation} \u2014 discharge filed for second signature.` });
          c();
          toast('Discharge filed \u2014 awaiting a second signature.', 'success');
        } },
    ],
  });
}

// The second signature: a DIFFERENT discharging authority enacts the filed
// discharge. Self-co-signing is refused here and, decisively, in the Worker gate.
async function coSignDischarge(app, u) {
  const actor = app.user;
  const pd = u.pendingDischarge;
  if (!pd) return;
  if (actor.id === pd.requestedBy) { toast('You filed this discharge \u2014 a different authority must co-sign it.', 'error'); return; }
  if (!canDischarge(actor, u)) { toast('You are not a discharging authority for this operator.', 'error'); return; }
  const ok = await confirmDialog({
    title: 'Co-sign discharge',
    message: `Co-sign and enact the ${pd.type} discharge of ${u.designation} \u00b7 ${u.codename}? Filed by ${pd.requestedByLabel}. This takes effect immediately.`,
    confirmLabel: 'Co-sign & discharge', danger: true,
  });
  if (!ok) return;
  mutate(app, u.id, u.version, (rec) => {
    rec.status = 'discharged';
    rec.discharge = { type: pd.type, by: pd.requestedByLabel, cosignedBy: actor.designation, at: new Date().toISOString(), reason: pd.reason };
    rec.pendingDischarge = null;
    rec.leave = null;
    addEvent(rec, 'edit', `${pd.type === 'honourable' ? 'Honourably' : 'Dishonourably'} discharged \u2014 filed by ${pd.requestedByLabel}, co-signed by ${actor.designation}: ${pd.reason}`);
  }, { action: 'DISCHARGE', detail: `${u.designation} discharged (${pd.type}) \u2014 co-signed.` });
  toast('Discharge co-signed and enacted.', 'success');
}

// Reject a pending discharge. A different authority rejects it; the requester
// may withdraw their own. Either way, no one is discharged.
async function rejectDischarge(app, u) {
  const actor = app.user;
  const pd = u.pendingDischarge;
  if (!pd) return;
  const mine = actor.id === pd.requestedBy;
  if (!mine && !canDischarge(actor, u)) { toast('You cannot act on this pending discharge.', 'error'); return; }
  const ok = await confirmDialog({
    title: mine ? 'Withdraw discharge' : 'Reject discharge',
    message: mine
      ? `Withdraw your pending ${pd.type} discharge of ${u.designation}?`
      : `Reject the pending ${pd.type} discharge of ${u.designation} filed by ${pd.requestedByLabel}?`,
    confirmLabel: mine ? 'Withdraw' : 'Reject discharge',
  });
  if (!ok) return;
  mutate(app, u.id, u.version, (rec) => {
    rec.pendingDischarge = null;
    addEvent(rec, 'edit', mine
      ? `Pending discharge withdrawn by ${actor.designation}.`
      : `Pending discharge (filed by ${pd.requestedByLabel}) rejected by ${actor.designation}.`);
  }, { action: 'REJECT_DISCHARGE', detail: `${u.designation} \u2014 pending discharge ${mine ? 'withdrawn' : 'rejected'}.` });
  toast(mine ? 'Discharge withdrawn.' : 'Pending discharge rejected.', 'success');
}

async function reinstate(app, u) {
  const actor = app.user;
  const ok = await confirmDialog({
    title: 'Reinstate to duty',
    message: `Reinstate ${u.designation} \u00b7 ${u.codename} to active duty? The prior discharge remains on the service record.`,
    confirmLabel: 'Reinstate',
  });
  if (!ok) return;
  mutate(app, u.id, u.version, (rec) => {
    rec.status = 'active';
    rec.discharge = null;
    addEvent(rec, 'edit', `Reinstated to active duty by ${actor.designation}.`);
  }, { action: 'REINSTATE', detail: `${u.designation} reinstated.` });
  toast('Operator reinstated to active duty.', 'success');
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
