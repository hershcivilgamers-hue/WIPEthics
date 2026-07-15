// =============================================================================
// views/activity.js — Audit feed.
//
// A reverse-chronological record of significant actions. Readable by any signed
// in operator; it does not expose record contents, only the fact and actor of
// each action. Filterable by free text (action, actor, detail), by action type,
// and by date range — filters persist while you move around the app.
// =============================================================================

import { recentActions } from '../audit.js';
import { esc, fmtDateTime, relTime } from '../ui.js';

// Map raw action codes to a tone for the left rule.
const TONE = {
  LOGIN: 'info', LOGOUT: 'muted', REGISTRATION: 'warn', SYSTEM_INIT: 'muted', MIGRATION: 'muted',
  CREATE_RECORD: 'ok', EDIT_RECORD: 'info', SET_CLEARANCE: 'warn',
  ADD_STRIKE: 'bad', ADD_NOTE: 'info', SET_LEAVE: 'warn', END_LEAVE: 'ok', LIFT_STRIKE: 'ok', ISSUE_STRIKE: 'bad',
  APPEAL_STRIKE: 'warn', RESOLVE_APPEAL: 'info', APPEAL_BLACKLIST: 'warn', RESOLVE_BLACKLIST_APPEAL: 'info',
  CREATE_DOCUMENT: 'muted', EDIT_DOCUMENT: 'muted', ISSUE_DOCUMENT: 'ok', REMOVE_DOCUMENT: 'warn', RESTORE_DOCUMENT: 'muted',
  SUSPEND_ACCOUNT: 'bad', REINSTATE_ACCOUNT: 'ok', REQUEST_LEAVE: 'info', RESOLVE_LEAVE_REQUEST: 'ok', REQUEST_ADVANCEMENT: 'info', RESOLVE_ADVANCEMENT: 'ok', REQUEST_TRANSFER: 'info', RESOLVE_TRANSFER_REQUEST: 'ok',
  DISCHARGE: 'bad', REINSTATE: 'ok',
  PROMOTE: 'ok', DEMOTE: 'bad', PROMO_CHECK: 'muted', SET_RANK: 'warn', SET_TAGS: 'info', SET_AWARDS: 'ok', TRANSFER_UNIT: 'warn',
  SET_PROMO_REQ: 'warn', REMOVE_PROMO_REQ: 'muted',
  REMOVE_RECORD: 'bad', RESTORE_RECORD: 'ok', PURGE_RECORD: 'bad',
  APPROVE_REGISTRATION: 'ok', REJECT_REGISTRATION: 'muted',
  ISSUE_DIRECTIVE: 'info', RESET_SYSTEM: 'bad',
  CREATE_SUBJECT: 'ok', EDIT_SUBJECT: 'info', ADD_SURVEILLANCE_LOG: 'info',
  SET_SUBJECT_STATUS: 'info', RECLASSIFY_SUBJECT: 'warn', CLOSE_SUBJECT: 'muted',
  REMOVE_SUBJECT: 'bad', SUBJECT_ACCESS_DENIED: 'bad',
  AUTHORISE_TARGET: 'bad', REFUSE_TARGET: 'muted',
  OPEN_CASE: 'ok', EDIT_CASE: 'info', ADD_CASE_ENTRY: 'info', ISSUE_SUMMONS: 'warn',
  SET_PANEL: 'info', CITE_SUBJECT: 'info', SET_CASE_STATUS: 'info', RECLASSIFY_CASE: 'warn',
  ENTER_RULING: 'ok', VOTE_CASE: 'info', REMOVE_CASE: 'bad', CASE_ACCESS_DENIED: 'bad',
  EXPORT_CASE: 'muted', EXPORT_SUBJECT: 'muted', EXPORT_PERSONNEL: 'muted', EXPORT_DIRECTIVE: 'muted',
  EXPORT_INTERVIEW: 'muted', EXPORT_OPERATION: 'muted', EXPORT_INTEL: 'muted', EXPORT_SUMMONS: 'muted', EXPORT_ENGAGEMENT: 'muted',
  CREATE_COMPARTMENT: 'ok', EDIT_COMPARTMENT: 'info', REMOVE_COMPARTMENT: 'bad', RESTORE_COMPARTMENT: 'ok',
  READ_IN: 'warn', READ_OUT: 'muted', ROSTER_UPDATE: 'info', SEAL_COMPARTMENT: 'warn',
  LOG_ACTIVITY: 'info', OPEN_ACTIVITY: 'muted', SET_ACTIVITY_OVERRIDE: 'warn', CLEAR_ACTIVITY_OVERRIDE: 'muted', SET_SETTING: 'warn',
  OPEN_RECRUIT: 'ok', EDIT_RECRUIT: 'info', ADVANCE_RECRUIT: 'info', VOTE_RECRUIT: 'muted',
  REJECT_RECRUIT: 'bad', INDUCT_RECRUIT: 'ok', REMOVE_RECRUIT: 'bad', RESTORE_RECRUIT: 'ok',
  SET_INTERVIEWERS: 'info', EDIT_INTERVIEW_RESPONSE: 'info', ASSESS_INTERVIEW: 'info',
  CREATE_ENGAGEMENT: 'ok', EDIT_ENGAGEMENT: 'info', REMOVE_ENGAGEMENT: 'bad', RESTORE_ENGAGEMENT: 'ok',
  SUBMIT_EVIDENCE: 'ok', EDIT_EVIDENCE: 'info', REVIEW_EVIDENCE: 'info', REMOVE_EVIDENCE: 'bad', RESTORE_EVIDENCE: 'ok', SET_EVIDENCE_REVIEW: 'warn',
  CREATE_OPERATION: 'ok', EDIT_OPERATION: 'info', LOG_OPERATION: 'info',
  ACTIVATE_OPERATION: 'ok', CONCLUDE_OPERATION: 'ok', ABORT_OPERATION: 'bad',
  REMOVE_OPERATION: 'bad', RESTORE_OPERATION: 'ok',
  CREATE_INTEL: 'ok', EDIT_INTEL: 'info', LOG_INTEL: 'info', BURN_INTEL: 'bad',
  CLOSE_INTEL: 'muted', ACTIVATE_INTEL: 'ok', REMOVE_INTEL: 'bad', RESTORE_INTEL: 'ok',
  ACK_DIRECTIVE: 'ok', RESET_PASSPHRASE: 'warn', CHANGE_PASSPHRASE: 'muted', SIGN_OUT_ALL: 'warn',
  CREATE_BLACKLIST: 'bad', EDIT_BLACKLIST: 'info', REMOVE_BLACKLIST: 'muted', RESTORE_BLACKLIST: 'warn',
};

