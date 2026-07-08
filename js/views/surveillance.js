// =============================================================================
// views/surveillance.js — Surveillance registry + subject file.
//
// A clearance-gated register of Persons of Interest (watch) and Acquisition
// Targets (pursuit). Each subject carries a sensitivity (minimum clearance);
// below it the record is inaccessible — enforced here on direct access, not
// merely hidden from the menu. All mutations route through the permission
// engine, are version-stamped for conflict safety, and are audit-logged.
// =============================================================================

import {
  SUBJECT_CLASS, SUBJECT_CLASS_ORDER, THREAT_LEVELS, THREAT_ORDER,
  SUBJECT_STATUS, SUBJECT_STATUS_ORDER, CLEARANCE_ORDER, CLEARANCES,
  ORGS, ORG_ORDER, clearanceWeight, TARGET_AUTH, targetAuthState,
} from '../constants.js';
import { subjects, getSubject, upsertSubject, compartments, getCompartment, newId, upsertCase, cases } from '../storage.js';
import {
  canViewSubject, canManageSubject, canClassifySubjectAt, canManageOrg,
  isCL5, readIntoCompartment, canManageTribunal, canViewCase,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { exportSubject } from '../export.js';
import {
  esc, fmtDate, fmtDateTime, relTime, clearanceBadge, orgTag,
  monogram, toast, openModal, confirmDialog,
} from '../ui.js';

const filter = { q: '', kind: '', status: '', threat: '' };

// --- Local badge renderers (kept here so ui.js stays domain-agnostic) -------
const kindTag = (k) => {
  const c = SUBJECT_CLASS[k] || { short: k, tone: 'muted' };
  return `<span class="subj-kind subj-kind--${c.tone}">${esc(c.short)}</span>`;
};
const threatBadge = (t) => {
  const m = THREAT_LEVELS[t] || { label: t, tone: 'muted' };
  return `<span class="badge badge--${m.tone} threat threat--${esc(t)}">${esc(m.label)}</span>`;
};
const subjStatusBadge = (s) => {
  const m = SUBJECT_STATUS[s] || { label: s, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};

// --- Need-To-Know caveat (kept local so ui.js stays domain-agnostic) --------
function caveatName(rec) {
  if (!rec || !rec.compartment) return null;
  return rec.compartmentName || (getCompartment(rec.compartment) || {}).name || 'COMPARTMENTED';
}
function caveatBanner(rec) {
  const n = caveatName(rec);
  return n ? `<div class="caveat-banner">\u25c8 NEED-TO-KNOW \u00b7 ${esc(n)} \u00b7 handling restricted to read-in personnel</div>` : '';
}
// Compartments this actor may file a record into (must be able to clear them).
function fileableCompartments(actor) {
  return compartments().filter((c) => !c.deleted
    && (isCL5(actor) || c.access === 'member' || readIntoCompartment(actor, c)));
}
function compartmentField(actor, selectedId) {
  const comps = fileableCompartments(actor);
  const opts = ['<option value="">\u2014 None (uncompartmented) \u2014</option>',
    ...comps.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)} (${esc(c.codeword || c.name)})</option>`)].join('');
  return `<div class="field"><label>Need-To-Know compartment</label><select id="su-comp">${opts}</select>
    <div class="field__hint">Only compartments you are read into are listed.</div></div>`;
}

// --- Shared mutation helper (version-stamped, audited) ----------------------
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getSubject(id);
  if (!fresh) { toast('Record no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This record was changed elsewhere. Reloading the latest version.', 'warn');
    app.refresh();
    return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertSubject(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}

function addLog(subject, type, by, text) {
  subject.logs = subject.logs || [];
  subject.logs.unshift({ id: newId('log'), ts: new Date().toISOString(), by, type, text });
}

// Orgs the actor is allowed to manage subjects for (used for creation).
function manageableOrgs(actor) {
  return ORG_ORDER.filter((o) => canManageOrg(actor, o));
}

// ===========================================================================
// REGISTRY LIST
// ===========================================================================
export function renderList(host, app) {
  const actor = app.user;
  const all = subjects().filter((s) => !s.deleted);

  // Split into what the operator may see and what is above their clearance.
  const visible = [];
  const locked = [];
  for (const s of all) {
    if (canViewSubject(actor, s)) visible.push(s); else locked.push(s);
  }

  const shown = visible
    .filter((s) => {
      if (filter.kind && s.kind !== filter.kind) return false;
      if (filter.status && s.status !== filter.status) return false;
      if (filter.threat && s.threat !== filter.threat) return false;
      if (filter.q) {
        const hay = `${s.ref} ${s.alias} ${s.lastKnownLocation || ''}`.toLowerCase();
        if (!hay.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) =>
      (THREAT_LEVELS[b.threat]?.weight || 0) - (THREAT_LEVELS[a.threat]?.weight || 0)
      || a.ref.localeCompare(b.ref));

  const kindOpts = ['', ...SUBJECT_CLASS_ORDER]
    .map((k) => `<option value="${k}" ${filter.kind === k ? 'selected' : ''}>${k ? esc(SUBJECT_CLASS[k].label) : 'All types'}</option>`).join('');
  const statusOpts = ['', ...SUBJECT_STATUS_ORDER]
    .map((s) => `<option value="${s}" ${filter.status === s ? 'selected' : ''}>${s ? esc(SUBJECT_STATUS[s].label) : 'All statuses'}</option>`).join('');
  const threatOpts = ['', ...THREAT_ORDER]
    .map((t) => `<option value="${t}" ${filter.threat === t ? 'selected' : ''}>${t ? esc(THREAT_LEVELS[t].label) : 'All threat levels'}</option>`).join('');

  const rows = shown.length ? shown.map((s) => `
    <tr data-id="${esc(s.id)}" tabindex="0">
      <td class="mono">${esc(s.ref)}</td>
      <td class="cell-name">${esc(s.alias)}</td>
      <td>${kindTag(s.kind)}</td>
      <td>${orgTag(s.org)}</td>
      <td>${threatBadge(s.threat)}</td>
      <td>${subjStatusBadge(s.status)}</td>
      <td>${clearanceBadge(s.clearance)}</td>
      <td class="cell-right"><span class="row-go">Open \u2192</span></td>
    </tr>`).join('') : `
    <tr><td colspan="8" class="empty">No subjects match the current filters.</td></tr>`;

  // Locked rows reveal only that a sealed record exists and the clearance it
  // needs — never the ref, alias, org, threat or any content.
  const lockedRows = locked.length ? locked.map((s) => `
    <tr class="row-locked">
      <td colspan="7" class="locked-cell">\u25a0\u25a0\u25a0 Sealed record \u2014 access restricted</td>
      <td class="cell-right">${clearanceBadge(s.clearance)}</td>
    </tr>`).join('') : '';

  const canCreate = manageableOrgs(actor).length > 0;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Surveillance</div>
        <h1 class="page-title">Subject Registry</h1>
        <div class="page-sub">${visible.length} accessible${locked.length ? ` \u00b7 ${locked.length} sealed above your clearance` : ''}</div>
      </div>
      ${canCreate ? `<button class="btn btn--primary" id="add-subject">+ New subject</button>` : ''}
    </div>

    <div class="toolbar">
      <input id="flt-q" class="toolbar__search" type="search" placeholder="Search ref, alias or location\u2026" value="${esc(filter.q)}" />
      <select id="flt-kind" class="toolbar__select">${kindOpts}</select>
      <select id="flt-threat" class="toolbar__select">${threatOpts}</select>
      <select id="flt-status" class="toolbar__select">${statusOpts}</select>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Ref</th><th>Alias</th><th>Type</th><th>Org</th>
            <th>Threat</th><th>Status</th><th>Sensitivity</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}${lockedRows}</tbody>
      </table>
    </div>
  `;

  const go = (id) => app.navigate(`#/subject/${id}`);
  host.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => go(tr.dataset.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(tr.dataset.id); });
  });

  const q = host.querySelector('#flt-q');
  q.addEventListener('input', () => { filter.q = q.value; renderList(host, app); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
  host.querySelector('#flt-kind').addEventListener('change', (e) => { filter.kind = e.target.value; renderList(host, app); });
  host.querySelector('#flt-threat').addEventListener('change', (e) => { filter.threat = e.target.value; renderList(host, app); });
  host.querySelector('#flt-status').addEventListener('change', (e) => { filter.status = e.target.value; renderList(host, app); });

  const addBtn = host.querySelector('#add-subject');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app));
}

