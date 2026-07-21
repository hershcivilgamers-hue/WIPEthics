// =============================================================================
// views/notifications.js — For Your Attention.
//
// A per-operator feed of things that want the signed-in operator's attention,
// COMPUTED from the records they already hold — never a stored notification and
// never the audit stream. Because it derives from the same redacted snapshot the
// rest of the app reads, it inherits every access rule for free: a source you
// cannot see cannot generate a notification, a sealed order cannot ask you to
// sign it. Nothing here writes; every item is a link into the record it concerns.
//
// buildNotifications is exported and pure so it can be unit-tested and reused
// (e.g. for a header count).
// =============================================================================

import {
  activityStatus, mergeActivityReqs, ACTIVITY_REQ_SETTING_ID,
  RECRUIT_PIPELINE_OMEGA, RECRUIT_PIPELINE_ETHICS, strikeActive,
  rankUp, promoChecklistComplete } from '../constants.js';
import {
  users, operations, intel, recruits, directives, cases, compartments, subjects,
  getActivityForUser, getSetting, blacklist, promoReqs, evidence, investigations } from '../storage.js';
import {
  isAssignedToOperation, isAssignedToIntel, canViewOperation, canViewIntel,
  canReadDirective, canManageOrg, canParticipateRecruitment, canRuleTribunal,
  canManageDirectives, isCL5, canIssueStrike, canManageLeave, canPromote, canManageTribunal } from '../permissions.js';
import { esc, relTime } from '../ui.js';
import { partitionNotes, markSeen, markDone, snooze, restore } from '../inbox.js';

const SEVEN_DAYS = 7 * 24 * 3600000;
const FOURTEEN_DAYS = 14 * 24 * 3600000;
const lastAt = (log) => { const l = log || []; return l.length ? Math.max(...l.map((e) => e.at)) : null; };

// Does `text` @-mention one of `handles` (lower-cased designation / codename)?
// Boundary-aware so "@EC-1" does not fire on a comment that says "@EC-10".
// Exported pure so the boundary rule can be unit-tested.
export function mentionsActor(text, handles) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return handles.some((h) => {
    if (!h) return false;
    let from = 0;
    for (;;) {
      const i = t.indexOf('@' + h, from);
      if (i < 0) return false;
      const after = t[i + 1 + h.length];
      if (after === undefined || !/[a-z0-9-]/.test(after)) return true;
      from = i + 1;
    }
  });
}

// Comment/log/report threads that carry free text, with the fields each uses.
const MENTION_THREADS = [
  { rows: () => recruits(),   thread: (r) => r.comments, at: 'ts', hash: (r) => `#/recruit/${r.id}`,   ref: (r) => r.ref },
  { rows: () => subjects(),   thread: (s) => s.logs,     at: 'ts', hash: (s) => `#/subject/${s.id}`,   ref: (s) => s.ref },
  { rows: () => cases(),      thread: (c) => c.entries,  at: 'ts', hash: (c) => `#/case/${c.id}`,      ref: (c) => c.ref },
  { rows: () => operations(), thread: (o) => o.log,      at: 'at', hash: (o) => `#/operation/${o.id}`, ref: (o) => o.ref },
  { rows: () => intel(),      thread: (s) => s.reports,  at: 'at', hash: (s) => `#/source/${s.id}`,    ref: (s) => s.ref },
];

