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
// Internal Security membership is an orthogonal caveat, NOT an org: an agent's
// `org` stays their cover post, and `isd` carries the covert identity. Anything
// that reads this is, by construction, only ever handed the field by redactUser
// when the viewer is ISD or CL5 — so a non-ISD client literally cannot see it.
export function isISD(actor) {
  return !!(actor && actor.isd && actor.isd.standing === 'active');
}

// ISD authority is judged on the agent's ISD clearance, NEVER their cover one —
// an Inspector may be a CL3 Private on paper. Commissioner/Director sit at CL4·S
// on the ISD ladder and run the department; CL5 always overrides. There is no
// CL5 inside the ISD, so it can never outrank the Committee it answers to.
export function isdWeight(actor) {
  return isISD(actor) ? clearanceWeight(actor.isd.clearance) : 0;
}
export function canManageISD(actor) {
  return isCL5(actor) || isdWeight(actor) >= 5;
}

// Is the agent at least `rank` on the ISD ladder? Needed because two ranks share
// a clearance (Operative/Investigator are both CL3), so clearance alone cannot
// express "Investigator and above". Ranks are ordered high->low, so a LOWER
// index is more senior. CL5 clears every tier.
export function isdAtLeast(actor, rank) {
  if (isCL5(actor)) return true;
  if (!isISD(actor)) return false;
  const mine = rankIndex('isd', actor.isd.rank);
  const need = rankIndex('isd', rank);
  return mine >= 0 && need >= 0 && mine <= need;
}

// --- ISD investigations ------------------------------------------------------
// Reading is for the Department (or CL5) — nobody else knows these exist.
// Filing and adding entries starts at Investigator; an Operative may read and be
// assigned but files nothing on their own authority. Opening a preliminary into
// an ACTIVE investigation is an Inspector's call; adjudication, disposition and
// closure belong to ISD command.
export function canViewInvestigation(actor) {
  return isCL5(actor) || isISD(actor);
}
export function canFileInvestigation(actor) {
  return isdAtLeast(actor, 'Investigator');
}
export function canAdvanceInvestigation(actor) {
  return isdAtLeast(actor, 'Inspector');
}
export function canAdjudicateInvestigation(actor) {
  return canManageISD(actor);
}

// ISD induction assessments. Covert like everything else in the Department.
// A recruiter (Investigator and above) files and scores an induction; the final
// outcome — and reading a passing candidate in — is ISD command's.
export function canViewInduction(actor) {
  return isCL5(actor) || isISD(actor);
}
export function canFileInduction(actor) {
  return isdAtLeast(actor, 'Investigator');
}

function hasStakeIn(actor, org) {
  if (org === 'isd') return isISD(actor); // Command does NOT get a free ISD stake
  return actor.org === org || actor.org === 'command';
}

// CL4·Senior (weight 5) is the floor for managing personnel records.
export function canManageOrg(actor, org) {
  if (!actor) return false;
  if (isCL5(actor)) return true; // CL5 (Command tier) manages every organisation
  return w(actor) >= 5 && hasStakeIn(actor, org);
}

// A delegated "junior command" authority: a CL4·Junior (weight 4) with a stake
// in the target's organisation, acting on someone STRICTLY junior to them in
// clearance. CL5 may always act. Used for discharge and leave — lighter-weight
// personnel actions that junior command should be trusted with, but only over
// their own subordinates.
export function canJuniorActOn(actor, target) {
  if (!actor || !target) return false;
  if (isCL5(actor)) return true;
  if (actor.id === target.id) return false;
  return w(actor) >= 4 && hasStakeIn(actor, target.org) && w(target) < w(actor);
}

// Discharge (honourable or dishonourable) and reinstatement. Junior command may
// discharge a subordinate; CL5 may discharge anyone. (Managers — CL4·S+ — also
// qualify, as they satisfy the junior rule against anyone below them and CL5
// covers the rest.)
export function canDischarge(actor, target) {
  return canJuniorActOn(actor, target);
}

// Placing on / returning from leave. Full personnel managers as before, plus
// junior command over their subordinates.
export function canManageLeave(actor, target) {
  return canEditPersonnel(actor, target) || canJuniorActOn(actor, target);
}

// Which organisations an actor may open/maintain surveillance subjects for.
// Lowered to CL4·Junior with a stake so junior command can open Persons of
// Interest (and initiate Targets — which still require Ethics authorisation to
// go live, enforced separately).
export function canManageSubjectsIn(actor, org) {
  if (!actor) return false;
  if (isCL5(actor)) return true;
  return w(actor) >= 4 && hasStakeIn(actor, org);
}

