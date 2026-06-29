// =============================================================================
// views/compartments.js — Need-To-Know compartments.
//
// A compartment is an access caveat that sits ALONGSIDE the clearance ladder.
// To see a compartmented record an operator must clear the normal clearance
// gate AND be "read into" the compartment (or hold CL5, the universal read
// override). This view lists the compartments the operator administers or is
// read into, and — for administrators — manages the read-in roster, sealing and
// removal. Every mutation routes through the permission engine, is
// version-stamped for conflict safety, and is audit-logged; in server mode the
// Worker re-authorizes each write and re-derives the roster on read.
// =============================================================================

import {
  COMPARTMENT_STATUS, COMPARTMENT_STATUS_ORDER, CLEARANCE_ORDER, CLEARANCES,
  ORGS, ORG_ORDER, clearanceWeight,
} from '../constants.js';
import {
  compartments, getCompartment, upsertCompartment, getUser, users,
  subjects, cases, directives, newId,
} from '../storage.js';
import {
  canManageCompartment, readIntoCompartment, canReadOperatorInto,
  canManageOrg, isCL5,
} from '../permissions.js';
import { logAction } from '../audit.js';
import {
  esc, fmtDate, fmtDateTime, clearanceBadge, orgTag, monogram,
  toast, openModal, confirmDialog,
} from '../ui.js';

const filter = { q: '', org: '', status: '' };

