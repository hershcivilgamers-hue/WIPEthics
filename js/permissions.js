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

import { clearanceWeight } from './constants.js';

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
