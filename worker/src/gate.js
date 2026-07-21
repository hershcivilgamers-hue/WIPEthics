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
  canEditPersonnel, canSetClearance, canSetRank, canIssueStrike, canDeletePersonnel,
  canApproveRegistrations, canPromote, canDemote, canManagePromoReqs, canManageSettings,
  canManageDirectives, canReadDirective, canManageSubject, canManageTribunal, canRuleTribunal,
  canComposeDocument, canViewDocument,
  compartmentClears, canManageCompartment, canReadOperatorInto,
  canManageOrg, canParticipateRecruitment, canActOnRecruit, isMemberTrack, canLogToOperation, canLogIntel, canManageTraining, isCL5,
  canDischarge, canManageLeave, isISD, canManageISD,
  canViewInvestigation, canFileInvestigation, canAdvanceInvestigation, canAdjudicateInvestigation,
} from '../../js/permissions.js';
import { investigationNextStage, INVESTIGATION_DISPOSITION } from '../../js/constants.js';
import { rankUp, rankDown, clearanceForRank, clearanceWeight, tallyVotes, RANKS, caseTakesVote, strikeActive } from '../../js/constants.js';

const deny = (msg) => ({ ok: false, status: 403, error: msg || 'Not permitted.' });
const ok = (action, detail) => ({ ok: true, action, detail });

const len = (a) => (Array.isArray(a) ? a.length : 0);
const j = (v) => JSON.stringify(v ?? null);

