// =============================================================================
// views/recruitment.js — Omega-1 recruitment (scouting pipeline).
//
// The regiment's intake process, run by the unit's CL4 cadre. A candidate moves
// Scouting -> Greenlit -> Tryout and is then archived approved or denied:
//   • Scouting — any CL4 opens a scouting target and the thread is reviewed.
//   • Greenlit — a CL4 yes/no vote; a majority of Yes advances to tryout.
//   • Tryout   — on approval the approver is prompted to open the personnel file.
// Every action routes through the permission engine, is version-stamped and
// audit-logged; in server mode the Worker re-authorises each write (vote
// integrity, valid stage transitions, the majority gate) and re-scopes the
// pipeline on read.
// =============================================================================

import {
  RECRUIT_STAGE, RECRUIT_PIPELINE, RECRUIT_ARCHIVE, tallyVotes,
  ORGS, ORG_ORDER, RANKS, clearanceForRank,
} from '../constants.js';
import {
  recruits, getRecruit, upsertRecruit, getUser, users, upsertUser, newId,
} from '../storage.js';
import {
  canParticipateRecruitment, canManageOrg, canInductRecruit, isCL5,
} from '../permissions.js';
import { makeCredential } from '../crypto.js';
import { logAction } from '../audit.js';
import {
  esc, fmtDate, fmtDateTime, relTime, orgTag, monogram,
  toast, openModal, confirmDialog,
} from '../ui.js';