// ===========================================================================
// SUBJECT FILE
// ===========================================================================
export function renderSubject(host, app, id) {
  const actor = app.user;
  const s = getSubject(id);

  if (!s || s.deleted) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Record not found</h1>
      <div class="page-sub">This subject does not exist or has been removed.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Registry</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/surveillance'));
    return;
  }

  // HARD ACCESS GATE — enforced on direct navigation, not just hidden in nav.
  if (!canViewSubject(actor, s)) {
    host.innerHTML = `
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Registry</button>
      <div class="denied">
        <div class="denied__mark">\u25a0\u25a0\u25a0</div>
        <h1 class="denied__title">Access denied</h1>
        <p class="denied__text">
          This surveillance record is sealed at ${esc(CLEARANCES[s.clearance].label)}.
          Your clearance does not permit access. This attempt has been logged.
        </p>
        ${clearanceBadge(s.clearance)}
      </div>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/surveillance'));
    logAction(actor, 'SUBJECT_ACCESS_DENIED', `Blocked access to sealed record ${s.ref}.`);
    return;
  }

  const canManage = canManageSubject(actor, s);
  const logs = s.logs || [];

  // Target authorisation banner + Ethics decision controls.
  const authState = targetAuthState(s);
  const canDecide = canManageTribunal(actor);
  let authBanner = '';
  if (authState === 'pending') {
    authBanner = `<div class="ntk-banner" style="border-color:var(--warn)">
      <strong>Pending Ethics authorisation.</strong> This Target was requested by
      <span class="mono">${esc((s.authorization && s.authorization.requestedBy) || 'surveillance')}</span>
      and is <em>not</em> authorised for termination until an Ethics Committee member signs off.
      ${canDecide ? '<div class="actionbar" style="margin-top:8px"><button class="btn btn--sm btn--danger" data-act="auth-approve">Authorise termination</button><button class="btn btn--sm btn--ghost" data-act="auth-refuse">Refuse</button></div>' : ''}
    </div>`;
  } else if (authState === 'authorised') {
    authBanner = `<div class="ntk-banner" style="border-color:var(--bad)">
      <strong>Authorised for termination.</strong> Signed off by
      <span class="mono">${esc((s.authorization && s.authorization.by) || 'Ethics Committee')}</span>${s.authorization && s.authorization.at ? ` on ${fmtDate(s.authorization.at)}` : ''}.
    </div>`;
  }

  // Cross-reference: cases citing this subject. Derived at render and inherently
  // clearance-safe — only cases already in the viewer's snapshot are visible;
  // any the viewer cannot open appear as a sealed stub.
  const citing = cases().filter((c) => !c.deleted && (c.linkedSubjectIds || []).includes(s.id));
  const refItems = citing.map((c) => (canViewCase(actor, c) && !c.redacted)
    ? `<a href="#/case/${esc(c.id)}">${esc(c.ref)} \u2014 ${esc(c.title)} <span class="muted-text">(${esc(c.kind)} \u00b7 ${esc(c.status)})</span></a>`
    : `<span class="sealed-ref">\u25a0 Sealed matter \u00b7 ${esc((CLEARANCES[c.clearance] || {}).label || c.clearance || 'restricted')}</span>`).join('');
  const refCard = citing.length ? `<section class="card">
      <div class="card__title">Referenced in Proceedings</div>
      <div class="card__body link-list">${refItems}</div>
    </section>` : '';

    const logItems = logs.length ? logs.map((l) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(l.type)}"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(l.text)}</div>
        <div class="tl__meta"><span class="tl__type">${esc(l.type)}</span> \u00b7 <span class="mono">${esc(l.by)}</span> \u00b7 ${fmtDate(l.ts)}</div>
      </div>
    </li>`).join('') : '<div class="empty">No surveillance entries recorded.</div>';

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Registry</button>
      <button class="btn btn--sm" id="export-subject">\u2913 Export record</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--${SUBJECT_CLASS[s.kind]?.tone === 'bad' ? 'omega' : 'ethics'}">${esc(monogram(s.alias))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(s.alias)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(s.ref)}</span>
          ${kindTag(s.kind)}
          ${orgTag(s.org)}
          ${threatBadge(s.threat)}
          ${subjStatusBadge(s.status)}
          ${clearanceBadge(s.clearance)}
        </div>
      </div>
    </header>

    ${caveatBanner(s)}
    ${authBanner}

    ${canManage ? `<div class="actionbar">
      <button class="btn btn--sm" data-act="log">Add log entry</button>
      <button class="btn btn--sm" data-act="image">Add imagery</button>
      <button class="btn btn--sm" data-act="status">Set status</button>
      <button class="btn btn--sm" data-act="reclassify">Reclassify</button>
      <button class="btn btn--sm" data-act="edit">Edit</button>
      ${s.status !== 'closed' ? '<button class="btn btn--sm" data-act="close">Close watch</button>' : ''}
      <button class="btn btn--sm btn--danger" data-act="remove">Remove</button>
    </div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Subject Record</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Reference</span><span class="kv__v mono">${esc(s.ref)}</span></div>
          <div class="kv"><span class="kv__k">Classification</span><span class="kv__v">${esc(SUBJECT_CLASS[s.kind]?.label || s.kind)}</span></div>
          <div class="kv"><span class="kv__k">Organisation</span><span class="kv__v">${orgTag(s.org)} ${esc(ORGS[s.org].name)}</span></div>
          <div class="kv"><span class="kv__k">Threat</span><span class="kv__v">${threatBadge(s.threat)}</span></div>
          <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${subjStatusBadge(s.status)}</span></div>
          <div class="kv"><span class="kv__k">Sensitivity</span><span class="kv__v">${clearanceBadge(s.clearance)}</span></div>
          <div class="kv"><span class="kv__k">Last known</span><span class="kv__v">${esc(s.lastKnownLocation || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(s.createdAt)} \u00b7 <span class="mono">${esc(s.createdBy || 'SYSTEM')}</span></span></div>
          <div class="kv"><span class="kv__k">Updated</span><span class="kv__v">${fmtDateTime(s.updatedAt)}</span></div>
        </div>
      </section>
      <div class="dossier-col">
        <section class="card">
          <div class="card__title">Assessment</div>
          <div class="card__body"><p class="subj-summary">${esc(s.summary || 'No summary on record.')}</p></div>
        </section>
        ${refCard}
        <section class="card">
          <div class="card__title">Imagery</div>
          <div class="card__body">
            ${(s.images && s.images.length) ? `<div class="img-grid">${s.images.map((im) => `
              <button class="img-thumb" data-img="${esc(im.id)}" title="${esc(im.caption || '')}">
                <img src="${im.dataUrl}" alt="${esc(im.caption || 'surveillance image')}" loading="lazy" />
              </button>`).join('')}</div>` : '<div class="empty">No imagery on record.</div>'}
          </div>
        </section>
        <section class="card">
          <div class="card__title">Surveillance Log</div>
          <div class="card__body">
            ${logs.length ? `<ul class="timeline">${logItems}</ul>` : logItems}
          </div>
        </section>
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/surveillance'));
  host.querySelector('#export-subject').addEventListener('click', () => exportSubject(app, s));

  const dispatch = {
    log: () => openLog(app, s),
    image: () => addImage(app, s),
    status: () => openStatus(app, s),
    reclassify: () => openReclassify(app, s),
    edit: () => openEdit(app, s),
    close: () => closeSubject(app, s),
    remove: () => removeSubject(app, s),
    'auth-approve': () => decideTarget(app, s, true),
    'auth-refuse': () => decideTarget(app, s, false),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act]()));
  host.querySelectorAll('[data-img]').forEach((b) => b.addEventListener('click', () => openLightbox(app, s, b.dataset.img)));
}

// ===========================================================================
// IMAGERY
// ===========================================================================
// Images are stored inline on the subject record as downscaled JPEG data URLs.
// Surveillance records sync whole through the Worker and feed the snapshot, so
// images are aggressively downscaled (max ~800px, JPEG) and capped per record to
// keep payloads small; the access gate is the subject's own (you see a subject's
// imagery iff you can see the subject).
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 220 * 1024; // per compressed image, a guard against huge records

function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.click();
  });
}

function downscaleImage(file, maxDim = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('not an image')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        // JPEG keeps photographic surveillance stills small (transparency is not
        // needed here); fall back to PNG only if toDataURL refuses JPEG.
        let url = canvas.toDataURL('image/jpeg', quality);
        if (!url.startsWith('data:image/jpeg')) url = canvas.toDataURL('image/png');
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addImage(app, s) {
  if (!canManageSubject(app.user, s)) { toast('You cannot edit this record.', 'error'); return; }
  if ((s.images || []).length >= MAX_IMAGES) { toast(`A record holds at most ${MAX_IMAGES} images.`, 'error'); return; }
  const file = await pickImageFile();
  if (!file) return;
  let dataUrl;
  try { dataUrl = await downscaleImage(file); }
  catch { toast('That file could not be read as an image.', 'error'); return; }
  if (dataUrl.length > MAX_IMAGE_BYTES * 1.37) { // base64 is ~1.37x the byte size
    toast('That image is too detailed to store even after downscaling \u2014 try a smaller crop.', 'error');
    return;
  }

  openModal({
    title: 'Add imagery',
    wide: true,
    body: `
      <div class="img-preview"><img src="${dataUrl}" alt="preview" /></div>
      <div class="field"><label>Caption (optional)</label><input id="im-cap" type="text" placeholder="e.g. Subject at Sector 9 \u2014 14 Jun" /></div>
      <div class="field__hint">Stored downscaled (\u2264 800px) with the record.</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Add image', tone: 'primary', onClick: (c, d) => {
          const caption = d.querySelector('#im-cap').value.trim();
          mutate(app, s.id, s.version, (rec) => {
            rec.images = [...(rec.images || []), { id: newId('img'), dataUrl, caption, by: app.user.designation, at: new Date().toISOString() }];
          }, { action: 'EDIT_SUBJECT', detail: `Imagery added to ${s.ref}.` });
          c();
          toast('Image added to the record.', 'success');
        } },
    ],
  });
}