// Fields the server owns and the client never sees or sets. Their presence in
// the stored record but absence from a client payload (credentials), or vice
// versa (redaction artifacts), must NOT register as a change — otherwise an
// ordinary promotion looks like it also rewrote other fields and gets refused.
const SERVER_OWNED = new Set([
  'salt', 'passwordHash', 'mustChangePassphrase', 'accessLevel', 'bodyWithheld',
  'compartmentName', 'compartmented', 'membersCount', 'access',
  // CAIRO's interview verdict is authored only by the dedicated /assess endpoint,
  // never through the ordinary sync path — so a client can't forge a verdict.
  'interviewAssessment',
  // Internal Security membership. redactUser omits it entirely for non-ISD
  // viewers, so it is absent from most clients' copies of a record — without
  // this, an ordinary edit by a non-ISD manager would look like it blanked the
  // field and be refused. Its own writes go through the dedicated branch below.
  'isd',
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

  // Account suspension: an administrative hold on sign-in that leaves the
  // record itself untouched. Only active \u21c4 suspended is lawful here —
  // pending accounts go through approval, and departures go through the
  // recycle bin. Never your own account, and never bundled with other edits.
  if (j(next.accountStatus) !== j(cur.accountStatus)) {
    const susp = (cur.accountStatus === 'active' && next.accountStatus === 'suspended')
      || (cur.accountStatus === 'suspended' && next.accountStatus === 'active');
    if (!susp) return deny('That account-status change is not permitted.');
    if (!canEditPersonnel(actor, cur)) return deny('You cannot administer this account.');
    if (actor.id === cur.id) return deny('You cannot suspend or reinstate your own account.');
    if (changedOutside(cur, next, ['accountStatus', 'events', 'version', 'updatedAt'])) {
      return deny('An account-status change cannot be combined with other edits.');
    }
    return next.accountStatus === 'suspended'
      ? ok('SUSPEND_ACCOUNT', `${cur.designation} suspended.`)
      : ok('REINSTATE_ACCOUNT', `${cur.designation} reinstated.`);
  }

  // Unit transfer: moving an operator to another organisation. This necessarily
  // changes org, rank (the old rank isn't on the new ladder), clearance and the
  // re-minted designation together, so it needs its own authorised path — the
  // one-step rank branch below would otherwise reject it. Authority spans two
  // chains of command, so the actor must manage BOTH the source and destination
  // organisation (in practice CL5, or Command staff who hold a stake in every
  // org). Disciplinary history, tags and awards ride along unchanged; the
  // promotion checklist resets for the new ladder.
  if (j(next.org) !== j(cur.org)) {
    if (!canManageOrg(actor, cur.org) || !canManageOrg(actor, next.org)) {
      return deny('A unit transfer requires authority over both the source and destination organisation.');
    }
    if (!(RANKS[next.org] || []).includes(next.rank)) {
      return deny('The assigned rank is not valid for the destination organisation.');
    }
    const tier = clearanceForRank(next.org, next.rank);
    if (tier && j(next.clearance) !== j(tier)) return deny('Transfer must align clearance to the new rank.');
    if (tier && !canSetClearance(actor, { ...cur, org: next.org }, tier)) return deny('That rank\u0027s clearance is above your own ceiling.');
    if (len(next.promoChecks) !== 0) return deny('A transfer must reset the promotion checklist.');
    if (changedOutside(cur, next, ['org', 'rank', 'clearance', 'designation', 'promoChecks', 'events', 'version', 'updatedAt'])) {
      return deny('A unit transfer cannot be combined with other edits.');
    }
    return ok('TRANSFER_UNIT', `${cur.designation} transferred ${cur.org} \u2192 ${next.org} as ${next.designation}.`);
  }

  if (j(next.rank) !== j(cur.rank)) {
    // A rank that isn't on the org's ladder at all is a data error (e.g. an
    // Omega "Commander" left on an Ethics file after an org change). Correcting
    // it isn't a ladder move, so the one-step rule can't apply — instead we let
    // a manager set any VALID rank for the org whose clearance sits within their
    // own ceiling. This can only make an invalid record valid; it can't be used
    // to jump a properly-ranked operator, because it requires the *current* rank
    // to be off-ladder.
    const curOnLadder = (RANKS[cur.org] || []).includes(cur.rank);
    const nextOnLadder = (RANKS[cur.org] || []).includes(next.rank);
    if (!curOnLadder && nextOnLadder) {
      if (!canSetRank(actor, cur)) return deny('You are not permitted to correct this operator\u0027s rank.');
      const tier = clearanceForRank(cur.org, next.rank);
      if (tier && j(next.clearance) !== j(tier)) return deny('Rank correction must align clearance to the corrected rank.');
      if (tier && !canSetClearance(actor, cur, tier)) return deny('That rank\u0027s clearance is above your own ceiling.');
      if (len(next.promoChecks) !== 0) return deny('A rank change must reset the promotion checklist.');
      if (changedOutside(cur, next, ['rank', 'clearance', 'promoChecks', 'events', 'version', 'updatedAt'])) {
        return deny('A rank correction cannot be combined with other edits.');
      }
      return ok('SET_RANK', `${cur.designation}: rank corrected to ${next.rank}.`);
    }
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

  if (len(next.strikes) < len(cur.strikes)) {
    if (!canIssueStrike(actor, cur)) return deny('You cannot amend this operator\u2019s disciplinary record.');
    if (changedOutside(cur, next, ['strikes', 'events', 'version', 'updatedAt'])) {
      return deny('A strike change cannot be combined with other edits.');
    }
    return ok('LIFT_STRIKE', `Strike removed for ${cur.designation}.`);
  }

  // Equal-length strike change: an in-place amendment to exactly one strike.
  // The only lawful amendments are (a) the operator filing an appeal against
  // their own strike, (b) an authority resolving that appeal, or (c) an
  // authority lifting the strike in place. Anything else — rewriting reasons,
  // doctoring appeal grounds, deleting an appeal — is refused outright, so the
  // disciplinary record is append-only in substance.
  if (j(next.strikes || []) !== j(cur.strikes || [])) {
    if (changedOutside(cur, next, ['strikes', 'events', 'version', 'updatedAt'])) {
      return deny('A strike change cannot be combined with other edits.');
    }
    const cs = cur.strikes || []; const ns = next.strikes || [];
    if (cs.length !== ns.length || cs.some((s, i) => s.id !== ns[i].id)) {
      return deny('Strike records may not be reordered.');
    }
    const changedIdx = cs.map((s, i) => (j(s) !== j(ns[i]) ? i : -1)).filter((i) => i >= 0);
    if (changedIdx.length !== 1) return deny('Amend one strike at a time.');
    const a = cs[changedIdx[0]]; const b = ns[changedIdx[0]];
    const strip = (s) => { const { appeal, lifted, ...rest } = s; return rest; };
    if (j(strip(a)) !== j(strip(b))) {
      return deny('A strike\u2019s substance cannot be rewritten \u2014 only appealed, resolved, or lifted.');
    }

    // (a) APPEAL — the struck operator, on their own record, one appeal per
    // strike, active strikes only. The appeal lands as pending; nothing else.
    if (!a.appeal && b.appeal && j(a.lifted ?? null) === j(b.lifted ?? null)) {
      if (actor.id !== cur.id) return deny('Only the operator concerned may appeal their strike.');
      if (!strikeActive(a)) return deny('Only an active strike can be appealed.');
      const ap = b.appeal;
      if (ap.status !== 'pending' || !String(ap.text || '').trim()) {
        return deny('An appeal must state its grounds and land as pending.');
      }
      if (ap.resolvedBy || ap.resolvedAt || ap.resolution) return deny('An appeal cannot arrive pre-resolved.');
      return ok('APPEAL_STRIKE', `${cur.designation} appealed a strike.`);
    }

    // (b) RESOLVE — an authority rules on a pending appeal. The grounds are
    // immutable; the issuing authority is recused from their own strike (CL5,
    // as Command, may always rule so a small site cannot deadlock).
    if (a.appeal && a.appeal.status === 'pending' && b.appeal && j(a.lifted ?? null) === j(b.lifted ?? null)) {
      if (!canIssueStrike(actor, cur)) return deny('You cannot rule on this operator\u2019s appeals.');
      if (!isCL5(actor) && a.by && actor.designation === a.by) {
        return deny('The issuing authority is recused from ruling on the appeal against their own strike.');
      }
      if (b.appeal.text !== a.appeal.text || j(b.appeal.at) !== j(a.appeal.at)) {
        return deny('The grounds of an appeal cannot be rewritten.');
      }
      if (b.appeal.status !== 'upheld' && b.appeal.status !== 'overturned') {
        return deny('An appeal is resolved as upheld or overturned.');
      }
      if (!b.appeal.resolvedBy) return deny('A resolution must be signed.');
      return ok('RESOLVE_APPEAL', `Appeal ${b.appeal.status} for ${cur.designation}.`);
    }

    // (c) LIFT IN PLACE — an authority voids the strike; it stays on the record
    // marked lifted. The appeal (if any) is untouched.
    if (!a.lifted && b.lifted && j(a.appeal ?? null) === j(b.appeal ?? null)) {
      if (!canIssueStrike(actor, cur)) return deny('You cannot amend this operator\u2019s disciplinary record.');
      if (!b.lifted.by) return deny('A lift must be signed.');
      return ok('LIFT_STRIKE', `Strike lifted for ${cur.designation}.`);
    }

    return deny('Strike records may only be appealed, resolved, or lifted.');
  }

  if (j(next.promoChecks) !== j(cur.promoChecks) &&
      !changedOutside(cur, next, ['promoChecks', 'version', 'updatedAt'])) {
    if (!canPromote(actor, cur)) return deny('You cannot update this checklist.');
    return ok('PROMO_CHECK', `Updated ${cur.designation}'s promotion checklist.`);
  }

  if (j(next.awards || []) !== j(cur.awards || []) &&
      !changedOutside(cur, next, ['awards', 'events', 'version', 'updatedAt'])) {
    if (!canEditPersonnel(actor, cur)) return deny('You cannot award or remove decorations for this record.');
    return ok('SET_AWARDS', `Updated awards on ${cur.designation}.`);
  }

  if (j(next.tags || []) !== j(cur.tags || []) &&
      !changedOutside(cur, next, ['tags', 'events', 'version', 'updatedAt'])) {
    if (!canEditPersonnel(actor, cur)) return deny('You cannot assign tags to this record.');
    return ok('SET_TAGS', `Updated tags on ${cur.designation}.`);
  }

  // The evidence-review flag: a command tool that makes an operator's evidence
  // submissions land for review instead of counting straight away. Set by a
  // manager of the operator's org (CL4·Senior with a stake, or CL5), atomically.
  if (j(next.evidenceReviewRequired ?? false) !== j(cur.evidenceReviewRequired ?? false) &&
      !changedOutside(cur, next, ['evidenceReviewRequired', 'events', 'version', 'updatedAt'])) {
    if (!canManageOrg(actor, cur.org)) return deny('You cannot change the evidence-review setting for this operator.');
    return ok('SET_EVIDENCE_REVIEW', `${cur.designation}: evidence review ${next.evidenceReviewRequired ? 'required' : 'cleared'}.`);
  }

  // Internal Security membership. `isd` is SERVER_OWNED, so changedOutside
  // already ignores it — this branch is the ONLY lawful way it moves. Induction,
  // rank and standing are ISD command's (Commissioner/Director, judged on the
  // ISD ladder — never the cover clearance) or CL5's. An agent may set only
  // their OWN badge number. The cover post (org/rank/clearance) is untouched.
  if (j(next.isd ?? null) !== j(cur.isd ?? null)
      && !changedOutside(cur, next, ['events', 'version', 'updatedAt'])) {
    const before = cur.isd ?? null;
    const after = next.isd ?? null;
    const badgeOnly = before && after
      && j({ ...before, badgeNumber: null }) === j({ ...after, badgeNumber: null });
    if (badgeOnly) {
      if (actor.id !== cur.id || !isISD(actor)) return deny('An agent records only their own badge number.');
      return ok('SET_ISD_BADGE', `${cur.designation} recorded their Internal Security badge number.`);
    }
    if (!canManageISD(actor)) return deny('Internal Security membership is set by ISD command.');
    if (after) {
      if (!(RANKS.isd || []).includes(after.rank)) return deny('That is not a valid Internal Security rank.');
      const tier = clearanceForRank('isd', after.rank);
      if (tier && after.clearance !== tier) return deny('Internal Security clearance must match the ISD rank.');
      return ok('SET_ISD_MEMBERSHIP', `${cur.designation}: Internal Security ${before ? 'record updated' : 'induction'} (${after.rank}).`);
    }
    return ok('SET_ISD_MEMBERSHIP', `${cur.designation} removed from Internal Security.`);
  }

  // Discharge is DUAL CONTROL (REC-10): the status → 'discharged' transition is
  // valid ONLY as the co-signature on a pending request filed by a DIFFERENT
  // authority — a lone signer cannot enact it, whatever the client attempts.
  // Reinstatement stays a single signed action. Junior command (CL4·J with a
  // stake) or CL5. Only status, the discharge record, the pending request, leave
  // and events may change.
  if (j(next.status) !== j(cur.status) && (next.status === 'discharged' || cur.status === 'discharged')) {
    if (!canDischarge(actor, cur)) return deny('You cannot discharge or reinstate this operator.');
    if (changedOutside(cur, next, ['status', 'discharge', 'pendingDischarge', 'leave', 'events', 'version', 'updatedAt'])) {
      return deny('A discharge cannot be combined with other edits.');
    }
    if (next.status === 'discharged') {
      const pd = cur.pendingDischarge;
      if (!pd || pd.status !== 'pending') {
        return deny('A discharge must be filed for a second signature before it can take effect.');
      }
      if (pd.requestedBy === actor.id) {
        return deny('You filed this discharge — a different authority must co-sign it.');
      }
      if (next.pendingDischarge != null) {
        return deny('Enacting a discharge must clear its pending request.');
      }
      const dc = next.discharge;
      if (!dc || (dc.type !== 'honourable' && dc.type !== 'dishonourable') || !dc.by) {
        return deny('A discharge must record its character and the filing authority.');
      }
      if (dc.type !== pd.type || String(dc.reason || '') !== String(pd.reason || '')) {
        return deny('The enacted discharge must match what was filed.');
      }
      return ok('DISCHARGE', `${cur.designation} discharged (${dc.type}) — co-signed.`);
    }
    return ok('REINSTATE', `${cur.designation} reinstated to duty.`);
  }

  // Filing or clearing a PENDING discharge (status unchanged — enactment is the
  // branch above). Filing is by a discharging authority under their own name;
  // clearing (a different authority rejects, or the filer withdraws) enacts
  // nothing. The two-person rule itself is enforced at enactment, above.
  if (j(next.status) === j(cur.status)
      && j(next.pendingDischarge ?? null) !== j(cur.pendingDischarge ?? null)) {
    const a = cur.pendingDischarge ?? null;
    const b = next.pendingDischarge ?? null;
    if ((!a || a.status !== 'pending') && b && b.status === 'pending') {
      if (!canDischarge(actor, cur)) return deny('You cannot file a discharge for this operator.');
      if (b.requestedBy !== actor.id) return deny('A discharge is filed under your own authority.');
      if (b.type !== 'honourable' && b.type !== 'dishonourable') return deny('A filed discharge must record its character.');
      if (!String(b.reason || '').trim()) return deny('A filed discharge must state its grounds.');
      if (changedOutside(cur, next, ['pendingDischarge', 'events', 'version', 'updatedAt'])) {
        return deny('Filing a discharge cannot be combined with other edits.');
      }
      return ok('REQUEST_DISCHARGE', `${cur.designation} — discharge filed for second signature.`);
    }
    if (a && a.status === 'pending' && !b) {
      if (actor.id !== a.requestedBy && !canDischarge(actor, cur)) {
        return deny('You cannot act on this pending discharge.');
      }
      if (changedOutside(cur, next, ['pendingDischarge', 'events', 'version', 'updatedAt'])) {
        return deny('Clearing a discharge cannot be combined with other edits.');
      }
      return ok('REJECT_DISCHARGE', `${cur.designation} — pending discharge cleared.`);
    }
    return deny('That pending-discharge change is not permitted.');
  }

  // Advancement review requests: the operator asks their chain to look at the
  // promotion checklist. Filing is self-only and immutable; the resolution is
  // signed. Promoting the operator closes a pending request automatically (the
  // client files that closure as its own write straight after the promotion).
  if (j(next.advancementRequest ?? null) !== j(cur.advancementRequest ?? null)) {
    const a = cur.advancementRequest ?? null; const b = next.advancementRequest ?? null;
    if ((!a || a.status !== 'pending') && b && b.status === 'pending') {
      if (actor.id !== cur.id) return deny('Only the operator concerned may request their own advancement review.');
      if (cur.accountStatus !== 'active') return deny('Only an active account may request review.');
      if (!rankUp(cur.org, cur.rank)) return deny('You already hold the top rank of your organisation.');
      if (!String(b.note || '').trim()) return deny('A review request must state its case.');
      if (b.resolvedBy || b.resolvedAt || b.resolution) return deny('A request cannot arrive pre-resolved.');
      if (changedOutside(cur, next, ['advancementRequest', 'events', 'version', 'updatedAt'])) {
        return deny('A review request cannot be combined with other edits.');
      }
      return ok('REQUEST_ADVANCEMENT', `${cur.designation} requested an advancement review.`);
    }
    if (a && a.status === 'pending' && b) {
      if (!canPromote(actor, cur)) return deny('You cannot rule on this operator\u2019s advancement.');
      if (b.note !== a.note || j(b.at) !== j(a.at)) return deny('The substance of a request cannot be rewritten.');
      if (b.status !== 'actioned' && b.status !== 'declined') return deny('A review is resolved as actioned or declined.');
      if (!b.resolvedBy) return deny('A resolution must be signed.');
      if (changedOutside(cur, next, ['advancementRequest', 'events', 'version', 'updatedAt'])) {
        return deny('A resolution cannot be combined with other edits.');
      }
      return ok('RESOLVE_ADVANCEMENT', `Advancement review ${b.status} for ${cur.designation}.`);
    }
    return deny('Advancement requests may only be filed once, and then resolved.');
  }

  // Transfer requests: the operator asks to move units. Approving means running
  // the actual transfer (its own strictly-gated write, requiring authority over
  // both organisations); the request then closes as \u201ctransferred\u201d in a
  // follow-up write. Declining needs authority over the operator's CURRENT org.
  if (j(next.transferRequest ?? null) !== j(cur.transferRequest ?? null)) {
    const a = cur.transferRequest ?? null; const b = next.transferRequest ?? null;
    if ((!a || a.status !== 'pending') && b && b.status === 'pending') {
      if (actor.id !== cur.id) return deny('Only the operator concerned may request their own transfer.');
      if (cur.accountStatus !== 'active') return deny('Only an active account may request a transfer.');
      if (!RANKS[b.toOrg] || b.toOrg === cur.org) return deny('Name a valid destination organisation other than your own.');
      if (!String(b.note || '').trim()) return deny('A transfer request must state its reason.');
      if (b.resolvedBy || b.resolvedAt || b.resolution) return deny('A request cannot arrive pre-resolved.');
      if (changedOutside(cur, next, ['transferRequest', 'events', 'version', 'updatedAt'])) {
        return deny('A transfer request cannot be combined with other edits.');
      }
      return ok('REQUEST_TRANSFER', `${cur.designation} requested transfer to ${b.toOrg}.`);
    }
    if (a && a.status === 'pending' && b) {
      if (!canManageOrg(actor, cur.org)) return deny('You cannot rule on transfers for this organisation.');
      if (b.toOrg !== a.toOrg || b.note !== a.note || j(b.at) !== j(a.at)) return deny('The substance of a request cannot be rewritten.');
      if (b.status !== 'transferred' && b.status !== 'declined') return deny('A request is resolved as transferred or declined.');
      if (!b.resolvedBy) return deny('A resolution must be signed.');
      if (changedOutside(cur, next, ['transferRequest', 'events', 'version', 'updatedAt'])) {
        return deny('A resolution cannot be combined with other edits.');
      }
      return ok('RESOLVE_TRANSFER_REQUEST', `Transfer request ${b.status} for ${cur.designation}.`);
    }
    return deny('Transfer requests may only be filed once, and then resolved.');
  }

  // Leave requests: the operator asks; an authority answers. A request lives in
  // a single slot on the record (one at a time), its substance is immutable once
  // filed, and every resolution is signed. Approval applies the leave in the
  // same write — the authority may adjust the dates, and the record shows both
  // what was asked and what was granted. This branch must run before the plain
  // leave branch below, because an approval changes both fields at once.
  if (j(next.leaveRequest ?? null) !== j(cur.leaveRequest ?? null)) {
    const a = cur.leaveRequest ?? null; const b = next.leaveRequest ?? null;

    // (a) FILE — the operator, on their own active record, when no request is
    // already pending and they are not currently on leave.
    if ((!a || a.status !== 'pending') && b && b.status === 'pending') {
      if (actor.id !== cur.id) return deny('Only the operator concerned may request their own leave.');
      if (cur.accountStatus !== 'active') return deny('Only an active account may request leave.');
      if (cur.leave) return deny('Return from your current leave before requesting another.');
      if (!b.from || !b.to || String(b.to) < String(b.from)) return deny('A leave request needs a valid date range.');
      if (!String(b.reason || '').trim()) return deny('A leave request must state its reason.');
      if (b.resolvedBy || b.resolvedAt || b.note) return deny('A request cannot arrive pre-resolved.');
      if (changedOutside(cur, next, ['leaveRequest', 'events', 'version', 'updatedAt'])) {
        return deny('A leave request cannot be combined with other edits.');
      }
      return ok('REQUEST_LEAVE', `${cur.designation} requested leave ${b.from} \u2013 ${b.to}.`);
    }

    // (b) RESOLVE — an authority approves (leave applied in the same write) or
    // declines. The request's substance is immutable; the resolution is signed.
    if (a && a.status === 'pending' && b) {
      if (!canManageLeave(actor, cur)) return deny('You cannot manage leave for this operator.');
      if (b.from !== a.from || b.to !== a.to || b.reason !== a.reason || j(b.at) !== j(a.at) || (b.type ?? null) !== (a.type ?? null)) {
        return deny('The substance of a leave request cannot be rewritten.');
      }
      if (b.status !== 'approved' && b.status !== 'declined') return deny('A request is resolved as approved or declined.');
      if (!b.resolvedBy) return deny('A resolution must be signed.');
      if (changedOutside(cur, next, ['leaveRequest', 'leave', 'status', 'events', 'version', 'updatedAt'])) {
        return deny('A resolution cannot be combined with other edits.');
      }
      if (b.status === 'approved') {
        if (!next.leave || next.status !== 'loa') return deny('An approved request must place the operator on leave.');
      } else if (j(next.leave ?? null) !== j(cur.leave ?? null) || next.status !== cur.status) {
        return deny('Declining a request must leave the record unchanged.');
      }
      return ok('RESOLVE_LEAVE_REQUEST', `Leave request ${b.status} for ${cur.designation}.`);
    }

    return deny('Leave requests may only be filed once, and then resolved.');
  }

  // Placing on / returning from leave. Junior command over a subordinate, or a
  // full manager. Only leave, the active<->on-leave status flip and events.
  if (j(next.leave ?? null) !== j(cur.leave ?? null)) {
    if (!canManageLeave(actor, cur)) return deny('You cannot manage leave for this operator.');
    if (j(next.status) !== j(cur.status) && next.status !== 'loa' && next.status !== 'active') {
      return deny('A leave change may only set the on-leave or active status.');
    }
    if (changedOutside(cur, next, ['leave', 'status', 'events', 'version', 'updatedAt'])) {
      return deny('A leave change cannot be combined with other edits.');
    }
    return ok('SET_LEAVE', `Updated leave for ${cur.designation}.`);
  }

  if (!canEditPersonnel(actor, cur)) return deny('You cannot edit this record.');
  return ok('EDIT_PERSONNEL', `Updated ${cur.designation}.`);
}

function authorizeDocument(actor, cur, next) {
  const org = (next || cur).org;
  const ref = (next || cur).ref || 'document';
  if (!canComposeDocument(actor, org)) return deny('You cannot compose documents for that organisation.');
  // The classification can never exceed the composer's own clearance.
  const cls = (next || cur).classification;
  if (cls && clearanceWeight(cls) > clearanceWeight(actor.clearance)) {
    return deny('You cannot classify a document above your own clearance.');
  }
  if (!cur) return ok('CREATE_DOCUMENT', `Drafted ${ref}.`);
  // Withdrawal / restoration of a document.
  if (!!next.deleted !== !!cur.deleted) {
    return next.deleted ? ok('REMOVE_DOCUMENT', `Withdrew ${ref}.`) : ok('RESTORE_DOCUMENT', `Restored ${ref}.`);
  }
  // An issued document is a record: its content freezes. The only further change
  // is issuing a draft, or withdrawing it (handled above). Supersede, never
  // rewrite.
  if (cur.status === 'issued') {
    if (j({ ...next, updatedAt: 0, version: 0 }) !== j({ ...cur, updatedAt: 0, version: 0 })) {
      return deny('An issued document is a record and cannot be edited. Supersede it with a new one.');
    }
    return ok('EDIT_DOCUMENT', `Touched ${ref}.`);
  }
  if (cur.status === 'draft' && next.status === 'issued') return ok('ISSUE_DOCUMENT', `Issued ${ref}.`);
  return ok('EDIT_DOCUMENT', `Updated draft ${ref}.`);
}

function authorizeDirective(actor, cur, next, ctx) {
  const org = (next || cur).org;
  const ref = (next || cur).ref || 'directive';
  // Acknowledgement: any operator cleared to read an active order may
  // countersign it — adding exactly their own entry and touching nothing else.
  // Checked before the manager gate, like the handler's report-only path.
  if (cur && j(next.acks || {}) !== j(cur.acks || {})
      && !changedOutside(cur, next, ['acks', 'version', 'updatedAt'])) {
    const before = cur.acks || {};
    const after = next.acks || {};
    const kept = Object.keys(before).every((k) => after[k] === before[k]);
    const added = Object.keys(after).filter((k) => !(k in before));
    if (!kept || added.length !== 1 || added[0] !== actor.id) return deny('You may only add your own acknowledgement.');
    if (cur.status === 'rescinded') return deny('A rescinded order cannot be acknowledged.');
    if (actor.org !== cur.org) return deny('This order is addressed to the issuing organisation\u2019s personnel.');
    if (!canReadDirective(actor, cur) || !compartmentClears(actor, cur, ctx && ctx.compMap)) return deny('You are not cleared to read this order.');
    return ok('ACK_DIRECTIVE', `${actor.designation} acknowledged ${ref}.`);
  }
  if (!canManageDirectives(actor, org)) return deny('You cannot manage directives for that organisation.');
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;
  if (!cur) return ok('CREATE_DIRECTIVE', `Issued ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) return next.deleted ? ok('REMOVE_DIRECTIVE', `Withdrew ${ref}.`) : ok('RESTORE_DIRECTIVE', `Restored ${ref}.`);
  return ok('EDIT_DIRECTIVE', `Updated ${ref}.`);
}

function authorizeSubject(actor, cur, next, ctx) {
  const ref = (next || cur).ref || 'subject';

  // A Target is a termination authorisation, and Ethics oversight is deliberately
  // cross-organisational: an Ethics Committee member may authorise or refuse a
  // Target on ANY unit's subject. So the authorisation block is checked first,
  // before the owning-org management gate.
  const authChanged = j(next && next.authorization) !== j(cur && cur.authorization);
  if (authChanged) {
    const block = compartmentWriteBlock(actor, cur, next, ctx);
    if (block) return block;
    const st = next.authorization && next.authorization.status;
    // Filing a REQUEST (status 'pending') is a surveillance manager's action —
    // this is how a non-Ethics operator (e.g. an Assistant, or a task-force
    // manager) asks the Committee to authorise a Target. DECIDING it —
    // authorising or refusing — is reserved to an Ethics Committee member.
    if (st === 'pending') {
      if (!canManageSubject(actor, next || cur)) return deny('You cannot manage this surveillance subject.');
      return ok('REQUEST_TARGET', `Target authorisation requested for ${ref}.`);
    }
    if (!canManageTribunal(actor)) return deny('Only an Ethics Committee member may authorise or refuse a Target.');
    if (st === 'authorised') return ok('AUTHORISE_TARGET', `Target ${ref} authorised for termination.`);
    if (st === 'refused') return ok('REFUSE_TARGET', `Target authorisation refused for ${ref}.`);
    return ok('EDIT_SUBJECT', `Updated ${ref}.`);
  }

  // Everything else requires management of the owning organisation.
  if (!canManageSubject(actor, next || cur)) return deny('You cannot manage this surveillance subject.');
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;

  // Becoming a Target (created as target, or a POI reclassified to target)
  // requires a completed Ethics authorisation already present on the record.
  // A surveillance manager can request it, but the write that makes something a
  // live target cannot land without Ethics sign-off — enforced here regardless
  // of what the client sends.
  const becomingTarget = (next && next.kind === 'target') && (!cur || cur.kind !== 'target');
  if (becomingTarget) {
    const a = next.authorization;
    if (!a || a.status !== 'authorised' || !a.by) {
      return deny('A Target requires authorisation by an Ethics Committee member.');
    }
  }

  if (!cur) return ok('CREATE_SUBJECT', `Opened ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) return next.deleted ? ok('REMOVE_SUBJECT', `Closed ${ref}.`) : ok('RESTORE_SUBJECT', `Reopened ${ref}.`);
  if ((next.kind === 'target') !== (cur.kind === 'target')) return ok('RECLASSIFY_SUBJECT', `${ref} reclassified.`);
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

  // Deliberative vote: a seated panel member may cast exactly their own vote on
  // a non-tribunal matter, changing nothing else. Checked before the manager
  // gate so an ordinary Committee member (not necessarily a manager) can vote on
  // a matter they are seated on. Mirrors the recruitment ballot rule.
  if (cur && j(next.votes || {}) !== j(cur.votes || {})) {
    const vb = cur.votes || {}, va = next.votes || {};
    const keys = new Set([...Object.keys(vb), ...Object.keys(va)]);
    for (const k of keys) {
      if (j(vb[k]) !== j(va[k]) && k !== actor.id) return deny('You can only cast your own vote.');
    }
    if (!caseTakesVote(cur.kind)) return deny('This matter is not decided by a vote.');
    if (!(cur.panelIds || []).includes(actor.id)) return deny('Only a seated panel member may vote on this matter.');
    if (changedOutside(cur, next, ['votes', 'entries', 'version', 'updatedAt'])) {
      return deny('A vote cannot be combined with other changes.');
    }
    return ok('VOTE_CASE', `Vote recorded on ${ref}.`);
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

function authorizeSettings(actor, cur, next) {
  if (!canManageSettings(actor)) return deny('Global settings are managed at CL5.');
  return ok('SET_SETTING', `Updated setting ${(next || cur || {}).id || ''}.`);
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
    return ok('OPEN_ACTIVITY', 'Activity record opened.');
  }
  if (!!next.deleted !== !!cur.deleted) {
    if (!isMgr) return deny('Only a manager can remove an activity record.');
    return next.deleted ? ok('REMOVE_RECORD', 'Activity record removed.') : ok('RESTORE_RECORD', 'Activity record restored.');
  }

  // A status override is a manager action, never on one's own record, and may
  // touch nothing but the override field.
  if (j(next.override) !== j(cur.override)) {
    if (isSelf) return deny('You cannot override your own activity status.');
    if (!isMgr) return deny('Only a manager may override an activity status.');
    if (changedOutside(cur, next, ['override', 'version', 'updatedAt'])) return deny('An override may only change the override.');
    return next.override
      ? ok('SET_ACTIVITY_OVERRIDE', `Activity status set to ${next.override.status}.`)
      : ok('CLEAR_ACTIVITY_OVERRIDE', 'Activity override cleared.');
  }

  // Otherwise this is a log write: self or manager, and only the log may change.
  if (changedOutside(cur, next, ['log', 'version', 'updatedAt'])) {
    return deny('An activity update cannot change other fields.');
  }
  return ok('LOG_ACTIVITY', 'Hours logged.');
}

// Recruitment. Both org pipelines are run by the unit's CL4 cadre and share the
// vote-integrity rule (a ballot write may only change the actor's own vote).
// They diverge on who advances stages: Omega-1 transitions are open to any CL4,
// while every Ethics transition — and any change while an Ethics application is
// in the interview stage — is CL5 only.
function authorizeRecruit(actor, cur, next, ctx) {
  const org = (next || cur).org;
  // Base gate, shared with the client (canActOnRecruit): the CL4 cadre (or CL5)
  // runs Omega scouting and the Ethics Assistant track, but the Ethics MEMBER
  // track is Command (CL5) only \u2014 it onboards Committee Members.
  //
  // Member-ness is judged against the STORED record (cur) as well as the incoming
  // one, so a crafted write cannot escape the gate by stripping or flipping
  // `track` on an existing Member candidate. `track` is additionally frozen from
  // cur on update (see writeRecord in index.js), so it cannot actually change.
  // See [[permissions-gate-split]].
  const memberTrack = isMemberTrack(cur) || isMemberTrack(next);
  if (memberTrack) {
    if (!isCL5(actor)) return deny('The Member track is Command (CL5) only.');
  } else if (!canActOnRecruit(actor, next || cur)) {
    return deny('Recruitment is run by the unit\u2019s CL4 cadre.');
  }
  const ref = (next || cur).ref || 'candidate';
  const isEthics = org === 'ethics-committee';

  if (!cur) return ok('OPEN_RECRUIT', `Opened candidate ${ref}.`);

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

  if (isEthics) {
    if (stageChanged) {
      if (!isCL5(actor)) return deny('Only CL5 may advance or close an application.');
      if (cur.stage === 'application' && next.stage === 'interview') {
        if (!tallyVotes(cur.votes).majorityYes) return deny('An application needs a majority Yes vote to go to interview.');
        return ok('ADVANCE_RECRUIT', `${ref} \u2192 interview.`);
      }
      if (next.stage === 'archived') {
        if (cur.stage === 'interview' && next.archiveStatus === 'approved') return ok('INDUCT_RECRUIT', `${ref} passed interview.`);
        return ok('REJECT_RECRUIT', `${ref} archived (${next.archiveStatus || 'denied'}).`);
      }
      return deny('That is not a valid stage transition.');
    }
    // Interview stage — field-aware authority. Seating interviewers and changing
    // the question set stay CL5-only; an operator CL5 has ASSIGNED to the
    // interview (or CL5) may record the candidate's responses. Each of these is
    // an atomic write (nothing else changes alongside it).
    if (cur.stage === 'interview') {
      if (j(cur.interviewers || []) !== j(next.interviewers || [])) {
        if (!isCL5(actor)) return deny('Only CL5 may assign interviewers.');
        if (changedOutside(cur, next, ['interviewers', 'version', 'updatedAt'])) {
          return deny('An interviewer change cannot be combined with other edits.');
        }
        return ok('SET_INTERVIEWERS', `Interviewers seated on ${ref}.`);
      }
      if (j(cur.interviewResponses || {}) !== j(next.interviewResponses || {})) {
        const assigned = Array.isArray(cur.interviewers) && cur.interviewers.includes(actor.id);
        if (!isCL5(actor) && !assigned) return deny('Only CL5 or an assigned interviewer may record responses.');
        if (changedOutside(cur, next, ['interviewResponses', 'version', 'updatedAt'])) {
          return deny('A response edit cannot be combined with other edits.');
        }
        return ok('EDIT_INTERVIEW_RESPONSE', `Interview response recorded for ${ref}.`);
      }
      // Anything else at interview stage — re-roll, custom questions, notes — is CL5 only.
      if (!isCL5(actor)) return deny('Only CL5 may add to an application in the interview stage.');
      if (j(cur.interviewSeed) !== j(next.interviewSeed)) return ok('EDIT_RECRUIT', `Interview question set re-rolled for ${ref}.`);
      if (j(cur.customQuestions || []) !== j(next.customQuestions || [])) {
        const grew = (next.customQuestions || []).length > (cur.customQuestions || []).length;
        return ok('EDIT_RECRUIT', grew ? `Interview question added to ${ref}.` : `Interview question removed from ${ref}.`);
      }
    }
    if (votesChanged) return ok('VOTE_RECRUIT', `Vote cast on ${ref}.`);
    return ok('EDIT_RECRUIT', `Updated candidate ${ref}.`);
  }

  // Omega-1 — any CL4 cadre advances.
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

// A cross-department barred/hostile register. An entry is raised against an
// organisation; managing it (add / edit / lift / remove) follows that org's
// management rule, so any org manager maintains their own entries and CL5
// maintains all of them. Everyone signed in can read the register.
function authorizeBlacklist(actor, cur, next) {
  const org = (next || cur).org;
  const ref = (next || cur).name || 'entry';

  // Appeals: filed by ANY signed-in operator on the barred individual's behalf
  // (they hold no account), resolved by a manager of the raising organisation.
  // Once filed, an appeal's grounds are immutable — it can only be resolved,
  // never doctored or deleted, by anyone.
  const appealChanged = cur && j(next.appeal ?? null) !== j(cur.appeal ?? null);
  if (appealChanged) {
    // (a) Filing: one pending appeal per entry, active entries only, and the
    // write may carry nothing else.
    if (!cur.appeal && next.appeal && next.appeal.status === 'pending') {
      if ((cur.status || 'active') !== 'active') return deny('Only an active blacklist entry can be appealed.');
      if (!String(next.appeal.text || '').trim()) return deny('An appeal must state its grounds.');
      if (next.appeal.filedBy !== actor.designation) return deny('An appeal is filed in your own name.');
      if (next.appeal.resolvedBy || next.appeal.resolution) return deny('An appeal cannot arrive pre-resolved.');
      if (changedOutside(cur, next, ['appeal', 'version', 'updatedAt'])) {
        return deny('An appeal cannot be combined with other changes.');
      }
      return ok('APPEAL_BLACKLIST', `Appeal filed against the blacklist entry for ${ref}.`);
    }
    // (b) Resolution: a manager rules upheld (entry stands) or overturned (the
    // entry is lifted in the same write). Grounds and filer are immutable.
    if (cur.appeal && cur.appeal.status === 'pending' && next.appeal) {
      if (!canManageOrg(actor, org)) return deny('Only a manager of the raising organisation may resolve this appeal.');
      if (next.appeal.text !== cur.appeal.text || next.appeal.filedBy !== cur.appeal.filedBy || j(next.appeal.at) !== j(cur.appeal.at)) {
        return deny('The grounds of an appeal cannot be rewritten.');
      }
      if (next.appeal.status !== 'upheld' && next.appeal.status !== 'overturned') {
        return deny('An appeal is resolved as upheld or overturned.');
      }
      if (!next.appeal.resolvedBy) return deny('A resolution must be signed.');
      if (next.appeal.status === 'overturned' && next.status !== 'lifted') {
        return deny('An overturned entry must be lifted.');
      }
      if (changedOutside(cur, next, ['appeal', 'status', 'version', 'updatedAt'])) {
        return deny('A resolution cannot be combined with other changes.');
      }
      return ok('RESOLVE_BLACKLIST_APPEAL', `Blacklist appeal ${next.appeal.status} for ${ref}.`);
    }
    return deny('Appeals may only be filed once, and then resolved \u2014 never altered or removed.');
  }

  if (!canManageOrg(actor, org)) return deny('You cannot maintain the blacklist for that organisation.');
  if (!cur) return ok('CREATE_BLACKLIST', `Blacklisted ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) return next.deleted ? ok('REMOVE_BLACKLIST', `Removed blacklist entry for ${ref}.`) : ok('RESTORE_BLACKLIST', `Restored blacklist entry for ${ref}.`);
  return ok('EDIT_BLACKLIST', `Updated blacklist entry for ${ref}.`);
}

// ISD investigations. Covert and tiered, following the Department's multi-stage
// protocol: an Investigator files a referral and records to the file; opening a
// preliminary into an ACTIVE investigation is an Inspector's call; adjudication,
// disposition and closure belong to ISD command. An Operative may read and be
// assigned but files nothing on their own authority. Stages move ONE step.
function authorizeInvestigation(actor, cur, next) {
  const rec = next || cur;
  const ref = rec.ref || 'matter';
  // Covert: to anyone outside the Department these records do not exist, so the
  // refusal must not confirm otherwise.
  if (!canViewInvestigation(actor)) return deny('No such record.');

  if (!cur) {
    if (!canFileInvestigation(actor)) return deny('An Operative may not file an investigation.');
    if (next.stage !== 'referral') return deny('A matter opens as a referral.');
    if (next.disposition) return deny('A referral cannot arrive with a disposition.');
    return ok('OPEN_INVESTIGATION', `Referral ${ref} filed.`);
  }

  if (!!next.deleted !== !!cur.deleted) {
    if (!canAdjudicateInvestigation(actor)) return deny('Only ISD command may withdraw an investigation.');
    return next.deleted ? ok('REMOVE_INVESTIGATION', `Withdrew ${ref}.`) : ok('RESTORE_INVESTIGATION', `Restored ${ref}.`);
  }

  // Append-only record: any Investigator+ may add an entry to a live matter.
  if (j(next.entries) !== j(cur.entries) && !changedOutside(cur, next, ['entries', 'version', 'updatedAt'])) {
    if (!canFileInvestigation(actor)) return deny('An Operative may not add to the investigative record.');
    if (cur.stage === 'closed') return deny('A closed matter is a record and cannot be added to.');
    if (len(next.entries) < len(cur.entries)) return deny('The investigative record is append-only.');
    return ok('LOG_INVESTIGATION', `Entry recorded in ${ref}.`);
  }

  // Stage transitions — strictly one step along the protocol.
  if (j(next.stage) !== j(cur.stage)) {
    if (next.stage !== investigationNextStage(cur.stage)) return deny('That is not a valid stage transition.');
    if (next.stage === 'active' && !canAdvanceInvestigation(actor)) {
      return deny('Opening a preliminary into an investigation is an Inspector’s call.');
    }
    if ((next.stage === 'adjudication' || next.stage === 'closed') && !canAdjudicateInvestigation(actor)) {
      return deny('Adjudication and closure belong to ISD command.');
    }
    if (next.stage === 'closed') {
      if (!next.disposition) return deny('A closed matter must record a disposition.');
      if (!INVESTIGATION_DISPOSITION[next.disposition]) return deny('Unknown disposition.');
    } else if (j(next.disposition ?? null) !== j(cur.disposition ?? null)) {
      return deny('A disposition is recorded at closure.');
    }
    return ok('ADVANCE_INVESTIGATION', `${ref} → ${next.stage}.`);
  }

  // A finding is the outcome of closing a matter, never a standalone edit — so a
  // disposition may only move as part of the closure handled above.
  if (j(next.disposition ?? null) !== j(cur.disposition ?? null)) {
    return deny('A disposition is recorded at closure.');
  }

  if (!canAdjudicateInvestigation(actor)) return deny('Only ISD command may amend an investigation.');
  return ok('EDIT_INVESTIGATION', `Updated ${ref}.`);
}

const AUTHORIZERS = {
  users: authorizeUser,
  investigations: authorizeInvestigation,
  documents: authorizeDocument,
  directives: authorizeDirective,
  subjects: authorizeSubject,
  cases: authorizeCase,
  compartments: authorizeCompartment,
  activity: authorizeActivity,
  recruits: authorizeRecruit,
  operations: authorizeOperation,
  intel: authorizeIntel,
  trainings: authorizeTraining,
  engagement: authorizeEngagement,
  evidence: authorizeEvidence,
  blacklist: authorizeBlacklist,
  promo_reqs: authorizePromoReq,
  settings: authorizeSettings,
};

// collection -> (actor, current|null, incoming, ctx) -> {ok, action, detail}
//   | {ok:false, status, error}
// `ctx` may carry { compMap, clearanceOf } for the authorizers that need to look
// beyond the single record (compartment gating, read-in floor checks).
// Operations & deployment log. Managers run the operation; an assigned operator
// (or a manager) may file a single log entry. The log-only path is checked first
// so an assigned operator can file a field report even into a compartmented op
// (assignment implies need-to-know); everything else is a manager action and is
// subject to the compartment write-block.
function authorizeOperation(actor, cur, next, ctx) {
  const org = (next || cur).org;
  const ref = (next || cur).ref || 'operation';

  if (!cur) {
    if (!canManageOrg(actor, org)) return deny('You cannot open operations for that organisation.');
    const block = compartmentWriteBlock(actor, null, next, ctx);
    if (block) return block;
    return ok('CREATE_OPERATION', `Opened operation ${ref}.`);
  }

  if (!!next.deleted !== !!cur.deleted) {
    if (!canManageOrg(actor, org)) return deny('Only a manager can remove an operation.');
    const block = compartmentWriteBlock(actor, cur, next, ctx);
    if (block) return block;
    return next.deleted ? ok('REMOVE_OPERATION', `Removed operation ${ref}.`) : ok('RESTORE_OPERATION', `Restored operation ${ref}.`);
  }

  // Log-only: an assigned operator or a manager may append an entry, and nothing
  // but the log may change.
  if (j(next.log) !== j(cur.log) && !changedOutside(cur, next, ['log', 'version', 'updatedAt'])) {
    if (!canLogToOperation(actor, cur)) return deny('You are not assigned to this operation.');
    return ok('LOG_OPERATION', `Entry logged to ${ref}.`);
  }

  // Everything else is a manager action.
  if (!canManageOrg(actor, org)) return deny('You cannot manage this operation.');
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;
  if (j(next.status) !== j(cur.status)) {
    if (next.status === 'active') return ok('ACTIVATE_OPERATION', `Operation ${ref} activated.`);
    if (next.status === 'concluded') return ok('CONCLUDE_OPERATION', `Operation ${ref} concluded.`);
    if (next.status === 'aborted') return ok('ABORT_OPERATION', `Operation ${ref} aborted.`);
  }
  return ok('EDIT_OPERATION', `Updated operation ${ref}.`);
}

// Intelligence sources & informants. Mirrors operations: a manager opens, tasks
// and closes a source; a handler (or a manager) may file a report. The
// report-only path is checked first so a handler can file into a compartmented
// source (running it implies need-to-know); every other change is a manager
// action and is blocked when the actor is not read into the compartment.
function authorizeIntel(actor, cur, next, ctx) {
  const org = (next || cur).org;
  const ref = (next || cur).ref || 'source';

  if (!cur) {
    if (!canManageOrg(actor, org)) return deny('You cannot open intelligence sources for that organisation.');
    const block = compartmentWriteBlock(actor, null, next, ctx);
    if (block) return block;
    return ok('CREATE_INTEL', `Opened source ${ref}.`);
  }

  if (!!next.deleted !== !!cur.deleted) {
    if (!canManageOrg(actor, org)) return deny('Only a manager can remove a source.');
    const block = compartmentWriteBlock(actor, cur, next, ctx);
    if (block) return block;
    return next.deleted ? ok('REMOVE_INTEL', `Removed source ${ref}.`) : ok('RESTORE_INTEL', `Restored source ${ref}.`);
  }

  // Report-only: a handler or a manager may append a report, and nothing else.
  if (j(next.reports) !== j(cur.reports) && !changedOutside(cur, next, ['reports', 'version', 'updatedAt'])) {
    if (!canLogIntel(actor, cur)) return deny('You are not the handler of this source.');
    return ok('LOG_INTEL', `Report filed to ${ref}.`);
  }

  // Everything else is a manager action.
  if (!canManageOrg(actor, org)) return deny('You cannot manage this source.');
  const block = compartmentWriteBlock(actor, cur, next, ctx);
  if (block) return block;
  if (j(next.status) !== j(cur.status)) {
    if (next.status === 'burned') return ok('BURN_INTEL', `Source ${ref} marked burned.`);
    if (next.status === 'closed') return ok('CLOSE_INTEL', `Source ${ref} closed.`);
    if (next.status === 'active') return ok('ACTIVATE_INTEL', `Source ${ref} activated.`);
  }
  return ok('EDIT_INTEL', `Updated source ${ref}.`);
}

// Trainings catalogue. Straightforwardly org-scoped: a unit's managers define,
// amend, retire and restore courses; nobody else writes. Completions are held
// on personnel files and are authorised by the personnel gate, not here.
function authorizeTraining(actor, cur, next) {
  const org = (next || cur).org;
  const ref = (next || cur).ref || (next || cur).code || 'course';
  if (!canManageTraining(actor, org)) return deny('You cannot manage the training catalogue for that organisation.');
  if (!cur) return ok('CREATE_TRAINING', `Added course ${ref}.`);
  if (!!next.deleted !== !!cur.deleted) {
    return next.deleted ? ok('REMOVE_TRAINING', `Retired course ${ref}.`) : ok('RESTORE_TRAINING', `Restored course ${ref}.`);
  }
  return ok('EDIT_TRAINING', `Updated course ${ref}.`);
}

// Weekly engagement scores. A Sr CL4 command tool: only a manager of the owning
// organisation (CL4·Senior with a stake, or CL5) may enter or amend scores. The
// derived sections are recomputed on read and never stored, so nothing here can
// forge a countable metric — only the manual scores and quality overrides move.
function authorizeEngagement(actor, cur, next) {
  const org = (next || cur).org || 'omega-1';
  const who = (next || cur).userId || 'operator';
  // ISD scoring answers to ISD command, judged on the ISD ladder — a Commissioner
  // may hold a CL3 cover post, so canManageOrg would wrongly lock them out.
  const allowed = org === 'isd' ? canManageISD(actor) : canManageOrg(actor, org);
  if (!allowed) return deny('Engagement scoring is maintained by senior command.');
  if (!cur) return ok('CREATE_ENGAGEMENT', `Engagement scored for ${who}.`);
  if (!!next.deleted !== !!cur.deleted) {
    return next.deleted ? ok('REMOVE_ENGAGEMENT', `Removed an engagement score.`) : ok('RESTORE_ENGAGEMENT', `Restored an engagement score.`);
  }
  return ok('EDIT_ENGAGEMENT', `Engagement re-scored for ${who}.`);
}

// Evidence submissions. An operator files their OWN evidence; a manager of the
// owning org (CL4·Senior with a stake, or CL5) may file for anyone and is the
// only one who can change a submission's status (count / reject). A submitter may
// withdraw their own item; a manager may withdraw any. The status a self-file
// lands with is enforced server-side from the operator's review flag (see
// writeRecord) — never trusted from the client, so nobody self-approves.
function authorizeEvidence(actor, cur, next) {
  const org = (next || cur).org || 'omega-1';
  const rec = next || cur;
  const isSelf = rec.userId === actor.id;
  const isMgr = canManageOrg(actor, org);
  if (!isSelf && !isMgr) return deny('You can only submit your own evidence.');

  if (!cur) {
    if (isSelf && !isMgr && next.submittedBy !== actor.designation) return deny('Evidence must be filed in your own name.');
    return ok('SUBMIT_EVIDENCE', `Evidence filed for ${rec.userId}.`);
  }

  if (!!next.deleted !== !!cur.deleted) {
    return next.deleted ? ok('REMOVE_EVIDENCE', 'Evidence withdrawn.') : ok('RESTORE_EVIDENCE', 'Evidence restored.');
  }

  // Accept / reject / re-open is a reviewer action; nothing else may change with it.
  if (j(next.status) !== j(cur.status)) {
    if (!isMgr) return deny('Only a reviewer may accept or reject evidence.');
    if (!['counted', 'pending', 'rejected'].includes(next.status)) return deny('Unknown evidence status.');
    if (changedOutside(cur, next, ['status', 'reviewedBy', 'reviewedAt', 'version', 'updatedAt'])) {
      return deny('A review decision cannot be combined with other edits.');
    }
    return ok('REVIEW_EVIDENCE', `Evidence ${next.status}.`);
  }

  // Otherwise an edit to the item's own content by the submitter or a manager.
  return ok('EDIT_EVIDENCE', 'Evidence updated.');
}

export function authorizeWrite(collection, actor, cur, next, ctx) {
  const fn = AUTHORIZERS[collection];
  if (!fn) return { ok: false, status: 404, error: 'Unknown collection.' };
  if (!actor) return { ok: false, status: 401, error: 'Not authenticated.' };
  return fn(actor, cur, next, ctx);
}
