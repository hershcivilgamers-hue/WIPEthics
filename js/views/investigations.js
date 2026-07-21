// =============================================================================
// views/investigations.js — ISD investigations.
//
// The Department's multi-stage investigative protocol, as a pipeline board:
// Referral → Preliminary → Active → Adjudication → Closed. Authority is tiered
// on the ISD ladder and mirrors the Worker gate exactly, so the UI never offers
// an action the server would refuse: an Operative reads and is assigned but
// files nothing; an Investigator files referrals and records to the file; an
// Inspector opens a preliminary into an active investigation; adjudication,
// disposition and closure belong to ISD command. The record is append-only.
//
// Nothing here is visible outside the Department — the snapshot carries no
// investigations at all for anyone else (see redact.js).
// =============================================================================

import {
  INVESTIGATION_STAGE, INVESTIGATION_PIPELINE, INVESTIGATION_DISPOSITION,
  investigationNextStage, CASE_KIND,
} from '../constants.js';
import {
  investigations, getInvestigation, upsertInvestigation, users, getUser, newId,
  cases, getCase, upsertCase,
} from '../storage.js';
import {
  canFileInvestigation, canAdvanceInvestigation, canAdjudicateInvestigation, canManageTribunal,
} from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, fmtDate, fmtDateTime, toast, openModal, confirmDialog } from '../ui.js';

const ORG = 'isd';
const live = () => investigations().filter((i) => !i.deleted);

