// =============================================================================
// views/isd-induction.js — ISD induction assessments.
//
// The Department's recruitment: a fixed multiple-choice test (isd-induction.js)
// with an objective key, so the score is derived, not entered. A recruiter
// (Investigator+) files a candidate's assessment and records their answers; ISD
// command decides the outcome, and a passing candidate who holds a system
// account can be read into the Department from here. Covert — the snapshot
// carries no inductions for anyone outside it.
//
// Most agents never become system users (per the Department's own preference),
// so an induction stands as the record that a candidate qualified; the read-in
// link is only offered when the candidate matches a real operator.
// =============================================================================

import {
  INDUCTION_QUESTIONS, INDUCTION_MAX, INDUCTION_PASS_MARK, scoreInduction,
} from '../isd-induction.js';
import { clearanceForRank } from '../constants.js';
import {
  inductions, getInduction, upsertInduction, users, getUser, upsertUser, newId,
} from '../storage.js';
import { canFileInduction, canManageISD } from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, fmtDate, toast, openModal, confirmDialog } from '../ui.js';

const ORG = 'isd';
const live = () => inductions().filter((i) => !i.deleted);

function resultBadge(rec) {
  const { score, max, passed } = scoreInduction(rec.answers || {});
  const tone = passed ? 'ok' : 'bad';
  return `<span class="badge badge--${tone}">${score}/${max} · ${passed ? 'Pass' : 'Fail'}</span>`;
}
function outcomeBadge(rec) {
  if (rec.outcome === 'inducted') return '<span class="badge badge--ok">Inducted</span>';
  if (rec.outcome === 'declined') return '<span class="badge badge--muted">Declined</span>';
  return '';
}