// --- Badge renderers --------------------------------------------------------
const statusBadge = (s) => {
  const m = COMPARTMENT_STATUS[s] || { label: s, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};
const accessBadge = (a) => {
  const m = { admin: ['warn', 'Administrator'], member: ['ok', 'Read in'], none: ['muted', 'No access'] }[a] || ['muted', a];
  return `<span class="badge badge--${m[0]}">${esc(m[1])}</span>`;
};
const caveatChip = (name) => `<span class="caveat-chip">\u25c8 ${esc(name)}</span>`;

// --- Server/standalone-agnostic helpers -------------------------------------
// In server mode the snapshot carries `access` (admin/member/none) and
// `membersCount`; members[] is present only for administrators. Standalone mode
// recomputes from the permission engine.
function accessOf(actor, c) {
  if (c.access) return c.access;
  if (canManageCompartment(actor, c)) return 'admin';
  return readIntoCompartment(actor, c) ? 'member' : 'none';
}
const memberCount = (c) => (typeof c.membersCount === 'number'
  ? c.membersCount
  : (Array.isArray(c.members) ? c.members.length : 0));

function visibleCompartments(actor) {
  return compartments().filter((c) => !c.deleted && accessOf(actor, c) !== 'none');
}
function manageableOrgs(actor) {
  return ORG_ORDER.filter((o) => canManageOrg(actor, o));
}

// --- Shared mutation helper (version-stamped, audited) ----------------------
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getCompartment(id);
  if (!fresh) { toast('Compartment no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This compartment was changed elsewhere. Reloading the latest version.', 'warn');
    app.refresh();
    return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertCompartment(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}

function addCompEvent(comp, type, text) {
  comp.events = comp.events || [];
  comp.events.unshift({ id: newId('cev'), at: new Date().toISOString(), type, text });
}

// ===========================================================================
// REGISTRY LIST
// ===========================================================================
export function renderList(host, app) {
  const actor = app.user;
  const mine = visibleCompartments(actor);

  const shown = mine
    .filter((c) => {
      if (filter.org && c.org !== filter.org) return false;
      if (filter.status && c.status !== filter.status) return false;
      if (filter.q) {
        const hay = `${c.ref} ${c.name} ${c.codeword || ''}`.toLowerCase();
        if (!hay.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const orgOpts = ['', ...ORG_ORDER]
    .map((o) => `<option value="${o}" ${filter.org === o ? 'selected' : ''}>${o ? esc(ORGS[o].name) : 'All organisations'}</option>`).join('');
  const statusOpts = ['', ...COMPARTMENT_STATUS_ORDER]
    .map((s) => `<option value="${s}" ${filter.status === s ? 'selected' : ''}>${s ? esc(COMPARTMENT_STATUS[s].label) : 'All statuses'}</option>`).join('');

  const rows = shown.length ? shown.map((c) => `
    <tr data-id="${esc(c.id)}" tabindex="0">
      <td class="mono">${esc(c.codeword || c.name)}</td>
      <td class="cell-name">${esc(c.name)}</td>
      <td>${orgTag(c.org)}</td>
      <td>${clearanceBadge(c.clearance)}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="cell-center">${memberCount(c)}</td>
      <td>${accessBadge(accessOf(actor, c))}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`).join('') : `
    <tr><td colspan="8" class="empty">No compartments match the current filters.</td></tr>`;

  const canCreate = manageableOrgs(actor).length > 0;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Need-To-Know</div>
        <h1 class="page-title">Compartments</h1>
        <div class="page-sub">${mine.length} compartment${mine.length === 1 ? '' : 's'} you administer or are read into</div>
      </div>
      ${canCreate ? '<button class="btn btn--primary" id="add-comp">+ New compartment</button>' : ''}
    </div>

    <div class="ntk-note card">
      <div class="card__body">
        A compartment is an access caveat <strong>independent of clearance</strong>. Seeing a compartmented
        record requires clearing its clearance level <strong>and</strong> being read into the compartment.
        CL5 is a universal read override. Only compartments you administer or are read into are listed here.
      </div>
    </div>

    <div class="toolbar">
      <input id="flt-q" class="toolbar__search" type="search" placeholder="Search codeword or name\u2026" value="${esc(filter.q)}" />
      <select id="flt-org" class="toolbar__select">${orgOpts}</select>
      <select id="flt-status" class="toolbar__select">${statusOpts}</select>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Codeword</th><th>Name</th><th>Org</th><th>Floor</th>
            <th>Status</th><th>Read-in</th><th>Your access</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const go = (id) => app.navigate(`#/compartment/${id}`);
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => go(tr.dataset.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(tr.dataset.id); });
  });

  const q = host.querySelector('#flt-q');
  q.addEventListener('input', () => { filter.q = q.value; renderList(host, app); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
  host.querySelector('#flt-org').addEventListener('change', (e) => { filter.org = e.target.value; renderList(host, app); });
  host.querySelector('#flt-status').addEventListener('change', (e) => { filter.status = e.target.value; renderList(host, app); });

  const addBtn = host.querySelector('#add-comp');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app));
}

// ===========================================================================
// COMPARTMENT DETAIL
// ===========================================================================
export function renderCompartment(host, app, id) {
  const actor = app.user;
  const c = getCompartment(id);

  if (!c || c.deleted || accessOf(actor, c) === 'none') {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Compartment not found</h1>
      <div class="page-sub">This compartment does not exist, has been removed, or you are not read into it.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Need-To-Know</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/compartments'));
    return;
  }

  const access = accessOf(actor, c);
  const isAdmin = access === 'admin';
  const hasRoster = isAdmin && Array.isArray(c.members);
  const sealed = c.status === 'sealed';

  // Roster (administrators only).
  const rosterRows = hasRoster ? (c.members.length ? c.members.map((mid) => {
    const u = getUser(mid);
    const label = u ? `<span class="mono">${esc(u.designation)}</span> \u00b7 ${esc(u.codename)} ${orgTag(u.org)} ${clearanceBadge(u.clearance)}`
      : `<span class="mono">${esc(mid)}</span> <span class="muted-text">(not visible)</span>`;
    return `<div class="bin-row">
      <div>${label}</div>
      <div class="bin-row__actions"><button class="btn btn--xs btn--danger" data-readout="${esc(mid)}">Read out</button></div>
    </div>`;
  }).join('') : '<div class="empty">No operators are read into this compartment.</div>') : '';

  // Records filed under this compartment that are present in the (already
  // access-filtered) working set. In server mode the snapshot only contains
  // records the viewer is cleared to see, so this listing is access-correct.
  const taggedSubjects = subjects().filter((s) => !s.deleted && s.compartment === id);
  const taggedCases = cases().filter((x) => !x.deleted && x.compartment === id);
  const taggedDirectives = directives().filter((d) => !d.deleted && d.compartment === id);
  const recordRow = (ref, name, hash) => `<a class="rec-link" href="${hash}"><span class="mono">${esc(ref)}</span> ${esc(name)}</a>`;
  const records = [
    ...taggedSubjects.map((s) => recordRow(s.ref, s.alias, `#/subject/${s.id}`)),
    ...taggedCases.map((x) => recordRow(x.ref, x.title, `#/case/${x.id}`)),
    ...taggedDirectives.map((d) => recordRow(d.ref, d.title, `#/directive/${d.id}`)),
  ];

  const events = c.events || [];
  const eventItems = events.length ? events.map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(e.type || 'note')}"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(e.text)}</div>
        <div class="tl__meta"><span class="tl__type">${esc(e.type || 'note')}</span> \u00b7 ${fmtDate(e.at)}</div>
      </div>
    </li>`).join('') : '<div class="empty">No compartment history recorded.</div>';

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Need-To-Know</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--ethics">${esc(monogram(c.name))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(c.name)} ${caveatChip(c.codeword || c.name)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(c.ref)}</span>
          ${orgTag(c.org)}
          ${statusBadge(c.status)}
          ${clearanceBadge(c.clearance)}
          ${accessBadge(access)}
        </div>
      </div>
    </header>

    ${isAdmin ? `<div class="actionbar">
      ${sealed
        ? '<button class="btn btn--sm" data-act="unseal">Unseal</button>'
        : '<button class="btn btn--sm" data-act="readin">Read in operator</button><button class="btn btn--sm" data-act="seal">Seal</button>'}
      <button class="btn btn--sm" data-act="edit">Edit</button>
      <button class="btn btn--sm btn--danger" data-act="remove">Remove</button>
    </div>` : `<div class="ntk-note card"><div class="card__body">You are <strong>read into</strong> this compartment. Roster administration is restricted to compartment administrators.</div></div>`}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Compartment Record</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Reference</span><span class="kv__v mono">${esc(c.ref)}</span></div>
          <div class="kv"><span class="kv__k">Codeword</span><span class="kv__v">${caveatChip(c.codeword || c.name)}</span></div>
          <div class="kv"><span class="kv__k">Organisation</span><span class="kv__v">${orgTag(c.org)} ${esc(ORGS[c.org].name)}</span></div>
          <div class="kv"><span class="kv__k">Clearance floor</span><span class="kv__v">${clearanceBadge(c.clearance)}</span></div>
          <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${statusBadge(c.status)}</span></div>
          <div class="kv"><span class="kv__k">Read-in</span><span class="kv__v">${memberCount(c)} operator${memberCount(c) === 1 ? '' : 's'}</span></div>
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(c.createdAt)} \u00b7 <span class="mono">${esc(c.createdBy || 'SYSTEM')}</span></span></div>
          <div class="kv"><span class="kv__k">Updated</span><span class="kv__v">${fmtDateTime(c.updatedAt)}</span></div>
        </div>
      </section>
      <div class="dossier-col">
        <section class="card">
          <div class="card__title">Charter</div>
          <div class="card__body"><p class="subj-summary">${esc(c.description || 'No description on record.')}</p></div>
        </section>
        ${isAdmin ? `<section class="card">
          <div class="card__title">Read-in Roster</div>
          <div class="card__body">${rosterRows}</div>
        </section>` : ''}
        ${records.length ? `<section class="card">
          <div class="card__title">Compartmented Records</div>
          <div class="card__body"><div class="rec-list">${records.join('')}</div></div>
        </section>` : ''}
        <section class="card">
          <div class="card__title">Compartment History</div>
          <div class="card__body">${events.length ? `<ul class="timeline">${eventItems}</ul>` : eventItems}</div>
        </section>
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/compartments'));

  const dispatch = {
    readin: () => openReadIn(app, c),
    seal: () => toggleSeal(app, c, true),
    unseal: () => toggleSeal(app, c, false),
    edit: () => openEdit(app, c),
    remove: () => removeCompartment(app, c),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act]()));
  host.querySelectorAll('[data-readout]').forEach((b) => b.addEventListener('click', () => readOut(app, c, b.dataset.readout)));
}

// ===========================================================================
// ACTION MODALS
// ===========================================================================
function selectField(id, label, options, selected, labeller = (x) => x) {
  const opts = options.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(labeller(o))}</option>`).join('');
  return `<div class="field"><label>${esc(label)}</label><select id="${id}">${opts}</select></div>`;
}

function suggestRef(name) {
  const slug = (name || 'COMPARTMENT').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  let ref = `NTK-${slug}`;
  const taken = (r) => compartments().some((c) => c.ref.toLowerCase() === r.toLowerCase());
  if (!taken(ref)) return ref;
  let n = 2;
  while (taken(`${ref}-${n}`)) n += 1;
  return `${ref}-${n}`;
}

function openCreate(app) {
  const actor = app.user;
  const orgs = manageableOrgs(actor);
  if (!orgs.length) { toast('You cannot open compartments.', 'error'); return; }
  const ceiling = clearanceWeight(actor.clearance);
  // Floor cannot exceed your own clearance — you can't open a compartment more
  // exclusive than your own access (you'd lock yourself out).
  const allowedFloor = CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= ceiling);

  const body = `
    <p class="modal__message">Open a Need-To-Know compartment. You are read in automatically. The clearance floor is the minimum clearance any read-in operator must hold.</p>
    <div class="field"><label>Name / codeword</label><input id="cm-name" type="text" placeholder="e.g. NIGHTJAR" /></div>
    ${selectField('cm-org', 'Organisation', orgs, orgs[0], (o) => ORGS[o].name)}
    ${selectField('cm-clr', 'Clearance floor', allowedFloor, allowedFloor[allowedFloor.length - 1], (c) => CLEARANCES[c].label)}
    <div class="field"><label>Charter / description</label><textarea id="cm-desc" rows="3" placeholder="What does this compartment cover?"></textarea></div>
    <div id="cm-err" class="auth__error" hidden></div>
  `;

  openModal({
    title: 'New compartment',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (close) => close() },
      { label: 'Open compartment', tone: 'primary', onClick: (close, d) => {
          const name = d.querySelector('#cm-name').value.trim();
          const org = d.querySelector('#cm-org').value;
          const clr = d.querySelector('#cm-clr').value;
          const desc = d.querySelector('#cm-desc').value.trim();
          const err = d.querySelector('#cm-err');
          err.hidden = true;

          if (!name) { err.textContent = 'A name or codeword is required.'; err.hidden = false; return; }
          if (!canManageOrg(actor, org)) { err.textContent = 'You cannot open compartments for that organisation.'; err.hidden = false; return; }
          const ref = suggestRef(name);
          // Read the creator in only if they meet the floor (they always can,
          // since the floor is capped at their own clearance above).
          const selfMember = clearanceWeight(actor.clearance) >= clearanceWeight(clr) ? [actor.id] : [];
          const now = new Date().toISOString();
          upsertCompartment({
            id: newId('cmp'), ref, name, codeword: name.toUpperCase(), org,
            clearance: clr, description: desc, status: 'active',
            members: selfMember,
            events: [{ id: newId('cev'), at: now, type: 'opened', text: `Compartment opened by ${actor.designation}.` }],
            createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'CREATE_COMPARTMENT', `Opened compartment ${name} (${ref}).`);
          close();
          toast(`Compartment ${name} opened.`, 'success');
          app.navigate('#/compartments');
        } },
    ],
  });
}