// Build the attention list for an operator. Each item:
//   { tone, icon, text, hash, at }  — `at` (ms) may be null (undated).
export function buildNotifications(actor, now = Date.now()) {
  const items = [];
  const add = (tone, icon, text, hash, at = null) => items.push({ tone, icon, text, hash, at });

  // 1. Your own readiness — a personal breach is worth surfacing.
  const reqs = mergeActivityReqs((getSetting(ACTIVITY_REQ_SETTING_ID) || {}).data);
  const myStatus = activityStatus(actor, getActivityForUser(actor.id), reqs, now);
  if (myStatus.key === 'inactive') add('bad', '\u25CF', 'You have logged no hours this week \u2014 you are marked Inactive.', '#/dashboard');
  else if (myStatus.key === 'semi') add('warn', '\u25CF', `You are below the weekly requirement (${myStatus.weekHours}h logged).`, '#/dashboard');

  // 2. Standing orders addressed to you that you have not acknowledged.
  for (const d of directives()) {
    if (d.deleted || d.status === 'rescinded') continue;
    if (d.org !== actor.org) continue;
    if (!canReadDirective(actor, d)) continue;
    if (!(d.acks || {})[actor.id]) add('warn', '\u270D', `Standing order ${d.ref} awaits your acknowledgement.`, `#/directive/${d.id}`, new Date(d.createdAt).getTime());
  }

  // 3. Operations you are assigned to that are currently active.
  for (const o of operations()) {
    if (o.deleted || !canViewOperation(actor, o)) continue;
    if (o.status === 'active' && isAssignedToOperation(actor, o)) add('info', '\u25B8', `You are assigned to active operation ${o.ref} \u201c${o.name}\u201d.`, `#/operation/${o.id}`, lastAt(o.log));
  }

  // 4. Sources you handle that have gone quiet (no report in seven days), or need vetting.
  for (const s of intel()) {
    if (s.deleted || !canViewIntel(actor, s) || !isAssignedToIntel(actor, s)) continue;
    if (s.status === 'probation') add('warn', '\u2699', `Source \u201c${s.codename}\u201d (${s.ref}) is on probation and awaits vetting.`, `#/source/${s.id}`, lastAt(s.reports));
    else if (s.status === 'active') {
      const la = lastAt(s.reports);
      if (!la || la < now - SEVEN_DAYS) add('info', '\u2699', `Source \u201c${s.codename}\u201d (${s.ref}) has filed nothing in over a week.`, `#/source/${s.id}`, la);
    }
  }

  // 5. Recruitment awaiting you: candidates you can vote on but have not.
  for (const r of recruits()) {
    if (r.deleted || r.stage === 'archived') continue;
    if (!canParticipateRecruitment(actor, r.org)) continue;
    const voteStage = (r.org === 'ethics-committee' ? RECRUIT_PIPELINE_ETHICS : RECRUIT_PIPELINE_OMEGA).includes(r.stage);
    if (voteStage && !(r.votes || {})[actor.id]) {
      const where = r.org === 'ethics-committee' ? `#/recruit/${r.id}` : `#/recruit/${r.id}`;
      add('info', '\u2691', `Candidate ${r.name} (${r.ref}) awaits your vote.`, where, new Date(r.updatedAt).getTime());
    }
  }

  // 6. Tribunal: cases in deliberation, for those who may rule.
  if (canRuleTribunal(actor)) {
    for (const c of cases()) {
      if (c.deleted) continue;
      if (c.status === 'deliberation') add('warn', '\u2696', `Case ${c.ref} \u201c${c.title}\u201d is in deliberation and awaits a ruling.`, `#/case/${c.id}`, new Date(c.updatedAt).getTime());
    }
  }

  // 7. Registration approvals waiting on a manager.
  if (isCL5(actor) || canManageOrg(actor, actor.org)) {
    const pending = users().filter((u) => !u.deleted && u.accountStatus === 'pending' && (isCL5(actor) || u.requestedOrg === actor.org || actor.org === 'command'));
    if (pending.length) add('warn', '\u2295', `${pending.length} access request${pending.length > 1 ? 's' : ''} awaiting approval.`, '#/admin', null);
  }

  // 8a. A pending appeal against one of YOUR OWN strikes — reassure the operator it's lodged.
  const me = users().find((u) => u.id === actor.id);
  if (me) {
    const mine = me.strikes || [];
    const pend = mine.find((st) => st.appeal && st.appeal.status === 'pending');
    if (pend) add('info', '\u2696', 'Your strike appeal is lodged and awaiting a ruling.', `#/personnel/${actor.id}`, new Date(pend.appeal.at).getTime());
    else {
      // A recent win is worth surfacing; an old one shouldn't linger forever.
      const won = mine.find((st) => st.appeal && st.appeal.status === 'overturned'
        && st.appeal.resolvedAt && (now - new Date(st.appeal.resolvedAt).getTime()) < 14 * 24 * 3600000);
      if (won) add('ok', '\u2696', 'A strike against you was overturned on appeal.', `#/personnel/${actor.id}`, new Date(won.appeal.resolvedAt).getTime());
    }
  }

  // 10a. Your own leave request: pending, or recently resolved.
  if (me && me.leaveRequest) {
    const r = me.leaveRequest;
    if (r.status === 'pending') add('info', '\u2708', `Your leave request (${r.from} \u2013 ${r.to}) is awaiting review.`, `#/personnel/${actor.id}`, r.at ? new Date(r.at).getTime() : null);
    else if (r.resolvedAt && (now - new Date(r.resolvedAt).getTime()) < 14 * 24 * 3600000) {
      add(r.status === 'approved' ? 'ok' : 'warn', '\u2708', `Your leave request was ${r.status}.`, `#/personnel/${actor.id}`, new Date(r.resolvedAt).getTime());
    }
  }

  // 11a. Your own advancement / transfer requests: pending or recently resolved.
  if (me) {
    for (const [key, icon, label] of [['advancementRequest', '\u2b06', 'advancement review'], ['transferRequest', '\u21c4', 'transfer request']]) {
      const r = me[key];
      if (!r) continue;
      if (r.status === 'pending') add('info', icon, `Your ${label} is awaiting review.`, `#/personnel/${actor.id}`, r.at ? new Date(r.at).getTime() : null);
      else if (r.resolvedAt && (now - new Date(r.resolvedAt).getTime()) < 14 * 24 * 3600000) {
        add(r.status === 'declined' ? 'warn' : 'ok', icon, `Your ${label} was ${r.status}.`, `#/personnel/${actor.id}`, new Date(r.resolvedAt).getTime());
      }
    }
  }

  // 11b. Requests awaiting an authority.
  for (const u of users()) {
    if (u.deleted || u.id === actor.id) continue;
    const ar = u.advancementRequest;
    if (ar && ar.status === 'pending' && canPromote(actor, u)) {
      add('warn', '\u2b06', `Advancement review requested \u2014 ${u.designation}.`, `#/personnel/${u.id}`, ar.at ? new Date(ar.at).getTime() : null);
    }
    const tr = u.transferRequest;
    if (tr && tr.status === 'pending' && canManageOrg(actor, u.org)) {
      add('warn', '\u21c4', `Transfer request awaiting review \u2014 ${u.designation}.`, `#/personnel/${u.id}`, tr.at ? new Date(tr.at).getTime() : null);
    }
  }

  // 10b. Leave requests awaiting an authority.
  for (const u of users()) {
    if (u.deleted || u.id === actor.id) continue;
    const r = u.leaveRequest;
    if (r && r.status === 'pending' && canManageLeave(actor, u)) {
      add('warn', '\u2708', `Leave request awaiting review \u2014 ${u.designation} (${r.from} \u2013 ${r.to}).`, `#/personnel/${u.id}`, r.at ? new Date(r.at).getTime() : null);
    }
  }

  // 8b. Strike appeals awaiting an authority who may rule (issuer recused).
  for (const u of users()) {
    if (u.deleted || !canIssueStrike(actor, u)) continue;
    const waiting = (u.strikes || []).some((st) => st.appeal && st.appeal.status === 'pending' && (isCL5(actor) || !st.by || actor.designation !== st.by));
    if (waiting) add('warn', '\u2696', `Strike appeal awaiting review \u2014 ${u.designation}.`, `#/personnel/${u.id}`, null);
  }

  // 9. Blacklist appeals awaiting a manager of the raising organisation.
  for (const e of blacklist()) {
    if (e.deleted) continue;
    if (e.appeal && e.appeal.status === 'pending' && canManageOrg(actor, e.org)) {
      add('warn', '\u2298', `Blacklist appeal awaiting review \u2014 ${e.name}.`, '#/blacklist', e.appeal.at ? new Date(e.appeal.at).getTime() : null);
    }
  }

  // 12. Promotion eligibility: an operator whose checklist is fully met, shown to
  //     those who may promote them. Skipped if they already filed an advancement
  //     request (branch 11b covers that), so the two don't double up.
  for (const u of users()) {
    if (u.deleted || u.id === actor.id) continue;
    if (!canPromote(actor, u)) continue; // canPromote already ensures a next rank exists
    if (u.advancementRequest && u.advancementRequest.status === 'pending') continue;
    const set = promoReqs().find((r) => r.org === u.org && r.fromRank === u.rank);
    if (!promoChecklistComplete(u, set)) continue;
    add('ok', '⬆', `${u.designation} has met every promotion requirement for ${rankUp(u.org, u.rank)} — eligible for review.`, `#/personnel/${u.id}`, null);
  }

  // 13. @mentions: someone named you in a thread you can see, within a fortnight.
  //     Derives from the redacted snapshot, so a thread you cannot read cannot
  //     mention you. One item per record — the most recent mentioning entry.
  const handles = [actor.designation, actor.codename].filter(Boolean).map((h) => String(h).toLowerCase());
  if (handles.length) {
    for (const src of MENTION_THREADS) {
      for (const rec of src.rows()) {
        if (rec.deleted) continue;
        let hit = null;
        for (const e of (src.thread(rec) || [])) {
          if (e.by === actor.designation) continue; // your own message
          const when = typeof e[src.at] === 'number' ? e[src.at] : Date.parse(e[src.at]);
          if (!(when > now - FOURTEEN_DAYS)) continue;
          if (!mentionsActor(e.text, handles)) continue;
          if (!hit || when > hit.when) hit = { when, by: e.by };
        }
        if (hit) add('info', '@', `${hit.by} mentioned you in ${src.ref(rec)}.`, src.hash(rec), hit.when);
      }
    }
  }

  // 14. Evidence awaiting review — for an Omega reviewer, held submissions.
  if (isCL5(actor) || canManageOrg(actor, 'omega-1')) {
    const held = evidence().filter((e) => !e.deleted && e.status === 'pending').length;
    if (held) add('warn', '◈', `${held} evidence submission${held > 1 ? 's' : ''} awaiting your review.`, '#/evidence', null);
  }

  // 15. Your own evidence was rejected recently — so you know to resubmit.
  for (const e of evidence()) {
    if (e.deleted || e.userId !== actor.id || e.status !== 'rejected') continue;
    const when = e.reviewedAt ? Date.parse(e.reviewedAt) : null;
    if (when && when > now - FOURTEEN_DAYS) add('bad', '✕', `Your evidence “${e.title}” was rejected.`, '#/evidence', when);
  }

  // 16. Internal Security referrals awaiting a case. Only a seated Committee
  //     member sees this: the Department substantiates and refers, the Committee
  //     opens the case. (Investigations reach CL5 anyway, so nothing leaks — a
  //     viewer who cannot see them cannot satisfy canManageTribunal here either.)
  if (canManageTribunal(actor)) {
    const waiting = investigations().filter((i) => !i.deleted && i.stage === 'closed'
      && (i.disposition === 'substantiated' || i.disposition === 'referred') && !i.caseId);
    for (const i of waiting) {
      add('warn', '⚖', `Internal Security referral ${i.ref} is substantiated and awaits a case.`, '#/investigations',
        i.updatedAt ? new Date(i.updatedAt).getTime() : null);
    }
  }

  // Newest first; undated items sink to the bottom.
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  return items;
}

