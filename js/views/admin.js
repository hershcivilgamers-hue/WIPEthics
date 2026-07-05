// =============================================================================
// views/admin.js — Administration (CL5 only).
//
// Four tools behind one screen:
//   • Registrations — approve or reject pending access requests.
//   • Clearance     — adjust any operator's clearance from one table.
//   • Recycle bin   — restore or permanently purge removed records.
//   • System        — backend status, dataset export, full reset.
// =============================================================================

import { ORGS, RANKS, CLEARANCE_ORDER, CLEARANCES, rankUp, clearanceForRank, ACTIVITY_REQ_SETTING_ID, ACTIVITY_REQ_DEFAULT, mergeActivityReqs, PERSONNEL_TAGS_SETTING_ID, TAG_COLORS, normalizeTagCatalog } from '../constants.js';
import {
  users, directives, subjects, cases, getUser, upsertUser, getDirective, upsertDirective,
  getSubject, upsertSubject, getCase, upsertCase, compartments, getCompartment, upsertCompartment,
  recruits, getRecruit, upsertRecruit, operations, getOperation, upsertOperation, intel, getIntel, upsertIntel,
  promoReqs, getPromoReq, upsertPromoReq,
  deletePromoReq, getSetting, upsertSetting, newId, loadDb, saveDb, clearDb, storageBackend,
} from '../storage.js';
import { canSetClearance, canManagePromoReqs, canManageSettings, isCL5 } from '../permissions.js';
import { ensureSeeded } from '../seed.js';
import { logAction } from '../audit.js';
import {
  esc, fmtDate, fmtDateTime, clearanceBadge, orgTag, accountBadge,
  toast, openModal, confirmDialog,
} from '../ui.js';

let activeTab = 'registrations';

function nextDesignation(org) {
  const prefix = org === 'omega-1' ? 'O1' : org === 'ethics-committee' ? 'EC' : 'CMD';
  const nums = users().filter((x) => x.org === org && /-(\d+)$/.test(x.designation || '')).map((x) => parseInt(x.designation.split('-')[1], 10));
  return `${prefix}-${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

export function render(host, app) {
  const tabs = [
    ['registrations', 'Registrations'],
    ['clearance', 'Clearance'],
    ['promotions', 'Promotion Reqs'],
    ['activity', 'Activity Reqs'],
    ['tags', 'Personnel Tags'],
    ['recycle', 'Recycle Bin'],
    ['system', 'System'],
  ];

  const pendingCount = users().filter((u) => !u.deleted && u.accountStatus === 'pending').length;
  const binCount = users().filter((u) => u.deleted).length + directives().filter((d) => d.deleted).length
    + subjects().filter((s) => s.deleted).length + cases().filter((c) => c.deleted).length
    + compartments().filter((c) => c.deleted).length
    + recruits().filter((r) => r.deleted).length + operations().filter((o) => o.deleted).length
    + intel().filter((s) => s.deleted).length;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Site Command</div>
        <h1 class="page-title">Administration</h1>
        <div class="page-sub">Command-tier controls \u00b7 CL5</div>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(([id, lbl]) => `
        <button class="tab ${activeTab === id ? 'tab--active' : ''}" data-tab="${id}">
          ${esc(lbl)}
          ${id === 'registrations' && pendingCount ? `<span class="tab__count">${pendingCount}</span>` : ''}
          ${id === 'recycle' && binCount ? `<span class="tab__count">${binCount}</span>` : ''}
        </button>`).join('')}
    </div>
    <div id="admin-panel"></div>
  `;

  host.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.tab; render(host, app); }));
  drawPanel(host.querySelector('#admin-panel'), app);
}

function drawPanel(panel, app) {
  if (activeTab === 'registrations') return drawRegistrations(panel, app);
  if (activeTab === 'clearance') return drawClearance(panel, app);
  if (activeTab === 'promotions') return drawPromoReqs(panel, app);
  if (activeTab === 'activity') return drawActivityReqs(panel, app);
  if (activeTab === 'tags') return drawTags(panel, app);
  if (activeTab === 'recycle') return drawRecycle(panel, app);
  return drawSystem(panel, app);
}

