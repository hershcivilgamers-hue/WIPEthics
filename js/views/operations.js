// =============================================================================
// views/operations.js — Unit activity & readiness (hours-based).
//
// Each operator self-reports sessions: hours played, a note of what they did,
// and tags to the work that backs it up (orders now; operations when built; plus
// PoI/Targets). Their readiness — Active / Semi-Active / Inactive — is DERIVED
// from the hours logged in the current week against the unit's requirement
// (Omega-1: 5h/week + 25h/month; Ethics Assistants: 1h/week + an interaction;
// other roles exempt). Authorised leave suppresses to "On Leave" with no breach,
// and a Senior CL4+ may override a status (never their own). Logging is
// self-service; the Worker re-authorises every write.
// =============================================================================

import {
  ACTIVITY_STATUS, ACTIVITY_REQ_DEFAULT, ACTIVITY_REQ_SETTING_ID, mergeActivityReqs,
  activityRequirement, activityStatus, activityInBreach,
  ORGS, ORG_ORDER, activeStrikeCount, STRIKE_LIMIT,
} from '../constants.js';
import {
  users, getUser, getActivityForUser, upsertActivity, directives, subjects, operations, getSetting, newId,
} from '../storage.js';
import {
  canLogActivity, canOverrideActivity, canViewOperation, isCL5,
} from '../permissions.js';
import { logAction } from '../audit.js';
import {
  esc, fmtDate, fmtDateTime, relTime, orgTag, monogram,
  toast, openModal,
} from '../ui.js';

function reqs() {
  const rec = getSetting(ACTIVITY_REQ_SETTING_ID);
  return mergeActivityReqs(rec && rec.data);
}