function openLightbox(app, s, imgId) {
  const im = (s.images || []).find((x) => x.id === imgId);
  if (!im) return;
  const canManage = canManageSubject(app.user, s);
  openModal({
    title: im.caption || 'Surveillance imagery',
    wide: true,
    body: `
      <div class="img-full"><img src="${im.dataUrl}" alt="${esc(im.caption || 'surveillance image')}" /></div>
      <div class="img-meta">Filed by <span class="mono">${esc(im.by || '\u2014')}</span> \u00b7 ${fmtDateTime(im.at)}</div>`,
    actions: canManage ? [
      { label: 'Remove image', tone: 'danger', onClick: async (c) => {
          c();
          const ok = await confirmDialog({ title: 'Remove image', message: 'Remove this image from the record?', confirmLabel: 'Remove', danger: true });
          if (!ok) return;
          mutate(app, s.id, s.version, (rec) => { rec.images = (rec.images || []).filter((x) => x.id !== imgId); }, { action: 'EDIT_SUBJECT', detail: `Imagery removed from ${s.ref}.` });
          toast('Image removed.', 'success');
        } },
      { label: 'Close', tone: 'primary', onClick: (c) => c() },
    ] : [{ label: 'Close', tone: 'primary', onClick: (c) => c() }],
  });
}