// --- Registrations ----------------------------------------------------------
function drawRegistrations(panel, app) {
  const pending = users().filter((u) => !u.deleted && u.accountStatus === 'pending');
  if (!pending.length) {
    panel.innerHTML = '<div class="card"><div class="card__body empty">No access requests awaiting approval.</div></div>';
    return;
  }
  panel.innerHTML = `<div class="stack">${pending.map((u) => `
    <div class="card req-card">
      <div class="req-card__main">
        <div class="req-card__name">${esc(u.codename)} <span class="mono req-card__id">${esc(u.designation)}</span></div>
        <div class="req-card__meta">Requested ${orgTag(u.requestedOrg || u.org)} ${esc(ORGS[u.requestedOrg || u.org].name)}${u.requestedRank ? ` \u00b7 rank sought <strong>${esc(u.requestedRank)}</strong>${clearanceForRank(u.requestedOrg || u.org, u.requestedRank) ? ` (${esc(clearanceForRank(u.requestedOrg || u.org, u.requestedRank))})` : ''}` : ''} \u00b7 ${fmtDate(u.createdAt)} \u00b7 operator ID <span class="mono">${esc(u.username)}</span></div>
      </div>
      <div class="req-card__actions">
        <button class="btn btn--primary btn--sm" data-approve="${esc(u.id)}">Approve</button>
        <button class="btn btn--danger btn--sm" data-reject="${esc(u.id)}">Reject</button>
      </div>
    </div>`).join('')}</div>`;

  panel.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approve(app, b.dataset.approve)));
  panel.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => reject(app, b.dataset.reject)));
}

function approve(app, id) {
  const u = getUser(id);
  if (!u) return;
  const org = u.requestedOrg || u.org;
  const ranks = RANKS[org] || [];
  const ceiling = CLEARANCES[app.user.clearance].weight;
  const allowed = CLEARANCE_ORDER.filter((c) => CLEARANCES[c].weight <= ceiling);
  // Pre-select what the applicant asked for, when it's valid for this org.
  const wantRank = ranks.includes(u.requestedRank) ? u.requestedRank : ranks[0];
  const wantClr = clearanceForRank(org, wantRank);
  const rankOpts = ranks.map((r) => `<option value="${esc(r)}" ${r === wantRank ? 'selected' : ''}>${esc(r)}</option>`).join('');
  const clrOpts = allowed.map((c) => `<option value="${c}" ${c === wantClr ? 'selected' : ''}>${esc(CLEARANCES[c].label)}</option>`).join('');

  const dlg = openModal({
    title: `Approve \u2014 ${u.codename}`,
    body: `
      <p class="modal__message">Confirm organisation, assign a rank and clearance. A permanent designation is issued on approval.</p>
      <div class="field"><label>Organisation</label>
        <select id="ap-org">${['omega-1', 'ethics-committee', 'command'].map((o) => `<option value="${o}" ${o === org ? 'selected' : ''}>${esc(ORGS[o].name)}</option>`).join('')}</select></div>
      <div class="field"><label>Rank</label><select id="ap-rank">${rankOpts}</select></div>
      <div class="field"><label>Clearance</label><select id="ap-clr">${clrOpts}</select></div>
    `,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Approve & activate', tone: 'primary', onClick: (c, d) => {
          const chosenOrg = d.querySelector('#ap-org').value;
          const rank = d.querySelector('#ap-rank').value;
          const clr = d.querySelector('#ap-clr').value;
          const fresh = getUser(id);
          if (!fresh) { c(); app.refresh(); return; }
          const designation = nextDesignation(chosenOrg);
          fresh.org = chosenOrg;
          fresh.rank = rank;
          fresh.clearance = clr;
          fresh.designation = designation;
          fresh.accountStatus = 'active';
          fresh.requestedOrg = null;
          fresh.version += 1;
          fresh.updatedAt = new Date().toISOString();
          fresh.events = fresh.events || [];
          fresh.events.unshift({ id: newId('evt'), date: new Date().toISOString(), type: 'appointment', text: `Access approved by ${app.user.designation}; assigned ${rank}, ${CLEARANCES[clr].label}.` });
          upsertUser(fresh);
          logAction(app.user, 'APPROVE_REGISTRATION', `Approved ${designation} (${fresh.codename}) into ${ORGS[chosenOrg].short}.`);
          c();
          toast(`Approved \u2014 ${designation} activated.`, 'success');
          app.refresh();
        } },
    ],
  });

  // Keep the rank list in step with the chosen organisation, and nudge the
  // clearance to match the selected rank's tier.
  const orgSel = dlg.querySelector('#ap-org');
  const rankSel = dlg.querySelector('#ap-rank');
  const clrSel = dlg.querySelector('#ap-clr');
  const syncClr = () => {
    if (!clrSel || !rankSel) return;
    const want = clearanceForRank(orgSel ? orgSel.value : org, rankSel.value);
    if (want && [...clrSel.options].some((o) => o.value === want)) clrSel.value = want;
  };
  if (orgSel && rankSel) {
    orgSel.addEventListener('change', () => {
      const list = RANKS[orgSel.value] || [];
      rankSel.innerHTML = list.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
      syncClr();
    });
    rankSel.addEventListener('change', syncClr);
  }
}

async function reject(app, id) {
  const u = getUser(id);
  if (!u) return;
  const ok = await confirmDialog({ title: 'Reject request', message: `Reject and discard the access request from ${u.codename}?`, confirmLabel: 'Reject request', danger: true });
  if (!ok) return;
  u.deleted = true;
  u.deletedAt = new Date().toISOString();
  upsertUser(u);
  logAction(app.user, 'REJECT_REGISTRATION', `Rejected access request from ${u.codename}.`);
  toast('Request rejected.', 'success');
  app.refresh();
}