const statusBadge = (k) => {
  const m = ACTIVITY_STATUS[k] || { label: k, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};

// Which operators' activity can this viewer see?
function inScope(actor, u) {
  if (isCL5(actor)) return true;
  if (u.id === actor.id) return true;
  return actor.org === u.org || actor.org === 'command';
}
// The roster the board tracks: in-scope operators the requirement applies to,
// plus the viewer themselves.
function trackedRoster(actor) {
  return users().filter((u) => !u.deleted && u.status !== 'discharged'
    && inScope(actor, u)
    && (!activityRequirement(u, reqs()).exempt || u.org === 'ethics-committee' || u.id === actor.id));
}

const lastLoggedAt = (rec) => {
  const log = (rec && rec.log) || [];
  return log.length ? Math.max(...log.map((e) => e.at)) : null;
};

// --- Shared mutation helper (creates the record on first write) -------------
function mutateActivity(app, userId, mutator, { action, detail }) {
  const now = new Date().toISOString();
  const existing = getActivityForUser(userId);
  if (existing) {
    mutator(existing);
    existing.version = (existing.version || 1) + 1;
    existing.updatedAt = now;
    upsertActivity(existing);
  } else {
    const u = getUser(userId);
    const rec = {
      id: newId('act'), userId, org: u.org, log: [], override: null,
      createdBy: app.user.designation, createdAt: now, updatedAt: now,
      version: 1, deleted: false, deletedAt: null,
    };
    mutator(rec);
    upsertActivity(rec);
  }
  if (action) logAction(app.user, action, detail);
  app.refresh();
}

// ===========================================================================
// READINESS BOARD
// ===========================================================================
export function render(host, app) {
  const actor = app.user;
  const roster = trackedRoster(actor);
  const myReq = activityRequirement(actor, reqs());
  const canLogSelf = !myReq.exempt;

  const breaches = roster.filter((u) => activityInBreach(u, getActivityForUser(u.id), reqs()));

  const orgBlock = (org) => {
    const list = roster.filter((u) => u.org === org).sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
    if (!list.length) return '';
    const isOmega = org === 'omega-1';
    const rows = list.map((u) => {
      const rec = getActivityForUser(u.id);
      const st = activityStatus(u, rec, reqs());
      const last = lastLoggedAt(rec);
      const breach = st.key === 'semi' || st.key === 'inactive';
      const wk = st.req.exempt ? '\u2014' : `${(+st.weekHours.toFixed(1))} / ${st.req.weekly}h`;
      const mo = (isOmega && !st.req.exempt) ? `${(+st.monthHours.toFixed(1))} / ${st.req.monthly}h` : '\u2014';
      const canLog = canLogActivity(actor, rec || { userId: u.id, org: u.org });
      const canOv = canOverrideActivity(actor, rec || { userId: u.id, org: u.org });
      const strikes = activeStrikeCount(u.strikes);
      const strikeFlag = strikes ? ` <span class="badge badge--bad" title="${strikes} active strike${strikes === 1 ? '' : 's'}">\u26a0 ${strikes} strike${strikes === 1 ? '' : 's'}${strikes >= STRIKE_LIMIT ? ' \u2014 at limit' : ''}</span>` : '';
      return `
        <tr class="${breach ? 'row-breach' : ''}" data-user="${esc(u.id)}" tabindex="0">
          <td class="cell-name"><span class="mono">${esc(u.designation)}</span> ${esc(u.codename || '')}${strikeFlag}</td>
          <td>${statusBadge(st.key)}${st.manual ? ' <span class="muted-text">(manual)</span>' : ''}</td>
          <td class="cell-num">${wk}</td>
          ${isOmega ? `<td class="cell-num">${mo}</td>` : ''}
          <td>${last ? relTime(new Date(last).toISOString()) : '<span class="muted-text">never</span>'}</td>
          <td class="cell-right">
            ${canLog ? `<button class="btn btn--xs" data-act="log" data-user="${esc(u.id)}">Log</button>` : ''}
            ${canOv ? `<button class="btn btn--xs" data-act="override" data-user="${esc(u.id)}">Override</button>` : ''}
          </td>
        </tr>`;
    }).join('');
    return `
      <section class="card" style="margin-top:16px">
        <div class="card__title">${orgTag(org)} ${esc(ORGS[org].name)}</div>
        <table class="table activity-table">
          <thead><tr><th>Operator</th><th>Status</th><th>This week</th>${isOmega ? '<th>This month</th>' : ''}<th>Last logged</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  };

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Operations</div>
        <h1 class="page-title">Readiness</h1>
        <div class="page-sub">Activity hours logged against unit requirements</div>
      </div>
      ${canLogSelf ? '<button class="btn btn--primary" id="log-self">Log my hours</button>' : ''}
    </div>

    ${breaches.length ? `<div class="readiness-banner readiness-banner--bad">
      <strong>${breaches.length}</strong> operator${breaches.length === 1 ? '' : 's'} below the activity requirement this week.
    </div>` : ''}

    ${ORG_ORDER.map(orgBlock).join('') || '<div class="empty">No operators in your remit are subject to activity requirements.</div>'}

    <p class="field__hint" style="margin-top:14px">Status reflects hours logged since Monday. Omega-1: ${reqs().omegaWeekly}h/week (+ ${reqs().omegaMonthly}h/month). Ethics Assistants: ${reqs().ethicsWeekly}h/week plus an interaction. Other roles are exempt.</p>
  `;

  const self = host.querySelector('#log-self');
  if (self) self.addEventListener('click', () => openLog(app, actor.id));

  const dispatch = {
    log: (uid) => openLog(app, uid),
    override: (uid) => openOverride(app, uid),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    dispatch[b.dataset.act] && dispatch[b.dataset.act](b.dataset.user);
  }));
  host.querySelectorAll('tr[data-user]').forEach((tr) => {
    tr.addEventListener('click', () => openLogDetail(app, tr.dataset.user));
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openLogDetail(app, tr.dataset.user); });
  });
}

