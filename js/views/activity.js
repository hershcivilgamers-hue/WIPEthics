// =============================================================================
// views/activity.js — Audit feed.
//
// A reverse-chronological record of significant actions. Readable by any signed
// in operator; it does not expose record contents, only the fact and actor of
// each action.
// =============================================================================

import { recentActions } from '../audit.js';
import { esc, fmtDateTime, relTime } from '../ui.js';

// Map raw action codes to a tone for the left rule.
const TONE = {
  LOGIN: 'info', LOGOUT: 'muted', REGISTRATION: 'warn', SYSTEM_INIT: 'muted', MIGRATION: 'muted',
  CREATE_RECORD: 'ok', EDIT_RECORD: 'info', SET_CLEARANCE: 'warn',
  ADD_STRIKE: 'bad', ADD_NOTE: 'info', SET_LEAVE: 'warn', END_LEAVE: 'ok',
  REMOVE_RECORD: 'bad', RESTORE_RECORD: 'ok', PURGE_RECORD: 'bad',
  APPROVE_REGISTRATION: 'ok', REJECT_REGISTRATION: 'muted',
  ISSUE_DIRECTIVE: 'info', RESET_SYSTEM: 'bad',
  CREATE_SUBJECT: 'ok', EDIT_SUBJECT: 'info', ADD_SURVEILLANCE_LOG: 'info',
  SET_SUBJECT_STATUS: 'info', RECLASSIFY_SUBJECT: 'warn', CLOSE_SUBJECT: 'muted',
  REMOVE_SUBJECT: 'bad', SUBJECT_ACCESS_DENIED: 'bad',
};

function label(action) {
  return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export function render(host, app) {
  const entries = recentActions(150);

  let activeFilter = '';
  const actions = [...new Set(entries.map((e) => e.action))].sort();

  function draw() {
    const list = entries.filter((e) => !activeFilter || e.action === activeFilter);
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
  }

  const filterOpts = ['<option value="">All actions</option>', ...actions.map((a) => `<option value="${esc(a)}">${esc(label(a))}</option>`)].join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO</div>
        <h1 class="page-title">Activity Log</h1>
        <div class="page-sub">${entries.length} recorded action${entries.length === 1 ? '' : 's'}</div>
      </div>
    </div>
    <div class="toolbar">
      <select id="log-filter" class="toolbar__select">${filterOpts}</select>
    </div>
    <div class="card"><ul class="log" id="log-list"></ul></div>
  `;

  host.querySelector('#log-filter').addEventListener('change', (e) => { activeFilter = e.target.value; draw(); });
  draw();
}
