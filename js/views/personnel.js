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
} from '../constants.js';
import { users, getUser, upsertUser, newId } from '../storage.js';
import {
  canEditPersonnel, canSetClearance, canSetRank, canIssueStrike,
  canDeletePersonnel, accessLevel, isCL5,
} from '../permissions.js';
import { logAction } from '../audit.js';
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
  const strikesBlock = sectionStrikes(u, full);
  const leaveBlock = onLeave ? sectionLeave(u, full) : '';
  const notesBlock = sectionNotes(u, full);

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
    <button class="btn btn--ghost btn--sm" id="back">\u2190 ${esc(ORGS[u.org].short)} roster</button>

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
        ${leaveBlock}
        ${strikesBlock}
        ${awardsBlock}
        ${serviceRecord}
        ${notesBlock}
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate(`#/${u.org === 'ethics-committee' ? 'ethics' : u.org}`));

  const dispatch = {
    edit: () => openEdit(app, u),
    clearance: () => openClearance(app, u),
    strike: () => openStrike(app, u),
    note: () => openNote(app, u),
    leave: () => onLeave ? returnFromLeave(app, u) : openLeave(app, u),
    delete: () => removeRecord(app, u),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act]()));
}

// --- Dossier sub-sections ---------------------------------------------------
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

function sectionStrikes(u, full) {
  const count = (u.strikes || []).length;
  if (!count) return '';
  let body;
  if (full) {
    body = u.strikes.map((s) => `
      <div class="strike">
        <div class="strike__reason">${esc(s.reason)}</div>
        <div class="strike__meta">${fmtDate(s.date)} \u00b7 issued by <span class="mono">${esc(s.by)}</span></div>
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
  const ranks = RANKS[u.org] || [];
  const body = `
    <div class="field"><label>Codename</label><input id="ed-codename" type="text" value="${esc(u.codename)}" /></div>
    <div class="field"><label>Legal name</label><input id="ed-real" type="text" value="${esc(u.realName)}" /></div>
    ${fieldSelect('ed-rank', 'Rank', ranks.length ? ranks : ['\u2014'], u.rank || ranks[0])}
    ${fieldSelect('ed-status', 'Status', STATUS_ORDER, u.status)}
  `;
  openModal({
    title: `Edit \u2014 ${u.designation}`,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save changes', tone: 'primary', onClick: (c, d) => {
          const codename = d.querySelector('#ed-codename').value.trim() || u.codename;
          const realName = d.querySelector('#ed-real').value.trim() || u.realName;
          const rank = d.querySelector('#ed-rank').value;
          const status = d.querySelector('#ed-status').value;
          mutate(app, u.id, u.version, (rec) => {
            const changes = [];
            if (rec.rank !== rank) changes.push(`rank \u2192 ${rank}`);
            if (rec.status !== status) changes.push(`status \u2192 ${status}`);
            rec.codename = codename; rec.realName = realName; rec.rank = rank; rec.status = status;
            if (changes.length) addEvent(rec, 'edit', `Record updated: ${changes.join(', ')}.`);
          }, { action: 'EDIT_RECORD', detail: `${u.designation} record updated.` });
          c();
          toast('Record updated.', 'success');
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
