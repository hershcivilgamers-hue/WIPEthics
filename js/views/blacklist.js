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
  EXTERNAL_BLACKLIST_SETTING_ID, normalizeSheetSources, toSheetCsvUrl, parseCsv, mapSheetRows,
} from '../constants.js';
import { blacklist, getBlacklistEntry, upsertBlacklistEntry, newId, getSetting, upsertSetting } from '../storage.js';
import { canManageOrg, isCL5, canManageSettings } from '../permissions.js';
import { esc, fmtDate, orgTag, toast, openModal, confirmDialog } from '../ui.js';
import { logAction } from '../audit.js';

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
    ${canManageSettings(actor) ? '<div class="toolbar" style="justify-content:flex-end"><button class="btn btn--sm" id="bl-sources">Manage external sheets</button></div>' : ''}
    <div id="bl-external"></div>
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
  const srcBtn = host.querySelector('#bl-sources');
  if (srcBtn) srcBtn.addEventListener('click', () => openSources(app));
  loadExternalSheets(host.querySelector('#bl-external'));
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
    <div class="kv kv--stack"><span class="kv__k">Reason</span><span class="kv__v">${esc(b.reason || '\u2014')}</span></div>
    ${b.appeal ? `<div class="kv kv--stack"><span class="kv__k">Appeal</span><span class="kv__v">
        <div>${b.appeal.status === 'pending' ? 'Pending review' : `<strong>${esc(b.appeal.status)}</strong> by ${esc(b.appeal.resolvedBy || '')}`} \u00b7 filed by ${esc(b.appeal.filedBy || '')} ${b.appeal.at ? `\u00b7 ${fmtDate(b.appeal.at)}` : ''}</div>
        <div class="muted-text">\u201c${esc(b.appeal.text)}\u201d</div>
        ${b.appeal.resolution ? `<div>Resolution: ${esc(b.appeal.resolution)}</div>` : ''}
      </span></div>` : ''}`;

  const actions = [{ label: 'Close', tone: 'ghost', onClick: (c) => c() }];
  // Any signed-in operator may file an appeal on the barred individual's behalf.
  if (!b.appeal && !lifted) {
    actions.push({ label: 'File appeal', tone: 'ghost', onClick: (c) => { c(); openBlacklistAppeal(app, b); } });
  }
  // A manager of the raising org rules on a pending appeal.
  if (canManage && b.appeal && b.appeal.status === 'pending') {
    actions.push({ label: 'Rule on appeal', tone: 'primary', onClick: (c) => { c(); openResolveBlacklistAppeal(app, b); } });
  }
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

// Any operator may file an appeal against a blacklist entry on the barred
// individual's behalf. One appeal per entry; grounds are immutable once filed.
function openBlacklistAppeal(app, b) {
  const actor = app.user;
  openModal({
    title: 'Appeal blacklist entry',
    wide: true,
    body: `
      <p class="modal__message">File an appeal against the entry for <strong>${esc(b.name)}</strong>${b.identifier ? ` (<span class="mono">${esc(b.identifier)}</span>)` : ''}. Record it in your own name; the grounds cannot be edited once filed.</p>
      <div class="field"><label>Grounds of appeal</label><textarea id="bla-grounds" rows="4" placeholder="State why this entry should be overturned\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'File appeal', tone: 'primary', onClick: (c, d) => {
          const text = d.querySelector('#bla-grounds').value.trim();
          if (!text) { toast('State the grounds of the appeal.', 'error'); return; }
          const cur = getBlacklistEntry(b.id);
          upsertBlacklistEntry({ ...cur, appeal: { text, at: new Date().toISOString(), status: 'pending', filedBy: actor.designation }, updatedAt: new Date().toISOString(), version: (cur.version || 1) + 1 });
          logAction(actor, 'APPEAL_BLACKLIST', `Appeal filed against the blacklist entry for ${cur.name}.`);
          c(); toast('Appeal filed \u2014 awaiting a ruling.', 'success'); app.refresh();
        } },
    ],
  });
}