function label(action) {
  return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

// Pure filter over audit entries — exported so it can be unit-tested.
// f = { q, action, from, to }; from/to are 'YYYY-MM-DD' (inclusive).
export function filterAuditEntries(entries, f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  const fromTs = f.from ? `${f.from}T00:00:00.000` : null;
  const toTs = f.to ? `${f.to}T23:59:59.999` : null;
  return entries.filter((e) => {
    if (f.action && e.action !== f.action) return false;
    if (fromTs && String(e.ts) < fromTs) return false;
    if (toTs && String(e.ts) > toTs) return false;
    if (q && !`${e.action} ${label(e.action)} ${e.actor || ''} ${e.detail || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Filters persist across visits within the session, and are mirrored into the
// URL hash (#/activity?q=…&action=…&from=…&to=…) so a filtered view can be
// bookmarked or shared. The URL is updated via replaceState so it never
// re-routes mid-typing.
let fQ = '';
let fAction = '';
let fFrom = '';
let fTo = '';

function readUrlFilters() {
  const h = window.location.hash || '';
  const qi = h.indexOf('?');
  if (qi < 0) return null;
  const p = new URLSearchParams(h.slice(qi + 1));
  return { q: p.get('q') || '', action: p.get('action') || '', from: p.get('from') || '', to: p.get('to') || '' };
}
function syncUrlFilters() {
  const p = new URLSearchParams();
  if (fQ) p.set('q', fQ);
  if (fAction) p.set('action', fAction);
  if (fFrom) p.set('from', fFrom);
  if (fTo) p.set('to', fTo);
  const qs = p.toString();
  try { history.replaceState(null, '', '#/activity' + (qs ? `?${qs}` : '')); } catch (_) { /* no history API */ }
}

export function render(host, app) {
  // A bookmarked/shared URL wins over the in-session filters on entry.
  const urlF = readUrlFilters();
  if (urlF) { fQ = urlF.q; fAction = urlF.action; fFrom = urlF.from; fTo = urlF.to; }

  const entries = recentActions(400);
  const actions = [...new Set(entries.map((e) => e.action))].sort();

  function draw() {
    const list = filterAuditEntries(entries, { q: fQ, action: fAction, from: fFrom, to: fTo });
    const rows = list.length ? list.map((e) => `
      <li class="log__row log__row--${TONE[e.action] || 'muted'}">
        <div class="log__main">
          <span class="log__action">${esc(label(e.action))}</span>
          <span class="log__detail">${esc(e.detail || '')}</span>
        </div>
        <div class="log__meta">
          <span class="mono">${esc(e.actor)}</span>
          <span title="${esc(fmtDateTime(e.ts))}">${esc(relTime(e.ts))}</span>
        </div>
      </li>`).join('') : '<li class="empty">No matching activity.</li>';

    host.querySelector('#log-list').innerHTML = rows;
    const count = host.querySelector('#log-count');
    if (count) count.textContent = `${list.length} of ${entries.length} recorded action${entries.length === 1 ? '' : 's'}`;
  }

  const filterOpts = ['<option value="">All actions</option>', ...actions.map((a) => `<option value="${esc(a)}" ${a === fAction ? 'selected' : ''}>${esc(label(a))}</option>`)].join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO</div>
        <h1 class="page-title">Activity Log</h1>
        <div class="page-sub" id="log-count">${entries.length} recorded action${entries.length === 1 ? '' : 's'}</div>
      </div>
    </div>
    <div class="toolbar">
      <input id="log-q" class="toolbar__search" type="search" placeholder="Filter by actor, action or detail\u2026" value="${esc(fQ)}" autocomplete="off" />
      <select id="log-filter" class="toolbar__select">${filterOpts}</select>
      <input id="log-from" class="toolbar__select" type="date" value="${esc(fFrom)}" title="From date" />
      <input id="log-to" class="toolbar__select" type="date" value="${esc(fTo)}" title="To date" />
    </div>
    <div class="card"><ul class="log" id="log-list"></ul></div>
  `;

  host.querySelector('#log-q').addEventListener('input', (e) => { fQ = e.target.value; draw(); syncUrlFilters(); });
  host.querySelector('#log-filter').addEventListener('change', (e) => { fAction = e.target.value; draw(); syncUrlFilters(); });
  host.querySelector('#log-from').addEventListener('change', (e) => { fFrom = e.target.value; draw(); syncUrlFilters(); });
  host.querySelector('#log-to').addEventListener('change', (e) => { fTo = e.target.value; draw(); syncUrlFilters(); });
  draw();
}
