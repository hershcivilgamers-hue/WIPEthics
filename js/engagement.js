// =============================================================================
// engagement.js — Omega-1 weekly engagement derivation.
//
// Gathers the countable engagement of an operator over a review week (Sunday→
// Saturday) from the logs the system already holds — scouting, order-tagged
// activity, PoI/subject work, trainings hosted/attended, hours — then folds in
// the Sr CL4 reviewer's manual scores and quality overrides (constants.js does
// the pure scoring). Like the readiness board, it stores nothing derived: the
// numbers are recomputed on every read.
// =============================================================================

import { ENGAGEMENT_WEEK_MS, ENGAGEMENT_ORG_DEFAULT, engagementResolved, engagementReqs, evidenceCounts } from './constants.js';
import { recruits, subjects, users, getActivityForUser, getEngagementFor, evidenceFor, investigations } from './storage.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t)) || 0;
const inWin = (t, start, end) => { const v = ms(t); return v >= start && v < end; };

// Raw event counts for one operator across the review week (and a trailing
// three-week host count for requirement two).
export function gatherRaw(user, weekStart, now = Date.now(), org = ENGAGEMENT_ORG_DEFAULT) {
  const desig = user.designation;
  const end = weekStart + ENGAGEMENT_WEEK_MS;
  const threeWeeksAgo = now - 3 * ENGAGEMENT_WEEK_MS;

  // Trainings and hours are common to every organisation: an agent logs their
  // hours once, under their cover post.
  const commonAct = getActivityForUser(user.id);
  let commonHours = 0;
  for (const e of ((commonAct && commonAct.log) || [])) {
    if (e.at >= weekStart && e.at < end) commonHours += Number(e.hours) || 0;
  }
  let cTrainAttend = 0; let cTrainHost = 0; let cHost3wk = 0;
  for (const u of users()) {
    for (const t of (u.trainings || [])) {
      if (u.id === user.id) {
        if (inWin(t.awardedAt, weekStart, end)) cTrainAttend += 1;
      } else if (t.awardedBy === desig) {
        if (inWin(t.awardedAt, weekStart, end)) cTrainHost += 1;
        if (inWin(t.awardedAt, threeWeeksAgo, now + 1)) cHost3wk += 1;
      }
    }
  }

  // --- Internal Security: casework, not field presence ------------------------
  // Referrals filed, work recorded to files, and matters brought to a
  // disposition. The referral's own filing entry is excluded from casework so a
  // referral is not counted twice.
  if (org === 'isd') {
    let referralsCount = 0; let caseworkCount = 0; let dispositionsCount = 0; let contrib3wk = 0;
    for (const inv of investigations()) {
      if (inv.deleted) continue;
      if (inv.openedBy === desig && inWin(inv.createdAt, weekStart, end)) referralsCount += 1;
      for (const e of (inv.entries || [])) {
        if (e.by !== desig) continue;
        if (inWin(e.ts, weekStart, end)) {
          if (e.type !== 'filing') caseworkCount += 1;
          if (e.type === 'disposition') dispositionsCount += 1;
        }
        if (inWin(e.ts, threeWeeksAgo, now + 1)) contrib3wk += 1;
      }
    }
    return {
      referralsCount, caseworkCount, dispositionsCount, contrib3wk,
      trainAttend: cTrainAttend, trainHost: cTrainHost, hours: commonHours, host3wk: cHost3wk,
    };
  }

  // Scouting — Omega candidates this operator opened or commented on, in-week.
  let scoutingCount = 0;
  for (const r of recruits()) {
    if (r.deleted || r.org !== 'omega-1') continue;
    const opened = r.createdBy === desig && inWin(r.createdAt, weekStart, end);
    const commented = (r.comments || []).some((c) => c.by === desig && inWin(c.ts, weekStart, end));
    if (opened || commented) scoutingCount += 1;
  }

  // Orders + Activity — from the operator's own activity log this week.
  const act = getActivityForUser(user.id);
  let ordersCount = 0; let hours = 0;
  for (const e of ((act && act.log) || [])) {
    if (!(e.at >= weekStart && e.at < end)) continue;
    hours += Number(e.hours) || 0;
    ordersCount += (e.tags || []).filter((t) => t.kind === 'order').length;
  }

  // PoIs / Targets — subjects opened + surveillance log entries filed, in-week.
  let poisCount = 0;
  for (const s of subjects()) {
    if (s.deleted) continue;
    if (s.createdBy === desig && inWin(s.createdAt, weekStart, end)) poisCount += 1;
    poisCount += (s.logs || []).filter((l) => l.by === desig && inWin(l.ts, weekStart, end)).length;
  }

  // Evidence — this operator's counted submissions for the week (evidence.js).
  const evidenceCount = evidenceFor(user.id, weekStart).filter(evidenceCounts).length;

  // Trainings — attended (own completions) + hosted (completions this operator
  // recorded onto OTHER operators). host3wk drives requirement two.
  let trainAttend = 0; let trainHost = 0; let host3wk = 0;
  for (const u of users()) {
    for (const t of (u.trainings || [])) {
      if (u.id === user.id) {
        if (inWin(t.awardedAt, weekStart, end)) trainAttend += 1;
      } else if (t.awardedBy === desig) {
        if (inWin(t.awardedAt, weekStart, end)) trainHost += 1;
        if (inWin(t.awardedAt, threeWeeksAgo, now + 1)) host3wk += 1;
      }
    }
  }

  return { scoutingCount, ordersCount, poisCount, evidenceCount, trainAttend, trainHost, hours, host3wk };
}

// The full model for one operator/week: raw counts, the stored record, resolved
// per-section scores + source, total, and the two requirement flags.
export function engagementModel(user, weekStart, now = Date.now(), org = ENGAGEMENT_ORG_DEFAULT) {
  const raw = gatherRaw(user, weekStart, now, org);
  const record = getEngagementFor(user.id, weekStart);
  const resolved = engagementResolved(raw, record, org);
  const reqs = engagementReqs(raw, org);
  return { user, weekStart, raw, record, ...resolved, reqs };
}
