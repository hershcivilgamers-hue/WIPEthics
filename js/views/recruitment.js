// =============================================================================
// views/recruitment.js — Recruitment (two org-specific feeds).
//
// Omega-1 runs a scouting pipeline (Scouting -> Greenlit -> Tryout), advanced by
// the unit's CL4 cadre, with a yes/no vote at greenlight and ½ / full strikes at
// tryout. The Ethics Committee runs an Assistant pipeline (Application ->
// Interview) where the CL4 cadre comments and votes but only CL5 advances to
// interview (on a majority) and only CL5 runs the interview, passing (which opens
// the Assistant personnel file) or failing with a written reason. Each feed is
// scoped to operators with a stake in that org (or CL5). Every write routes
// through the permission engine, is version-stamped and audit-logged; the Worker
// re-authorises each write (vote integrity, valid transitions, the CL5 gates).
// =============================================================================

import {
  RECRUIT_STAGE, recruitPipeline, recruitFirstStage, RECRUIT_ARCHIVE, tallyVotes,
  OMEGA_DEPARTMENTS, ETHICS_APP_TAG, ETHICS_APP_TAG_ORDER,
  TRYOUT_STRIKE_HALF, TRYOUT_STRIKE_FULL, tryoutStrikeTotal,
  ORGS, RANKS, clearanceForRank,
} from '../constants.js';
import {
  recruits, getRecruit, upsertRecruit, getUser, users, upsertUser, newId,
} from '../storage.js';
import {
  canParticipateRecruitment, canManageOrg, canInductRecruit, isCL5,
} from '../permissions.js';
import { makeCredential } from '../crypto.js';
import { interviewSetFor, INTERVIEW_BANK_DRAW } from '../interview-bank.js';
import { exportInterviewScript } from '../export.js';
import { logAction } from '../audit.js';
import {
  esc, fmtDate, fmtDateTime, relTime, orgTag, monogram,
  toast, openModal, confirmDialog,
} from '../ui.js';

const ORG_LABEL = { 'omega-1': 'Recruitment', 'ethics-committee': 'Assistant Applications' };

const stageBadge = (s) => {
  const m = RECRUIT_STAGE[s] || { label: s, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};
const archiveBadge = (a) => {
  const m = RECRUIT_ARCHIVE[a];
  return m ? `<span class="badge badge--${m.tone}">${esc(m.label)}</span>` : '';
};
const tagBadge = (t) => {
  const m = ETHICS_APP_TAG[t];
  return m ? `<span class="badge badge--${m.tone}">${esc(m.label)}</span>` : '';
};

function visibleRecruits(actor, org) {
  return recruits().filter((r) => !r.deleted && r.org === org
    && (isCL5(actor) || canParticipateRecruitment(actor, r.org)));
}

// --- Shared mutation helper -------------------------------------------------
function mutate(app, id, expectedVersion, patch, { action, detail }) {
  const fresh = getRecruit(id);
  if (!fresh) { toast('Candidate no longer exists.', 'error'); app.refresh(); return false; }
  if (typeof expectedVersion === 'number' && fresh.version !== expectedVersion) {
    toast('This candidate was changed elsewhere. Reloading.', 'warn'); app.refresh(); return false;
  }
  patch(fresh);
  fresh.version += 1;
  fresh.updatedAt = new Date().toISOString();
  upsertRecruit(fresh);
  if (action) logAction(app.user, action, detail);
  app.refresh();
  return true;
}
function addComment(rec, by, stage, text) {
  rec.comments = rec.comments || [];
  rec.comments.push({ id: newId('rc'), by, ts: new Date().toISOString(), stage, text });
}

// ===========================================================================
// PIPELINE LIST (per organisation)
// ===========================================================================
export function renderList(host, app, org) {
  const actor = app.user;
  const mine = visibleRecruits(actor, org);
  const live = mine.filter((r) => r.stage !== 'archived');
  const archived = mine.filter((r) => r.stage === 'archived');
  const pipeline = recruitPipeline(org);
  const isEthics = org === 'ethics-committee';

  const card = (r) => {
    const t = tallyVotes(r.votes);
    const voteStage = isEthics ? 'application' : 'greenlit';
    return `
      <article class="recruit-card" data-id="${esc(r.id)}" tabindex="0">
        <div class="recruit-card__top">
          <span class="mono">${esc(r.ref)}</span>
          ${isEthics && r.tag ? tagBadge(r.tag) : ''}
        </div>
        <div class="recruit-card__name">${esc(r.name)}</div>
        <div class="recruit-card__meta">${esc(r.rank || '\u2014')} \u00b7 ${esc(r.department || '\u2014')}</div>
        <div class="recruit-card__foot">
          ${r.stage === voteStage ? `<span class="vote-tally">\u25b2 ${t.yes} \u00b7 \u25bc ${t.no}</span>` : `<span class="muted-text">${(r.comments || []).length} note${(r.comments || []).length === 1 ? '' : 's'}</span>`}
          <span class="row-go">Open \u2192</span>
        </div>
      </article>`;
  };

  const columns = pipeline.map((stage) => {
    const list = live.filter((r) => r.stage === stage).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return `
      <section class="pipe-col">
        <div class="pipe-col__head">${stageBadge(stage)} <span class="pipe-col__count">${list.length}</span></div>
        <div class="pipe-col__body">${list.length ? list.map(card).join('') : '<div class="empty">None</div>'}</div>
      </section>`;
  }).join('');

  const archivedRows = archived.length ? archived
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((r) => `
      <tr data-id="${esc(r.id)}" tabindex="0">
        <td class="mono">${esc(r.ref)}</td>
        <td class="cell-name">${esc(r.name)}</td>
        <td>${esc(r.rank || '\u2014')}</td>
        <td>${esc(r.department || '\u2014')}</td>
        <td>${archiveBadge(r.archiveStatus)}</td>
        <td class="cell-right"><span class="row-go">Open \u2192</span></td>
      </tr>`).join('') : '';

  const canCreate = isCL5(actor) || canParticipateRecruitment(actor, org);
  const eyebrow = isEthics ? 'CAIRO \u00b7 Ethics Committee' : 'CAIRO \u00b7 Omega-1';
  const newLabel = isEthics ? '+ New application' : '+ New scouting target';
  const sub = isEthics ? 'Assistant applications \u2014 cadre review and vote; CL5 interviews' : 'Scouting pipeline \u2014 run by the unit\u2019s CL4 cadre';

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h1 class="page-title">${esc(ORG_LABEL[org] || 'Recruitment')}</h1>
        <div class="page-sub">${sub}</div>
      </div>
      ${canCreate ? `<button class="btn btn--primary" id="add-recruit">${newLabel}</button>` : ''}
    </div>

    <div class="pipeline pipeline--${pipeline.length}">${columns}</div>

    ${archived.length ? `<section class="card" style="margin-top:18px">
      <div class="card__title">Archived</div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Name</th><th>Rank</th><th>Department</th><th>Outcome</th><th></th></tr></thead>
        <tbody>${archivedRows}</tbody>
      </table>
    </section>` : ''}
  `;

  const go = (id) => app.navigate(`#/recruit/${id}`);
  host.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(el.dataset.id); });
  });
  const addBtn = host.querySelector('#add-recruit');
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app, org));
}