const stageBadge = (s) => {
  const m = INVESTIGATION_STAGE[s] || { label: s, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};
const dispositionBadge = (d) => {
  const m = INVESTIGATION_DISPOSITION[d];
  return m ? `<span class="badge badge--${m.tone}">${esc(m.label)}</span>` : '';
};
const subjectLabel = (rec) => {
  const u = rec.subjectUserId ? getUser(rec.subjectUserId) : null;
  return u ? `${u.designation} · ${u.codename || ''}`.trim() : (rec.subjectName || 'Unnamed subject');
};

// Who may push THIS matter to its next stage — mirrors authorizeInvestigation.
function canAdvanceFrom(actor, stage) {
  if (stage === 'referral') return canFileInvestigation(actor);
  if (stage === 'preliminary') return canAdvanceInvestigation(actor);
  if (stage === 'active' || stage === 'adjudication') return canAdjudicateInvestigation(actor);
  return false;
}

export function render(host, app) {
  const actor = app.user;
  const all = live();
  const open = all.filter((i) => i.stage !== 'closed');
  const closed = all.filter((i) => i.stage === 'closed')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const columns = INVESTIGATION_PIPELINE.filter((s) => s !== 'closed').map((stage) => {
    const list = open.filter((i) => i.stage === stage)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const cards = list.length ? list.map((r) => `
      <article class="recruit-card" data-id="${esc(r.id)}" tabindex="0">
        <div class="recruit-card__top"><span class="mono">${esc(r.ref)}</span></div>
        <div class="recruit-card__name">${esc(subjectLabel(r))}</div>
        <div class="recruit-card__meta">${esc(r.summary || 'No summary recorded.')}</div>
        <div class="recruit-card__foot">
          <span class="muted-text">${(r.entries || []).length} entr${(r.entries || []).length === 1 ? 'y' : 'ies'}</span>
          <span class="row-go">Open →</span>
        </div>
      </article>`).join('') : '<div class="empty">None</div>';
    return `<section class="pipe-col">
      <div class="pipe-col__head">${stageBadge(stage)} <span class="pipe-col__count">${list.length}</span></div>
      <div class="pipe-col__body">${cards}</div>
    </section>`;
  }).join('');

  const closedRows = closed.map((r) => `
    <tr data-id="${esc(r.id)}" tabindex="0">
      <td class="mono">${esc(r.ref)}</td>
      <td class="cell-name">${esc(subjectLabel(r))}</td>
      <td>${dispositionBadge(r.disposition)}</td>
      <td>${fmtDate(r.updatedAt)}</td>
      <td class="cell-right"><span class="row-go">Open →</span></td>
    </tr>`).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · Internal Security</div>
        <h1 class="page-title">Investigations</h1>
        <div class="page-sub">Multi-stage protocol · referral through adjudication · Department eyes only</div>
      </div>
      ${canFileInvestigation(actor) ? '<button class="btn btn--primary" id="inv-new">+ File a referral</button>' : ''}
    </div>

    <div class="ntk-banner">Internal Security material. These records are not visible outside the Department.</div>

    <div class="pipeline pipeline--4">${columns}</div>

    ${closed.length ? `<section class="card" style="margin-top:18px">
      <div class="card__title">Closed</div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Subject</th><th>Disposition</th><th>Closed</th><th></th></tr></thead>
        <tbody>${closedRows}</tbody>
      </table>
    </section>` : ''}
  `;

  const openRec = (id) => openRecord(app, id);
  host.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => openRec(el.dataset.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRec(el.dataset.id); });
  });
  const add = host.querySelector('#inv-new');
  if (add) add.addEventListener('click', () => openReferral(app));
}

// --- The investigative file ---------------------------------------------------
function openRecord(app, id) {
  const rec = getInvestigation(id);
  if (!rec) return;
  const actor = app.user;
  const entries = [...(rec.entries || [])].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const thread = entries.length ? entries.map((e) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--note"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(e.text)}</div>
        <div class="tl__meta"><span class="mono">${esc(e.by)}</span> · ${esc(e.type || 'note')} · ${fmtDateTime(e.ts)}</div>
      </div>
    </li>`).join('') : '<div class="empty">Nothing recorded yet.</div>';

  const next = investigationNextStage(rec.stage);
  const mayAdvance = next && canAdvanceFrom(actor, rec.stage);
  const closing = next === 'closed';

  // Escalation. The Department refers; the Committee rules — so opening the case
  // is deliberately NOT an ISD power: canManageTribunal needs an Ethics stake,
  // which an agent's cover post does not give them. A seated Committee member
  // (CL5, who can also see these files) picks the referral up from here.
  const linkedCase = rec.caseId ? getCase(rec.caseId) : null;
  const referable = rec.stage === 'closed'
    && (rec.disposition === 'substantiated' || rec.disposition === 'referred')
    && !linkedCase;
  // Referring writes TWO records: the case (canManageTribunal) and the link back
  // onto the investigation (canAdjudicateInvestigation). Both are required here so
  // the action can never half-succeed — a Command CL4-S has the first but not the
  // second, and is only kept out today by not seeing investigations at all.
  const mayRefer = referable && canManageTribunal(actor) && canAdjudicateInvestigation(actor);

  const dialog = openModal({
    title: `${rec.ref} — ${subjectLabel(rec)}`,
    wide: true,
    body: `
      <div class="kv"><span class="kv__k">Stage</span><span class="kv__v">${stageBadge(rec.stage)} ${dispositionBadge(rec.disposition)}</span></div>
      <div class="kv"><span class="kv__k">Subject</span><span class="kv__v">${esc(subjectLabel(rec))}</span></div>
      <div class="kv"><span class="kv__k">Filed</span><span class="kv__v">${fmtDate(rec.createdAt)} · <span class="mono">${esc(rec.openedBy || '—')}</span></span></div>
      <p class="modal__message">${esc((INVESTIGATION_STAGE[rec.stage] || {}).blurb || '')}</p>
      ${rec.summary ? `<div class="card__subtitle" style="margin-top:8px">Summary</div><p>${esc(rec.summary)}</p>` : ''}
      <div class="card__subtitle" style="margin-top:10px">Investigative record <span class="muted-text">(append-only)</span></div>
      ${entries.length ? `<ul class="timeline">${thread}</ul>` : thread}
      ${rec.stage !== 'closed' && canFileInvestigation(actor) ? `
        <div class="comment-box">
          <input id="inv-entry" type="text" placeholder="Record to the file…" />
          <button class="btn btn--sm" id="inv-add">Record</button>
        </div>` : ''}
      ${linkedCase ? `<div class="kv" style="margin-top:8px"><span class="kv__k">Committee case</span><span class="kv__v"><a class="rec-link" href="#/case/${esc(linkedCase.id)}">${esc(linkedCase.ref)} — ${esc(linkedCase.title)}</a></span></div>` : ''}
      ${referable && !mayRefer ? '<p class="field__hint" style="margin-top:8px">Substantiated. Awaiting the Committee to open a case — the Department refers, the Committee rules.</p>' : ''}
      ${rec.stage === 'closed' ? '<p class="field__hint" style="margin-top:8px">This matter is closed; its record is sealed.</p>' : ''}
    `,
    actions: [
      { label: 'Close', tone: 'ghost', onClick: (c) => c() },
      ...(mayAdvance ? [{
        label: closing ? 'Close with disposition…' : `Advance to ${INVESTIGATION_STAGE[next].label}`,
        tone: closing ? 'danger' : 'primary',
        onClick: (c) => { c(); if (closing) openClose(app, rec.id); else advance(app, rec.id, next); },
      }] : []),
      ...(mayRefer ? [{
        label: 'Open a Committee case',
        tone: 'primary',
        onClick: (c) => { c(); openReferToCommittee(app, rec.id); },
      }] : []),
    ],
  });

  const addBtn = dialog.querySelector('#inv-add');
  if (addBtn) {
    const submit = () => {
      const input = dialog.querySelector('#inv-entry');
      const text = input.value.trim();
      if (!text) { toast('Enter something to record.', 'error'); return; }
      addEntry(app, rec.id, text);
    };
    addBtn.addEventListener('click', submit);
    dialog.querySelector('#inv-entry').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
}

// --- Actions ------------------------------------------------------------------
function openReferral(app) {
  const roster = users().filter((u) => !u.deleted && u.accountStatus === 'active')
    .sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
  const opts = ['<option value="">— not a listed operator —</option>',
    ...roster.map((u) => `<option value="${esc(u.id)}">${esc(u.designation)} · ${esc(u.codename || '')}</option>`)].join('');

  openModal({
    title: 'File a referral',
    wide: true,
    body: `
      <p class="modal__message">A referral is an assessment request, not yet an investigation. It opens at the Referral stage.</p>
      <div class="field"><label>Subject of the referral</label><select id="inv-subject">${opts}</select></div>
      <div class="field"><label>Or name them <span class="muted-text">(if not an operator)</span></label><input id="inv-name" type="text" placeholder="Name or description" /></div>
      <div class="field"><label>Summary</label><textarea id="inv-summary" rows="3" placeholder="What is being referred, and why…"></textarea></div>
      <div id="inv-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'File referral', tone: 'primary', onClick: (c, d) => {
          const subjectUserId = d.querySelector('#inv-subject').value || null;
          const subjectName = d.querySelector('#inv-name').value.trim();
          const summary = d.querySelector('#inv-summary').value.trim();
          if (!subjectUserId && !subjectName) {
            const e = d.querySelector('#inv-err'); e.textContent = 'Name a subject, or pick an operator.'; e.hidden = false; return;
          }
          if (!summary) { const e = d.querySelector('#inv-err'); e.textContent = 'A referral must state its grounds.'; e.hidden = false; return; }
          fileReferral(app, { subjectUserId, subjectName, summary });
          c();
        } },
    ],
  });
}

function nextRef() {
  const n = investigations().length + 1;
  return `ISD-INV-${String(n).padStart(4, '0')}`;
}

function fileReferral(app, { subjectUserId, subjectName, summary }) {
  const now = new Date().toISOString();
  const ref = nextRef();
  upsertInvestigation({
    id: newId('inv'), ref, org: ORG,
    subjectUserId: subjectUserId || null, subjectName: subjectName || null,
    stage: 'referral', summary, disposition: null, caseId: null, compartment: null,
    entries: [{ id: newId('ie'), ts: now, by: app.user.designation, type: 'filing', text: `Referral filed: ${summary}` }],
    openedBy: app.user.designation,
    createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
  });
  logAction(app.user, 'OPEN_INVESTIGATION', `Referral ${ref} filed.`);
  toast(`Referral ${ref} filed.`, 'success');
  app.refresh();
}

function addEntry(app, id, text) {
  const fresh = getInvestigation(id);
  if (!fresh) return;
  const now = new Date().toISOString();
  fresh.entries = [...(fresh.entries || []), { id: newId('ie'), ts: now, by: app.user.designation, type: 'note', text }];
  fresh.updatedAt = now;
  fresh.version = (fresh.version || 1) + 1;
  upsertInvestigation(fresh);
  logAction(app.user, 'LOG_INVESTIGATION', `Entry recorded in ${fresh.ref}.`);
  toast('Recorded to the file.', 'success');
  app.refresh();
}

function advance(app, id, to) {
  const fresh = getInvestigation(id);
  if (!fresh) return;
  const now = new Date().toISOString();
  fresh.stage = to;
  fresh.entries = [...(fresh.entries || []), {
    id: newId('ie'), ts: now, by: app.user.designation, type: 'stage',
    text: `Advanced to ${INVESTIGATION_STAGE[to].label}.`,
  }];
  fresh.updatedAt = now;
  fresh.version = (fresh.version || 1) + 1;
  upsertInvestigation(fresh);
  logAction(app.user, 'ADVANCE_INVESTIGATION', `${fresh.ref} → ${to}.`);
  toast(`Advanced to ${INVESTIGATION_STAGE[to].label}.`, 'success');
  app.refresh();
}

// Closure records the disposition in the same write — the gate requires it.
function openClose(app, id) {
  const rec = getInvestigation(id);
  if (!rec) return;
  const opts = Object.values(INVESTIGATION_DISPOSITION)
    .map((d) => `<option value="${esc(d.code)}">${esc(d.label)}</option>`).join('');
  openModal({
    title: `Close ${rec.ref}`,
    body: `
      <p class="modal__message">Closing records a disposition and seals the file. A substantiated matter should then be referred to the Ethics Committee — the Department investigates; the Committee rules.</p>
      <div class="field"><label>Disposition</label><select id="inv-disp">${opts}</select></div>
      <div class="field"><label>Closing note</label><textarea id="inv-close-note" rows="2" placeholder="Basis for the disposition…"></textarea></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Close matter', tone: 'danger', onClick: (c, d) => {
          const disposition = d.querySelector('#inv-disp').value;
          const note = d.querySelector('#inv-close-note').value.trim();
          const fresh = getInvestigation(id);
          if (!fresh) { c(); return; }
          const now = new Date().toISOString();
          fresh.stage = 'closed';
          fresh.disposition = disposition;
          fresh.entries = [...(fresh.entries || []), {
            id: newId('ie'), ts: now, by: app.user.designation, type: 'disposition',
            text: `Closed — ${INVESTIGATION_DISPOSITION[disposition].label}.${note ? ` ${note}` : ''}`,
          }];
          fresh.updatedAt = now;
          fresh.version = (fresh.version || 1) + 1;
          upsertInvestigation(fresh);
          logAction(app.user, 'ADVANCE_INVESTIGATION', `${fresh.ref} closed — ${disposition}.`);
          c();
          toast('Matter closed.', 'success');
          app.refresh();
        } },
    ],
  });
}