function openEdit(app, c) {
  const actor = app.user;
  const ceiling = clearanceWeight(actor.clearance);
  const allowedFloor = CLEARANCE_ORDER.filter((x) => clearanceWeight(x) <= ceiling);
  const floorSel = allowedFloor.includes(c.clearance) ? c.clearance : allowedFloor[allowedFloor.length - 1];
  const body = `
    <div class="field"><label>Name / codeword</label><input id="ce-name" type="text" value="${esc(c.name)}" /></div>
    ${selectField('ce-clr', 'Clearance floor', allowedFloor, floorSel, (x) => CLEARANCES[x].label)}
    ${selectField('ce-status', 'Status', COMPARTMENT_STATUS_ORDER, c.status, (x) => COMPARTMENT_STATUS[x].label)}
    <div class="field"><label>Charter / description</label><textarea id="ce-desc" rows="4">${esc(c.description || '')}</textarea></div>
    <p class="modal__message">Raising the floor does not read out operators already below it — read them out manually if required.</p>
  `;
  openModal({
    title: `Edit \u2014 ${c.name}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (close) => close() },
      { label: 'Save changes', tone: 'primary', onClick: (close, d) => {
          const name = d.querySelector('#ce-name').value.trim() || c.name;
          const clr = d.querySelector('#ce-clr').value;
          const status = d.querySelector('#ce-status').value;
          const desc = d.querySelector('#ce-desc').value.trim();
          mutate(app, c.id, c.version, (rec) => {
            const before = rec.status;
            rec.name = name; rec.codeword = name.toUpperCase();
            rec.clearance = clr; rec.status = status; rec.description = desc;
            if (before !== status) addCompEvent(rec, status === 'sealed' ? 'sealed' : 'opened', status === 'sealed' ? 'Compartment sealed.' : 'Compartment unsealed.');
          }, { action: 'EDIT_COMPARTMENT', detail: `${c.name} updated.` });
          close();
          toast('Compartment updated.', 'success');
        } },
    ],
  });
}

function openReadIn(app, c) {
  const actor = app.user;
  if (c.status === 'sealed') { toast('A sealed compartment cannot take new read-ins.', 'error'); return; }
  const current = new Set(Array.isArray(c.members) ? c.members : []);
  // Eligible: active, not already read in, meets the clearance floor.
  const eligible = users().filter((u) => !u.deleted && u.accountStatus === 'active'
    && !current.has(u.id)
    && clearanceWeight(u.clearance) >= clearanceWeight(c.clearance));

  if (!eligible.length) {
    openModal({
      title: `Read in \u2014 ${c.name}`,
      body: '<p class="modal__message">No eligible operators. Everyone who meets this compartment\u2019s clearance floor is already read in.</p>',
      actions: [{ label: 'Close', tone: 'primary', onClick: (close) => close() }],
    });
    return;
  }

  const opts = eligible
    .sort((a, b) => a.designation.localeCompare(b.designation))
    .map((u) => `<option value="${esc(u.id)}">${esc(u.designation)} \u00b7 ${esc(u.codename)} \u2014 ${esc(CLEARANCES[u.clearance]?.label || u.clearance)} \u00b7 ${esc(ORGS[u.org]?.short || u.org)}</option>`).join('');

  const body = `
    <p class="modal__message">Read an operator into <strong>${esc(c.name)}</strong>. They must meet the clearance floor (${esc(CLEARANCES[c.clearance]?.label || c.clearance)}).</p>
    <div class="field"><label>Operator</label><select id="ri-user">${opts}</select></div>
    <div class="field"><label>Justification (optional)</label><input id="ri-reason" type="text" placeholder="operational need\u2026" /></div>
  `;
  openModal({
    title: `Read in \u2014 ${c.name}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (close) => close() },
      { label: 'Read in', tone: 'primary', onClick: (close, d) => {
          const uid = d.querySelector('#ri-user').value;
          const u = getUser(uid);
          if (!u) { toast('Select an operator.', 'error'); return; }
          if (!canReadOperatorInto(actor, c, u)) { toast('That operator cannot be read into this compartment.', 'error'); return; }
          const reason = d.querySelector('#ri-reason').value.trim();
          mutate(app, c.id, c.version, (rec) => {
            rec.members = [...(rec.members || []), uid];
            addCompEvent(rec, 'read-in', `${u.designation} read in${reason ? ` \u2014 ${reason}` : ''}.`);
          }, { action: 'READ_IN', detail: `${u.designation} read into ${c.name}.` });
          close();
          toast(`${u.designation} read in.`, 'success');
        } },
    ],
  });
}