export function render(host, app) {
  const userId = app.user.id;
  const items = buildNotifications(app.user);
  const { active, snoozed, cleared } = partitionNotes(userId, items);
  const unread = active.filter((n) => n._unread).length;

  const activeRow = (n) => `
    <div class="note-row note-row--${esc(n.tone)} ${n._unread ? 'note-row--unread' : ''}" data-go="${esc(n.hash)}" tabindex="0">
      <span class="note-row__dot" aria-hidden="true"></span>
      <span class="note-row__icon">${n.icon}</span>
      <span class="note-row__text">${esc(n.text)}</span>
      ${n.at ? `<span class="note-row__at muted-text">${esc(relTime(new Date(n.at).toISOString()))}</span>` : ''}
      <span class="note-row__actions">
        <button class="note-act" data-snooze="${esc(n._key)}" title="Snooze for a day" aria-label="Snooze for a day">⏰</button>
        <button class="note-act" data-done="${esc(n._key)}" title="Mark done" aria-label="Mark done">✓</button>
      </span>
    </div>`;

  const parkedRow = (n, kind) => `
    <div class="note-row note-row--muted note-row--parked" data-go="${esc(n.hash)}" tabindex="0">
      <span class="note-row__dot" aria-hidden="true"></span>
      <span class="note-row__icon">${n.icon}</span>
      <span class="note-row__text">${esc(n.text)}</span>
      <span class="note-row__at muted-text">${kind === 'snoozed' && n._snoozeUntil ? `snoozed · back ${esc(relTime(new Date(n._snoozeUntil).toISOString()))}` : 'cleared'}</span>
      <span class="note-row__actions">
        <button class="note-act" data-restore="${esc(n._key)}" title="Bring back to the list" aria-label="Restore">↺</button>
      </span>
    </div>`;

  const activeHTML = active.length
    ? active.map(activeRow).join('')
    : '<div class="empty">Nothing needs your attention right now.</div>';

  const parkedCount = snoozed.length + cleared.length;
  const moreHTML = parkedCount ? `
    <details class="note-more">
      <summary>${snoozed.length ? `${snoozed.length} snoozed` : ''}${snoozed.length && cleared.length ? ' · ' : ''}${cleared.length ? `${cleared.length} cleared` : ''}</summary>
      <div class="note-list">
        ${snoozed.map((n) => parkedRow(n, 'snoozed')).join('')}
        ${cleared.map((n) => parkedRow(n, 'done')).join('')}
      </div>
    </details>` : '';

  const sub = active.length
    ? `${unread ? `${unread} new · ` : ''}${active.length} item${active.length > 1 ? 's' : ''}`
    : (parkedCount ? 'All clear — nothing active' : 'All clear');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO</div>
        <h1 class="page-title">For Your Attention</h1>
        <div class="page-sub">${sub}</div>
      </div>
    </div>
    <div class="card"><div class="card__body">
      <div class="note-list">${activeHTML}</div>
      ${moreHTML}
    </div></div>
  `;

  // Row navigation — but never when a per-row action button was the target.
  host.querySelectorAll('[data-go]').forEach((el) => {
    const go = (e) => { if (e && e.target.closest('.note-act')) return; app.navigate(el.dataset.go); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  });
  const refresh = () => app.refresh();
  host.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markDone(userId, b.dataset.done); refresh(); }));
  host.querySelectorAll('[data-snooze]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); snooze(userId, b.dataset.snooze); refresh(); }));
  host.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); restore(userId, b.dataset.restore); refresh(); }));

  // Opening the feed clears the unread badge; items stay in the list until acted on.
  markSeen(userId, active.map((n) => n._key));
}