// A manager rules on a pending blacklist appeal. Overturning lifts the entry in
// the same act; it remains on the register marked overturned.
function openResolveBlacklistAppeal(app, b) {
  const actor = app.user;
  if (!canManageOrg(actor, b.org)) { toast('Only a manager of the raising organisation may rule on this.', 'error'); return; }
  if (!b.appeal || b.appeal.status !== 'pending') return;
  openModal({
    title: 'Rule on appeal',
    wide: true,
    body: `
      <p class="modal__message">Entry: <strong>${esc(b.name)}</strong> \u2014 ${esc(b.reason || '')}</p>
      <p class="modal__message">Grounds: \u201c${esc(b.appeal.text)}\u201d (filed by ${esc(b.appeal.filedBy || '')})</p>
      <label class="radio-row"><input type="radio" name="bla-ruling" value="overturned" checked /> <span><strong>Overturn</strong> \u2014 the appeal succeeds; the entry is lifted but remains on the register, marked overturned.</span></label>
      <label class="radio-row"><input type="radio" name="bla-ruling" value="upheld" /> <span><strong>Uphold</strong> \u2014 the entry stands. The appeal and ruling remain on record.</span></label>
      <div class="field" style="margin-top:10px"><label>Resolution</label><textarea id="bla-res" rows="3" placeholder="Reasoning for the ruling\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Enter ruling', tone: 'primary', onClick: (c, d) => {
          const ruling = (d.querySelector('input[name="bla-ruling"]:checked') || {}).value;
          const resolution = d.querySelector('#bla-res').value.trim();
          if (!resolution) { toast('A ruling must state its reasoning.', 'error'); return; }
          const cur = getBlacklistEntry(b.id);
          const next = { ...cur, appeal: { ...cur.appeal, status: ruling, resolvedBy: actor.designation, resolvedAt: new Date().toISOString(), resolution }, updatedAt: new Date().toISOString(), version: (cur.version || 1) + 1 };
          if (ruling === 'overturned') next.status = 'lifted';
          upsertBlacklistEntry(next);
          logAction(actor, 'RESOLVE_BLACKLIST_APPEAL', `Blacklist appeal ${ruling} for ${cur.name}.`);
          c(); toast(ruling === 'overturned' ? 'Appeal overturned \u2014 entry lifted.' : 'Appeal upheld \u2014 entry stands.', 'success'); app.refresh();
        } },
    ],
  });
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

// --- External Google Sheets --------------------------------------------------
function sheetSources() {
  const rec = getSetting(EXTERNAL_BLACKLIST_SETTING_ID);
  return normalizeSheetSources(rec && rec.data);
}

// Cache of parsed external entries for this render, so the SteamID search is
// instant after the initial fetch. Each item: { source, entry }.
let externalCache = [];
let externalState = 'idle';

// Fetch and parse configured sheets, but DON'T display them. Entries stay hidden
// behind a SteamID search — the register is only revealed for a specific lookup.
async function loadExternalSheets(container) {
  if (!container) return;
  const sources = sheetSources();
  if (!sources.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="card">
      <div class="card__title">External department blacklists</div>
      <div class="card__body">
        <p class="field__hint">${sources.length} linked sheet${sources.length === 1 ? '' : 's'}. Enter a SteamID (or identifier) to search the external registers \u2014 entries are hidden until you search.</p>
        <div class="toolbar" style="margin:0">
          <input id="bl-ext-q" class="toolbar__search" type="search" placeholder="Search external sheets by SteamID\u2026" autocomplete="off" disabled />
        </div>
        <div id="bl-ext-results" class="bl-ext-results"><div class="muted-text">Loading external sheets\u2026</div></div>
      </div>
    </div>`;

  const input = container.querySelector('#bl-ext-q');
  const results = container.querySelector('#bl-ext-results');

  // Fetch all sources into the cache (client-side; a published sheet serves CSV
  // with permissive CORS). Per-source failures are noted but don't block others.
  externalCache = [];
  externalState = 'loading';
  const problems = [];
  await Promise.all(sources.map(async (s) => {
    try {
      const res = await fetch(toSheetCsvUrl(s.url), { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = mapSheetRows(parseCsv(await res.text()));
      for (const e of entries) externalCache.push({ source: s.label, url: s.url, entry: e });
    } catch (err) {
      problems.push(`${s.label}: ${err.message}`);
    }
  }));
  externalState = 'ready';

  input.disabled = false;
  const problemNote = problems.length ? `<div class="field__hint" style="color:var(--warn)">Could not load: ${esc(problems.join('; '))}. Sheets must be published to the web or link-shared.</div>` : '';
  const idle = () => { results.innerHTML = `<div class="muted-text">Enter a SteamID above to search ${externalCache.length} external entr${externalCache.length === 1 ? 'y' : 'ies'}.</div>${problemNote}`; };
  idle();

  const runSearch = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { idle(); return; }
    // Match primarily on the identifier (SteamID); also match the name as a fallback.
    const hits = externalCache.filter(({ entry }) =>
      (entry.identifier && entry.identifier.toLowerCase().includes(q))
      || (entry.name && entry.name.toLowerCase().includes(q)));
    if (!hits.length) { results.innerHTML = `<div class="empty">No external entries match \u201c${esc(input.value.trim())}\u201d.</div>`; return; }
    results.innerHTML = `
      <table class="data-table"><thead><tr><th>Name</th><th>Identifier</th><th>Severity</th><th>Reason</th><th>Source</th></tr></thead>
      <tbody>${hits.map(({ source, entry }) => `
        <tr><td class="cell-name">${esc(entry.name)}</td><td class="mono">${esc(entry.identifier || '\u2014')}</td><td>${esc(entry.severity || '\u2014')}</td><td>${esc(entry.reason || '\u2014')}</td><td class="muted-text">${esc(source)}</td></tr>`).join('')}</tbody></table>
      <div class="field__hint">${hits.length} match${hits.length === 1 ? '' : 'es'} \u00b7 read-only from linked sheets.</div>`;
  };
  input.addEventListener('input', runSearch);
}

function openSources(app) {
  const sources = sheetSources();
  const rows = sources.length ? sources.map((s) => `
    <div class="tag-admin-row">
      <span>${esc(s.label)}</span>
      <span class="mono muted-text" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(s.url)}</span>
      <button class="btn btn--xs btn--danger" data-src-remove="${esc(s.id)}">Remove</button>
    </div>`).join('') : '<div class="empty">No external sheets configured.</div>';
  const body = `
    <p class="modal__message">Link department blacklists published as Google Sheets. Paste a share link or a \u201cpublish to web\u201d CSV link \u2014 the sheet must be viewable by anyone with the link.</p>
    <div class="tag-admin-list" id="src-list">${rows}</div>
    <div class="field" style="margin-top:var(--s3)"><label>Label</label><input id="src-label" type="text" placeholder="e.g. Security Department" maxlength="60" /></div>
    <div class="field"><label>Google Sheet URL</label><input id="src-url" type="text" placeholder="https://docs.google.com/spreadsheets/d/\u2026" /></div>`;
  const dlg = openModal({
    title: 'External blacklist sheets',
    wide: true,
    body,
    actions: [
      { label: 'Close', tone: 'ghost', onClick: (c) => c() },
      { label: 'Add sheet', tone: 'primary', onClick: (c, d) => {
          const label = d.querySelector('#src-label').value.trim();
          const url = d.querySelector('#src-url').value.trim();
          if (!label || !/^https?:\/\//.test(url)) { toast('Enter a label and a valid URL.', 'error'); return; }
          const next = [...sources, { id: newId('sht'), label, url }];
          const cur = getSetting(EXTERNAL_BLACKLIST_SETTING_ID) || { id: EXTERNAL_BLACKLIST_SETTING_ID, org: 'command' };
          cur.data = { sources: next };
          upsertSetting(cur);
          logAction(app.user, 'SET_SETTING', `Added external blacklist sheet \u201c${label}\u201d.`);
          c(); toast('Sheet linked.', 'success'); app.refresh();
        } },
    ],
  });
  dlg.querySelectorAll('[data-src-remove]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.srcRemove;
    const cur = getSetting(EXTERNAL_BLACKLIST_SETTING_ID) || { id: EXTERNAL_BLACKLIST_SETTING_ID, org: 'command' };
    cur.data = { sources: sources.filter((s) => s.id !== id) };
    upsertSetting(cur);
    logAction(app.user, 'SET_SETTING', 'Removed an external blacklist sheet.');
    toast('Sheet removed.', 'success');
    app.refresh();
  }));
}
