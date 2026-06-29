// =============================================================================
// permissions.js — The access engine.
//
// Every "can this operator do X?" decision in the system routes through here,
// so the rules live in exactly one place. Two kinds of question are answered:
//
//   1. ACTIONS  — can the actor edit / promote / approve / delete a record?
//   2. VISIBILITY — how much of a dossier may the actor see (full / partial /
//      name-only)? This drives the redaction bars in the personnel file.
//
// Guiding rules:
//   • Viewing rosters is open to any signed-in operator.
//   • Managing records requires CL4·Senior or above, AND a stake in that
//     organisation (same org, or Command which spans both).
//   • Approving registrations and changing clearance are CL5-only.
//   • No operator may raise their own clearance, strike themselves, or delete
//     their own record (the self-override block).
//   • Nobody may grant a clearance higher than their own.
// =============================================================================

import { clearanceWeight, rankIndex, rankUp, rankDown } from './constants.js';

const w = (user) => clearanceWeight(user?.clearance);

export const isCL5 = (user) => user?.clearance === 'CL5';

// Command personnel act across both operational organisations.
function hasStakeIn(actor, org) {
  return actor.org === org || actor.org === 'command';
}

// CL4·Senior (weight 5) is the floor for managing personnel records.
export function canManageOrg(actor, org) {
  if (!actor) return false;
  return w(actor) >= 5 && hasStakeIn(actor, org);
}

export function canEditPersonnel(actor, target) {
  if (!actor || !target) return false;
  return canManageOrg(actor, target.org);
}

// Promotion / demotion of clearance. CL5 only, never on yourself, never above
// your own ceiling.
export function canSetClearance(actor, target, nextClearance) {
  if (!isCL5(actor)) return false;
  if (actor.id === target.id) return false;
  return clearanceWeight(nextClearance) <= w(actor);
}

// Rank changes within an org follow the management rule (CL4·S+ with a stake).
export function canSetRank(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;
  return canManageOrg(actor, target.org);
}

// --- Promotion & demotion ---------------------------------------------------
// Distinct from canSetRank (the CL5/admin override). These model the in-org
// promotion process:
//   • CL5 may promote or demote anyone, in any organisation, by one step.
//   • Otherwise the actor must be CL4 or above (weight >= 4) AND hold a rank in
//     the SAME organisation as the target. Such an actor may only move someone
//     to a rank that stays at least one step below their own — i.e. they can
//     promote operators who are currently at least two ranks beneath them, and
//     demote operators who are currently beneath them.
// (Ranks are ordered high->low, so a LOWER index is more senior.)
export function canPromote(actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  if (!rankUp(target.org, target.rank)) return false; // already at the top, or unranked
  if (isCL5(actor)) return true;
  if (w(actor) < 4) return false;
  if (actor.org !== target.org) return false;
  const ai = rankIndex(actor.org, actor.rank);
  if (ai < 0) return false;
  return rankIndex(target.org, target.rank) >= ai + 2;
}

export function canDemote(actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  if (!rankDown(target.org, target.rank)) return false; // already at the bottom, or unranked
  if (isCL5(actor)) return true;
  if (w(actor) < 4) return false;
  if (actor.org !== target.org) return false;
  const ai = rankIndex(actor.org, actor.rank);
  if (ai < 0) return false;
  return rankIndex(target.org, target.rank) >= ai + 1;
}

// The promotion-requirements registry is CL5-editable.
export function canManagePromoReqs(actor) {
  return isCL5(actor);
}

export function canIssueStrike(actor, target) {
  if (!canManageOrg(actor, target?.org)) return false;
  return actor.id !== target.id;
}

export function canDeletePersonnel(actor, target) {
  if (!isCL5(actor)) return false;
  return actor.id !== target.id;
}

export function canApproveRegistrations(actor) {
  return isCL5(actor);
}

export function canManageDirectives(actor, org) {
  return canManageOrg(actor, org);
}

// A directive carries a minimum clearance to read its body. The directive's
// existence (reference, title, org) is open on the board; the body is gated.
// This is the single source of truth for that gate, used by the board, the
// memo detail view and the export.
export function canReadDirective(actor, directive) {
  if (!actor || !directive) return false;
  return w(actor) >= clearanceWeight(directive.clearance);
}

export function canAccessAdmin(actor) {
  return isCL5(actor);
}

export function canViewCommandRoster(actor) {
  // The Command roster (oversight tier) is visible to CL5 and Command staff.
  return isCL5(actor) || actor?.org === 'command';
}

export function canUseRecycleBin(actor) {
  return isCL5(actor);
}

// --- Visibility / redaction -------------------------------------------------
// Returns one of: 'full' | 'partial' | 'name-only'.
//   full      — identity, service record, awards, strikes, leave, notes.
//   partial   — identity + service record + awards; strikes, leave reasons and
//               notes are redacted.
//   name-only — designation, codename, org and clearance label only.
export function accessLevel(actor, target) {
  if (!actor || !target) return 'name-only';
  if (isCL5(actor)) return 'full';
  if (actor.id === target.id) return 'full';

  const sameChain = hasStakeIn(actor, target.org);
  if (sameChain && w(actor) >= clearanceWeight(target.clearance)) return 'full';

  // CL4 sees a partial file across organisations; CL3 sees name-only.
  if (w(actor) >= 4) return 'partial';
  return 'name-only';
}

export const canSeeStrikes = (actor, target) => accessLevel(actor, target) === 'full';
export const canSeeNotes = (actor, target) => accessLevel(actor, target) === 'full';
export const canSeeLeaveReason = (actor, target) => accessLevel(actor, target) === 'full';

