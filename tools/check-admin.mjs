// =============================================================================
// check-admin.mjs — Administrator (staff) moderation grant.
//   node tools/check-admin.mjs
//
// Command classes an operator as staff. The grant buys exactly two things: read
// access to every record (so nothing hides from the people policing it) and the
// power to remove or restore ANY post. It buys none of Command's other
// authority — an Administrator is a moderator, not a CL5.
// =============================================================================

import assert from 'node:assert';
import {
  isAdmin, isCL5, canModerate, adminSees,
  canSetClearance, canApproveRegistrations, canEditPersonnel, canPromote,
  canViewCase, canViewSubject, canSeeDirective, accessLevel, canManageISD,
} from '../js/permissions.js';
import { authorizeWrite } from '../worker/src/gate.js';
import { redactUser } from '../worker/src/redact.js';

const ctx = { compMap: new Map() };
const w = (actor, cur, next) => authorizeWrite('users', actor, cur, next, ctx);

const grant = { standing: 'active', grantedBy: 'CMD-1', grantedAt: 't' };
const staff  = { id: 's1', designation: 'O1-5', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3', admin: grant };
const plain  = { id: 'p1', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3' };
const cl5    = { id: 'd1', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };

// --- What the grant IS -------------------------------------------------------
assert.equal(isAdmin(staff), true);
assert.equal(isAdmin(plain), false);
assert.equal(isAdmin({ ...staff, admin: { standing: 'revoked' } }), false, 'a revoked grant is not a grant');
assert.equal(isCL5(staff), false, 'an Administrator is NOT CL5 — every CL5-only gate still sees a CL3');
assert.equal(canModerate(staff), true);
assert.equal(adminSees(staff), true);

// --- What it grants: read-through -------------------------------------------
const secretCase = { id: 'c1', ref: 'EC-CASE-1', clearance: 'CL5', title: 'Sealed' };
const secretSubj = { id: 'x1', ref: 'TGT-1', kind: 'target', clearance: 'CL5', org: 'omega-1' };
const otherOrder = { id: 'd9', ref: 'EC-DIR-9', org: 'ethics-committee', clearance: 'CL5', audience: [] };
assert.equal(canViewCase(staff, secretCase), true, 'staff read a case far above their clearance');
assert.equal(canViewCase(plain, secretCase), false, 'a plain CL3 does not');
assert.equal(canViewSubject(staff, secretSubj), true, 'staff read a sealed Target');
assert.equal(canViewSubject(plain, secretSubj), false);
assert.equal(canSeeDirective(staff, otherOrder), true, 'staff see an order addressed elsewhere');
assert.equal(canSeeDirective(plain, otherOrder), false);
assert.equal(accessLevel(staff, cl5), 'full', 'staff read a full dossier');

// --- What it does NOT grant: Command authority -------------------------------
assert.equal(canApproveRegistrations(staff), false, 'staff cannot approve access requests');
assert.equal(canSetClearance(staff, plain, 'CL4-J'), false, 'staff cannot grant clearances');
assert.equal(canPromote(staff, plain), false, 'staff cannot promote');
assert.equal(canEditPersonnel(staff, plain), false, 'staff cannot edit personnel records');
assert.equal(canManageISD(staff), false, 'staff do not run Internal Security');

// --- The moderation power: remove/restore ANY post ---------------------------
// A case owned by Ethics, which this Omega CL3 could never ordinarily touch.
const kase = { id: 'c2', ref: 'EC-CASE-2', clearance: 'CL3', status: 'open', title: 'Matter',
  panelIds: [], votes: {}, entries: [], exhibits: [], ruling: null, version: 1, deleted: false };
const removed = { ...kase, deleted: true, deletedAt: 't', version: 2 };
assert.equal(authorizeWrite('cases', staff, kase, removed, ctx).action, 'MODERATE_REMOVE', 'staff remove any post');
assert.equal(authorizeWrite('cases', staff, removed, { ...kase, version: 3 }, ctx).action, 'MODERATE_RESTORE', 'and restore it');
assert.equal(authorizeWrite('cases', plain, kase, removed, ctx).ok, false, 'a plain operator cannot');

// Narrow by construction: the write must be nothing BUT the delete flag.
const removedAndEdited = { ...removed, title: 'Rewritten' };
assert.equal(authorizeWrite('cases', staff, kase, removedAndEdited, ctx).ok, false,
  'moderation cannot be used to edit a record while removing it');

// It reaches every collection, not a hand-picked few.
for (const coll of ['subjects', 'directives', 'operations', 'intel', 'documents', 'recruits', 'blacklist']) {
  const rec = { id: 'r1', ref: 'R-1', org: 'ethics-committee', clearance: 'CL5', version: 1, deleted: false };
  const gone = { ...rec, deleted: true, deletedAt: 't', version: 2 };
  assert.equal(authorizeWrite(coll, staff, rec, gone, ctx).action, 'MODERATE_REMOVE', `staff moderate ${coll}`);
}

// Self-removal is still barred — the self-override block is not moderation.
const selfGone = { ...staff, accountStatus: 'active', version: 2, deleted: true, deletedAt: 't' };
assert.equal(w(staff, { ...staff, accountStatus: 'active', version: 1, deleted: false }, selfGone).ok, false,
  'an Administrator cannot remove their own record');

// --- Granting the grant is CL5's alone ---------------------------------------
const before = { ...plain, accountStatus: 'active', version: 1, deleted: false };
const after = { ...before, admin: grant, version: 2 };
assert.equal(w(cl5, before, after).action, 'GRANT_ADMIN', 'Command classes an operator as staff');
assert.equal(w(staff, before, after).ok, false, 'an Administrator cannot mint more Administrators');
assert.equal(w({ ...plain, clearance: 'CL4-S' }, before, after).ok, false, 'nor can a CL4-S manager');
assert.equal(w(cl5, after, { ...before, version: 3 }).action, 'REVOKE_ADMIN', 'and can revoke it');

// Self-grant is barred both ways.
const cl5Self = { ...cl5, accountStatus: 'active', version: 1, deleted: false };
assert.equal(w(cl5, cl5Self, { ...cl5Self, admin: grant, version: 2 }).ok, false,
  'nobody grants themselves Administrator access');

// The grant must be isolated, and can only ever be 'active'.
assert.equal(w(cl5, before, { ...after, clearance: 'CL5' }).action !== 'GRANT_ADMIN', true,
  'a grant cannot ride along with a clearance change');
assert.equal(w(cl5, before, { ...before, admin: { standing: 'sneaky' }, version: 2 }).ok, false,
  'an Administrator grant is active or absent');

// --- Accountability: who holds it is open ------------------------------------
assert.deepEqual(redactUser(plain, staff).admin, grant, 'anyone can see who holds moderation');

console.log('OK — Administrator: read-through, remove/restore anywhere, no Command authority, CL5-only grant.');