// ===========================================================================
// ACTION MODALS
// ===========================================================================
function selectField(id, label, options, selected, labeller = (x) => x) {
  const opts = options.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(labeller(o))}</option>`).join('');
  return `<div class="field"><label>${esc(label)}</label><select id="${id}">${opts}</select></div>`;
}

function openCreate(app) {
  const actor = app.user;
  const orgs = manageableOrgs(actor);
  if (!orgs.length) { toast('You cannot create surveillance records.', 'error'); return; }
  const ceiling = clearanceWeight(actor.clearance);
  const allowedClr = CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= ceiling);

  const body = `
    <p class="modal__message">Open a surveillance record. Sensitivity cannot exceed your own clearance.</p>
    ${selectField('su-kind', 'Classification', (canManageTribunal(actor) ? SUBJECT_CLASS_ORDER : ['poi']), 'poi', (k) => SUBJECT_CLASS[k].label)}
    ${canManageTribunal(actor) ? '<div class="field__hint">A Target is a termination authorisation. Creating one here records your Ethics authorisation. Others must open a Person of Interest and request conversion.</div>' : ''}
    <div class="field"><label>Reference</label><input id="su-ref" type="text" placeholder="e.g. POI-2240" /></div>
    <div class="field"><label>Alias / designation</label><input id="su-alias" type="text" placeholder="e.g. Courier" /></div>
    ${selectField('su-org', 'Organisation', orgs, orgs[0], (o) => ORGS[o].name)}
    ${selectField('su-threat', 'Threat level', THREAT_ORDER, 'low', (t) => THREAT_LEVELS[t].label)}
    ${selectField('su-clr', 'Sensitivity (min. clearance to view)', allowedClr, allowedClr[0], (c) => CLEARANCES[c].label)}
    <div class="field"><label>Last known location</label><input id="su-loc" type="text" placeholder="optional" /></div>
    <div class="field"><label>Assessment</label><textarea id="su-summary" rows="3" placeholder="Why is this subject under watch?"></textarea></div>
    ${compartmentField(actor, '')}
    <div id="su-err" class="auth__error" hidden></div>
  `;

  openModal({
    title: 'New surveillance subject',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Open record', tone: 'primary', onClick: (c, d) => {
          const kind = d.querySelector('#su-kind').value;
          const ref = d.querySelector('#su-ref').value.trim() || suggestRef(kind);
          const alias = d.querySelector('#su-alias').value.trim();
          const org = d.querySelector('#su-org').value;
          const threat = d.querySelector('#su-threat').value;
          const clr = d.querySelector('#su-clr').value;
          const loc = d.querySelector('#su-loc').value.trim();
          const summary = d.querySelector('#su-summary').value.trim();
          const comp = d.querySelector('#su-comp').value || null;
          const err = d.querySelector('#su-err');
          err.hidden = true;

          if (!alias) { err.textContent = 'An alias or designation is required.'; err.hidden = false; return; }
          if (!canManageOrg(actor, org)) { err.textContent = 'You cannot create records for that organisation.'; err.hidden = false; return; }
          if (!canClassifySubjectAt(actor, clr)) { err.textContent = 'Sensitivity cannot exceed your own clearance.'; err.hidden = false; return; }
          if (subjects().some((x) => !x.deleted && x.ref.toLowerCase() === ref.toLowerCase())) { err.textContent = 'That reference is already in use.'; err.hidden = false; return; }

          if (kind === 'target' && !canManageTribunal(actor)) { err.textContent = 'Only an Ethics Committee member may open a Target. Open a Person of Interest and request conversion.'; err.hidden = false; return; }

          const now = new Date().toISOString();
          const authorization = kind === 'target'
            ? { status: 'authorised', by: actor.designation, at: now, requestedBy: actor.designation, note: 'Opened directly by Ethics member.' }
            : null;
          upsertSubject({
            id: newId('sub'), ref, alias, realName: '[UNIDENTIFIED]', kind, org,
            threat, clearance: clr, status: 'active', summary, lastKnownLocation: loc,
            compartment: comp, images: [], authorization,
            logs: [{ id: newId('log'), ts: now, by: actor.designation, type: 'intel', text: `Record opened by ${actor.designation}.` }],
            createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'CREATE_SUBJECT', `Opened ${ref} (${alias}) under ${ORGS[org].short}.`);
          c();
          toast(`Subject ${ref} opened.`, 'success');
          app.refresh();
        } },
    ],
  });
}

function suggestRef(kind) {
  const prefix = kind === 'target' ? 'TGT' : 'POI';
  const nums = subjects().filter((s) => s.ref.startsWith(prefix)).length + 90;
  return `${prefix}-${nums}`;
}

function openEdit(app, s) {
  const body = `
    <div class="field"><label>Alias / designation</label><input id="ed-alias" type="text" value="${esc(s.alias)}" /></div>
    ${selectField('ed-kind', 'Classification', SUBJECT_CLASS_ORDER, s.kind, (k) => SUBJECT_CLASS[k].label)}
    <div class="field"><label>Last known location</label><input id="ed-loc" type="text" value="${esc(s.lastKnownLocation || '')}" /></div>
    <div class="field"><label>Assessment</label><textarea id="ed-summary" rows="4">${esc(s.summary || '')}</textarea></div>
    ${compartmentField(app.user, s.compartment).replace('id="su-comp"', 'id="ed-comp"')}
  `;
  openModal({
    title: `Edit \u2014 ${s.ref}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save changes', tone: 'primary', onClick: (c, d) => {
          const alias = d.querySelector('#ed-alias').value.trim() || s.alias;
          const kind = d.querySelector('#ed-kind').value;
          const loc = d.querySelector('#ed-loc').value.trim();
          const summary = d.querySelector('#ed-summary').value.trim();
          const comp = d.querySelector('#ed-comp').value || null;
          mutate(app, s.id, s.version, (rec) => {
            rec.alias = alias; rec.kind = kind; rec.lastKnownLocation = loc; rec.summary = summary;
            rec.compartment = comp;
          }, { action: 'EDIT_SUBJECT', detail: `${s.ref} record updated.` });
          c();
          toast('Record updated.', 'success');
        } },
    ],
  });
}

