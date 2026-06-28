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
// This is the line between presentational security and enforced security.
// =============================================================================

import {
  isCL5, canEditPersonnel, canSetClearance, canIssueStrike, canDeletePersonnel,
  canApproveRegistrations, canPromote, canDemote, canManagePromoReqs,
  canManageDirectives, canManageSubject, canManageTribunal, canRuleTribunal,
} from '../../js/permissions.js';
import { rankIndex, clearanceForRank } from '../../js/constants.js';

const deny = (msg) => ({ ok: false, status: 403, error: msg || 'Not permitted.' });
const allow = { ok: true };

const len = (a) => (Array.isArray(a) ? a.length : 0);
const j = (v) => JSON.stringify(v ?? null);

// Did anything other than the listed fields change between two records?
function changedOutside(cur, next, allowed) {
  const keys = new Set([...Object.keys(cur || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    if (allowed.includes(k)) continue;
    if (j(cur?.[k]) !== j(next?.[k])) return true;
  }
  return false;
}

// --- Personnel: classify the operation by what changed, gate accordingly ----
function authorizeUser(actor, cur, next) {
  // Creation (admin add). Requires authority over the target org; if a clearance
  // is set on creation, that requires the clearance gate too.
  if (!cur) {
    if (!canManageDirectives(actor, next.org) && !canEditPersonnel(actor, next)) {
      // canEditPersonnel needs an org; reuse it as the "manage this org" check.
    }
    if (!canEditPersonnel(actor, next)) return deny('You cannot create personnel in that organisation.');
    if (next.clearance && !canSetClearance(actor, next, next.clearance)) return deny('You cannot assign that clearance.');
    return allow;
  }

  // Soft-delete / restore.
  if (!!next.deleted !== !!cur.deleted) {
    if (next.deleted && !canDeletePersonnel(actor, cur)) return deny('You cannot remove this record.');
    if (!next.deleted && !canDeletePersonnel(actor, cur)) return deny('You cannot restore this record.');
    return allow;
  }

  // Registration approval (pending -> active).
  if (cur.accountStatus === 'pending' && next.accountStatus === 'active') {
    if (!canApproveRegistrations(actor)) return deny('Only CL5 may approve registrations.');
    return allow;
  }

  // Rank change = promotion or demotion. Clearance may only move to the new
  // rank's tier, and the checklist must reset; nothing else may change.
  if (j(next.rank) !== j(cur.rank)) {
    const up = rankIndex(cur.org, next.rank) >= 0 && rankIndex(cur.org, next.rank) < rankIndex(cur.org, cur.rank);
    const okGate = up ? canPromote(actor, cur) : canDemote(actor, cur);
    if (!okGate) return deny('You are not permitted to change this operator\'s rank.');
    const tier = clearanceForRank(cur.org, next.rank);
    if (tier && j(next.clearance) !== j(tier)) return deny('Rank change must align clearance to the new rank.');
    if (len(next.promoChecks) !== 0) return deny('A rank change must reset the promotion checklist.');
    if (changedOutside(cur, next, ['rank', 'clearance', 'promoChecks', 'events', 'version', 'updatedAt'])) {
      return deny('A rank change cannot be combined with other edits.');
    }
    return allow;
  }

  // Clearance change on its own = the CL5 override.
  if (j(next.clearance) !== j(cur.clearance)) {
    if (!canSetClearance(actor, cur, next.clearance)) return deny('You cannot set that clearance.');
    if (changedOutside(cur, next, ['clearance', 'events', 'version', 'updatedAt'])) {
      return deny('A clearance change cannot be combined with other edits.');
    }
    return allow;
  }

  // A new strike.
  if (len(next.strikes) > len(cur.strikes)) {
    if (!canIssueStrike(actor, cur)) return deny('You cannot strike this operator.');
    return allow;
  }

  // Ticking a promotion requirement (only promoChecks changes).
  if (j(next.promoChecks) !== j(cur.promoChecks) &&
      !changedOutside(cur, next, ['promoChecks', 'version', 'updatedAt'])) {
    if (!canPromote(actor, cur)) return deny('You cannot update this checklist.');
    return allow;
  }

  // Anything else (codename, legal name, status, leave, awards, notes, events)
  // is a general edit.
  if (!canEditPersonnel(actor, cur)) return deny('You cannot edit this record.');
  return allow;
}

function authorizeDirective(actor, cur, next) {
  const org = (next || cur).org;
  if (!canManageDirectives(actor, org)) return deny('You cannot manage directives for that organisation.');
  return allow;
}

function authorizeSubject(actor, cur, next) {
  if (!canManageSubject(actor, next || cur)) return deny('You cannot manage this surveillance subject.');
  return allow;
}

function authorizeCase(actor, cur, next) {
  // Entering or changing a ruling is CL5-only; everything else is tribunal mgmt.
  const rulingChanged = j(next?.ruling) !== j(cur?.ruling) && next?.ruling != null;
  if (rulingChanged) {
    if (!canRuleTribunal(actor)) return deny('Only CL5 may enter a ruling.');
    return allow;
  }
  if (!canManageTribunal(actor)) return deny('You cannot manage tribunal cases.');
  return allow;
}

function authorizePromoReq(actor) {
  if (!canManagePromoReqs(actor)) return deny('Promotion requirements are managed at CL5.');
  return allow;
}

const AUTHORIZERS = {
  users: authorizeUser,
  directives: authorizeDirective,
  subjects: authorizeSubject,
  cases: authorizeCase,
  promo_reqs: authorizePromoReq,
};

// collection -> (actor, current|null, incoming) -> {ok} | {ok:false,status,error}
export function authorizeWrite(collection, actor, cur, next) {
  const fn = AUTHORIZERS[collection];
  if (!fn) return { ok: false, status: 404, error: 'Unknown collection.' };
  if (!actor) return { ok: false, status: 401, error: 'Not authenticated.' };
  return fn(actor, cur, next);
}