// --- Surveillance -----------------------------------------------------------
// A subject carries a minimum clearance (its sensitivity). Visibility is a hard
// gate, not a soft redaction: below the required clearance, you get nothing.
// This is checked on direct access in the view, not just by hiding the menu.
export function canViewSubject(actor, subject) {
  if (!actor || !subject) return false;
  return w(actor) >= clearanceWeight(subject.clearance);
}

// Managing a subject (create / edit / log / close / remove) follows the same
// rule as managing personnel: CL4·Senior or above with a stake in the org.
export function canManageSubject(actor, subject) {
  return canManageOrg(actor, subject?.org);
}

// You cannot classify a subject at a sensitivity higher than your own clearance
// — you can't mark something more secret than you are cleared to see.
export function canClassifyAt(actor, clearance) {
  return clearanceWeight(clearance) <= w(actor);
}
export const canClassifySubjectAt = canClassifyAt;

// --- Ethics tribunals -------------------------------------------------------
// The Committee convenes and runs proceedings. Managing a case (create, edit,
// docket entries, summons, panel, status) follows the standard management rule
// applied to the Ethics Committee: CL4·Senior with a stake, or Command.
export function canManageTribunal(actor) {
  return canManageOrg(actor, 'ethics-committee');
}

// Entering a binding ruling is a stricter, CL5-only act (the Chairman or
// Command) — the verdict carries more weight than running the proceeding.
export function canRuleTribunal(actor) {
  return isCL5(actor);
}

// A case carries a sensitivity, gated as a hard wall like a surveillance record.
export function canViewCase(actor, record) {
  if (!actor || !record) return false;
  return w(actor) >= clearanceWeight(record.clearance);
}

// --- Need-To-Know compartments ----------------------------------------------
// Compartments are an ORTHOGONAL access control, independent of (and stacked on
// top of) the clearance ladder. An operator may hold CL5 and still not be read
// into a given compartment; a CL3 operator may be read in where their work
// requires it. A record may carry one compartment caveat — to see the
// compartmented content the actor must clear BOTH the clearance gate AND the
// compartment.
//
//   • CL5 is a universal READ override, consistent with CL5 already seeing every
//     dossier, subject, case and the audit log. It does NOT auto-administer a
//     compartment for an organisation it has no stake in.
//   • Administering a compartment (open / seal / read in / read out) follows the
//     standard management rule for the owning org (CL4·Senior with a stake, or
//     Command).

// Is this operator read into the compartment?
export function readIntoCompartment(actor, compartment) {
  if (!actor || !compartment) return false;
  if (isCL5(actor)) return true;
  return Array.isArray(compartment.members) && compartment.members.includes(actor.id);
}

// May this operator administer the compartment (edit it, seal it, change roster)?
export function canManageCompartment(actor, compartment) {
  return canManageOrg(actor, compartment?.org);
}

// May `actor` read `target` INTO `compartment`? Requires administration rights,
// the compartment to be open, and the target to meet its clearance floor (you
// cannot read in an operator who isn't even cleared to the compartment's level).
export function canReadOperatorInto(actor, compartment, target) {
  if (!canManageCompartment(actor, compartment)) return false;
  if (!target || !compartment) return false;
  if (compartment.status === 'sealed') return false;
  return clearanceWeight(target.clearance) >= clearanceWeight(compartment.clearance);
}

// Does the actor clear the Need-To-Know gate for a record bearing an optional
// `compartment` id, given a lookup of known compartments (a Map or plain
// object)? Uncompartmented records always pass. A reference to a missing or
// removed compartment fails CLOSED for everyone but CL5 — a deliberately
// over-restrictive default: never leak compartmented content on stale metadata.
export function compartmentClears(actor, record, compartmentsById) {
  const cid = record?.compartment;
  if (!cid) return true;
  if (isCL5(actor)) return true;
  let c = null;
  if (compartmentsById) {
    c = typeof compartmentsById.get === 'function' ? compartmentsById.get(cid) : compartmentsById[cid];
  }
  if (!c) return false; // dangling caveat — deny (CL5 has already passed above)
  return readIntoCompartment(actor, c);
}

// --- Operational activity & readiness ---------------------------------------
// Activity is operational-unit information: visible within the owning org, to
// Command, to CL5, and to the operator themselves. Logging is self-service (an
// operator logs their own check-ins regardless of clearance); a duty posture or
// logging on another operator's behalf needs the org-management right.
export function canManageActivity(actor, org) {
  return canManageOrg(actor, org);
}
export function canLogActivity(actor, record) {
  if (!actor || !record) return false;
  return record.userId === actor.id || canManageOrg(actor, record.org);
}
export function canViewActivity(actor, record) {
  if (!actor || !record) return false;
  if (isCL5(actor)) return true;
  if (record.userId === actor.id) return true;
  return actor.org === record.org || actor.org === 'command';
}

// --- Recruitment ------------------------------------------------------------
// The Omega-1 scouting pipeline is run by the unit's CL4 cadre: ANY CL4 with a
// stake in the organisation may open scouting targets, comment, vote and advance
// candidates (not only the senior CL4·S managers). Candidate records are
// pre-personnel and sensitive — visible to that same CL4 cadre and to CL5.
export function canParticipateRecruitment(actor, org) {
  if (!actor) return false;
  return w(actor) >= 4 && hasStakeIn(actor, org);
}
export function canViewRecruitment(actor, record) {
  if (!actor || !record) return false;
  if (isCL5(actor)) return true;
  return canParticipateRecruitment(actor, record.org);
}
// Whether this actor can be the one to open a candidate's personnel file on a
// tryout approval (creating personnel needs the org-management right).
export function canInductRecruit(actor, record) {
  return canManageOrg(actor, record?.org);
}