function openLog(app, s) {
  openModal({
    title: `Add log entry \u2014 ${s.ref}`,
    body: `
      ${selectField('lg-type', 'Entry type', ['sighting', 'intel', 'note', 'status'], 'sighting', (t) => t[0].toUpperCase() + t.slice(1))}
      <div class="field"><label>Entry</label><textarea id="lg-text" rows="3" placeholder="Record the observation\u2026"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Add entry', tone: 'primary', onClick: (c, d) => {
          const type = d.querySelector('#lg-type').value;
          const text = d.querySelector('#lg-text').value.trim();
          if (!text) { toast('An entry is required.', 'error'); return; }
          mutate(app, s.id, s.version, (rec) => {
            addLog(rec, type, app.user.designation, text);
          }, { action: 'ADD_SURVEILLANCE_LOG', detail: `Log entry added to ${s.ref}.` });
          c();
          toast('Log entry recorded.', 'success');
        } },
    ],
  });
}

function openStatus(app, s) {
  openModal({
    title: `Set status \u2014 ${s.ref}`,
    body: selectField('st-status', 'Status', SUBJECT_STATUS_ORDER, s.status, (x) => SUBJECT_STATUS[x].label),
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Update status', tone: 'primary', onClick: (c, d) => {
          const status = d.querySelector('#st-status').value;
          mutate(app, s.id, s.version, (rec) => {
            const from = rec.status;
            rec.status = status;
            addLog(rec, 'status', app.user.designation, `Status ${SUBJECT_STATUS[from].label} \u2192 ${SUBJECT_STATUS[status].label}.`);
          }, { action: 'SET_SUBJECT_STATUS', detail: `${s.ref} status \u2192 ${status}.` });
          c();
          toast('Status updated.', 'success');
        } },
    ],
  });
}

function openReclassify(app, s) {
  const ceiling = clearanceWeight(app.user.clearance);
  const allowedClr = CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= ceiling);
  const body = `
    <p class="modal__message">Adjust threat assessment and sensitivity. You cannot raise sensitivity above your own clearance.</p>
    ${selectField('rc-threat', 'Threat level', THREAT_ORDER, s.threat, (t) => THREAT_LEVELS[t].label)}
    ${selectField('rc-clr', 'Sensitivity', allowedClr, allowedClr.includes(s.clearance) ? s.clearance : allowedClr[allowedClr.length - 1], (c) => CLEARANCES[c].label)}
  `;
  openModal({
    title: `Reclassify \u2014 ${s.ref}`,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Apply', tone: 'primary', onClick: (c, d) => {
          const threat = d.querySelector('#rc-threat').value;
          const clr = d.querySelector('#rc-clr').value;
          if (!canClassifySubjectAt(app.user, clr)) { toast('Sensitivity cannot exceed your own clearance.', 'error'); return; }
          mutate(app, s.id, s.version, (rec) => {
            const notes = [];
            if (rec.threat !== threat) notes.push(`threat ${THREAT_LEVELS[rec.threat].label} \u2192 ${THREAT_LEVELS[threat].label}`);
            if (rec.clearance !== clr) notes.push(`sensitivity ${CLEARANCES[rec.clearance].label} \u2192 ${CLEARANCES[clr].label}`);
            rec.threat = threat; rec.clearance = clr;
            if (notes.length) addLog(rec, 'status', app.user.designation, `Reclassified: ${notes.join(', ')}.`);
          }, { action: 'RECLASSIFY_SUBJECT', detail: `${s.ref} reclassified.` });
          c();
          toast('Subject reclassified.', 'success');
        } },
    ],
  });
}

async function closeSubject(app, s) {
  // Targets close plainly (their lifecycle is governed by authorisation, below).
  // A Person of Interest closes with an OUTCOME.
  if (s.kind !== 'poi') {
    const ok = await confirmDialog({
      title: 'Close watch',
      message: `Close the surveillance record for ${s.ref} \u00b7 ${s.alias}? It stays on file and can be reopened.`,
      confirmLabel: 'Close watch',
    });
    if (!ok) return;
    mutate(app, s.id, s.version, (rec) => {
      rec.status = 'closed';
      addLog(rec, 'status', app.user.designation, 'Watch closed.');
    }, { action: 'CLOSE_SUBJECT', detail: `${s.ref} watch closed.` });
    toast('Watch closed.', 'success');
    return;
  }

  const canEthics = canManageTribunal(app.user);
  const body = `
    <p class="modal__message">Record the outcome of the watch on <strong>${esc(s.alias)}</strong> (${esc(s.ref)}).</p>
    <label class="radio-row"><input type="radio" name="poi-outcome" value="absolved" checked /> <span><strong>Absolved</strong> — no further action. The watch is closed.</span></label>
    <label class="radio-row"><input type="radio" name="poi-outcome" value="summoned" /> <span><strong>Summoned to Tribunal</strong> — closes the watch and opens an Ethics case naming the subject.</span></label>
    <label class="radio-row"><input type="radio" name="poi-outcome" value="assassination" /> <span><strong>Assassination</strong> — converts the subject into a Target for termination. <em>Requires authorisation by an Ethics Committee member.</em></span></label>
    <div class="field" style="margin-top:10px"><label>Note <span class="muted-text">(recorded on the file)</span></label><textarea id="poi-note" rows="2" placeholder="Reason / context for the outcome\u2026"></textarea></div>
    <div id="poi-err" class="auth__error" hidden></div>
  `;
  openModal({
    title: `Close watch \u2014 ${s.ref}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Record outcome', tone: 'primary', onClick: (c, d) => {
          const outcome = (d.querySelector('input[name="poi-outcome"]:checked') || {}).value;
          const note = d.querySelector('#poi-note').value.trim();
          const err = d.querySelector('#poi-err');
          err.hidden = true;

          if (outcome === 'absolved') {
            mutate(app, s.id, s.version, (rec) => {
              rec.status = 'closed';
              addLog(rec, 'status', app.user.designation, `Absolved${note ? `: ${note}` : '.'} No further action.`);
            }, { action: 'CLOSE_SUBJECT', detail: `${s.ref} absolved.` });
            c(); toast('Subject absolved; watch closed.', 'success');
            return;
          }

          if (outcome === 'summoned') {
            // Close the watch and open a linked Ethics case naming the subject.
            const n = subjects().filter((x) => (x.ref || '').startsWith('EC-CASE-')).length; // cheap unique-ish
            const caseRef = `EC-CASE-${String(Date.now()).slice(-4)}`;
            const now = new Date().toISOString();
            upsertCase({
              id: newId('case'), ref: caseRef, title: `Tribunal — ${s.alias}`, kind: 'tribunal',
              clearance: s.clearance, status: 'open',
              summary: `Referred from surveillance ${s.ref}.${note ? ` ${note}` : ''}`,
              respondentId: null, respondentName: s.alias, respondentDept: null,
              panelIds: [], votes: {}, linkedSubjectIds: [s.id], summons: [],
              entries: [{ id: newId('ce'), ts: now, by: app.user.designation, type: 'filing', text: `Case opened from surveillance referral ${s.ref}.` }],
              ruling: null, compartment: s.compartment || null,
              createdBy: app.user.designation, createdAt: now, updatedAt: now,
              version: 1, deleted: false, deletedAt: null,
            });
            logAction(app.user, 'OPEN_CASE', `Opened ${caseRef} from surveillance ${s.ref}.`);
            mutate(app, s.id, s.version, (rec) => {
              rec.status = 'closed';
              addLog(rec, 'status', app.user.designation, `Summoned to Ethics tribunal (${caseRef})${note ? `: ${note}` : '.'}`);
            }, { action: 'CLOSE_SUBJECT', detail: `${s.ref} summoned to tribunal.` });
            c(); toast(`Watch closed; case ${caseRef} opened.`, 'success');
            app.navigate(`#/case/${caseRef}`);
            return;
          }

          // Assassination -> request conversion to a Target, pending Ethics sign-off.
          requestTargetConversion(app, s, note, c);
        } },
    ],
  });
}

