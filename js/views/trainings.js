// =============================================================================
// views/trainings.js — Training catalogue.
//
// The register of courses a unit runs — induction, weapons, containment,
// medical, records and command tracks. Managers of the owning organisation
// define, amend and retire courses; anyone with a stake reads the catalogue.
//
// Completions are NOT held here — they live on personnel files, where "who is
// current on what" belongs and inherits personnel redaction. This view shows
// each course with a live count of how many active operators in its unit
// currently hold it, and the personnel dossier shows the per-operator holdings.
// =============================================================================

import {
  TRAINING_CATEGORY, TRAINING_CATEGORY_ORDER, CLEARANCE_ORDER, CLEARANCES,
  clearanceWeight, trainingCurrency,
} from '../constants.js';
import { trainings, getTraining, upsertTraining, users, newId } from '../storage.js';
import { canViewTraining, canManageTraining, isCL5 } from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, toast, openModal, confirmDialog } from '../ui.js';

const ORGS = [
  { key: 'omega-1', label: 'MTF Omega-1' },
  { key: 'ethics-committee', label: 'Ethics Committee' },
  { key: 'command', label: 'Site Command' },
];

const catBadge = (c) => { const m = TRAINING_CATEGORY[c] || { label: c, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };

// How many active operators of a course's org currently hold it (derived).
function holders(course, now) {
  const roster = users().filter((u) => !u.deleted && u.accountStatus === 'active' && u.status !== 'discharged' && u.org === course.org);
  let held = 0; let current = 0;
  for (const u of roster) {
    const comp = (u.trainings || []).filter((t) => t.courseId === course.id).sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt))[0];
    if (comp) { held += 1; if (trainingCurrency(comp, now) !== 'lapsed') current += 1; }
  }
  return { held, current, roster: roster.length };
}

