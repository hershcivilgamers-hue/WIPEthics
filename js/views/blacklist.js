// =============================================================================
// views/blacklist.js — Cross-department blacklist registry.
//
// A shared "do not admit / do not engage" register. Every signed-in operator
// can read and search it; managers of the raising organisation (and any CL5)
// add, amend, lift, or remove entries. Entries carry a severity and an active/
// lifted status, and record who raised them and when.
// =============================================================================

import {
  BLACKLIST_SEVERITY, BLACKLIST_SEVERITY_ORDER, BLACKLIST_STATUS,
  ORGS, ORG_ORDER,
} from '../constants.js';
import { blacklist, getBlacklistEntry, upsertBlacklistEntry, newId } from '../storage.js';
import { canManageOrg, isCL5 } from '../permissions.js';
import { esc, fmtDate, orgTag, toast, openModal, confirmDialog } from '../ui.js';

const filter = { q: '', severity: '', status: 'active' };

function manageableOrgs(actor) {
  return ORG_ORDER.filter((o) => canManageOrg(actor, o));
}
function sevBadge(code) {
  const s = BLACKLIST_SEVERITY[code] || { label: code, tone: 'muted' };
  return `<span class="badge badge--${s.tone}">${esc(s.label)}</span>`;
}
function statusBadge(code) {
  const s = BLACKLIST_STATUS[code] || { label: code, tone: 'muted' };
  return `<span class="badge badge--${s.tone}">${esc(s.label)}</span>`;
}