// --- Clearance management ---------------------------------------------------
function drawClearance(panel, app) {
  const roster = users().filter((u) => !u.deleted && u.accountStatus === 'active')
    .sort((a, b) => a.org.localeCompare(b.org) || (CLEARANCES[b.clearance]?.weight || 0) - (CLEARANCES[a.clearance]?.weight || 0));

  const rows = roster.map((u) => {
    const self = u.id === app.user.id;
    const opts = CLEARANCE_ORDER.map((c) => `<option value="${c}" ${u.clearance === c ? 'selected' : ''}>${esc(CLEARANCES[c].label)}</option>`).join('');
    return `
      <tr>
        <td class="mono">${esc(u.designation)}</td>
        <td>${esc(u.codename)}</td>
        <td>${orgTag(u.org)}</td>
        <td>${clearanceBadge(u.clearance)}</td>
        <td>
          ${self ? '<span class="muted-text">\u2014 self \u2014</span>' : `
            <span class="inline-set">
              <select data-clr="${esc(u.id)}">${opts}</select>
              <button class="btn btn--xs" data-apply="${esc(u.id)}">Apply</button>
            </span>`}
        </td>
      </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="card">
      <div class="card__title">Clearance assignment</div>
      <table class="table">
        <thead><tr><th>Designation</th><th>Codename</th><th>Org</th><th>Current</th><th>Set</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  panel.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.apply;
    const sel = panel.querySelector(`[data-clr="${id}"]`);
    const next = sel.value;
    const target = getUser(id);
    if (!target) return;
    if (!canSetClearance(app.user, target, next)) { toast('You cannot assign a clearance above your own.', 'error'); return; }
    const from = target.clearance || 'none';
    target.clearance = next;
    target.version += 1;
    target.updatedAt = new Date().toISOString();
    target.events = target.events || [];
    target.events.unshift({ id: newId('evt'), date: new Date().toISOString(), type: 'clearance', text: `Clearance changed ${from} \u2192 ${next} by ${app.user.designation}.` });
    upsertUser(target);
    logAction(app.user, 'SET_CLEARANCE', `${target.designation} set to ${next}.`);
    toast(`${target.designation} \u2192 ${CLEARANCES[next].label}.`, 'success');
    app.refresh();
  }));
}

// --- Promotion requirements -------------------------------------------------
// CL5 edits the requirement set for each rank transition. Sets are keyed by
// (org, fromRank); editing here changes what every operator's dossier shows for
// that transition. Per-file progress lives on each operator, not here.
function transitionsFor(org) {
  const ladder = RANKS[org] || [];
  // Every rank except the most senior (index 0) has a promotion target.
  const out = [];
  for (let i = ladder.length - 1; i >= 1; i--) {
    out.push({ fromRank: ladder[i], toRank: ladder[i - 1] });
  }
  return out;
}

function findSet(org, fromRank) {
  return promoReqs().find((r) => r.org === org && r.fromRank === fromRank) || null;
}

function drawPromoReqs(panel, app) {
  if (!canManagePromoReqs(app.user)) {
    panel.innerHTML = '<div class="card"><div class="card__body empty">Promotion requirements are managed at CL5.</div></div>';
    return;
  }

  const orgsWithLadders = ['omega-1', 'ethics-committee', 'command'].filter((o) => (RANKS[o] || []).length >= 2);

  panel.innerHTML = `
    <div class="card">
      <div class="card__body">
        <p class="muted" style="margin:0">Define the requirement checklist for each rank transition. An operator's
        file shows the set for their next rank, and tracks which items are checked. Changing a set here updates every
        operator on that transition; their individual progress is preserved by item.</p>
      </div>
    </div>
    ${orgsWithLadders.map((org) => `
      <div class="card">
        <div class="card__title">${orgTag(org)} ${esc(ORGS[org].name)}</div>
        <div class="card__body">
          ${transitionsFor(org).map((t) => {
            const set = findSet(org, t.fromRank);
            const items = set?.items || [];
            const rows = items.map((it) => `
              <div class="preq-item">
                <input class="preq-item__text" value="${esc(it.text)}" data-edit="${esc((set?.id || '') + '|' + it.id)}" aria-label="Requirement text" />
                <button class="btn btn--xs btn--ghost" data-del="${esc((set?.id || '') + '|' + it.id)}" title="Remove">\u2715</button>
              </div>`).join('');
            return `
              <div class="preq-transition">
                <div class="preq-transition__head"><span class="mono">${esc(t.fromRank)}</span> <span class="promo-arrow">\u2192</span> <span class="mono">${esc(t.toRank)}</span></div>
                <div class="preq-items">${rows || '<div class="muted preq-empty">No requirements yet.</div>'}</div>
                <div class="preq-add">
                  <input class="preq-add__input" placeholder="Add a requirement\u2026" data-add-input="${esc(org + '|' + t.fromRank + '|' + t.toRank)}" />
                  <button class="btn btn--xs" data-add="${esc(org + '|' + t.fromRank + '|' + t.toRank)}">Add</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
  `;

  // Edit an item's text (saved on change / blur).
  panel.querySelectorAll('[data-edit]').forEach((inp) => inp.addEventListener('change', () => {
    const [setId, itemId] = inp.dataset.edit.split('|');
    const set = getPromoReq(setId);
    if (!set) return;
    const item = (set.items || []).find((x) => x.id === itemId);
    if (!item) return;
    const text = inp.value.trim();
    if (!text) return; // empty edits are ignored; use Remove to delete
    item.text = text;
    set.updatedAt = new Date().toISOString();
    set.version = (set.version || 1) + 1;
    upsertPromoReq(set);
    logAction(app.user, 'SET_PROMO_REQ', `Edited a ${ORGS[set.org].short} ${set.fromRank} \u2192 ${set.toRank} requirement.`);
    toast('Requirement updated.', 'success');
  }));

  // Remove an item.
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const [setId, itemId] = b.dataset.del.split('|');
    const set = getPromoReq(setId);
    if (!set) return;
    const ok = await confirmDialog({ title: 'Remove requirement?', message: 'This removes the item from the transition for all operators.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    set.items = (set.items || []).filter((x) => x.id !== itemId);
    set.updatedAt = new Date().toISOString();
    set.version = (set.version || 1) + 1;
    if (set.items.length === 0) deletePromoReq(set.id);
    else upsertPromoReq(set);
    logAction(app.user, 'REMOVE_PROMO_REQ', `Removed a ${ORGS[set.org].short} ${set.fromRank} \u2192 ${set.toRank} requirement.`);
    app.refresh();
  }));

  // Add an item (creating the set if it doesn't exist yet).
  panel.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const [org, fromRank, toRank] = b.dataset.add.split('|');
    const input = panel.querySelector(`[data-add-input="${b.dataset.add}"]`);
    const text = (input?.value || '').trim();
    if (!text) { toast('Enter the requirement text first.', 'warn'); return; }
    let set = findSet(org, fromRank);
    if (!set) {
      set = { id: newId('preq'), org, fromRank, toRank, items: [], createdBy: app.user.designation, updatedAt: new Date().toISOString(), version: 1 };
    }
    set.items = [...(set.items || []), { id: newId('rq'), text }];
    set.updatedAt = new Date().toISOString();
    set.version = (set.version || 1) + 1;
    upsertPromoReq(set);
    logAction(app.user, 'SET_PROMO_REQ', `Added a ${ORGS[org].short} ${fromRank} \u2192 ${toRank} requirement.`);
    app.refresh();
  }));
}

// --- Recycle bin ------------------------------------------------------------
function drawActivityReqs(panel, app) {
  if (!canManageSettings(app.user)) {
    panel.innerHTML = '<div class="empty">Activity requirements are managed at CL5.</div>';
    return;
  }
  const rec = getSetting(ACTIVITY_REQ_SETTING_ID);
  const r = mergeActivityReqs(rec && rec.data);

  panel.innerHTML = `
    <section class="card">
      <div class="card__title">Activity requirements</div>
      <div class="card__body">
        <p class="field__hint">These thresholds drive the Readiness board. An operator is Active when the weekly requirement is met, Semi-Active with some activity but under it, and Inactive with nothing logged this week. Other Committee roles and Command are always exempt.</p>
        <div class="req-grid">
          <div class="field"><label>Omega-1 \u2014 hours / week</label><input id="rq-ow" type="number" min="0" step="0.5" value="${r.omegaWeekly}" /></div>
          <div class="field"><label>Omega-1 \u2014 hours / month</label><input id="rq-om" type="number" min="0" step="1" value="${r.omegaMonthly}" /></div>
          <div class="field"><label>Ethics Assistant \u2014 hours / week</label><input id="rq-ew" type="number" min="0" step="0.5" value="${r.ethicsWeekly}" /></div>
        </div>
        <label class="check-line"><input id="rq-ei" type="checkbox" ${r.ethicsNeedsInteraction ? 'checked' : ''} /> Ethics Assistants also need an interaction (a note or a tag) to count as Active</label>
        <div class="form-actions">
          <button class="btn btn--primary" id="rq-save">Save requirements</button>
          <button class="btn btn--ghost" id="rq-reset">Reset to defaults</button>
        </div>
      </div>
    </section>`;

  const persist = (data) => {
    const cur = getSetting(ACTIVITY_REQ_SETTING_ID) || { id: ACTIVITY_REQ_SETTING_ID, org: 'command' };
    cur.data = data;
    upsertSetting(cur);
    logAction(app.user, 'SET_SETTING', `Activity requirements: O1 ${data.omegaWeekly}h/wk + ${data.omegaMonthly}h/mo; EC Assistant ${data.ethicsWeekly}h/wk${data.ethicsNeedsInteraction ? ' + interaction' : ''}.`);
    toast('Activity requirements saved.', 'success');
    drawActivityReqs(panel, app);
  };

  panel.querySelector('#rq-save').addEventListener('click', () => {
    persist(mergeActivityReqs({
      omegaWeekly: parseFloat(panel.querySelector('#rq-ow').value),
      omegaMonthly: parseFloat(panel.querySelector('#rq-om').value),
      ethicsWeekly: parseFloat(panel.querySelector('#rq-ew').value),
      ethicsNeedsInteraction: panel.querySelector('#rq-ei').checked,
    }));
  });
  panel.querySelector('#rq-reset').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset requirements', message: 'Reset to the defaults \u2014 Omega-1 5h/week + 25h/month, Ethics Assistant 1h/week plus an interaction?', confirmLabel: 'Reset' });
    if (ok) persist(mergeActivityReqs(ACTIVITY_REQ_DEFAULT));
  });
}

// --- Personnel tags ---------------------------------------------------------
function tagCatalog() {
  const rec = getSetting(PERSONNEL_TAGS_SETTING_ID);
  return normalizeTagCatalog(rec && rec.data);
}
function saveTagCatalog(app, tags, note) {
  const cur = getSetting(PERSONNEL_TAGS_SETTING_ID) || { id: PERSONNEL_TAGS_SETTING_ID, org: 'command' };
  cur.data = { tags };
  upsertSetting(cur);
  logAction(app.user, 'SET_SETTING', note || 'Updated personnel tags.');
}

function drawTags(panel, app) {
  if (!canManageSettings(app.user)) {
    panel.innerHTML = '<div class="empty">Personnel tags are managed at CL5.</div>';
    return;
  }
  const tags = tagCatalog();
  const usage = (id) => users().filter((u) => !u.deleted && Array.isArray(u.tags) && u.tags.includes(id)).length;

  const rows = tags.length ? tags.map((t) => `
    <div class="tag-admin-row">
      <span class="badge tag-badge tag-badge--${esc(t.color)}">${esc(t.label)}</span>
      <span class="muted-text">${usage(t.id)} assigned</span>
      <select data-tag-color="${esc(t.id)}" class="toolbar__select">
        ${TAG_COLORS.map((c) => `<option value="${c}" ${c === t.color ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <button class="btn btn--xs" data-tag-rename="${esc(t.id)}">Rename</button>
      <button class="btn btn--xs btn--danger" data-tag-remove="${esc(t.id)}">Remove</button>
    </div>`).join('') : '<div class="empty">No tags defined yet.</div>';

  panel.innerHTML = `
    <section class="card">
      <div class="card__title">Personnel tags</div>
      <div class="card__body">
        <p class="field__hint">Define role or attribute labels (for example \u201cDevelopment Manager\u201d) and assign them to personnel from any dossier. Removing a tag also clears it from everyone who holds it.</p>
        <div class="tag-admin-list">${rows}</div>
        <div class="form-row" style="margin-top:var(--s3)">
          <input id="tag-new" class="toolbar__search" type="text" placeholder="New tag label\u2026" maxlength="40" />
          <select id="tag-new-color" class="toolbar__select">${TAG_COLORS.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
          <button class="btn btn--primary" id="tag-add">Add tag</button>
        </div>
      </div>
    </section>`;

  panel.querySelector('#tag-add').addEventListener('click', () => {
    const label = panel.querySelector('#tag-new').value.trim();
    const color = panel.querySelector('#tag-new-color').value;
    if (!label) { toast('Enter a tag label.', 'error'); return; }
    if (tags.some((t) => t.label.toLowerCase() === label.toLowerCase())) { toast('A tag with that label already exists.', 'error'); return; }
    const next = [...tags, { id: newId('tag'), label, color }];
    saveTagCatalog(app, next, `Created personnel tag \u201c${label}\u201d.`);
    toast('Tag created.', 'success');
    drawTags(panel, app);
  });

  panel.querySelectorAll('[data-tag-color]').forEach((sel) => sel.addEventListener('change', () => {
    const id = sel.dataset.tagColor;
    const next = tags.map((t) => (t.id === id ? { ...t, color: sel.value } : t));
    saveTagCatalog(app, next, 'Recoloured a personnel tag.');
    drawTags(panel, app);
  }));

  panel.querySelectorAll('[data-tag-rename]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.tagRename;
    const tag = tags.find((t) => t.id === id);
    openModal({
      title: 'Rename tag',
      body: `<div class="field"><label>Label</label><input id="tag-rn" type="text" value="${esc(tag.label)}" maxlength="40" /></div>`,
      actions: [
        { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
        { label: 'Save', tone: 'primary', onClick: (c, d) => {
            const label = d.querySelector('#tag-rn').value.trim();
            if (!label) { toast('Enter a label.', 'error'); return; }
            const next = tags.map((t) => (t.id === id ? { ...t, label } : t));
            saveTagCatalog(app, next, `Renamed a personnel tag to \u201c${label}\u201d.`);
            c(); toast('Tag renamed.', 'success'); drawTags(panel, app);
          } },
      ],
    });
  }));

  panel.querySelectorAll('[data-tag-remove]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.tagRemove;
    const tag = tags.find((t) => t.id === id);
    const held = usage(id);
    const ok = await confirmDialog({
      title: 'Remove tag',
      message: `Remove \u201c${tag.label}\u201d?${held ? ` It will be cleared from ${held} personnel record${held === 1 ? '' : 's'}.` : ''}`,
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    // Clear the tag from every holder, then drop it from the catalogue.
    users().forEach((u) => {
      if (Array.isArray(u.tags) && u.tags.includes(id)) {
        const rec = { ...u, tags: u.tags.filter((x) => x !== id) };
        upsertUser(rec);
      }
    });
    saveTagCatalog(app, tags.filter((t) => t.id !== id), `Removed personnel tag \u201c${tag.label}\u201d.`);
    toast('Tag removed.', 'success');
    drawTags(panel, app);
  }));
}

function drawRecycle(panel, app) {
  const delUsers = users().filter((u) => u.deleted);
  const delDirs = directives().filter((d) => d.deleted);
  const delSubjects = subjects().filter((s) => s.deleted);
  const delCases = cases().filter((c) => c.deleted);
  const delCompartments = compartments().filter((c) => c.deleted);
  const delRecruits = recruits().filter((r) => r.deleted);
  const delOps = operations().filter((o) => o.deleted);
  const delIntel = intel().filter((s) => s.deleted);

  if (!delUsers.length && !delDirs.length && !delSubjects.length && !delCases.length && !delCompartments.length
      && !delRecruits.length && !delOps.length && !delIntel.length) {
    panel.innerHTML = '<div class="card"><div class="card__body empty">The recycle bin is empty.</div></div>';
    return;
  }

  const userRows = delUsers.map((u) => `
    <div class="bin-row">
      <div><span class="mono">${esc(u.designation)}</span> \u00b7 ${esc(u.codename)} ${orgTag(u.org)}<div class="bin-row__meta">Removed ${fmtDateTime(u.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-u="${esc(u.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-u="${esc(u.id)}">Purge</button>
      </div>
    </div>`).join('');

  const dirRows = delDirs.map((d) => `
    <div class="bin-row">
      <div><span class="mono">${esc(d.ref)}</span> \u00b7 ${esc(d.title)}<div class="bin-row__meta">Removed ${fmtDateTime(d.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-d="${esc(d.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-d="${esc(d.id)}">Purge</button>
      </div>
    </div>`).join('');

  const subjRows = delSubjects.map((s) => `
    <div class="bin-row">
      <div><span class="mono">${esc(s.ref)}</span> \u00b7 ${esc(s.alias)} ${orgTag(s.org)}<div class="bin-row__meta">Removed ${fmtDateTime(s.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-s="${esc(s.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-s="${esc(s.id)}">Purge</button>
      </div>
    </div>`).join('');

  const caseRows = delCases.map((c) => `
    <div class="bin-row">
      <div><span class="mono">${esc(c.ref)}</span> \u00b7 ${esc(c.title)}<div class="bin-row__meta">Removed ${fmtDateTime(c.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-c="${esc(c.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-c="${esc(c.id)}">Purge</button>
      </div>
    </div>`).join('');

  const compRows = delCompartments.map((c) => `
    <div class="bin-row">
      <div><span class="mono">${esc(c.ref)}</span> \u00b7 ${esc(c.name)} ${orgTag(c.org)}<div class="bin-row__meta">Removed ${fmtDateTime(c.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-k="${esc(c.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-k="${esc(c.id)}">Purge</button>
      </div>
    </div>`).join('');

  const recRows = delRecruits.map((r) => `
    <div class="bin-row">
      <div><span class="mono">${esc(r.ref)}</span> \u00b7 ${esc(r.name)} ${orgTag(r.org)}<div class="bin-row__meta">Removed ${fmtDateTime(r.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-r="${esc(r.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-r="${esc(r.id)}">Purge</button>
      </div>
    </div>`).join('');

  const opRows = delOps.map((o) => `
    <div class="bin-row">
      <div><span class="mono">${esc(o.ref)}</span> \u00b7 ${esc(o.name)} ${orgTag(o.org)}<div class="bin-row__meta">Removed ${fmtDateTime(o.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-o="${esc(o.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-o="${esc(o.id)}">Purge</button>
      </div>
    </div>`).join('');

  const intelRows = delIntel.map((s) => `
    <div class="bin-row">
      <div><span class="mono">${esc(s.ref)}</span> \u00b7 ${esc(s.codename)} ${orgTag(s.org)}<div class="bin-row__meta">Removed ${fmtDateTime(s.deletedAt)}</div></div>
      <div class="bin-row__actions">
        <button class="btn btn--xs" data-restore-i="${esc(s.id)}">Restore</button>
        <button class="btn btn--xs btn--danger" data-purge-i="${esc(s.id)}">Purge</button>
      </div>
    </div>`).join('');

  panel.innerHTML = `
    ${delUsers.length ? `<div class="card"><div class="card__title">Removed personnel</div><div class="card__body">${userRows}</div></div>` : ''}
    ${delRecruits.length ? `<div class="card"><div class="card__title">Removed candidates</div><div class="card__body">${recRows}</div></div>` : ''}
    ${delSubjects.length ? `<div class="card"><div class="card__title">Removed surveillance subjects</div><div class="card__body">${subjRows}</div></div>` : ''}
    ${delCases.length ? `<div class="card"><div class="card__title">Removed tribunal cases</div><div class="card__body">${caseRows}</div></div>` : ''}
    ${delOps.length ? `<div class="card"><div class="card__title">Removed operations</div><div class="card__body">${opRows}</div></div>` : ''}
    ${delIntel.length ? `<div class="card"><div class="card__title">Removed intelligence sources</div><div class="card__body">${intelRows}</div></div>` : ''}
    ${delCompartments.length ? `<div class="card"><div class="card__title">Removed compartments</div><div class="card__body">${compRows}</div></div>` : ''}
    ${delDirs.length ? `<div class="card"><div class="card__title">Removed directives</div><div class="card__body">${dirRows}</div></div>` : ''}
  `;

  panel.querySelectorAll('[data-restore-u]').forEach((b) => b.addEventListener('click', () => {
    const u = getUser(b.dataset.restoreU); if (!u) return;
    u.deleted = false; u.deletedAt = null; u.version += 1; upsertUser(u);
    logAction(app.user, 'RESTORE_RECORD', `${u.designation} restored from recycle bin.`);
    toast('Record restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-u]').forEach((b) => b.addEventListener('click', async () => {
    const u = getUser(b.dataset.purgeU); if (!u) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete ${u.designation} \u00b7 ${u.codename}? This cannot be undone.`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.users = db.users.filter((x) => x.id !== u.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `${u.designation} permanently deleted.`);
    toast('Record purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-d]').forEach((b) => b.addEventListener('click', () => {
    const d = getDirective(b.dataset.restoreD); if (!d) return;
    d.deleted = false; d.deletedAt = null; upsertDirective(d);
    logAction(app.user, 'RESTORE_RECORD', `Directive ${d.ref} restored.`);
    toast('Directive restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-d]').forEach((b) => b.addEventListener('click', async () => {
    const d = getDirective(b.dataset.purgeD); if (!d) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete directive ${d.ref}?`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.directives = db.directives.filter((x) => x.id !== d.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Directive ${d.ref} permanently deleted.`);
    toast('Directive purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-s]').forEach((b) => b.addEventListener('click', () => {
    const s = getSubject(b.dataset.restoreS); if (!s) return;
    s.deleted = false; s.deletedAt = null; s.version += 1; upsertSubject(s);
    logAction(app.user, 'RESTORE_RECORD', `Subject ${s.ref} restored.`);
    toast('Subject restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-s]').forEach((b) => b.addEventListener('click', async () => {
    const s = getSubject(b.dataset.purgeS); if (!s) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete subject ${s.ref} \u00b7 ${s.alias}?`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.subjects = db.subjects.filter((x) => x.id !== s.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Subject ${s.ref} permanently deleted.`);
    toast('Subject purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-c]').forEach((b) => b.addEventListener('click', () => {
    const c = getCase(b.dataset.restoreC); if (!c) return;
    c.deleted = false; c.deletedAt = null; c.version += 1; upsertCase(c);
    logAction(app.user, 'RESTORE_RECORD', `Case ${c.ref} restored.`);
    toast('Case restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-c]').forEach((b) => b.addEventListener('click', async () => {
    const c = getCase(b.dataset.purgeC); if (!c) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete case ${c.ref} \u00b7 ${c.title}?`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.cases = db.cases.filter((x) => x.id !== c.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Case ${c.ref} permanently deleted.`);
    toast('Case purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-k]').forEach((b) => b.addEventListener('click', () => {
    const c = getCompartment(b.dataset.restoreK); if (!c) return;
    c.deleted = false; c.deletedAt = null; c.version += 1; upsertCompartment(c);
    logAction(app.user, 'RESTORE_COMPARTMENT', `Compartment ${c.name} restored.`);
    toast('Compartment restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-k]').forEach((b) => b.addEventListener('click', async () => {
    const c = getCompartment(b.dataset.purgeK); if (!c) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete compartment ${c.name} (${c.ref})? Records filed under it will need re-tagging.`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.compartments = db.compartments.filter((x) => x.id !== c.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Compartment ${c.name} permanently deleted.`);
    toast('Compartment purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-r]').forEach((b) => b.addEventListener('click', () => {
    const r = getRecruit(b.dataset.restoreR); if (!r) return;
    r.deleted = false; r.deletedAt = null; r.version += 1; upsertRecruit(r);
    logAction(app.user, 'RESTORE_RECORD', `Candidate ${r.ref} restored.`);
    toast('Candidate restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-r]').forEach((b) => b.addEventListener('click', async () => {
    const r = getRecruit(b.dataset.purgeR); if (!r) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete candidate ${r.ref} \u00b7 ${r.name}? This cannot be undone.`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.recruits = db.recruits.filter((x) => x.id !== r.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Candidate ${r.ref} permanently deleted.`);
    toast('Candidate purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-o]').forEach((b) => b.addEventListener('click', () => {
    const o = getOperation(b.dataset.restoreO); if (!o) return;
    o.deleted = false; o.deletedAt = null; o.version += 1; upsertOperation(o);
    logAction(app.user, 'RESTORE_RECORD', `Operation ${o.ref} restored.`);
    toast('Operation restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-o]').forEach((b) => b.addEventListener('click', async () => {
    const o = getOperation(b.dataset.purgeO); if (!o) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete operation ${o.ref} \u00b7 ${o.name}? Its log goes with it.`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.operations = db.operations.filter((x) => x.id !== o.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Operation ${o.ref} permanently deleted.`);
    toast('Operation purged.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-restore-i]').forEach((b) => b.addEventListener('click', () => {
    const s = getIntel(b.dataset.restoreI); if (!s) return;
    s.deleted = false; s.deletedAt = null; s.version += 1; upsertIntel(s);
    logAction(app.user, 'RESTORE_RECORD', `Source ${s.ref} restored.`);
    toast('Source restored.', 'success'); app.refresh();
  }));
  panel.querySelectorAll('[data-purge-i]').forEach((b) => b.addEventListener('click', async () => {
    const s = getIntel(b.dataset.purgeI); if (!s) return;
    const ok = await confirmDialog({ title: 'Purge permanently', message: `Permanently delete source ${s.ref} \u00b7 ${s.codename}? Its reporting record goes with it.`, confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    const db = loadDb(); db.intel = db.intel.filter((x) => x.id !== s.id);
    saveDb();
    logAction(app.user, 'PURGE_RECORD', `Source ${s.ref} permanently deleted.`);
    toast('Source purged.', 'success'); app.refresh();
  }));
}

// --- System -----------------------------------------------------------------
function drawSystem(panel, app) {
  const backend = storageBackend();
  const db = loadDb();
  const counts = {
    users: db.users.length,
    directives: db.directives.length,
    subjects: (db.subjects || []).length,
    cases: (db.cases || []).length,
    audit: db.audit.length,
  };

  panel.innerHTML = `
    <div class="card">
      <div class="card__title">Storage</div>
      <div class="card__body">
        <div class="kv"><span class="kv__k">Backend</span><span class="kv__v">${backend === 'localStorage' ? '<span class="badge badge--ok">localStorage</span> persistent on this browser' : '<span class="badge badge--warn">in-memory</span> not persisted (storage unavailable)'}</span></div>
        <div class="kv"><span class="kv__k">Seeded</span><span class="kv__v">${fmtDateTime(db.meta.seededAt)}</span></div>
        <div class="kv"><span class="kv__k">Records</span><span class="kv__v">${counts.users} personnel \u00b7 ${counts.subjects} subjects \u00b7 ${counts.cases} cases \u00b7 ${counts.directives} directives \u00b7 ${counts.audit} log entries</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card__title">Data</div>
      <div class="card__body">
        <p class="muted-text">Export a full snapshot of the dataset, or reset the system to its seeded state.</p>
        <div class="btn-row">
          <button class="btn" id="sys-export">Export dataset (JSON)</button>
          <button class="btn btn--danger" id="sys-reset">Reset system\u2026</button>
        </div>
      </div>
    </div>`;

  panel.querySelector('#sys-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(loadDb(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cairo-aic-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Dataset exported.', 'success');
  });

  panel.querySelector('#sys-reset').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset system',
      message: 'Wipe all records and restore the original seed data? Every change, including new personnel and your current session, will be lost.',
      confirmLabel: 'Reset everything',
      danger: true,
    });
    if (!ok) return;
    clearDb();
    await ensureSeeded();
    logAction(null, 'RESET_SYSTEM', 'System reset to seed state.');
    toast('System reset. Returning to sign-in.', 'success');
    app.refresh();
  });
}