// Convert a POI into a Target. The record is flipped to a target but flagged
// PENDING — the server will not accept it as a live target until an Ethics
// member authorises. If the requester is themselves an Ethics member they may
// authorise in the same step.
function requestTargetConversion(app, s, note, closeOuter) {
  const iAmEthics = canManageTribunal(app.user);
  const now = new Date().toISOString();
  mutate(app, s.id, s.version, (rec) => {
    rec.kind = 'target';
    rec.status = 'active';
    rec.threat = 'critical' in THREAT_LEVELS ? 'critical' : rec.threat;
    rec.authorization = iAmEthics
      ? { status: 'authorised', by: app.user.designation, at: now, requestedBy: app.user.designation, note: note || '' }
      : { status: 'pending', by: null, at: null, requestedBy: app.user.designation, requestedAt: now, note: note || '' };
    addLog(rec, 'status', app.user.designation, iAmEthics
      ? `Converted to Target and authorised for termination${note ? `: ${note}` : '.'}`
      : `Conversion to Target requested — pending Ethics authorisation${note ? `: ${note}` : '.'}`);
  }, iAmEthics
    ? { action: 'AUTHORISE_TARGET', detail: `${s.ref} converted to Target and authorised.` }
    : { action: 'EDIT_SUBJECT', detail: `${s.ref} conversion to Target requested.` });
  if (closeOuter) closeOuter();
  toast(iAmEthics ? 'Target authorised.' : 'Conversion requested — awaiting Ethics authorisation.', iAmEthics ? 'success' : 'info');
}