const stageBadge = (s) => {
  const m = RECRUIT_STAGE[s] || { label: s, tone: 'muted' };
  return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`;
};
const archiveBadge = (a) => {
  const m = RECRUIT_ARCHIVE[a];
  return m ? `<span class="badge badge--${m.tone}">${esc(m.label)}</span>` : '';
};

function visibleRecruits(actor) {
  return recruits().filter((r) => !r.deleted
    && (isCL5(actor) || canParticipateRecruitment(actor, r.org)));
}
function participableOrgs(actor) {
  return ORG_ORDER.filter((o) => canParticipateRecruitment(actor, o));
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
// PIPELINE LIST
// ===========================================================================
export function renderList(host, app) {
  const actor = app.user;
  const mine = visibleRecruits(actor);
  const live = mine.filter((r) => r.stage !== 'archived');
  const archived = mine.filter((r) => r.stage === 'archived');

  const card = (r) => {
    const t = tallyVotes(r.votes);
    return `
      <article class="recruit-card" data-id="${esc(r.id)}" tabindex="0">
        <div class="recruit-card__top">
          <span class="mono">${esc(r.ref)}</span>
          ${orgTag(r.org)}
          ${r.stage === 'archived' ? archiveBadge(r.archiveStatus) : ''}
        </div>
        <div class="recruit-card__name">${esc(r.name)}</div>
        <div class="recruit-card__meta">${esc(r.rank || '\u2014')} \u00b7 ${esc(r.department || '\u2014')}</div>
        <div class="recruit-card__foot">
          ${r.stage === 'greenlit' ? `<span class="vote-tally">\u25b2 ${t.yes} \u00b7 \u25bc ${t.no}</span>` : `<span class="muted-text">${(r.comments || []).length} note${(r.comments || []).length === 1 ? '' : 's'}</span>`}
          <span class="row-go">Open \u2192</span>
        </div>
      </article>`;
  };

  const columns = RECRUIT_PIPELINE.map((stage) => {
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

  const canCreate = participableOrgs(actor).length > 0;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Omega-1</div>
        <h1 class="page-title">Recruitment</h1>
        <div class="page-sub">Scouting pipeline \u2014 run by the unit\u2019s CL4 cadre</div>
      </div>
      ${canCreate ? '<button class="btn btn--primary" id="add-recruit">+ New scouting target</button>' : ''}
    </div>

    <div class="pipeline">${columns}</div>

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
  if (addBtn) addBtn.addEventListener('click', () => openCreate(app));
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
      <button class="btn btn--ghost" id="back">\u2190 Recruitment</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/recruitment'));
    return;
  }

  const canAct = canParticipateRecruitment(actor, r.org) || isCL5(actor);
  const t = tallyVotes(r.votes);
  const myVote = (r.votes || {})[actor.id] || null;
  const stage = r.stage;

  const comments = (r.comments || []).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const thread = comments.length ? comments.map((c) => `
    <li class="tl__item">
      <span class="tl__dot tl__dot--${esc(c.stage || 'note')}"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(c.text)}</div>
        <div class="tl__meta"><span class="mono">${esc(c.by)}</span> \u00b7 ${esc((RECRUIT_STAGE[c.stage] || {}).label || c.stage || 'note')} \u00b7 ${fmtDate(c.ts)}</div>
      </div>
    </li>`).join('') : '<div class="empty">No thread activity yet.</div>';

  // Stage-specific action bar.
  let actions = '';
  if (canAct && stage === 'scouting') {
    actions = `<button class="btn btn--sm btn--primary" data-act="greenlight">Advance to Greenlit</button>
      <button class="btn btn--sm btn--danger" data-act="deny">Deny</button>`;
  } else if (canAct && stage === 'greenlit') {
    actions = `<button class="btn btn--sm ${myVote === 'yes' ? 'btn--primary' : ''}" data-act="vote-yes">Vote Yes${myVote === 'yes' ? ' \u2713' : ''}</button>
      <button class="btn btn--sm ${myVote === 'no' ? 'btn--danger' : ''}" data-act="vote-no">Vote No${myVote === 'no' ? ' \u2713' : ''}</button>
      <button class="btn btn--sm btn--primary" data-act="tryout" ${t.majorityYes ? '' : 'disabled title="Needs a majority Yes vote"'}>Approve to Tryout</button>
      <button class="btn btn--sm btn--danger" data-act="deny">Deny</button>`;
  } else if (canAct && stage === 'tryout') {
    actions = `<button class="btn btn--sm btn--primary" data-act="approve">Approve</button>
      <button class="btn btn--sm btn--danger" data-act="deny">Deny</button>`;
  }

  const linkedFile = r.personnelFileId ? getUser(r.personnelFileId) : null;

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Recruitment</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--omega">${esc(monogram(r.name))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(r.name)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(r.ref)}</span>
          ${orgTag(r.org)}
          ${stageBadge(stage)}
          ${stage === 'archived' ? archiveBadge(r.archiveStatus) : ''}
        </div>
      </div>
    </header>

    ${actions ? `<div class="actionbar">${actions}</div>` : ''}

    <div class="dossier-grid">
      <section class="card">
        <div class="card__title">Candidate</div>
        <div class="card__body">
          <div class="kv"><span class="kv__k">Name</span><span class="kv__v">${esc(r.name)}</span></div>
          <div class="kv"><span class="kv__k">SteamID</span><span class="kv__v mono">${esc(r.steamId || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Department</span><span class="kv__v">${esc(r.department || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Rank sought</span><span class="kv__v">${esc(r.rank || '\u2014')}</span></div>
          <div class="kv"><span class="kv__k">Stage</span><span class="kv__v">${stageBadge(stage)}</span></div>
          ${stage === 'greenlit' ? `<div class="kv"><span class="kv__k">Vote</span><span class="kv__v">\u25b2 ${t.yes} Yes \u00b7 \u25bc ${t.no} No${t.majorityYes ? ' \u00b7 <span class="badge badge--ok">majority</span>' : ''}</span></div>` : ''}
          ${linkedFile ? `<div class="kv"><span class="kv__k">Personnel file</span><span class="kv__v"><a class="rec-link" href="#/personnel/${esc(linkedFile.id)}"><span class="mono">${esc(linkedFile.designation)}</span> ${esc(linkedFile.codename)}</a></span></div>` : ''}
          <div class="kv"><span class="kv__k">Opened</span><span class="kv__v">${fmtDate(r.createdAt)} \u00b7 <span class="mono">${esc(r.createdBy || 'SYSTEM')}</span></span></div>
          <div class="kv"><span class="kv__k">Updated</span><span class="kv__v">${fmtDateTime(r.updatedAt)}</span></div>
        </div>
      </section>
      <div class="dossier-col">
        <section class="card">
          <div class="card__title">Scouting Thread</div>
          <div class="card__body">
            ${comments.length ? `<ul class="timeline">${thread}</ul>` : thread}
            ${canAct && stage !== 'archived' ? `
              <div class="comment-box">
                <input id="rc-text" type="text" placeholder="Add to the thread\u2026" />
                <button class="btn btn--sm" id="rc-add">Comment</button>
              </div>` : ''}
          </div>
        </section>
      </div>
    </div>
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/recruitment'));

  const dispatch = {
    greenlight: () => advance(app, r, 'greenlit'),
    tryout: () => advance(app, r, 'tryout'),
    'vote-yes': () => castVote(app, r, 'yes'),
    'vote-no': () => castVote(app, r, 'no'),
    approve: () => approveTryout(app, r),
    deny: () => deny(app, r),
  };
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => dispatch[b.dataset.act] && dispatch[b.dataset.act]()));

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
}

// --- Actions ----------------------------------------------------------------
function castVote(app, r, vote) {
  const actor = app.user;
  const current = (r.votes || {})[actor.id] || null;
  const next = current === vote ? null : vote; // toggle off if same
  mutate(app, r.id, r.version, (rec) => {
    rec.votes = { ...(rec.votes || {}) };
    if (next) rec.votes[actor.id] = next; else delete rec.votes[actor.id];
  }, { action: 'VOTE_RECRUIT', detail: `${actor.designation} voted ${next || 'abstain'} on ${r.ref}.` });
  toast(next ? `Vote recorded: ${next}.` : 'Vote withdrawn.', 'success');
}

function advance(app, r, toStage) {
  if (toStage === 'tryout' && !tallyVotes(r.votes).majorityYes) {
    toast('A majority Yes vote is required to enter tryout.', 'error');
    return;
  }
  mutate(app, r.id, r.version, (rec) => {
    rec.stage = toStage;
    addComment(rec, app.user.designation, toStage, toStage === 'greenlit' ? 'Advanced to greenlight vote.' : 'Approved to tryout on a majority vote.');
  }, { action: 'ADVANCE_RECRUIT', detail: `${r.ref} \u2192 ${toStage}.` });
  toast(`Advanced to ${RECRUIT_STAGE[toStage].label}.`, 'success');
}

async function deny(app, r) {
  const ok = await confirmDialog({
    title: 'Deny candidate',
    message: `Archive ${r.name} (${r.ref}) as denied? The thread is closed.`,
    confirmLabel: 'Deny', danger: true,
  });
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
  // If the approver holds the management right, offer to open the personnel file.
  let openFile = false;
  if (canOpen) {
    openFile = await confirmDialog({
      title: 'Approve candidate',
      message: `Approve ${r.name} and open their Omega-1 personnel file now? Choose Cancel to approve without opening a file (a manager can open it later).`,
      confirmLabel: 'Approve & open file',
    });
    // confirmDialog returns true/false; a false here means "approve without file".
  } else {
    const ok = await confirmDialog({
      title: 'Approve candidate',
      message: `Approve ${r.name} at tryout? A manager will open their personnel file.`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
  }

  let newUserId = null;
  if (openFile) {
    try {
      newUserId = await openPersonnelFile(app, r);
    } catch (e) {
      toast('Could not open the personnel file; candidate approved without one.', 'warn');
    }
  }

  mutate(app, r.id, r.version, (rec) => {
    rec.stage = 'archived'; rec.archiveStatus = 'approved';
    if (newUserId) rec.personnelFileId = newUserId;
    addComment(rec, actor.designation, 'archived', newUserId ? 'Approved at tryout; personnel file opened.' : 'Approved at tryout.');
  }, { action: 'INDUCT_RECRUIT', detail: `${r.ref} approved at tryout.` });
  toast(newUserId ? 'Approved; personnel file opened.' : 'Candidate approved.', 'success');
}

// Open a roster personnel file for an approved candidate. Returns the new id.
async function openPersonnelFile(app, r) {
  const rank = r.rank && RANKS[r.org] && RANKS[r.org].includes(r.rank) ? r.rank : (RANKS[r.org] || [])[(RANKS[r.org] || []).length - 1];
  const clearance = clearanceForRank(r.org, rank) || 'CL3';
  // Auto designation: next free number in the org's prefix.
  const prefix = r.org === 'omega-1' ? 'O1' : r.org === 'ethics-committee' ? 'EC' : 'CMD';
  const nums = users().filter((u) => (u.designation || '').startsWith(prefix + '-')).map((u) => parseInt((u.designation.split('-')[1] || '0'), 10)).filter((n) => !Number.isNaN(n));
  const designation = `${prefix}-${(Math.max(0, ...nums) + 1)}`;
  // Username from name, de-duplicated; a random initial password (manager resets).
  const baseUser = (r.name || 'recruit').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'recruit';
  let username = baseUser; let n = 1;
  while (users().some((u) => u.username === username)) { username = `${baseUser}${n}`; n += 1; }
  const { salt, hash } = await makeCredential(`recruit-${newId('pw')}`);
  const now = new Date().toISOString();
  const user = {
    id: newId('usr'), designation, codename: r.name, realName: '[REDACTED]',
    org: r.org, rank, clearance, status: 'active', username, salt, passwordHash: hash,
    accountStatus: 'active', requestedOrg: null,
    awards: [], strikes: [], promoChecks: [], leave: null, notes: [],
    events: [{ id: newId('evt'), date: now, type: 'appointment', text: `Inducted from recruitment ${r.ref} by ${app.user.designation}.` }],
    createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
  };
  upsertUser(user);
  logAction(app.user, 'CREATE_RECORD', `${designation} (${r.name}) inducted from ${r.ref}.`);
  return user.id;
}

// --- Create scouting target -------------------------------------------------
function openCreate(app) {
  const actor = app.user;
  const orgs = participableOrgs(actor);
  if (!orgs.length) { toast('You cannot open scouting targets.', 'error'); return; }
  const org0 = orgs[0];
  const rankOpts = (RANKS[org0] || []).map((rk) => `<option value="${esc(rk)}">${esc(rk)}</option>`).join('');
  const orgOpts = orgs.map((o) => `<option value="${esc(o)}">${esc(ORGS[o].name)}</option>`).join('');

  const body = `
    <p class="modal__message">Open a scouting target. It enters the pipeline at Scouting for the unit\u2019s CL4 cadre to review.</p>
    <div class="field"><label>Name</label><input id="rc-name" type="text" placeholder="e.g. Rourke, T." /></div>
    <div class="field"><label>SteamID</label><input id="rc-steam" type="text" placeholder="STEAM_0:1:..." /></div>
    <div class="field"><label>Department</label><input id="rc-dept" type="text" placeholder="e.g. Security" /></div>
    <div class="field"><label>Rank sought</label><select id="rc-rank">${rankOpts}</select></div>
    ${orgs.length > 1 ? `<div class="field"><label>Organisation</label><select id="rc-org">${orgOpts}</select></div>` : ''}
    <div id="rc-err" class="auth__error" hidden></div>
  `;

  openModal({
    title: 'New scouting target',
    wide: true,
    body,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (close) => close() },
      { label: 'Open target', tone: 'primary', onClick: (close, d) => {
          const name = d.querySelector('#rc-name').value.trim();
          const steamId = d.querySelector('#rc-steam').value.trim();
          const department = d.querySelector('#rc-dept').value.trim();
          const org = d.querySelector('#rc-org') ? d.querySelector('#rc-org').value : org0;
          const rank = d.querySelector('#rc-rank').value;
          const err = d.querySelector('#rc-err');
          err.hidden = true;
          if (!name) { err.textContent = 'A name is required.'; err.hidden = false; return; }
          if (!canParticipateRecruitment(actor, org)) { err.textContent = 'You cannot open scouting targets for that organisation.'; err.hidden = false; return; }
          const prefix = 'SCT';
          const nums = recruits().filter((x) => (x.ref || '').startsWith(prefix)).length + 43;
          const ref = `${prefix}-${String(nums).padStart(4, '0')}`;
          const now = new Date().toISOString();
          upsertRecruit({
            id: newId('rec'), ref, name, steamId, department, rank, org,
            stage: 'scouting', archiveStatus: null,
            comments: [{ id: newId('rc'), by: actor.designation, ts: now, stage: 'scouting', text: `Scouting target opened by ${actor.designation}.` }],
            votes: {}, personnelFileId: null,
            createdBy: actor.designation, createdAt: now, updatedAt: now,
            version: 1, deleted: false, deletedAt: null,
          });
          logAction(actor, 'OPEN_RECRUIT', `Opened scouting target ${ref} (${name}).`);
          close();
          toast(`Scouting target ${ref} opened.`, 'success');
          app.navigate('#/recruitment');
        } },
    ],
  });
}