export function render(host, app) {
  const actor = app.user;
  const now = Date.now();
  const all = trainings().filter((c) => !c.deleted && canViewTraining(actor, c));

  const orgSections = ORGS.filter((o) => all.some((c) => c.org === o.key) || canManageTraining(actor, o.key)).map((o) => {
    const courses = all.filter((c) => c.org === o.key).sort((a, b) => (TRAINING_CATEGORY_ORDER.indexOf(a.category) - TRAINING_CATEGORY_ORDER.indexOf(b.category)) || a.code.localeCompare(b.code));
    const canManage = canManageTraining(actor, o.key);
    const rows = courses.length ? courses.map((c) => {
      const h = holders(c, now);
      return `
        <tr data-id="${esc(c.id)}" ${canManage ? 'class="row-click" tabindex="0"' : ''}>
          <td class="mono">${esc(c.code)}</td>
          <td class="cell-name">${esc(c.title)}${!c.active ? ' <span class="badge badge--muted">retired</span>' : ''}</td>
          <td>${catBadge(c.category)}</td>
          <td>${c.clearanceFloor ? esc((CLEARANCES[c.clearanceFloor] || {}).label || c.clearanceFloor) : '\u2014'}</td>
          <td>${c.validityMonths ? `${c.validityMonths} mo` : 'No expiry'}</td>
          <td><span class="badge badge--${h.current === h.roster && h.roster ? 'ok' : (h.current ? 'warn' : 'muted')}">${h.current}/${h.roster} current</span></td>
        </tr>`;
    }).join('') : `<tr><td colspan="6"><div class="empty">No courses defined for this organisation.</div></td></tr>`;

    return `
      <section class="card" style="margin-top:16px">
        <div class="card__title">${esc(o.label)} ${canManage ? `<button class="btn btn--sm btn--primary" data-new="${esc(o.key)}" style="float:right;margin-top:-4px">+ New course</button>` : ''}</div>
        <table class="table">
          <thead><tr><th>Code</th><th>Course</th><th>Category</th><th>Min. clearance</th><th>Validity</th><th>Held by unit</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO</div>
        <h1 class="page-title">Trainings</h1>
        <div class="page-sub">Course catalogue \u00b7 currency is shown on each personnel file</div>
      </div>
    </div>
    ${all.length || ORGS.some((o) => canManageTraining(actor, o.key)) ? orgSections : '<div class="empty">No courses you are cleared to see.</div>'}
  `;

  host.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openCourse(app, b.dataset.new, null); }));
  host.querySelectorAll('tr[data-id].row-click').forEach((tr) => {
    const open = () => openCourse(app, null, tr.dataset.id);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function clearanceFloorOptions(actor, current) {
  const opts = ['<option value="">\u2014 Any clearance \u2014</option>'];
  for (const c of CLEARANCE_ORDER) {
    if (clearanceWeight(c) > clearanceWeight(actor.clearance) && !isCL5(actor)) continue;
    opts.push(`<option value="${esc(c)}" ${current === c ? 'selected' : ''}>${esc((CLEARANCES[c] || {}).label || c)}</option>`);
  }
  return opts.join('');
}

// Create or edit a course. `org` for a new one; `id` for an existing one.
function openCourse(app, org, id) {
  const actor = app.user;
  const existing = id ? getTraining(id) : null;
  const forOrg = existing ? existing.org : org;
  if (!canManageTraining(actor, forOrg)) { toast('You cannot manage this catalogue.', 'error'); return; }

  const catOpts = TRAINING_CATEGORY_ORDER.map((k) => `<option value="${k}" ${existing && existing.category === k ? 'selected' : ''}>${esc(TRAINING_CATEGORY[k].label)}</option>`).join('');
  const body = `
    <div class="field"><label>Course code</label><input id="tr-code" type="text" placeholder="e.g. O1-CQB" value="${existing ? esc(existing.code) : ''}" /></div>
    <div class="field"><label>Title</label><input id="tr-title" type="text" placeholder="Close-quarters battle refresher" value="${existing ? esc(existing.title) : ''}" /></div>
    <div class="field"><label>Category</label><select id="tr-cat">${catOpts}</select></div>
    <div class="field"><label>Description</label><textarea id="tr-desc" rows="2" placeholder="What the course certifies\u2026">${existing ? esc(existing.description || '') : ''}</textarea></div>
    <div class="field"><label>Validity (months, 0 = never lapses)</label><input id="tr-valid" type="number" min="0" max="120" value="${existing ? Number(existing.validityMonths || 0) : 12}" /></div>
    <div class="field"><label>Minimum clearance to hold</label><select id="tr-clr">${clearanceFloorOptions(actor, existing ? existing.clearanceFloor : '')}</select></div>
    ${existing ? `<div class="field"><label><input id="tr-active" type="checkbox" ${existing.active ? 'checked' : ''} /> Active (offered)</label></div>` : ''}
    <div id="tr-err" class="auth__error" hidden></div>`;

  openModal({
    title: existing ? `Edit ${existing.code}` : 'New course',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      ...(existing ? [{ label: existing.deleted ? 'Restore' : 'Retire', tone: 'ghost', onClick: async (c) => {
          c();
          const ok = await confirmDialog({ title: existing.deleted ? 'Restore course' : 'Retire course', message: existing.deleted ? `Restore ${existing.code}?` : `Retire ${existing.code}? Existing completions are kept; the course stops being offered.`, confirmLabel: existing.deleted ? 'Restore' : 'Retire', danger: !existing.deleted });
          if (!ok) return;
          const fresh = getTraining(existing.id); if (!fresh) return;
          fresh.deleted = !fresh.deleted; fresh.deletedAt = fresh.deleted ? new Date().toISOString() : null;
          fresh.version = (fresh.version || 1) + 1; fresh.updatedAt = new Date().toISOString();
          upsertTraining(fresh);
          logAction(actor, fresh.deleted ? 'REMOVE_TRAINING' : 'RESTORE_TRAINING', `${fresh.deleted ? 'Retired' : 'Restored'} course ${fresh.ref}.`);
          toast(fresh.deleted ? 'Course retired.' : 'Course restored.', 'success'); app.refresh();
        } }] : []),
      { label: existing ? 'Save' : 'Add course', tone: 'primary', onClick: (c, d) => {
          const code = d.querySelector('#tr-code').value.trim();
          const title = d.querySelector('#tr-title').value.trim();
          const err = d.querySelector('#tr-err'); err.hidden = true;
          if (!code || !title) { err.textContent = 'A code and title are required.'; err.hidden = false; return; }
          const validityMonths = Math.max(0, Number(d.querySelector('#tr-valid').value) || 0);
          const patch = {
            code, title, category: d.querySelector('#tr-cat').value,
            description: d.querySelector('#tr-desc').value.trim(),
            validityMonths, clearanceFloor: d.querySelector('#tr-clr').value || null,
          };
          if (existing) {
            const fresh = getTraining(existing.id); if (!fresh) { toast('Course no longer exists.', 'error'); c(); app.refresh(); return; }
            Object.assign(fresh, patch);
            fresh.active = d.querySelector('#tr-active') ? d.querySelector('#tr-active').checked : fresh.active;
            fresh.version = (fresh.version || 1) + 1; fresh.updatedAt = new Date().toISOString();
            upsertTraining(fresh);
            logAction(actor, 'EDIT_TRAINING', `Updated course ${fresh.ref}.`);
            toast('Course updated.', 'success');
          } else {
            const n = trainings().length + 1;
            const ref = `TRN-${String(n).padStart(3, '0')}`;
            const nowIso = new Date().toISOString();
            upsertTraining({
              id: newId('trn'), ref, ...patch, org: forOrg, active: true,
              createdBy: actor.designation, createdAt: nowIso, updatedAt: nowIso,
              version: 1, deleted: false, deletedAt: null,
            });
            logAction(actor, 'CREATE_TRAINING', `Added course ${ref} (${code}).`);
            toast(`Course ${ref} added.`, 'success');
          }
          c(); app.refresh();
        } },
    ],
  });
}
