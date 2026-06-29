// =============================================================================
// views/operations.js — Operational activity & readiness.
//
// A unit readiness board. Each operator has an activity record (a running log of
// operational check-ins) and a DERIVED readiness state — Current, Overdue or
// Activity Breach — computed from how recently they were last active, never set
// as a field. Logging is self-service (an operator records their own check-ins
// regardless of clearance); setting a duty posture or logging on another
// operator's behalf needs the org-management right. Every write routes through
// the permission engine, is version-stamped and audit-logged; in server mode the
// Worker re-authorises each write and re-scopes the board on read.
// =============================================================================

import {
  ACTIVITY_TYPE, ACTIVITY_TYPE_ORDER, DUTY_STATUS, DUTY_STATUS_ORDER,
  READINESS, READINESS_OVERDUE_DAYS, READINESS_BREACH_DAYS, readinessFor,
  ORGS, ORG_ORDER,
} from '../constants.js';
import {
  users, getUser, activity, getActivityForUser, upsertActivity, newId,
} from '../storage.js';
import { canLogActivity, canManageOrg, isCL5 } from '../permissions.js';
import { logAction } from '../audit.js';
import {
  esc, fmtDate, fmtDateTime, relTime, clearanceBadge, orgTag, monogram,
  toast, openModal,
} from '../ui.js';

const filter = { org: '', readiness: '' };

const dutyBadge = (d) => {
  const m = DUTY_STATUS[d] || DUTY_STATUS.none;
  return d && d !== 'none' ? `<span class="badge badge--${m.tone}">${esc(m.label)}</span>` : '<span class="muted-text">\u2014</span>';
};
const readyBadge = (r) => {
  const m = READINESS[r] || READINESS.unknown;
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};

// Build the readiness row for a user from their (optional) activity record.
function rowFor(actor, u) {
  const rec = getActivityForUser(u.id);
  const readiness = rec ? readinessFor(rec.lastActiveAt) : 'unknown';
  return { u, rec, readiness, duty: rec?.duty || 'none', lastActiveAt: rec?.lastActiveAt || null };
}

function visibleOperators(actor) {
  return users()
    .filter((u) => !u.deleted && u.accountStatus === 'active')
    .filter((u) => isCL5(actor) || actor.org === 'command' || actor.org === u.org || u.id === actor.id);
}

// ===========================================================================
// READINESS BOARD
// ===========================================================================
export function render(host, app) {
  const actor = app.user;
  const rows = visibleOperators(actor).map((u) => rowFor(actor, u))
    .filter((r) => {
      if (filter.org && r.u.org !== filter.org) return false;
      if (filter.readiness && r.readiness !== filter.readiness) return false;
      return true;
    })
    .sort((a, b) => {
      const order = { breach: 0, overdue: 1, unknown: 2, current: 3 };
      return (order[a.readiness] - order[b.readiness]) || a.u.designation.localeCompare(b.u.designation);
    });

  const allVisible = visibleOperators(actor).map((u) => rowFor(actor, u));
  const breaches = allVisible.filter((r) => r.readiness === 'breach').length;
  const overdue = allVisible.filter((r) => r.readiness === 'overdue').length;

  const orgOpts = ['', ...ORG_ORDER]
    .map((o) => `<option value="${o}" ${filter.org === o ? 'selected' : ''}>${o ? esc(ORGS[o].name) : 'All organisations'}</option>`).join('');
  const readyOpts = ['', 'current', 'overdue', 'breach', 'unknown']
    .map((r) => `<option value="${r}" ${filter.readiness === r ? 'selected' : ''}>${r ? esc(READINESS[r].label) : 'All readiness'}</option>`).join('');

  const body = rows.length ? rows.map((r) => `
    <tr data-id="${esc(r.u.id)}" tabindex="0">
      <td class="mono">${esc(r.u.designation)}</td>
      <td class="cell-name">${esc(r.u.codename)}</td>
      <td>${orgTag(r.u.org)}</td>
      <td>${esc(r.u.rank || '\u2014')}</td>
      <td>${dutyBadge(r.duty)}</td>
      <td>${readyBadge(r.readiness)}</td>
      <td>${r.lastActiveAt ? esc(relTime(r.lastActiveAt)) : '<span class="muted-text">never</span>'}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty">No operators match the current filters.</td></tr>';

  const selfRec = getActivityForUser(actor.id);

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Operations</div>
        <h1 class="page-title">Readiness</h1>
        <div class="page-sub">${allVisible.length} operator${allVisible.length === 1 ? '' : 's'} \u00b7 readiness derived from activity in the last ${READINESS_OVERDUE_DAYS}\u2013${READINESS_BREACH_DAYS} days</div>
      </div>
      <button class="btn btn--primary" id="log-self">+ Log my activity</button>
    </div>

    ${breaches || overdue ? `<div class="readiness-banner ${breaches ? 'readiness-banner--bad' : 'readiness-banner--warn'}">
      ${breaches ? `<strong>${breaches}</strong> operator${breaches === 1 ? '' : 's'} in activity breach` : ''}${breaches && overdue ? ' \u00b7 ' : ''}${overdue ? `<strong>${overdue}</strong> overdue` : ''} \u2014 follow up on duty status.
    </div>` : ''}

    <div class="toolbar">
      <select id="flt-org" class="toolbar__select">${orgOpts}</select>
      <select id="flt-ready" class="toolbar__select">${readyOpts}</select>
    </div>

    <div class="card">
      <table class="table">
        <thead><tr><th>Operator</th><th>Codename</th><th>Org</th><th>Rank</th><th>Duty</th><th>Readiness</th><th>Last active</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;

  const open = (id) => { const u = getUser(id); if (u) openActivity(app, u); };
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => open(tr.dataset.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(tr.dataset.id); });
  });
  host.querySelector('#flt-org').addEventListener('change', (e) => { filter.org = e.target.value; render(host, app); });
  host.querySelector('#flt-ready').addEventListener('change', (e) => { filter.readiness = e.target.value; render(host, app); });
  host.querySelector('#log-self').addEventListener('click', () => openActivity(app, actor));
}

// ===========================================================================
// ACTIVITY MODAL (timeline + log form)
// ===========================================================================
function selectField(id, label, options, selected, labeller = (x) => x) {
  const opts = options.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(labeller(o))}</option>`).join('');
  return `<div class="field"><label>${esc(label)}</label><select id="${id}">${opts}</select></div>`;
}

