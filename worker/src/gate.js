// =============================================================================
// gate.js — Server-side write authorization.
//
// The app performs one atomic operation per save (a promote, a strike, an edit,
// a ruling…). The Worker can't be handed a verb it trusts, so instead it loads
// the stored record, diffs it against what's being written, infers which
// operation this is, and runs the SAME permission gate the client ran. If the
// inference finds a change the actor isn't allowed to make, the write is
// refused with 403 — regardless of what the UI let them attempt.
//
// Each authorizer also returns the operation label + a short human detail, so
// the audit log is written from what actually changed rather than a value the
// client could spoof.
// =============================================================================

import {
  canEditPersonnel, canSetClearance, canIssueStrike, canDeletePersonnel,
  canApproveRegistrations, canPromote, canDemote, canManagePromoReqs,
  canManageDirectives, canManageSubject, canManageTribunal, canRuleTribunal,
  compartmentClears, canManageCompartment, canReadOperatorInto,
  canManageOrg, canParticipateRecruitment,
} from '../../js/permissions.js';
import { rankUp, rankDown, clearanceForRank, clearanceWeight, tallyVotes } from '../../js/constants.js';

const deny = (msg) => ({ ok: false, status: 403, error: msg || 'Not permitted.' });
const ok = (action, detail) => ({ ok: true, action, detail });

const len = (a) => (Array.isArray(a) ? a.length : 0);
const j = (v) => JSON.stringify(v ?? null);

// Fields the server owns and the client never sees or sets. Their presence in
// the stored record but absence from a client payload (credentials), or vice
// versa (redaction artifacts), must NOT register as a change — otherwise an
// ordinary promotion looks like it also rewrote other fields and gets refused.
const SERVER_OWNED = new Set([
  'salt', 'passwordHash', 'accessLevel', 'bodyWithheld',
  'compartmentName', 'compartmented', 'membersCount', 'access',
]);