// Ethics authorisation / refusal of a pending Target.
function decideTarget(app, s, approve) {
  if (!canManageTribunal(app.user)) { toast('Only an Ethics Committee member may decide this.', 'error'); return; }
  const now = new Date().toISOString();
  if (approve) {
    mutate(app, s.id, s.version, (rec) => {
      rec.authorization = { ...(rec.authorization || {}), status: 'authorised', by: app.user.designation, at: now };
      addLog(rec, 'status', app.user.designation, 'Target authorised for termination by Ethics Committee.');
    }, { action: 'AUTHORISE_TARGET', detail: `${s.ref} authorised for termination.` });
    toast('Target authorised.', 'success');
  } else {
    mutate(app, s.id, s.version, (rec) => {
      rec.authorization = { ...(rec.authorization || {}), status: 'refused', by: app.user.designation, at: now };
      rec.kind = 'poi';
      rec.status = 'active';
      addLog(rec, 'status', app.user.designation, 'Target authorisation refused by Ethics Committee; reverted to Person of Interest.');
    }, { action: 'REFUSE_TARGET', detail: `${s.ref} target authorisation refused.` });
    toast('Authorisation refused; reverted to POI.', 'info');
  }
}

async function removeSubject(app, s) {
  const ok = await confirmDialog({
    title: 'Remove subject record',
    message: `Move ${s.ref} \u00b7 ${s.alias} to the recycle bin? It can be restored by Command.`,
    confirmLabel: 'Remove record',
    danger: true,
  });
  if (!ok) return;
  const fresh = getSubject(s.id);
  if (!fresh) { app.refresh(); return; }
  fresh.deleted = true;
  fresh.deletedAt = new Date().toISOString();
  fresh.version += 1;
  upsertSubject(fresh);
  logAction(app.user, 'REMOVE_SUBJECT', `${s.ref} moved to recycle bin.`);
  toast('Record moved to recycle bin.', 'success');
  app.navigate('#/surveillance');
}