function openActivity(app, u) {
  const actor = app.user;
  const rec = getActivityForUser(u.id);
  const canLog = canLogActivity(actor, { userId: u.id, org: u.org });
  const isMgr = canManageOrg(actor, u.org);
  const readiness = rec ? readinessFor(rec.lastActiveAt) : 'unknown';

  const entries = (rec?.entries || []).slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const timeline = entries.length ? entries.map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(e.type)}"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(e.text)}</div>
        <div class="tl__meta"><span class="tl__type">${esc((ACTIVITY_TYPE[e.type] || {}).label || e.type)}</span> \u00b7 <span class="mono">${esc(e.by)}</span> \u00b7 ${fmtDate(e.ts)}</div>
      </div>
    </li>`).join('') : '<div class="empty">No activity recorded.</div>';

  const form = canLog ? `
    <div class="modal__divider"></div>
    ${selectField('ac-type', 'Entry type', ACTIVITY_TYPE_ORDER, 'check-in', (t) => ACTIVITY_TYPE[t].label)}
    <div class="field"><label>Entry</label><input id="ac-text" type="text" placeholder="Record the check-in or activity\u2026" /></div>
    ${isMgr ? selectField('ac-duty', 'Duty posture', DUTY_STATUS_ORDER, rec?.duty || 'none', (d) => DUTY_STATUS[d].label) : ''}
  ` : '<p class="modal__message">You can view this operator\u2019s readiness but not log activity on their behalf.</p>';

  openModal({
    title: `Activity \u2014 ${u.designation} \u00b7 ${u.codename}`,
    wide: true,
    body: `
      <div class="kv"><span class="kv__k">Readiness</span><span class="kv__v">${readyBadge(readiness)}</span></div>
      <div class="kv"><span class="kv__k">Duty</span><span class="kv__v">${dutyBadge(rec?.duty || 'none')}</span></div>
      <div class="kv"><span class="kv__k">Last active</span><span class="kv__v">${rec?.lastActiveAt ? fmtDateTime(rec.lastActiveAt) : '\u2014'}</span></div>
      <div class="modal__divider"></div>
      <div class="card__subtitle">Activity log</div>
      ${entries.length ? `<ul class="timeline">${timeline}</ul>` : timeline}
      ${form}
    `,
    actions: canLog ? [
      { label: 'Close', tone: 'ghost', onClick: (close) => close() },
      { label: 'Record', tone: 'primary', onClick: (close, d) => {
          const type = d.querySelector('#ac-type').value;
          const text = d.querySelector('#ac-text').value.trim();
          const duty = isMgr ? d.querySelector('#ac-duty').value : (rec?.duty || 'none');
          const dutyChanged = isMgr && duty !== (rec?.duty || 'none');
          if (!text && !dutyChanged) { toast('Add an entry or change the duty posture.', 'error'); return; }
          writeActivity(app, u, rec, { type, text, duty, dutyChanged });
          close();
        } },
    ] : [{ label: 'Close', tone: 'primary', onClick: (close) => close() }],
  });
}

function writeActivity(app, u, rec, { type, text, duty, dutyChanged }) {
  const now = new Date().toISOString();
  const actor = app.user;
  const entry = text ? { id: newId('act'), ts: now, type, by: actor.designation, text } : null;

  if (!rec) {
    // Lazily open the operator's activity record on first log.
    upsertActivity({
      id: newId('actr'), userId: u.id, org: u.org,
      entries: entry ? [entry] : [], duty: duty || 'none',
      lastActiveAt: entry ? now : null,
      createdBy: actor.designation, createdAt: now, updatedAt: now,
      version: 1, deleted: false, deletedAt: null,
    });
    logAction(actor, dutyChanged ? 'SET_DUTY_STATUS' : 'LOG_ACTIVITY', `Activity opened for ${u.designation}.`);
    toast('Activity recorded.', 'success');
    app.refresh();
    return;
  }

  const fresh = getActivityForUser(u.id);
  if (!fresh || fresh.version !== rec.version) { toast('This record changed elsewhere. Reloading.', 'warn'); app.refresh(); return; }
  if (entry) { fresh.entries = [...(fresh.entries || []), entry]; fresh.lastActiveAt = now; }
  if (dutyChanged) fresh.duty = duty;
  fresh.version += 1;
  fresh.updatedAt = now;
  upsertActivity(fresh);
  logAction(actor, dutyChanged ? 'SET_DUTY_STATUS' : 'LOG_ACTIVITY', `${u.designation}: ${dutyChanged ? `duty \u2192 ${DUTY_STATUS[duty].label}` : (ACTIVITY_TYPE[type] || {}).label || 'activity'}.`);
  toast('Activity recorded.', 'success');
  app.refresh();
}