function changedOutside(cur, next, allowed) {
  const allow = new Set(allowed);
  const keys = new Set([...Object.keys(cur || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    if (SERVER_OWNED.has(k) || allow.has(k)) continue;
    if (j(cur?.[k]) !== j(next?.[k])) return true;
  }
  return false;
}

// Need-To-Know guard for taggable records (subjects / cases / directives). The
// actor must be read into the record's CURRENT compartment to touch it at all,
// and read into the TARGET compartment to file it there. Returns a deny() or
// null. (compMap arrives via ctx; CL5 clears every compartment.)
function compartmentWriteBlock(actor, cur, next, ctx) {
  const compMap = ctx && ctx.compMap;
  if (cur && !compartmentClears(actor, cur, compMap)) {
    return deny('You are not read into this record\u2019s compartment.');
  }
  if (next && next.compartment && !compartmentClears(actor, next, compMap)) {
    return deny('You cannot file a record into a compartment you are not read into.');
  }
  return null;
}

function authorizeUser(actor, cur, next) {
  if (!cur) {
    if (!canEditPersonnel(actor, next)) return deny('You cannot create personnel in that organisation.');
    if (next.clearance && !canSetClearance(actor, next, next.clearance)) return deny('You cannot assign that clearance.');
    return ok('CREATE_PERSONNEL', `Created ${next.designation || 'operator'}.`);
  }

  if (!!next.deleted !== !!cur.deleted) {
    if (!canDeletePersonnel(actor, cur)) return deny(next.deleted ? 'You cannot remove this record.' : 'You cannot restore this record.');
    return next.deleted
      ? ok('REMOVE_PERSONNEL', `Removed ${cur.designation}.`)
      : ok('RESTORE_PERSONNEL', `Restored ${cur.designation}.`);
  }

  if (cur.accountStatus === 'pending' && next.accountStatus === 'active') {
    if (!canApproveRegistrations(actor)) return deny('Only CL5 may approve registrations.');
    return ok('APPROVE_REGISTRATION', `Approved ${next.codename || next.designation}.`);
  }

  if (j(next.rank) !== j(cur.rank)) {
    // Rank moves exactly one step. The only legitimate operator-driven rank
    // flows are the Promote and Demote buttons — each a single rankUp/rankDown.
    // An initial arbitrary rank is set through registration approval, handled
    // above. Enforcing one step here closes a forged-request hole where a
    // multi-step jump could carry a junior past the actor's own clearance in a
    // single write (the diff would otherwise only check the current rank gap).
    const up = next.rank === rankUp(cur.org, cur.rank);
    const down = next.rank === rankDown(cur.org, cur.rank);
    if (!up && !down) return deny('Rank changes move one step at a time.');
    if (!(up ? canPromote(actor, cur) : canDemote(actor, cur))) return deny('You are not permitted to change this operator\u0027s rank.');
    const tier = clearanceForRank(cur.org, next.rank);
    if (tier && j(next.clearance) !== j(tier)) return deny('Rank change must align clearance to the new rank.');
    if (len(next.promoChecks) !== 0) return deny('A rank change must reset the promotion checklist.');
    if (changedOutside(cur, next, ['rank', 'clearance', 'promoChecks', 'events', 'version', 'updatedAt'])) {
      return deny('A rank change cannot be combined with other edits.');
    }
    return up
      ? ok('PROMOTE', `${cur.designation}: ${cur.rank} \u2192 ${next.rank}.`)
      : ok('DEMOTE', `${cur.designation}: ${cur.rank} \u2192 ${next.rank}.`);
  }

  if (j(next.clearance) !== j(cur.clearance)) {
    if (!canSetClearance(actor, cur, next.clearance)) return deny('You cannot set that clearance.');
    if (changedOutside(cur, next, ['clearance', 'events', 'version', 'updatedAt'])) {
      return deny('A clearance change cannot be combined with other edits.');
    }
    return ok('SET_CLEARANCE', `${cur.designation}: ${cur.clearance} \u2192 ${next.clearance}.`);
  }

  if (len(next.strikes) > len(cur.strikes)) {
    if (!canIssueStrike(actor, cur)) return deny('You cannot strike this operator.');
    return ok('ISSUE_STRIKE', `Strike issued to ${cur.designation}.`);
  }

  if (j(next.promoChecks) !== j(cur.promoChecks) &&
      !changedOutside(cur, next, ['promoChecks', 'version', 'updatedAt'])) {
    if (!canPromote(actor, cur)) return deny('You cannot update this checklist.');
    return ok('PROMO_CHECK', `Updated ${cur.designation}'s promotion checklist.`);
  }

  if (!canEditPersonnel(actor, cur)) return deny('You cannot edit this record.');
  return ok('EDIT_PERSONNEL', `Updated ${cur.designation}.`);
}

function authorizeDirective(actor, cur, next, ctx) {
  const org = (next || cur).org;
  if (!canManageDirectives(actor, org)) return deny('You cannot manage directives for that organisation.');
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;
  const ref = (next || cur).ref || 'directive';
  if (!cur) return ok('CREATE_DIRECTIVE', `Issued ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) return next.deleted ? ok('REMOVE_DIRECTIVE', `Withdrew ${ref}.`) : ok('RESTORE_DIRECTIVE', `Restored ${ref}.`);
  return ok('EDIT_DIRECTIVE', `Updated ${ref}.`);
}

function authorizeSubject(actor, cur, next, ctx) {
  if (!canManageSubject(actor, next || cur)) return deny('You cannot manage this surveillance subject.');
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;
  const ref = (next || cur).ref || 'subject';
  if (!cur) return ok('CREATE_SUBJECT', `Opened ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) return next.deleted ? ok('REMOVE_SUBJECT', `Closed ${ref}.`) : ok('RESTORE_SUBJECT', `Reopened ${ref}.`);
  return ok('EDIT_SUBJECT', `Updated ${ref}.`);
}

function authorizeCase(actor, cur, next, ctx) {
  const ref = (next || cur)?.ref || 'case';
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;
  const rulingChanged = j(next?.ruling) !== j(cur?.ruling) && next?.ruling != null;
  if (rulingChanged) {
    if (!canRuleTribunal(actor)) return deny('Only CL5 may enter a ruling.');
    return ok('ENTER_RULING', `Ruling entered on ${ref}.`);
  }
  if (!canManageTribunal(actor)) return deny('You cannot manage tribunal cases.');
  if (!cur) return ok('CREATE_CASE', `Opened ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) return next.deleted ? ok('REMOVE_CASE', `Closed ${ref}.`) : ok('RESTORE_CASE', `Reopened ${ref}.`);
  return ok('EDIT_CASE', `Updated ${ref}.`);
}

// Need-To-Know compartments. Opening, sealing and editing a compartment, and
// reading operators in or out, follow the management rule for the owning org.
// A read-in additionally requires the compartment to be open and the operator
// to meet its clearance floor. The roster moves as its own atomic operation.
function authorizeCompartment(actor, cur, next, ctx) {
  const clearanceOf = (ctx && ctx.clearanceOf) || {};
  const nm = (c) => (c && (c.name || c.ref)) || 'compartment';

  if (!cur) {
    if (!canManageCompartment(actor, next)) return deny('You cannot open a compartment for that organisation.');
    // An initial read-in (the creator reads themselves in) must clear the floor,
    // so a forged create cannot seed an under-cleared roster.
    for (const id of (Array.isArray(next.members) ? next.members : [])) {
      if (clearanceWeight(clearanceOf[id]) < clearanceWeight(next.clearance)) {
        return deny('An initial read-in is below the compartment clearance floor.');
      }
    }
    return ok('CREATE_COMPARTMENT', `Opened compartment ${nm(next)}.`);
  }

  if (!!next.deleted !== !!cur.deleted) {
    if (!canManageCompartment(actor, cur)) return deny('You cannot remove this compartment.');
    return next.deleted
      ? ok('REMOVE_COMPARTMENT', `Removed compartment ${nm(cur)}.`)
      : ok('RESTORE_COMPARTMENT', `Restored compartment ${nm(cur)}.`);
  }

  const before = new Set(Array.isArray(cur.members) ? cur.members : []);
  const after = new Set(Array.isArray(next.members) ? next.members : []);
  const added = [...after].filter((x) => !before.has(x));
  const removed = [...before].filter((x) => !after.has(x));

  if (added.length || removed.length) {
    if (!canManageCompartment(actor, cur)) return deny('You cannot change this compartment\u2019s roster.');
    for (const id of added) {
      if (!canReadOperatorInto(actor, cur, { clearance: clearanceOf[id] })) {
        return deny('That operator cannot be read in — the compartment is sealed, or they are below its clearance floor.');
      }
    }
    if (changedOutside(cur, next, ['members', 'events', 'version', 'updatedAt'])) {
      return deny('A roster change cannot be combined with other edits.');
    }
    if (added.length && !removed.length) return ok('READ_IN', `Read ${added.length} operator(s) into ${nm(cur)}.`);
    if (removed.length && !added.length) return ok('READ_OUT', `Read ${removed.length} operator(s) out of ${nm(cur)}.`);
    return ok('ROSTER_UPDATE', `Adjusted the ${nm(cur)} roster.`);
  }

  if (!canManageCompartment(actor, cur)) return deny('You cannot edit this compartment.');
  return ok('EDIT_COMPARTMENT', `Updated compartment ${nm(cur)}.`);
}

function authorizePromoReq(actor) {
  if (!canManagePromoReqs(actor)) return deny('Promotion requirements are managed at CL5.');
  return ok('SET_PROMO_REQ', 'Updated promotion requirements.');
}

// Operational activity. Self-service: an operator opens/logs their OWN record
// regardless of clearance. Logging on another operator's behalf, setting a duty
// posture, or removing a record needs the org-management right. Writes are
// atomic — only the log, duty posture and derived timestamp move.
function authorizeActivity(actor, cur, next, ctx) {
  const rec = next || cur;
  const isSelf = rec.userId === actor.id;
  const isMgr = canManageOrg(actor, rec.org);
  if (!isSelf && !isMgr) return deny('You cannot log activity for that operator.');

  if (!cur) {
    if (isSelf && rec.org !== actor.org) return deny('Your activity record must sit under your own organisation.');
    return ok('LOG_ACTIVITY', 'Activity record opened.');
  }
  if (!!next.deleted !== !!cur.deleted) {
    if (!isMgr) return deny('Only a manager can remove an activity record.');
    return next.deleted ? ok('REMOVE_RECORD', 'Activity record removed.') : ok('RESTORE_RECORD', 'Activity record restored.');
  }
  const dutyChanged = j(next.duty) !== j(cur.duty);
  if (dutyChanged && !isMgr) return deny('Only a manager can set a duty posture.');
  if (changedOutside(cur, next, ['entries', 'duty', 'lastActiveAt', 'version', 'updatedAt'])) {
    return deny('An activity update cannot change other fields.');
  }
  if (dutyChanged) return ok('SET_DUTY_STATUS', 'Duty posture updated.');
  return ok('LOG_ACTIVITY', 'Activity logged.');
}

// Recruitment (Omega-1 scouting pipeline). Run by the unit's CL4 cadre. A vote
// write may only change the actor's own ballot; stage transitions follow the
// Scouting -> Greenlit -> Tryout -> Archived flow, and a candidate needs a
// majority Yes vote to leave Greenlit. Removing a candidate record needs the
// management right.
function authorizeRecruit(actor, cur, next, ctx) {
  const org = (next || cur).org;
  if (!canParticipateRecruitment(actor, org)) return deny('Recruitment is run by the unit\u2019s CL4 cadre.');
  const ref = (next || cur).ref || 'candidate';

  if (!cur) return ok('OPEN_RECRUIT', `Opened scouting target ${ref}.`);

  if (!!next.deleted !== !!cur.deleted) {
    if (!canManageOrg(actor, org)) return deny('Only a manager can remove a candidate record.');
    return next.deleted ? ok('REMOVE_RECRUIT', `Removed candidate ${ref}.`) : ok('RESTORE_RECRUIT', `Restored candidate ${ref}.`);
  }

  // Vote integrity — a ballot change may only touch the actor's own vote.
  const vb = cur.votes || {}, va = next.votes || {};
  const keys = new Set([...Object.keys(vb), ...Object.keys(va)]);
  let votesChanged = false;
  for (const k of keys) {
    if (j(vb[k]) !== j(va[k])) { votesChanged = true; if (k !== actor.id) return deny('You can only cast your own vote.'); }
  }

  const stageChanged = j(next.stage) !== j(cur.stage);
  if (stageChanged) {
    if (next.stage === 'archived') {
      if (cur.stage === 'tryout' && next.archiveStatus === 'approved') return ok('INDUCT_RECRUIT', `Candidate ${ref} approved at tryout.`);
      return ok('REJECT_RECRUIT', `Candidate ${ref} archived (${next.archiveStatus || 'denied'}).`);
    }
    if (cur.stage === 'scouting' && next.stage === 'greenlit') return ok('ADVANCE_RECRUIT', `Candidate ${ref} \u2192 greenlit.`);
    if (cur.stage === 'greenlit' && next.stage === 'tryout') {
      if (!tallyVotes(cur.votes).majorityYes) return deny('A candidate needs a majority Yes vote to enter tryout.');
      return ok('ADVANCE_RECRUIT', `Candidate ${ref} \u2192 tryout.`);
    }
    return deny('That is not a valid stage transition.');
  }

  if (votesChanged) return ok('VOTE_RECRUIT', `Vote cast on ${ref}.`);
  return ok('EDIT_RECRUIT', `Updated candidate ${ref}.`);
}

const AUTHORIZERS = {
  users: authorizeUser,
  directives: authorizeDirective,
  subjects: authorizeSubject,
  cases: authorizeCase,
  compartments: authorizeCompartment,
  activity: authorizeActivity,
  recruits: authorizeRecruit,
  promo_reqs: authorizePromoReq,
};

// collection -> (actor, current|null, incoming, ctx) -> {ok, action, detail}
//   | {ok:false, status, error}
// `ctx` may carry { compMap, clearanceOf } for the authorizers that need to look
// beyond the single record (compartment gating, read-in floor checks).
export function authorizeWrite(collection, actor, cur, next, ctx) {
  const fn = AUTHORIZERS[collection];
  if (!fn) return { ok: false, status: 404, error: 'Unknown collection.' };
  if (!actor) return { ok: false, status: 401, error: 'Not authenticated.' };
  return fn(actor, cur, next, ctx);
}