async function readOut(app, c, memberId) {
  const u = getUser(memberId);
  const who = u ? `${u.designation} \u00b7 ${u.codename}` : memberId;
  const ok = await confirmDialog({
    title: 'Read out operator',
    message: `Remove ${who} from compartment ${c.name}? They will lose access to its records.`,
    confirmLabel: 'Read out',
    danger: true,
  });
  if (!ok) return;
  mutate(app, c.id, c.version, (rec) => {
    rec.members = (rec.members || []).filter((m) => m !== memberId);
    addCompEvent(rec, 'read-out', `${u ? u.designation : memberId} read out.`);
  }, { action: 'READ_OUT', detail: `${u ? u.designation : memberId} read out of ${c.name}.` });
  toast('Operator read out.', 'success');
}

async function toggleSeal(app, c, seal) {
  const ok = await confirmDialog({
    title: seal ? 'Seal compartment' : 'Unseal compartment',
    message: seal
      ? `Seal ${c.name}? Existing read-ins keep access, but no new operators can be read in until it is unsealed.`
      : `Unseal ${c.name}? Operators can be read in again.`,
    confirmLabel: seal ? 'Seal' : 'Unseal',
  });
  if (!ok) return;
  mutate(app, c.id, c.version, (rec) => {
    rec.status = seal ? 'sealed' : 'active';
    addCompEvent(rec, seal ? 'sealed' : 'opened', seal ? 'Compartment sealed.' : 'Compartment unsealed.');
  }, { action: 'EDIT_COMPARTMENT', detail: `${c.name} ${seal ? 'sealed' : 'unsealed'}.` });
  toast(seal ? 'Compartment sealed.' : 'Compartment unsealed.', 'success');
}

async function removeCompartment(app, c) {
  const ok = await confirmDialog({
    title: 'Remove compartment',
    message: `Move compartment ${c.name} to the recycle bin? Records filed under it will be inaccessible to everyone below CL5 until it is restored.`,
    confirmLabel: 'Remove compartment',
    danger: true,
  });
  if (!ok) return;
  const fresh = getCompartment(c.id);
  if (!fresh) { app.refresh(); return; }
  fresh.deleted = true;
  fresh.deletedAt = new Date().toISOString();
  fresh.version += 1;
  upsertCompartment(fresh);
  logAction(app.user, 'REMOVE_COMPARTMENT', `Compartment ${c.name} moved to recycle bin.`);
  toast('Compartment moved to recycle bin.', 'success');
  app.navigate('#/compartments');
}