// ===========================================================================
// CANDIDATE DETAIL
// ===========================================================================
export function renderRecruit(host, app, id) {
  const actor = app.user;
  const r = getRecruit(id);

  if (!r || r.deleted || !(isCL5(actor) || canParticipateRecruitment(actor, r.org))) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Candidate not found</h1>
      <div class="page-sub">This candidate does not exist, has been removed, or is outside your remit.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Back</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate(backHash(r)));
    return;
  }

  const isEthics = r.org === 'ethics-committee';
  const cl5 = isCL5(actor);
  const canAct = cl5 || canParticipateRecruitment(actor, r.org);
  const t = tallyVotes(r.votes);
  const myVote = (r.votes || {})[actor.id] || null;
  const stage = r.stage;
  const voteStage = isEthics ? 'application' : 'greenlit';
  const strikeTotal = tryoutStrikeTotal(r.tryoutStrikes);

  // --- comment thread ---
  const comments = (r.comments || []).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const thread = comments.length ? comments.map((c) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(c.stage || 'note')}"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(c.text)}</div>
        <div class="tl__meta"><span class="mono">${esc(c.by)}</span> \u00b7 ${esc((RECRUIT_STAGE[c.stage] || {}).label || c.stage || 'note')} \u00b7 ${fmtDate(c.ts)}</div>
      </div>
    </li>`).join('') : '<div class="empty">No thread activity yet.</div>';

  // Who may add a comment right now? (Ethics interview stage is CL5-only.)
  const canComment = canAct && stage !== 'archived' && !(isEthics && stage === 'interview' && !cl5);

  // --- stage-specific action bar ---
  const actions = [];
  if (isEthics) {
    if (stage === 'application') {
      if (canAct) actions.push(voteButtons(myVote));
      if (cl5) actions.push(`<button class="btn btn--sm btn--primary" data-act="to-interview" ${t.majorityYes ? '' : 'disabled title="Needs a majority Yes vote"'}>Advance to Interview</button>
        <button class="btn btn--sm btn--danger" data-act="deny">Deny (reason)</button>`);
    } else if (stage === 'interview') {
      if (cl5) actions.push(`<button class="btn btn--sm btn--primary" data-act="pass">Pass &amp; Open File</button>
        <button class="btn btn--sm btn--danger" data-act="fail">Fail (reason)</button>`);
    }
  } else {
    if (canAct && stage === 'scouting') {
      actions.push(`<button class="btn btn--sm btn--primary" data-act="greenlight">Advance to Greenlit</button>
        <button class="btn btn--sm btn--danger" data-act="deny">Deny</button>`);
    } else if (canAct && stage === 'greenlit') {
      actions.push(voteButtons(myVote));
      actions.push(`<button class="btn btn--sm btn--primary" data-act="tryout" ${t.majorityYes ? '' : 'disabled title="Needs a majority Yes vote"'}>Approve to Tryout</button>
        <button class="btn btn--sm btn--danger" data-act="deny">Deny</button>`);
    } else if (canAct && stage === 'tryout') {
      actions.push(`<button class="btn btn--sm" data-act="half-strike">+ \u00bd Strike</button>
        <button class="btn btn--sm btn--danger" data-act="full-strike">+ Full Strike (Fail)</button>
        <button class="btn btn--sm btn--primary" data-act="approve">Approve</button>
        <button class="btn btn--sm btn--danger" data-act="deny">Deny</button>`);
    }
  }

  // --- Ethics application tags ---
  const tagRow = (isEthics && stage === 'application' && canAct) ? `
    <div class="tag-row">
      <span class="tag-row__label">Tag:</span>
      ${ETHICS_APP_TAG_ORDER.map((tg) => `<button class="btn btn--xs ${r.tag === tg ? 'btn--primary' : ''}" data-tag="${esc(tg)}">${esc(ETHICS_APP_TAG[tg].label)}</button>`).join('')}
    </div>` : '';

  // --- tryout strikes panel ---
  const strikesPanel = (!isEthics && (stage === 'tryout' || (r.tryoutStrikes || []).length)) ? `
    <section class="card">
      <div class="card__title">Tryout Strikes \u2014 total ${strikeTotal}</div>
      <div class="card__body">
        ${(r.tryoutStrikes || []).length ? (r.tryoutStrikes || []).map((s) => `
          <div class="bin-row"><div>${s.weight >= 1 ? 'Full' : '\u00bd'} strike \u2014 ${esc(s.reason || 'no reason given')}<div class="bin-row__meta"><span class="mono">${esc(s.by)}</span> \u00b7 ${fmtDate(s.ts)}</div></div></div>`).join('') : '<div class="empty">No strikes recorded.</div>'}
      </div>
    </section>` : '';

  // --- Interview assessment panel (Ethics interview stage, CL5 only) ---
  const trunc = (s) => { const x = String(s || ''); return x.length > 118 ? x.slice(0, 117) + '\u2026' : x; };
  const interviewPanel = (isEthics && stage === 'interview' && cl5) ? (() => {
    const drawn = interviewSetFor(r);
    const custom = r.customQuestions || [];
    const drawnList = drawn.map((q, i) => `
      <div class="iv-pick">
        <span class="iv-pick__n">${i + 1}</span>
        <span class="iv-pick__cat">${esc(q.category)}</span>
        <span class="iv-pick__p">${esc(trunc(q.prompt))}</span>
      </div>`).join('');
    const customList = custom.length ? custom.map((q) => `
      <div class="iv-pick iv-pick--custom">
        <span class="iv-pick__cat">Added</span>
        <span class="iv-pick__p">${esc(trunc(q.prompt))}</span>
        <button class="btn btn--xs btn--danger" data-iv-remove="${esc(q.id)}">Remove</button>
      </div>`).join('') : '<div class="empty">No Committee-added questions.</div>';
    return `
      <section class="card">
        <div class="card__title">Interview Assessment</div>
        <div class="card__body">
          <p class="muted-text">A set of ${INTERVIEW_BANK_DRAW} scenarios is drawn for this candidate and stays fixed until re-rolled. The exported script carries the marking criteria \u2014 it is the interviewer\u2019s copy and must not be shown to the candidate.</p>
          <div class="iv-actions">
            <button class="btn btn--sm btn--primary" data-act="iv-export">\u23ce Export Interviewer\u2019s Script</button>
            <button class="btn btn--sm" data-act="iv-reroll">\u27f3 Re-roll Question Set</button>
          </div>
          <div class="iv-picklist">${drawnList}</div>
          <div class="iv-sub">Committee-added questions</div>
          <div class="iv-picklist">${customList}</div>
          <button class="btn btn--sm" id="iv-add-toggle">+ Add a question to this interview</button>
          <div class="iv-form" id="iv-form" style="display:none;">
            <textarea id="iv-q-prompt" rows="3" placeholder="Scenario / question the candidate will be asked\u2026"></textarea>
            <input id="iv-q-valid" type="text" placeholder="What a valid response demonstrates (optional)" />
            <input id="iv-q-weak" type="text" placeholder="What a weak response looks like (optional)" />
            <div class="iv-form__row">
              <button class="btn btn--sm btn--primary" id="iv-add-submit">Add question</button>
              <button class="btn btn--sm btn--ghost" id="iv-add-cancel">Cancel</button>
            </div>
          </div>
        </div>
      </section>`;
  })() : '';

  const linkedFile = r.personnelFileId ? getUser(r.personnelFileId) : null;
  const avatarTone = isEthics ? 'ethics' : 'omega';

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 ${esc(ORG_LABEL[r.org] || 'Recruitment')}</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--${avatarTone}">${esc(monogram(r.name))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(r.name)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(r.ref)}</span>
          ${orgTag(r.org)}
          ${stageBadge(stage)}
          ${isEthics && r.tag ? tagBadge(r.tag) : ''}
          ${stage === 'archived' ? archiveBadge(r.archiveStatus) : ''}
        </div>
      </div>
    </header>

    ${actions.length ? `<div class="actionbar">${actions.join('')}</div>` : ''}
    ${tagRow}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Candidate</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Name</span><span class="kv__v">${esc(r.name)}</span></div>
          <div class="kv"><span class="kv__k">SteamID</span><span class="kv__v mono">${esc(r.steamId || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Department</span><span class="kv__v">${esc(r.department || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Rank sought</span><span class="kv__v">${esc(r.rank || '\u2014')}</span></div>
          ${isEthics && r.applicationLink ? `<div class="kv"><span class="kv__k">Application</span><span class="kv__v"><a class="rec-link" href="${esc(r.applicationLink)}" target="_blank" rel="noopener">Open application \u2197</a></span></div>` : ''}
          <div class="kv"><span class="kv__k">Stage</span><span class="kv__v">${stageBadge(stage)}</span></div>
          ${stage === voteStage ? `<div class="kv"><span class="kv__k">Vote</span><span class="kv__v">\u25b2 ${t.yes} Yes \u00b7 \u25bc ${t.no} No${t.majorityYes ? ' \u00b7 <span class="badge badge--ok">majority</span>' : ''}</span></div>` : ''}
          ${stage === 'archived' && r.archiveReason ? `<div class="kv"><span class="kv__k">Reason</span><span class="kv__v">${esc(r.archiveReason)}</span></div>` : ''}
          ${linkedFile ? `<div class="kv"><span class="kv__k">Personnel file</span><span class="kv__v"><a class="rec-link" href="#/personnel/${esc(linkedFile.id)}"><span class="mono">${esc(linkedFile.designation)}</span> ${esc(linkedFile.codename)}</a></span></div>` : ''}
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(r.createdAt)} \u00b7 <span class="mono">${esc(r.createdBy || 'SYSTEM')}</span></span></div>
          <div class="kv"><span class="kv__k">Updated</span><span class="kv__v">${fmtDateTime(r.updatedAt)}</span></div>
        </div>
      </section>
      <div class="dossier-col">
        ${interviewPanel}
        ${strikesPanel}
        <section class="card">
          <div class="card__title">${isEthics ? 'Application Thread' : 'Scouting Thread'}</div>
          <div class="card__body">
            ${comments.length ? `<ul class="timeline">${thread}</ul>` : thread}
            ${canComment ? `
              <div class="comment-box">
                <input id="rc-text" type="text" placeholder="Add to the thread\u2026" />
                <button class="btn btn--sm" id="rc-add">Comment</button>
              </div>` : (isEthics && stage === 'interview' && !cl5 ? '<p class="modal__message">Interview-stage notes are restricted to CL5.</p>' : '')}
          </div>
        </section>
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate(backHash(r)));

  const dispatch = {
    greenlight: () => advance(app, r, 'greenlit'),
    tryout: () => advance(app, r, 'tryout'),
    'to-interview': () => advance(app, r, 'interview'),
    'vote-yes': () => castVote(app, r, 'yes'),
    'vote-no': () => castVote(app, r, 'no'),
    'half-strike': () => addStrike(app, r, TRYOUT_STRIKE_HALF),
    'full-strike': () => addStrike(app, r, TRYOUT_STRIKE_FULL),
    approve: () => approveTryout(app, r),
    pass: () => passInterview(app, r),
    fail: () => failInterview(app, r),
    deny: () => deny(app, r),
    'iv-export': () => exportInterviewScript(app, r),
    'iv-reroll': () => rerollInterview(app, r),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act] && dispatch[b.dataset.act]()));
  host.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => setTag(app, r, b.dataset.tag)));

  const addBtn = host.querySelector('#rc-add');
  if (addBtn) {
    const submit = () => {
      const input = host.querySelector('#rc-text');
      const text = input.value.trim();
      if (!text) { toast('Enter a comment.', 'error'); return; }
      mutate(app, r.id, r.version, (rec) => addComment(rec, actor.designation, rec.stage, text),
        { action: 'EDIT_RECRUIT', detail: `Comment added to ${r.ref}.` });
    };
    addBtn.addEventListener('click', submit);
    host.querySelector('#rc-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // Interview: remove a Committee-added question, and the add-question form.
  host.querySelectorAll('[data-iv-remove]').forEach((b) =>
    b.addEventListener('click', () => removeCustomQuestion(app, r, b.dataset.ivRemove)));
  const ivToggle = host.querySelector('#iv-add-toggle');
  if (ivToggle) {
    const form = host.querySelector('#iv-form');
    ivToggle.addEventListener('click', () => {
      const showing = form.style.display !== 'none';
      form.style.display = showing ? 'none' : 'block';
      if (!showing) host.querySelector('#iv-q-prompt').focus();
    });
    host.querySelector('#iv-add-cancel').addEventListener('click', () => { form.style.display = 'none'; });
    host.querySelector('#iv-add-submit').addEventListener('click', () => {
      const prompt = host.querySelector('#iv-q-prompt').value.trim();
      const valid = host.querySelector('#iv-q-valid').value.trim();
      const weak = host.querySelector('#iv-q-weak').value.trim();
      if (!prompt) { toast('Enter the question text.', 'error'); return; }
      addCustomQuestion(app, r, prompt, valid, weak);
    });
  }
}

function voteButtons(myVote) {
  return `<button class="btn btn--sm ${myVote === 'yes' ? 'btn--primary' : ''}" data-act="vote-yes">Vote Yes${myVote === 'yes' ? ' \u2713' : ''}</button>
    <button class="btn btn--sm ${myVote === 'no' ? 'btn--danger' : ''}" data-act="vote-no">Vote No${myVote === 'no' ? ' \u2713' : ''}</button>`;
}
function backHash(r) {
  return r && r.org === 'ethics-committee' ? '#/ethics/recruitment' : '#/omega-1/recruitment';
}

// --- Actions ----------------------------------------------------------------
function castVote(app, r, vote) {
  const actor = app.user;
  const current = (r.votes || {})[actor.id] || null;
  const next = current === vote ? null : vote;
  mutate(app, r.id, r.version, (rec) => {
    rec.votes = { ...(rec.votes || {}) };
    if (next) rec.votes[actor.id] = next; else delete rec.votes[actor.id];
  }, { action: 'VOTE_RECRUIT', detail: `${actor.designation} voted ${next || 'abstain'} on ${r.ref}.` });
  toast(next ? `Vote recorded: ${next}.` : 'Vote withdrawn.', 'success');
}

function setTag(app, r, tag) {
  mutate(app, r.id, r.version, (rec) => { rec.tag = tag; }, { action: 'EDIT_RECRUIT', detail: `${r.ref} tagged ${ETHICS_APP_TAG[tag]?.label || tag}.` });
}

function advance(app, r, toStage) {
  if ((toStage === 'tryout' || toStage === 'interview') && !tallyVotes(r.votes).majorityYes) {
    toast('A majority Yes vote is required.', 'error');
    return;
  }
  mutate(app, r.id, r.version, (rec) => {
    rec.stage = toStage;
    if (toStage === 'interview') rec.tag = 'to-interview';
    addComment(rec, app.user.designation, toStage,
      toStage === 'greenlit' ? 'Advanced to greenlight vote.'
        : toStage === 'tryout' ? 'Approved to tryout on a majority vote.'
        : 'Advanced to interview on a majority vote.');
  }, { action: 'ADVANCE_RECRUIT', detail: `${r.ref} \u2192 ${toStage}.` });
  toast(`Advanced to ${RECRUIT_STAGE[toStage].label}.`, 'success');
}

async function addStrike(app, r, weight) {
  const reason = await promptText({
    title: weight >= 1 ? 'Full strike (Fail)' : 'Half strike',
    message: weight >= 1 ? `Record a full strike against ${r.name} and fail the tryout?` : `Record a ½ strike against ${r.name}?`,
    placeholder: 'Reason\u2026',
    confirmLabel: weight >= 1 ? 'Strike & fail' : 'Add ½ strike',
    danger: weight >= 1,
  });
  if (reason === null) return;
  mutate(app, r.id, r.version, (rec) => {
    rec.tryoutStrikes = [...(rec.tryoutStrikes || []), { id: newId('strk'), by: app.user.designation, ts: new Date().toISOString(), weight, reason: reason || null }];
    if (weight >= 1) {
      rec.stage = 'archived'; rec.archiveStatus = 'denied'; rec.archiveReason = `Failed tryout \u2014 full strike: ${reason || 'no reason given'}`;
      addComment(rec, app.user.designation, 'archived', 'Full strike recorded; tryout failed.');
    }
  }, { action: weight >= 1 ? 'REJECT_RECRUIT' : 'EDIT_RECRUIT', detail: weight >= 1 ? `${r.ref} failed tryout (full strike).` : `½ strike recorded on ${r.ref}.` });
  toast(weight >= 1 ? 'Full strike recorded; candidate failed.' : '½ strike recorded.', 'success');
}

async function deny(app, r) {
  const isEthics = r.org === 'ethics-committee';
  if (isEthics) {
    const reason = await promptText({ title: 'Deny application', message: `Archive ${r.name} (${r.ref}) as denied. A written reason is required.`, placeholder: 'Reason for denial\u2026', confirmLabel: 'Deny', danger: true, required: true });
    if (reason === null) return;
    mutate(app, r.id, r.version, (rec) => {
      rec.stage = 'archived'; rec.archiveStatus = 'denied'; rec.archiveReason = reason; rec.tag = 'denied';
      addComment(rec, app.user.designation, 'archived', `Denied: ${reason}`);
    }, { action: 'REJECT_RECRUIT', detail: `${r.ref} denied.` });
    toast('Application denied.', 'success');
    return;
  }
  const ok = await confirmDialog({ title: 'Deny candidate', message: `Archive ${r.name} (${r.ref}) as denied? The thread is closed.`, confirmLabel: 'Deny', danger: true });
  if (!ok) return;
  mutate(app, r.id, r.version, (rec) => {
    rec.stage = 'archived'; rec.archiveStatus = 'denied';
    addComment(rec, app.user.designation, 'archived', 'Denied and archived.');
  }, { action: 'REJECT_RECRUIT', detail: `${r.ref} denied.` });
  toast('Candidate archived (denied).', 'success');
}

async function approveTryout(app, r) {
  const actor = app.user;
  const canOpen = canInductRecruit(actor, r);
  let openFile = false; let passphrase = '';
  if (canOpen) {
    const choice = await promptInductFile({ title: 'Approve candidate', message: `Approve ${r.name} and open their Omega-1 personnel file now? Choose "Without file" to approve now and open the file later.`, confirmLabel: 'Approve & open file' });
    openFile = choice.open; passphrase = choice.passphrase;
  } else {
    const ok = await confirmDialog({ title: 'Approve candidate', message: `Approve ${r.name} at tryout? A manager will open their personnel file.`, confirmLabel: 'Approve' });
    if (!ok) return;
  }
  let newUserId = null;
  if (openFile) { try { newUserId = await openPersonnelFile(app, r, null, passphrase); } catch (e) { toast('Could not open the personnel file; candidate approved without one.', 'warn'); } }
  mutate(app, r.id, r.version, (rec) => {
    rec.stage = 'archived'; rec.archiveStatus = 'approved';
    if (newUserId) rec.personnelFileId = newUserId;
    addComment(rec, actor.designation, 'archived', newUserId ? 'Approved at tryout; personnel file opened.' : 'Approved at tryout.');
  }, { action: 'INDUCT_RECRUIT', detail: `${r.ref} approved at tryout.` });
  toast(newUserId ? 'Approved; personnel file opened.' : 'Candidate approved.', 'success');
}

async function passInterview(app, r) {
  const actor = app.user;
  const choice = await promptInductFile({ title: 'Pass interview', message: `Pass ${r.name} and open their Ethics Assistant personnel file? Choose "Without file" to record a pass and open the file later.`, confirmLabel: 'Pass & open file' });
  let newUserId = null;
  if (choice.open) { try { newUserId = await openPersonnelFile(app, r, 'Assistant', choice.passphrase); } catch (e) { toast('Could not open the personnel file; pass recorded without one.', 'warn'); } }
  mutate(app, r.id, r.version, (rec) => {
    rec.stage = 'archived'; rec.archiveStatus = 'approved'; rec.tag = 'accepted';
    if (newUserId) rec.personnelFileId = newUserId;
    addComment(rec, actor.designation, 'archived', newUserId ? 'Passed interview; Assistant file opened.' : 'Passed interview.');
  }, { action: 'INDUCT_RECRUIT', detail: `${r.ref} passed interview.` });
  toast(newUserId ? 'Passed; Assistant file opened.' : 'Pass recorded.', 'success');
}

async function failInterview(app, r) {
  const reason = await promptText({ title: 'Fail interview', message: `Fail ${r.name} at interview. A written reason is required.`, placeholder: 'Reason\u2026', confirmLabel: 'Fail', danger: true, required: true });
  if (reason === null) return;
  mutate(app, r.id, r.version, (rec) => {
    rec.stage = 'archived'; rec.archiveStatus = 'denied'; rec.archiveReason = reason; rec.tag = 'denied';
    addComment(rec, app.user.designation, 'archived', `Failed interview: ${reason}`);
  }, { action: 'REJECT_RECRUIT', detail: `${r.ref} failed interview.` });
  toast('Interview failed.', 'success');
}

// --- Interview assessment (Ethics interview stage, CL5 only) ----------------
// The bank draw is derived from the candidate id, so a re-roll only has to bump
// a single counter; custom questions are stored on the candidate record. All
// three route through the same versioned, audit-logged mutate(), and are
// re-authorised server-side (only CL5 may edit a record at the interview stage).
function rerollInterview(app, r) {
  mutate(app, r.id, r.version, (rec) => { rec.interviewSeed = (rec.interviewSeed || 0) + 1; },
    { action: 'EDIT_RECRUIT', detail: `Interview question set re-rolled for ${r.ref}.` });
  toast('A fresh question set has been drawn.', 'success');
}
function addCustomQuestion(app, r, prompt, valid, weak) {
  mutate(app, r.id, r.version, (rec) => {
    rec.customQuestions = [...(rec.customQuestions || []), {
      id: newId('ivq'), prompt, valid: valid || '', weak: weak || '',
      by: app.user.designation, at: new Date().toISOString(),
    }];
  }, { action: 'EDIT_RECRUIT', detail: `Interview question added to ${r.ref}.` });
  toast('Question added to this interview.', 'success');
}
function removeCustomQuestion(app, r, id) {
  mutate(app, r.id, r.version, (rec) => {
    rec.customQuestions = (rec.customQuestions || []).filter((q) => q.id !== id);
  }, { action: 'EDIT_RECRUIT', detail: `Interview question removed from ${r.ref}.` });
  toast('Question removed.', 'success');
}

// Open a roster personnel file for an approved candidate. `forceRank` (e.g.
// 'Assistant') overrides; otherwise Omega inductees start at the lowest rank and
// the sought rank is noted. Returns the new user id.
async function openPersonnelFile(app, r, forceRank, initialPassphrase) {
  const orgRanks = RANKS[r.org] || [];
  const rank = forceRank && orgRanks.includes(forceRank) ? forceRank
    : (r.rank && orgRanks.includes(r.rank) ? r.rank : orgRanks[orgRanks.length - 1]);
  const clearance = clearanceForRank(r.org, rank) || 'CL3';
  const prefix = r.org === 'omega-1' ? 'O1' : r.org === 'ethics-committee' ? 'EC' : 'CMD';
  const nums = users().filter((u) => (u.designation || '').startsWith(prefix + '-')).map((u) => parseInt((u.designation.split('-')[1] || '0'), 10)).filter((n) => !Number.isNaN(n));
  const designation = `${prefix}-${(Math.max(0, ...nums) + 1)}`;
  const baseUser = (r.name || 'recruit').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'recruit';
  let username = baseUser; let n = 1;
  while (users().some((u) => u.username === username)) { username = `${baseUser}${n}`; n += 1; }
  const seedPass = (initialPassphrase && String(initialPassphrase).length >= 6)
    ? String(initialPassphrase) : `recruit-${newId('pw')}`;
  const { salt, hash } = await makeCredential(seedPass);
  const now = new Date().toISOString();
  const soughtNote = (!forceRank && r.rank && !orgRanks.includes(r.rank)) ? ` Sought rank: ${r.rank}.` : '';
  const user = {
    id: newId('usr'), designation, codename: r.name, realName: '[REDACTED]',
    org: r.org, rank, clearance, status: 'active', username, salt, passwordHash: hash,
    accountStatus: 'active', requestedOrg: null,
    awards: [], strikes: [], promoChecks: [], leave: null, notes: [],
    events: [{ id: newId('evt'), date: now, type: 'appointment', text: `Inducted from recruitment ${r.ref} by ${app.user.designation}.${soughtNote}` }],
    createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
  };
  upsertUser(user);
  logAction(app.user, 'CREATE_RECORD', `${designation} (${r.name}) inducted from ${r.ref}.`);
  return user.id;
}

// --- Create candidate -------------------------------------------------------
function openCreate(app, org) {
  const actor = app.user;
  if (!(isCL5(actor) || canParticipateRecruitment(actor, org))) { toast('You cannot open candidates here.', 'error'); return; }
  const isEthics = org === 'ethics-committee';

  const deptField = isEthics
    ? '<div class="field"><label>Department</label><input id="rc-dept" type="text" placeholder="e.g. Ethics Committee" /></div>'
    : `<div class="field"><label>Department</label><select id="rc-dept">${OMEGA_DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select></div>`;

  const body = `
    <p class="modal__message">${isEthics ? 'Open an Assistant application. It enters at Application for the cadre to review and vote.' : 'Open a scouting target. It enters at Scouting for the unit\u2019s CL4 cadre to review.'}</p>
    <div class="field"><label>Name</label><input id="rc-name" type="text" placeholder="${isEthics ? 'Candidate name' : 'e.g. Rourke, T.'}" /></div>
    <div class="field"><label>SteamID</label><input id="rc-steam" type="text" placeholder="STEAM_0:1:..." /></div>
    ${deptField}
    <div class="field"><label>Rank sought</label><input id="rc-rank" type="text" placeholder="Free text \u2014 e.g. Trooper / Assistant Candidate" /></div>
    ${isEthics ? '<div class="field"><label>Link to application</label><input id="rc-link" type="text" placeholder="https://\u2026" /></div>' : ''}
    <div id="rc-err" class="auth__error" hidden></div>
  `;

  openModal({
    title: isEthics ? 'New application' : 'New scouting target',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (close) => close() },
      { label: isEthics ? 'Open application' : 'Open target', tone: 'primary', onClick: (close, d) => {
          const name = d.querySelector('#rc-name').value.trim();
          const steamId = d.querySelector('#rc-steam').value.trim();
          const department = d.querySelector('#rc-dept').value.trim();
          const rank = d.querySelector('#rc-rank').value.trim();
          const link = isEthics ? d.querySelector('#rc-link').value.trim() : '';
          const err = d.querySelector('#rc-err');
          err.hidden = true;
          if (!name) { err.textContent = 'A name is required.'; err.hidden = false; return; }
          const prefix = isEthics ? 'APP-EC' : 'SCT';
          const count = recruits().filter((x) => (x.ref || '').startsWith(prefix)).length + (isEthics ? 15 : 43);
          const ref = isEthics ? `${prefix}-${String(count).padStart(3, '0')}` : `${prefix}-${String(count).padStart(4, '0')}`;
          const now = new Date().toISOString();
          const firstStage = recruitFirstStage(org);
          upsertRecruit({
            id: newId('rec'), ref, name, steamId, department, rank, org,
            stage: firstStage, archiveStatus: null, archiveReason: null,
            applicationLink: link, tag: isEthics ? 'in-progress' : null,
            comments: [{ id: newId('rc'), by: actor.designation, ts: now, stage: firstStage, text: `${isEthics ? 'Application' : 'Scouting target'} opened by ${actor.designation}.` }],
            votes: {}, tryoutStrikes: [], personnelFileId: null,
            createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'OPEN_RECRUIT', `Opened ${ref} (${name}).`);
          close();
          toast(`${isEthics ? 'Application' : 'Scouting target'} ${ref} opened.`, 'success');
          app.navigate(org === 'ethics-committee' ? '#/ethics/recruitment' : '#/omega-1/recruitment');
        } },
    ],
  });
}

// Small reason/text prompt built on the modal. Resolves to the entered string
// (possibly '') or null if cancelled.
// Induction prompt: whether to open the personnel file now and, if so, an
// optional initial sign-in passphrase the inductor can hand over. Resolves
// { open, passphrase }. "Without file" leaves the file to be opened later.
function promptInductFile({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="modal__message">${esc(message)}</p>
        <div class="field"><label>Initial sign-in passphrase <span class="muted-text">(optional)</span></label>
          <input id="if-pass" type="text" placeholder="at least 6 characters \u2014 or leave blank" spellcheck="false" autocomplete="off" /></div>
        <p class="muted-text">Leave blank to set a placeholder; a manager can issue the passphrase later from the personnel file.</p>
        <div id="if-err" class="auth__error" hidden></div>`,
      actions: [
        { label: 'Without file', tone: 'ghost', onClick: (close) => { close(); resolve({ open: false, passphrase: '' }); } },
        { label: confirmLabel || 'Open file', tone: 'primary', onClick: (close, d) => {
            const p = d.querySelector('#if-pass').value.trim();
            if (p && p.length < 6) { const e = d.querySelector('#if-err'); e.textContent = 'A passphrase must be at least 6 characters, or left blank.'; e.hidden = false; return; }
            close(); resolve({ open: true, passphrase: p });
          } },
      ],
    });
  });
}

function promptText({ title, message, placeholder, confirmLabel, danger, required }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="modal__message">${esc(message)}</p>
        <div class="field"><textarea id="pt-text" rows="3" placeholder="${esc(placeholder || '')}"></textarea></div>
        <div id="pt-err" class="auth__error" hidden></div>`,
      actions: [
        { label: 'Cancel', tone: 'ghost', onClick: (close) => { close(); resolve(null); } },
        { label: confirmLabel || 'Confirm', tone: danger ? 'danger' : 'primary', onClick: (close, d) => {
            const v = d.querySelector('#pt-text').value.trim();
            if (required && !v) { const e = d.querySelector('#pt-err'); e.textContent = 'A reason is required.'; e.hidden = false; return; }
            close(); resolve(v);
          } },
      ],
    });
  });
}