export function canEditPersonnel(actor, target) {
  if (!actor || !target) return false;
  if (isCL5(actor)) return true; // CL5 (Command tier) has cross-organisation personnel authority
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
  if (isCL5(actor)) return true; // CL5 has cross-organisation authority
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
// Global settings (e.g. activity requirements) are managed at CL5.
export function canManageSettings(actor) {
  return isCL5(actor);
}

export function canIssueStrike(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;
  if (isCL5(actor)) return true; // CL5 has cross-organisation disciplinary authority
  return canManageOrg(actor, target?.org);
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

// --- Custom documents --------------------------------------------------------
// Any operator may compose a document for their own organisation; managers (and
// CL5, who manage every org) may compose for any org they hold. The stamped
// classification can never exceed the composer's own clearance.
export function canComposeDocument(actor, org) {
  if (!actor) return false;
  return canManageOrg(actor, org) || actor.org === org;
}
// A document is visible to those cleared to its classification who sit in its
// issuing org (or manage it). Drafts are visible only to the author and to
// managers of the issuing org — an unpublished document is not yet a record.
export function canViewDocument(actor, doc) {
  if (!actor || !doc) return false;
  if (w(actor) < clearanceWeight(doc.classification)) return false;
  const inScope = actor.org === doc.org || canManageOrg(actor, doc.org);
  if (!inScope) return false;
  if (doc.status === 'draft') return doc.createdBy === actor.id || canManageOrg(actor, doc.org);
  return true;
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
  // Internal Security is internal-affairs, not operations: an agent is walled off
  // from termination Targets — those are an Ethics/Omega operational matter, and
  // the Department has no business knowing who is marked. CL5 oversight is exempt.
  // (This applies to the whole person, so it also holds for their cover post.)
  if (subject.kind === 'target' && !isCL5(actor) && isISD(actor)) return false;
  return w(actor) >= clearanceWeight(subject.clearance);
}

// Managing a subject (create / edit / log / close / remove) follows the same
// rule as managing personnel: CL4·Senior or above with a stake in the org.
export function canManageSubject(actor, subject) {
  return canManageSubjectsIn(actor, subject?.org);
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

// --- Operational activity & requirements ------------------------------------
// Activity is operational-unit information: visible within the owning org, to
// Command, to CL5, and to the operator themselves. Logging hours is self-service
// (an operator logs their own sessions regardless of clearance); logging on
// another operator's behalf, or overriding a derived status, needs the
// org-management right — and a manager may never override their OWN status.
export function canManageActivity(actor, org) {
  return canManageOrg(actor, org);
}
export function canLogActivity(actor, record) {
  if (!actor || !record) return false;
  return record.userId === actor.id || canManageOrg(actor, record.org);
}
export function canOverrideActivity(actor, record) {
  if (!actor || !record) return false;
  if (record.userId === actor.id) return false; // no self-override
  return canManageOrg(actor, record.org);
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
// A candidate's track. The Ethics 'member' track onboards Committee Members and
// is CL5-only — visible to, and actionable by, Command / CL5 alone. Every other
// track (Omega scouting, Ethics 'assistant') is run by the unit's CL4 cadre.
export function isMemberTrack(record) {
  return !!record && record.track === 'member';
}
export function canViewRecruitment(actor, record) {
  if (!actor || !record) return false;
  if (isMemberTrack(record)) return isCL5(actor); // Member track: CL5 only
  if (isCL5(actor)) return true;
  return canParticipateRecruitment(actor, record.org);
}
// Whether this actor may ACT on a candidate — open it, comment, vote, advance,
// run the interview, archive, induct. The Member track is CL5-only; other tracks
// are the CL4 cadre (or CL5). The client and the Worker share this so the buttons
// and the writes never disagree. See [[permissions-gate-split]].
export function canActOnRecruit(actor, record) {
  if (!actor || !record) return false;
  if (isMemberTrack(record)) return isCL5(actor);
  return isCL5(actor) || canParticipateRecruitment(actor, record.org);
}
// Whether this actor can be the one to open a candidate's personnel file on a
// tryout approval (creating personnel needs the org-management right).
export function canInductRecruit(actor, record) {
  return canManageOrg(actor, record?.org);
}

// --- Operations & deployment log --------------------------------------------
// An operation is clearance-gated like a surveillance subject and may carry a
// Need-To-Know caveat. An operator ASSIGNED to it (lead or participant) can
// always see it and file log entries, even without the management right; running
// the operation (status, outcome, assignments, classification) is a manager task.
export function isAssignedToOperation(actor, op) {
  if (!actor || !op) return false;
  if (op.lead === actor.id) return true;
  return Array.isArray(op.participants) && op.participants.includes(actor.id);
}
export function canViewOperation(actor, op) {
  if (!actor || !op) return false;
  if (isCL5(actor)) return true;
  if (isAssignedToOperation(actor, op)) return true;
  // Org-scoped: only operators with a stake in the owning unit (or Command) see
  // its operations, and then only at or above the operation's clearance.
  const stake = actor.org === op.org || actor.org === 'command';
  return stake && w(actor) >= clearanceWeight(op.clearance);
}
export function canManageOperation(actor, op) {
  return canManageOrg(actor, op?.org);
}
export function canLogToOperation(actor, op) {
  if (!actor || !op) return false;
  return canManageOrg(actor, op.org) || isAssignedToOperation(actor, op);
}

// --- Intelligence sources & informants --------------------------------------
// The handler runs the source; assignment implies need-to-know. Otherwise, only
// operators with a stake in the owning unit (or Command) see a source, and then
// only at or above its classification. Managers open, task and close sources; a
// handler (or a manager) may file a report.
export function isAssignedToIntel(actor, src) {
  if (!actor || !src) return false;
  return src.handler === actor.id;
}
export function canViewIntel(actor, src) {
  if (!actor || !src) return false;
  if (isCL5(actor)) return true;
  if (isAssignedToIntel(actor, src)) return true;
  const stake = actor.org === src.org || actor.org === 'command';
  return stake && w(actor) >= clearanceWeight(src.clearance);
}
export function canManageIntel(actor, src) {
  return canManageOrg(actor, src?.org);
}
export function canLogIntel(actor, src) {
  if (!actor || !src) return false;
  return canManageOrg(actor, src.org) || isAssignedToIntel(actor, src);
}

// --- Trainings (course catalogue) -------------------------------------------
// Courses are org-scoped like directives: a unit's managers define and grant
// them; anyone with a stake in the unit (or Command, or CL5) reads the
// catalogue. Granting a completion is a personnel edit, so it flows through the
// personnel gate — this is only about the catalogue itself.
export function canViewTraining(actor, course) {
  if (!actor || !course) return false;
  if (isCL5(actor)) return true;
  return actor.org === course.org || actor.org === 'command';
}
export function canManageTraining(actor, org) {
  return canManageOrg(actor, org);
}