// ===========================================================================
// LOG HOURS
// ===========================================================================
function taggableItems(actor) {
  const orders = directives().filter((d) => !d.deleted).map((d) => ({ kind: 'order', id: d.id, label: `${d.ref || ''} ${d.title || ''}`.trim() || d.id }));
  const subs = subjects().filter((s) => !s.deleted).map((s) => ({ kind: 'subject', id: s.id, label: `${s.ref || ''} ${s.alias || ''}`.trim() || s.id }));
  const ops = operations().filter((o) => !o.deleted && canViewOperation(actor, o)).map((o) => ({ kind: 'operation', id: o.id, label: `${o.ref || ''} ${o.name || ''}`.trim() || o.id }));
  return { orders, subs, ops };
}

export function openLog(app, userId) {
  const actor = app.user;
  const target = getUser(userId);
  if (!target) { toast('Operator not found.', 'error'); return; }
  const rec = getActivityForUser(userId);
  if (!canLogActivity(actor, rec || { userId, org: target.org })) { toast('You cannot log for this operator.', 'error'); return; }
  const isSelf = userId === actor.id;
  const req = activityRequirement(target, reqs());

  const { orders, subs, ops } = taggableItems(actor);
  const checkbox = (it) => `<label class="tag-opt"><input type="checkbox" class="tagpick" data-kind="${esc(it.kind)}" data-id="${esc(it.id)}" data-label="${esc(it.label)}" /> ${esc(it.label)}</label>`;
  const tagPicker = `
    <div class="field"><label>Tag contributions (optional)</label>
      <div class="tag-list">
        ${orders.length ? `<div class="tag-group-h">Orders</div>${orders.map(checkbox).join('')}` : ''}
        ${ops.length ? `<div class="tag-group-h">Operations</div>${ops.map(checkbox).join('')}` : ''}
        ${subs.length ? `<div class="tag-group-h">PoI / Targets</div>${subs.map(checkbox).join('')}` : ''}
        ${(!orders.length && !subs.length && !ops.length) ? '<div class="muted-text">Nothing taggable yet.</div>' : ''}
      </div>
    </div>`;

  openModal({
    title: isSelf ? 'Log my hours' : `Log hours \u2014 ${target.designation}`,
    wide: true,
    body: `
      <p class="modal__message">Record a session: hours played and what you did this week.${req.needsInteraction ? ' An interaction (a note or a tag) is needed to count as Active.' : ''}</p>
      <div class="field"><label>Hours</label><input id="ac-hours" type="number" min="0" step="0.5" placeholder="e.g. 2.5" /></div>
      <div class="field"><label>What you did</label><textarea id="ac-note" rows="3" placeholder="e.g. Sector 9 patrol, ran a containment drill\u2026"></textarea></div>
      ${tagPicker}
      <div id="ac-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Log session', tone: 'primary', onClick: (c, d) => {
          const hours = parseFloat(d.querySelector('#ac-hours').value);
          const note = d.querySelector('#ac-note').value.trim();
          const tags = [...d.querySelectorAll('.tagpick:checked')].map((cb) => ({ kind: cb.dataset.kind, id: cb.dataset.id, label: cb.dataset.label }));
          const err = d.querySelector('#ac-err');
          err.hidden = true;
          if (!(hours > 0)) { err.textContent = 'Enter the hours played (greater than zero).'; err.hidden = false; return; }
          if (hours > 168) { err.textContent = 'That is more hours than exist in a week.'; err.hidden = false; return; }
          mutateActivity(app, userId, (r) => {
            r.log = [...(r.log || []), { id: newId('al'), at: Date.now(), hours, note, tags, by: actor.designation }];
          }, { action: 'LOG_ACTIVITY', detail: `${hours}h logged for ${target.designation}.` });
          c();
          toast('Session logged.', 'success');
        } },
    ],
  });
}

// ===========================================================================
// LOG DETAIL (read-only recent entries)
// ===========================================================================
function openLogDetail(app, userId) {
  const target = getUser(userId);
  const rec = getActivityForUser(userId);
  const st = activityStatus(target, rec, reqs());
  const log = ((rec && rec.log) || []).slice().sort((a, b) => b.at - a.at).slice(0, 12);
  const tagChip = (t) => `<span class="chip chip--${esc(t.kind)}">${esc(t.label)}</span>`;
  const rows = log.length ? log.map((e) => `
    <li class="tl__item">
      <div class="tl__body">
        <div class="tl__text"><strong>${(+Number(e.hours).toFixed(1))}h</strong> \u2014 ${esc(e.note || 'No note')}</div>
        ${(e.tags && e.tags.length) ? `<div class="tag-row">${e.tags.map(tagChip).join('')}</div>` : ''}
        <div class="tl__meta"><span class="mono">${esc(e.by || '')}</span> \u00b7 ${fmtDateTime(new Date(e.at).toISOString())}</div>
      </div>
    </li>`).join('') : '<div class="empty">No sessions logged.</div>';

  openModal({
    title: `${target.designation} \u2014 activity`,
    wide: true,
    body: `
      <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${statusBadge(st.key)}${st.manual ? ' <span class="muted-text">(manual override)</span>' : ''}</span></div>
      <div class="kv"><span class="kv__k">This week</span><span class="kv__v">${st.req.exempt ? '\u2014' : `${(+st.weekHours.toFixed(1))} / ${st.req.weekly}h`}</span></div>
      ${(target.org === 'omega-1' && !st.req.exempt) ? `<div class="kv"><span class="kv__k">This month</span><span class="kv__v">${(+st.monthHours.toFixed(1))} / ${st.req.monthly}h</span></div>` : ''}
      ${st.manual && st.overrideReason ? `<div class="kv"><span class="kv__k">Override note</span><span class="kv__v">${esc(st.overrideReason)}</span></div>` : ''}
      <div class="modal__divider"></div>
      <div class="card__subtitle">Recent sessions</div>
      ${log.length ? `<ul class="timeline">${rows}</ul>` : rows}`,
    actions: [{ label: 'Close', tone: 'primary', onClick: (c) => c() }],
  });
}

// ===========================================================================
// MANAGER OVERRIDE (never on one's own record)
// ===========================================================================
function openOverride(app, userId) {
  const actor = app.user;
  const target = getUser(userId);
  const rec = getActivityForUser(userId);
  if (!canOverrideActivity(actor, rec || { userId, org: target.org })) { toast('You cannot override this status.', 'error'); return; }
  const cur = rec && rec.override ? rec.override.status : '';

  const opt = (v, l) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  openModal({
    title: `Override status \u2014 ${target.designation}`,
    body: `
      <p class="modal__message">Pin this operator's activity status, overriding the derived value. Use sparingly \u2014 e.g. credited activity logged elsewhere.</p>
      <div class="field"><label>Status</label><select id="ov-status">
        ${opt('', '\u2014 No override (use derived) \u2014')}
        ${opt('active', 'Active')}
        ${opt('semi', 'Semi-Active')}
        ${opt('inactive', 'Inactive')}
      </select></div>
      <div class="field"><label>Reason (optional)</label><input id="ov-reason" type="text" placeholder="Why this override" /></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply', tone: 'primary', onClick: (c, d) => {
          const status = d.querySelector('#ov-status').value;
          const reason = d.querySelector('#ov-reason').value.trim();
          mutateActivity(app, userId, (r) => {
            r.override = status ? { status, by: actor.designation, at: new Date().toISOString(), reason } : null;
          }, { action: status ? 'SET_ACTIVITY_OVERRIDE' : 'CLEAR_ACTIVITY_OVERRIDE', detail: `${target.designation} status ${status ? 'set to ' + status : 'override cleared'}.` });
          c();
          toast(status ? 'Override applied.' : 'Override cleared.', 'success');
        } },
    ],
  });
}