// --- Escalation to the Ethics docket -----------------------------------------
// Opens a case on the Committee's docket from a substantiated matter and links
// the two. Guarded by canManageTribunal client-side — the same check
// authorizeCase runs — so the write never 403s. Linking back onto the
// investigation is a plain edit, which a CL5 Committee member is cleared for.
function suggestCaseRef() {
  const yy = new Date().getFullYear().toString().slice(-2);
  const n = cases().filter((c) => (c.ref || '').includes(`-${yy}-`)).length + 1;
  return `EC-CASE-${yy}-${String(n).padStart(3, '0')}`;
}

function openReferToCommittee(app, id) {
  const rec = getInvestigation(id);
  if (!rec) return;
  const actor = app.user;
  if (!canManageTribunal(actor) || !canAdjudicateInvestigation(actor)) {
    toast('Only a seated Committee member may open a case from a referral.', 'error'); return;
  }
  const kindOpts = Object.values(CASE_KIND).map((k) => `<option value="${esc(k.code)}">${esc(k.label)}</option>`).join('');
  openModal({
    title: `Open a Committee case — ${rec.ref}`,
    wide: true,
    body: `
      <p class="modal__message">The Department has substantiated this matter and referred it. Opening a case puts it on the Committee's docket and links the two records; the investigative file itself stays with the Department.</p>
      <div class="field"><label>Case reference</label><input id="ref-case-ref" type="text" value="${esc(suggestCaseRef())}" /></div>
      <div class="field"><label>Title</label><input id="ref-case-title" type="text" value="${esc(`Referred matter — ${subjectLabel(rec)}`)}" /></div>
      <div class="field"><label>Kind</label><select id="ref-case-kind">${kindOpts}</select></div>
      <div id="ref-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Open case', tone: 'primary', onClick: (c, d) => {
          const ref = d.querySelector('#ref-case-ref').value.trim();
          const title = d.querySelector('#ref-case-title').value.trim();
          const kind = d.querySelector('#ref-case-kind').value;
          if (!ref || !title) { const e = d.querySelector('#ref-err'); e.textContent = 'A reference and title are required.'; e.hidden = false; return; }
          referToCommittee(app, id, { ref, title, kind });
          c();
        } },
    ],
  });
}

function referToCommittee(app, id, { ref, title, kind }) {
  const rec = getInvestigation(id);
  if (!rec) return;
  const actor = app.user;
  const now = new Date().toISOString();
  const caseId = newId('case');
  upsertCase({
    id: caseId, ref, title, kind, clearance: 'CL4-S', status: 'open',
    summary: `Referred by the Internal Security Department following ${rec.ref}. ${rec.summary || ''}`.trim(),
    respondentId: rec.subjectUserId || null,
    respondentName: rec.subjectUserId ? null : (rec.subjectName || '[UNNAMED]'),
    respondentDept: null,
    panelIds: [], votes: {}, linkedSubjectIds: [], summons: [], compartment: null,
    entries: [{
      id: newId('ent'), ts: now, by: actor.designation, type: 'filing',
      text: `Case opened on an Internal Security referral (${rec.ref}), substantiated by the Department.`,
    }],
    ruling: null, createdBy: actor.designation, createdAt: now, updatedAt: now,
    version: 1, deleted: false, deletedAt: null,
  });
  logAction(actor, 'OPEN_CASE', `Opened ${ref} on ISD referral ${rec.ref}.`);

  // Link the investigation back to the case it produced.
  const fresh = getInvestigation(id);
  if (fresh) {
    fresh.caseId = caseId;
    fresh.updatedAt = now;
    fresh.version = (fresh.version || 1) + 1;
    upsertInvestigation(fresh);
    logAction(actor, 'EDIT_INVESTIGATION', `${fresh.ref} linked to ${ref}.`);
  }
  toast(`Case ${ref} opened on the docket.`, 'success');
  app.refresh();
}