export function render(host, app) {
  const actor = app.user;
  const canManageAny = manageableOrgs(actor).length > 0;

  const all = blacklist().filter((b) => !b.deleted);
  const rows = all
    .filter((b) => {
      if (filter.severity && b.severity !== filter.severity) return false;
      if (filter.status && (b.status || 'active') !== filter.status) return false;
      if (filter.q) {
        const hay = `${b.name || ''} ${b.identifier || ''} ${b.reason || ''} ${ORGS[b.org]?.name || ''}`.toLowerCase();
        if (!hay.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => (a.status === b.status ? (b.createdAt || '').localeCompare(a.createdAt || '') : (a.status === 'active' ? -1 : 1)));

  const body = rows.length ? rows.map((b) => `
    <tr data-id="${esc(b.id)}" tabindex="0" class="${(b.status || 'active') === 'lifted' ? 'row--muted' : ''}">
      <td class="cell-name">${esc(b.name)}${b.identifier ? `<span class="mono muted-text"> \u00b7 ${esc(b.identifier)}</span>` : ''}</td>
      <td>${sevBadge(b.severity)}</td>
      <td>${orgTag(b.org)}</td>
      <td class="bl-reason">${esc(b.reason || '\u2014')}</td>
      <td>${statusBadge(b.status || 'active')}</td>
      <td class="cell-right"><span class="row-go">${canManageOrg(actor, b.org) ? 'Manage \u2192' : 'View \u2192'}</span></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">No entries match the current filters.</td></tr>`;

  const sevOpts = ['<option value="">All severities</option>', ...BLACKLIST_SEVERITY_ORDER.map((s) => `<option value="${s}" ${filter.severity === s ? 'selected' : ''}>${esc(BLACKLIST_SEVERITY[s].label)}</option>`)].join('');
  const statOpts = [['active', 'Active'], ['lifted', 'Lifted'], ['', 'All']].map(([v, l]) => `<option value="${v}" ${filter.status === v ? 'selected' : ''}>${l}</option>`).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Cross-Department</div>
        <h1 class="page-title">Blacklist</h1>
        <div class="page-sub">Barred and hostile individuals \u00b7 ${all.filter((b) => (b.status || 'active') === 'active').length} active</div>
      </div>
      ${canManageAny ? '<button class="btn btn--primary" id="bl-add">+ Add entry</button>' : ''}
    </div>
    <div class="toolbar">
      <input id="bl-q" class="toolbar__search" type="search" placeholder="Search name, identifier or reason\u2026" value="${esc(filter.q)}" autocomplete="off" />
      <select id="bl-sev" class="toolbar__select">${sevOpts}</select>
      <select id="bl-status" class="toolbar__select">${statOpts}</select>
    </div>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Severity</th><th>Raised by</th><th>Reason</th><th>Status</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  host.querySelector('#bl-q').addEventListener('input', (e) => { filter.q = e.target.value; render(host, app); });
  host.querySelector('#bl-sev').addEventListener('change', (e) => { filter.severity = e.target.value; render(host, app); });
  host.querySelector('#bl-status').addEventListener('change', (e) => { filter.status = e.target.value; render(host, app); });
  const addBtn = host.querySelector('#bl-add');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app));
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    const open = () => openEntry(app, tr.dataset.id);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function openCreate(app) {
  const actor = app.user;
  const orgs = manageableOrgs(actor);
  if (!orgs.length) { toast('You cannot add blacklist entries.', 'error'); return; }
  const body = `
    <p class="modal__message">Add an individual to the blacklist. Entries are visible to all personnel.</p>
    <div class="field"><label>Name / handle</label><input id="bl-name" type="text" placeholder="e.g. John Doe or a known alias" /></div>
    <div class="field"><label>Identifier <span class="muted-text">(SteamID, etc. \u2014 optional)</span></label><input id="bl-id" type="text" placeholder="optional" /></div>
    <div class="field"><label>Raised by</label><select id="bl-org">${orgs.map((o) => `<option value="${o}">${esc(ORGS[o].name)}</option>`).join('')}</select></div>
    <div class="field"><label>Severity</label><select id="bl-sevn">${BLACKLIST_SEVERITY_ORDER.map((s) => `<option value="${s}">${esc(BLACKLIST_SEVERITY[s].label)}</option>`).join('')}</select></div>
    <div class="field"><label>Reason</label><textarea id="bl-reason" rows="3" placeholder="Why is this individual blacklisted?"></textarea></div>
    <div id="bl-err" class="auth__error" hidden></div>`;
  openModal({
    title: 'Add blacklist entry',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Add entry', tone: 'primary', onClick: (c, d) => {
          const name = d.querySelector('#bl-name').value.trim();
          const identifier = d.querySelector('#bl-id').value.trim();
          const org = d.querySelector('#bl-org').value;
          const severity = d.querySelector('#bl-sevn').value;
          const reason = d.querySelector('#bl-reason').value.trim();
          const err = d.querySelector('#bl-err');
          err.hidden = true;
          if (!name) { err.textContent = 'A name or handle is required.'; err.hidden = false; return; }
          if (!canManageOrg(actor, org)) { err.textContent = 'You cannot raise entries for that organisation.'; err.hidden = false; return; }
          const now = new Date().toISOString();
          upsertBlacklistEntry({
            id: newId('bl'), name, identifier: identifier || null, org, severity, reason,
            status: 'active', addedBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          c();
          toast(`${name} added to the blacklist.`, 'success');
          app.refresh();
        } },
    ],
  });
}

function openEntry(app, id) {
  const actor = app.user;
  const b = getBlacklistEntry(id);
  if (!b || b.deleted) return;
  const canManage = canManageOrg(actor, b.org);
  const lifted = (b.status || 'active') === 'lifted';

  const detail = `
    <div class="kv"><span class="kv__k">Name</span><span class="kv__v">${esc(b.name)}</span></div>
    ${b.identifier ? `<div class="kv"><span class="kv__k">Identifier</span><span class="kv__v mono">${esc(b.identifier)}</span></div>` : ''}
    <div class="kv"><span class="kv__k">Severity</span><span class="kv__v">${sevBadge(b.severity)}</span></div>
    <div class="kv"><span class="kv__k">Raised by</span><span class="kv__v">${orgTag(b.org)} \u00b7 <span class="mono">${esc(b.addedBy || '')}</span> \u00b7 ${fmtDate(b.createdAt)}</span></div>
    <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${statusBadge(b.status || 'active')}</span></div>
    <div class="kv kv--stack"><span class="kv__k">Reason</span><span class="kv__v">${esc(b.reason || '\u2014')}</span></div>`;

  const actions = [{ label: 'Close', tone: 'ghost', onClick: (c) => c() }];
  if (canManage) {
    actions.push({ label: 'Edit', tone: 'primary', onClick: (c) => { c(); openEdit(app, b); } });
    actions.push({ label: lifted ? 'Reinstate' : 'Lift', tone: 'ghost', onClick: (c) => {
      c();
      const cur = getBlacklistEntry(id);
      upsertBlacklistEntry({ ...cur, status: lifted ? 'active' : 'lifted', updatedAt: new Date().toISOString(), version: (cur.version || 1) + 1 });
      toast(lifted ? 'Entry reinstated.' : 'Entry lifted.', 'success');
      app.refresh();
    } });
    actions.push({ label: 'Remove', tone: 'danger', onClick: async (c) => {
      c();
      const ok = await confirmDialog({ title: 'Remove entry', message: `Remove the blacklist entry for ${b.name}?`, confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      const cur = getBlacklistEntry(id);
      upsertBlacklistEntry({ ...cur, deleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: (cur.version || 1) + 1 });
      toast('Entry removed.', 'success');
      app.refresh();
    } });
  }

  openModal({ title: `Blacklist \u2014 ${b.name}`, wide: true, body: detail, actions });
}

function openEdit(app, b) {
  const actor = app.user;
  const body = `
    <div class="field"><label>Name / handle</label><input id="be-name" type="text" value="${esc(b.name)}" /></div>
    <div class="field"><label>Identifier</label><input id="be-id" type="text" value="${esc(b.identifier || '')}" placeholder="optional" /></div>
    <div class="field"><label>Severity</label><select id="be-sev">${BLACKLIST_SEVERITY_ORDER.map((s) => `<option value="${s}" ${s === b.severity ? 'selected' : ''}>${esc(BLACKLIST_SEVERITY[s].label)}</option>`).join('')}</select></div>
    <div class="field"><label>Reason</label><textarea id="be-reason" rows="3">${esc(b.reason || '')}</textarea></div>`;
  openModal({
    title: `Edit \u2014 ${b.name}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save', tone: 'primary', onClick: (c, d) => {
          const name = d.querySelector('#be-name').value.trim() || b.name;
          const identifier = d.querySelector('#be-id').value.trim();
          const severity = d.querySelector('#be-sev').value;
          const reason = d.querySelector('#be-reason').value.trim();
          const cur = getBlacklistEntry(b.id);
          if (!cur || !canManageOrg(actor, cur.org)) { toast('You cannot edit this entry.', 'error'); return; }
          upsertBlacklistEntry({ ...cur, name, identifier: identifier || null, severity, reason, updatedAt: new Date().toISOString(), version: (cur.version || 1) + 1 });
          c();
          toast('Entry updated.', 'success');
          app.refresh();
        } },
    ],
  });
}
