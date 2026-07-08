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
  RECRUIT_PIPELINE_OMEGA, RECRUIT_PIPELINE_ETHICS, strikeActive } from '../constants.js';
import {
  users, operations, intel, recruits, directives, cases, compartments,
  getActivityForUser, getSetting, blacklist } from '../storage.js';
import {
  isAssignedToOperation, isAssignedToIntel, canViewOperation, canViewIntel,
  canReadDirective, canManageOrg, canParticipateRecruitment, canRuleTribunal,
  canManageDirectives, isCL5, canIssueStrike } from '../permissions.js';
import { esc, relTime } from '../ui.js';

const SEVEN_DAYS = 7 * 24 * 3600000;
const lastAt = (log) => { const l = log || []; return l.length ? Math.max(...l.map((e) => e.at)) : null; };

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
    for (const st of (me.strikes || [])) {
      if (st.appeal && st.appeal.status === 'pending') { add('info', '\u2696', 'Your strike appeal is lodged and awaiting a ruling.', `#/personnel/${actor.id}`, new Date(st.appeal.at).getTime()); break; }
      if (st.appeal && st.appeal.status === 'overturned') { add('ok', '\u2696', 'A strike against you was overturned on appeal.', `#/personnel/${actor.id}`, st.appeal.resolvedAt ? new Date(st.appeal.resolvedAt).getTime() : null); break; }
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

  // Newest first; undated items sink to the bottom.
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  return items;
}

export function render(host, app) {
  const items = buildNotifications(app.user);

  const rows = items.length ? items.map((n) => `
    <div class="note-row note-row--${esc(n.tone)}" data-go="${esc(n.hash)}" tabindex="0">
      <span class="note-row__icon">${n.icon}</span>
      <span class="note-row__text">${esc(n.text)}</span>
      ${n.at ? `<span class="note-row__at muted-text">${esc(relTime(new Date(n.at).toISOString()))}</span>` : ''}
    </div>`).join('') : '<div class="empty">Nothing needs your attention right now.</div>';

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO</div>
        <h1 class="page-title">For Your Attention</h1>
        <div class="page-sub">${items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : 'All clear'}</div>
      </div>
    </div>
    <div class="card"><div class="card__body"><div class="note-list">${rows}</div></div></div>
  `;

  host.querySelectorAll('[data-go]').forEach((el) => {
    const go = () => app.navigate(el.dataset.go);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