export function render(host, app) {
  const actor = app.user;
  const all = live().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pending = all.filter((r) => !r.outcome);
  const decided = all.filter((r) => r.outcome);

  const row = (r) => `
    <tr data-id="${esc(r.id)}" tabindex="0">
      <td class="mono">${esc(r.ref)}</td>
      <td class="cell-name">${esc(r.candidateName || '—')}${r.candidateSteamId ? `<div class="muted-text mono">${esc(r.candidateSteamId)}</div>` : ''}</td>
      <td>${resultBadge(r)} ${outcomeBadge(r)}</td>
      <td>${esc(r.recruiterName || r.createdBy || '—')}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td class="cell-right"><span class="row-go">Open →</span></td>
    </tr>`;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · Internal Security</div>
        <h1 class="page-title">Induction</h1>
        <div class="page-sub">Recruitment assessment · pass mark ${INDUCTION_PASS_MARK} of ${INDUCTION_MAX} · Department eyes only</div>
      </div>
      ${canFileInduction(actor) ? '<button class="btn btn--primary" id="ind-new">+ New induction</button>' : ''}
    </div>

    <div class="ntk-banner">Internal Security material. These assessments are not visible outside the Department.</div>

    <section class="card">
      <div class="card__title">Awaiting a decision ${pending.length ? `<span class="badge badge--warn">${pending.length}</span>` : ''}</div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Candidate</th><th>Result</th><th>Recruiter</th><th>Filed</th><th></th></tr></thead>
        <tbody>${pending.length ? pending.map(row).join('') : '<tr><td colspan="6" class="empty">No inductions awaiting a decision.</td></tr>'}</tbody>
      </table>
    </section>

    ${decided.length ? `<section class="card" style="margin-top:18px">
      <div class="card__title">Decided</div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Candidate</th><th>Result</th><th>Recruiter</th><th>Filed</th><th></th></tr></thead>
        <tbody>${decided.map(row).join('')}</tbody>
      </table>
    </section>` : ''}
  `;

  host.querySelectorAll('[data-id]').forEach((el) => {
    const open = () => openRecord(app, el.dataset.id);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
  const add = host.querySelector('#ind-new');
  if (add) add.addEventListener('click', () => openAssessment(app, null));
}

// The assessment form — used to file a new induction and to view/correct one.
// The recorder marks the candidate's answers; the score updates live.
function openAssessment(app, id) {
  const actor = app.user;
  const rec = id ? getInduction(id) : null;
  const readOnly = !canFileInduction(actor) || (rec && rec.outcome);
  const a = (rec && rec.answers) || {};

  const questionHTML = INDUCTION_QUESTIONS.map((q, i) => {
    const chosen = new Set(Array.isArray(a[q.id]) ? a[q.id] : []);
    const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
    const opts = q.options.map((o) => `
      <label class="check ind-opt">
        <input type="${inputType}" name="ind-${q.id}" value="${esc(o.id)}" ${chosen.has(o.id) ? 'checked' : ''} ${readOnly ? 'disabled' : ''} data-ind-q="${esc(q.id)}" />
        <span>${esc(o.label)}</span>
      </label>`).join('');
    return `<div class="ind-q" data-q="${esc(q.id)}">
      <div class="ind-q__head"><span class="ind-q__n">${i + 1}</span> <span class="ind-q__prompt">${esc(q.prompt)}</span>
        <span class="ind-q__type muted-text">${q.type === 'multi' ? 'select all that apply' : 'one answer'}</span></div>
      <div class="ind-q__opts">${opts}</div>
    </div>`;
  }).join('');

  const dialog = openModal({
    title: rec ? `${rec.ref} — ${rec.candidateName || 'Candidate'}` : 'New induction',
    wide: true,
    body: `
      <div class="card__subtitle">Section 1 — administrative</div>
      <div class="ind-admin">
        <div class="field"><label>Candidate name</label><input id="ind-name" type="text" value="${esc((rec && rec.candidateName) || '')}" ${readOnly ? 'disabled' : ''} /></div>
        <div class="field"><label>Candidate SteamID</label><input id="ind-steam" type="text" value="${esc((rec && rec.candidateSteamId) || '')}" placeholder="STEAM_0:…" ${readOnly ? 'disabled' : ''} /></div>
        <div class="field"><label>Recruiter rank</label><input id="ind-rrank" type="text" value="${esc((rec && rec.recruiterRank) || actor.isd?.rank || '')}" ${readOnly ? 'disabled' : ''} /></div>
        <div class="field"><label>Recruiter name</label><input id="ind-rname" type="text" value="${esc((rec && rec.recruiterName) || actor.designation)}" ${readOnly ? 'disabled' : ''} /></div>
      </div>
      <div class="card__subtitle" style="margin-top:10px">Section 2 — assessment
        <span class="ind-score" id="ind-score"></span></div>
      <div class="ind-questions">${questionHTML}</div>
      <div id="ind-err" class="auth__error" hidden></div>`,
    actions: readOnly
      ? [{ label: 'Close', tone: 'ghost', onClick: (c) => c() }]
      : [
        { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
        { label: rec ? 'Save' : 'File induction', tone: 'primary', onClick: (c, d) => {
            const admin = {
              candidateName: d.querySelector('#ind-name').value.trim(),
              candidateSteamId: d.querySelector('#ind-steam').value.trim(),
              recruiterRank: d.querySelector('#ind-rrank').value.trim(),
              recruiterName: d.querySelector('#ind-rname').value.trim(),
            };
            if (!admin.candidateName) { const e = d.querySelector('#ind-err'); e.textContent = 'A candidate name is required.'; e.hidden = false; return; }
            saveAssessment(app, id, admin, readAnswers(d));
            c();
          } },
      ],
  });

  // Live score as the recorder marks answers.
  const scoreEl = dialog.querySelector('#ind-score');
  const paint = () => {
    const { score, max, passed } = scoreInduction(readAnswers(dialog));
    scoreEl.innerHTML = `<span class="badge badge--${passed ? 'ok' : 'bad'}">${score}/${max} · ${passed ? 'Pass' : 'Fail'}</span>`;
  };
  dialog.querySelectorAll('[data-ind-q]').forEach((el) => el.addEventListener('change', paint));
  paint();
}

function readAnswers(root) {
  const answers = {};
  root.querySelectorAll('[data-ind-q]').forEach((el) => {
    if (!el.checked) return;
    const q = el.dataset.indQ;
    (answers[q] = answers[q] || []).push(el.value);
  });
  return answers;
}

function nextRef() {
  return `ISD-IND-${String(inductions().length + 1).padStart(4, '0')}`;
}

function saveAssessment(app, id, admin, answers) {
  const now = new Date().toISOString();
  if (id) {
    const fresh = getInduction(id);
    if (!fresh) { toast('That induction no longer exists.', 'error'); app.refresh(); return; }
    Object.assign(fresh, admin, { answers, updatedAt: now, version: (fresh.version || 1) + 1 });
    upsertInduction(fresh);
    logAction(app.user, 'EDIT_INDUCTION', `Updated induction ${fresh.ref}.`);
  } else {
    const ref = nextRef();
    upsertInduction({
      id: newId('ind'), ref, org: ORG, ...admin, answers,
      outcome: null, inductedUserId: null, createdBy: app.user.designation,
      createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
    });
    logAction(app.user, 'OPEN_INDUCTION', `Induction ${ref} filed for ${admin.candidateName}.`);
  }
  toast('Induction saved.', 'success');
  app.refresh();
}

// The record view — result, the recorded answers, and (for command) the decision.
function openRecord(app, id) {
  const rec = getInduction(id);
  if (!rec) return;
  const actor = app.user;
  const { score, max, passed, perQuestion } = scoreInduction(rec.answers || {});
  const command = canManageISD(actor);

  const answerList = INDUCTION_QUESTIONS.map((q, i) => {
    const chosen = new Set(Array.isArray(rec.answers?.[q.id]) ? rec.answers[q.id] : []);
    const opts = q.options.map((o) => {
      const picked = chosen.has(o.id);
      const cls = o.correct ? 'ind-a--correct' : (picked ? 'ind-a--wrong' : '');
      return `<li class="ind-a ${cls}">${picked ? '☑' : '☐'} ${esc(o.label)}${o.correct ? ' <span class="muted-text">(key)</span>' : ''}</li>`;
    }).join('');
    return `<div class="ind-q"><div class="ind-q__head"><span class="ind-q__n">${i + 1}</span> <span class="ind-q__prompt">${esc(q.prompt)}</span> <span class="muted-text">${perQuestion[q.id].gained}/${perQuestion[q.id].possible}</span></div><ul class="ind-answers">${opts}</ul></div>`;
  }).join('');

  // A read-in is offered only when the candidate matches a real operator who is
  // not already ISD — most candidates never become system users.
  const match = matchCandidate(rec);
  const canReadIn = command && passed && rec.outcome === 'inducted' && match && !match.isd;

  openModal({
    title: `${rec.ref} — ${rec.candidateName || 'Candidate'}`,
    wide: true,
    body: `
      <div class="kv"><span class="kv__k">Result</span><span class="kv__v"><span class="badge badge--${passed ? 'ok' : 'bad'}">${score}/${max} · ${passed ? 'Pass' : 'Fail'}</span> ${outcomeBadge(rec)}</span></div>
      <div class="kv"><span class="kv__k">SteamID</span><span class="kv__v mono">${esc(rec.candidateSteamId || '—')}</span></div>
      <div class="kv"><span class="kv__k">Recruiter</span><span class="kv__v">${esc(rec.recruiterRank || '')} ${esc(rec.recruiterName || rec.createdBy || '—')}</span></div>
      <div class="card__subtitle" style="margin-top:10px">Recorded answers</div>
      <div class="ind-questions">${answerList}</div>
      ${rec.outcome === 'inducted' && rec.inductedUserId ? `<p class="field__hint" style="margin-top:8px">Read into the Department — see <a class="rec-link" href="#/personnel/${esc(rec.inductedUserId)}">the operator’s file</a>.</p>` : ''}
    `,
    actions: [
      { label: 'Close', tone: 'ghost', onClick: (c) => c() },
      ...(canFileInduction(actor) && !rec.outcome ? [{ label: 'Edit answers', tone: 'ghost', onClick: (c) => { c(); openAssessment(app, id); } }] : []),
      ...(command && !rec.outcome && passed ? [{ label: 'Induct', tone: 'primary', onClick: (c) => { c(); decide(app, id, 'inducted'); } }] : []),
      ...(command && !rec.outcome ? [{ label: 'Decline', tone: 'danger', onClick: (c) => { c(); decide(app, id, 'declined'); } }] : []),
      ...(canReadIn ? [{ label: `Read ${match.designation} in`, tone: 'primary', onClick: (c) => { c(); readCandidateIn(app, id, match.id); } }] : []),
    ],
  });
}

// Best-effort match of a candidate to a real operator (by designation, codename,
// or a recorded userId). Loose on purpose — most candidates are not users.
function matchCandidate(rec) {
  if (rec.inductedUserId) return getUser(rec.inductedUserId);
  const name = (rec.candidateName || '').trim().toLowerCase();
  if (!name) return null;
  return users().find((u) => !u.deleted
    && ((u.designation || '').toLowerCase() === name || (u.codename || '').toLowerCase() === name)) || null;
}

function decide(app, id, outcome) {
  const fresh = getInduction(id);
  if (!fresh) return;
  if (outcome === 'inducted' && !scoreInduction(fresh.answers || {}).passed) {
    toast('A candidate who did not pass cannot be inducted.', 'error'); return;
  }
  fresh.outcome = outcome;
  fresh.updatedAt = new Date().toISOString();
  fresh.version = (fresh.version || 1) + 1;
  upsertInduction(fresh);
  logAction(app.user, 'DECIDE_INDUCTION', `Induction ${fresh.ref} ${outcome}.`);
  toast(outcome === 'inducted' ? 'Candidate inducted.' : 'Candidate declined.', 'success');
  app.refresh();
}

// Read a passing, inducted candidate who holds an account into the Department as
// an Operative, and link the induction to their file.
async function readCandidateIn(app, id, userId) {
  const rec = getInduction(id);
  const u = getUser(userId);
  if (!rec || !u || u.isd) return;
  const ok = await confirmDialog({
    title: 'Read into Internal Security',
    message: `Read ${u.designation} · ${u.codename || ''} into the Department as an Operative? Their cover post is unaffected.`,
    confirmLabel: 'Read in',
  });
  if (!ok) return;
  const now = new Date().toISOString();
  const fresh = getUser(userId);
  fresh.isd = { rank: 'Operative', clearance: clearanceForRank('isd', 'Operative'), standing: 'active', badgeNumber: null, promoChecks: [] };
  fresh.updatedAt = now; fresh.version = (fresh.version || 1) + 1;
  upsertUser(fresh);
  logAction(app.user, 'SET_ISD_MEMBERSHIP', `${fresh.designation} read into Internal Security from induction ${rec.ref}.`);

  const link = getInduction(id);
  link.inductedUserId = userId;
  link.updatedAt = now; link.version = (link.version || 1) + 1;
  upsertInduction(link);
  logAction(app.user, 'DECIDE_INDUCTION', `Induction ${link.ref} linked to ${fresh.designation}.`);
  toast('Read into the Department.', 'success');
  app.refresh();
}
