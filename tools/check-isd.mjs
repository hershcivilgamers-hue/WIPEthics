// =============================================================================
// check-isd.mjs — Internal Security Department: covert visibility + authority.
//   node tools/check-isd.mjs
//
// The ship-blocking invariant: a non-ISD operator's snapshot must be
// indistinguishable from one in a world where the department does not exist.
// Also proves ISD authority is judged on the ISD ladder, never the cover post.
// =============================================================================

import assert from 'node:assert';
import { isISD, isdWeight, canManageISD } from '../js/permissions.js';
import { RANKS, RANK_CLEARANCE, clearanceForRank } from '../js/constants.js';
import { redactUser, buildSnapshot } from '../worker/src/redact.js';
import { authorizeWrite } from '../worker/src/gate.js';

// --- Ladder ------------------------------------------------------------------
assert.deepEqual(RANKS.isd, ['Director', 'Commissioner', 'Inspector', 'Investigator', 'Operative'],
  'ISD ladder is stored high->low');
assert.equal(clearanceForRank('isd', 'Director'), 'CL4-S');
assert.equal(clearanceForRank('isd', 'Inspector'), 'CL4-J');
assert.equal(clearanceForRank('isd', 'Operative'), 'CL3');
assert.ok(!Object.values(RANK_CLEARANCE.isd).includes('CL5'),
  'there is deliberately no CL5 in the ISD — it cannot outrank the Committee');

// --- Cast --------------------------------------------------------------------
// An ISD Commissioner whose COVER post is a lowly CL3 Omega private. Authority
// must follow the ISD ladder, not the cover clearance.
const commissioner = {
  id: 'i1', designation: 'O1-7', org: 'omega-1', rank: 'Private', clearance: 'CL3',
  isd: { rank: 'Commissioner', clearance: 'CL4-S', standing: 'active', badgeNumber: '114' },
};
const inspector = {
  id: 'i2', designation: 'O1-8', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3',
  isd: { rank: 'Inspector', clearance: 'CL4-J', standing: 'active', badgeNumber: '221' },
};
const omegaMgr = { id: 'o1', designation: 'O1-2', org: 'omega-1', rank: 'Major', clearance: 'CL4-S' };
const cl3      = { id: 'c1', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3' };
const cl5      = { id: 'd1', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };

// --- Membership + authority --------------------------------------------------
assert.equal(isISD(commissioner), true);
assert.equal(isISD(omegaMgr), false);
assert.equal(isISD({ ...inspector, isd: { ...inspector.isd, standing: 'revoked' } }), false,
  'revoked standing is not membership');

assert.equal(isdWeight(commissioner), 5, 'Commissioner weighs CL4-S on the ISD ladder');
assert.equal(isdWeight(omegaMgr), 0, 'a non-member has no ISD weight');
assert.equal(canManageISD(commissioner), true, 'ISD authority uses the ISD clearance, NOT the CL3 cover');
assert.equal(canManageISD(inspector), false, 'an Inspector (CL4-J) does not run the department');
assert.equal(canManageISD(omegaMgr), false, 'an Omega CL4-S manager has no ISD authority');
assert.equal(canManageISD(cl5), true, 'CL5 always overrides');

// --- Covert redaction: the ship-blocking invariant ---------------------------
for (const viewer of [cl3, omegaMgr]) {
  const out = redactUser(viewer, commissioner);
  assert.ok(!('isd' in out), `viewer ${viewer.designation} must not receive the isd key at all`);
  assert.equal(out.org, 'omega-1', 'the agent still appears normally under their cover post');
  assert.ok(!JSON.stringify(out).includes('114'), 'the badge number never leaks');
}
assert.ok('isd' in redactUser(commissioner, inspector), 'ISD sees ISD');
assert.ok('isd' in redactUser(cl5, commissioner), 'CL5 sees ISD');

// Whole-snapshot check: no trace of the department for an outsider.
const db = { users: [commissioner, inspector, omegaMgr, cl3], audit: [] };
const outsider = JSON.stringify(buildSnapshot(omegaMgr, db));
assert.ok(!outsider.includes('"isd"'), 'no isd key anywhere in an outsider snapshot');
assert.ok(!outsider.includes('Commissioner') && !outsider.includes('Inspector'),
  'no ISD rank names leak into an outsider snapshot');
assert.ok(JSON.stringify(buildSnapshot(commissioner, db)).includes('"isd"'), 'ISD sees it');

// --- Write gate ---------------------------------------------------------------
const usr = (actor, cur, next) => authorizeWrite('users', actor, cur, next, {});
const plain = { id: 'u9', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3', accountStatus: 'active', version: 1, deleted: false };
const inducted = { ...plain, isd: { rank: 'Operative', clearance: 'CL3', standing: 'active', badgeNumber: null }, version: 2 };

assert.equal(usr(commissioner, plain, inducted).action, 'SET_ISD_MEMBERSHIP', 'ISD command inducts');
assert.equal(usr(cl5, plain, inducted).action, 'SET_ISD_MEMBERSHIP', 'CL5 inducts');
assert.equal(usr(omegaMgr, plain, inducted).ok, false, 'an Omega manager cannot induct into the ISD');
assert.equal(usr(inspector, plain, inducted).ok, false, 'an Inspector cannot induct');

// Rank/clearance integrity.
assert.equal(usr(commissioner, plain, { ...plain, isd: { rank: 'Overlord', clearance: 'CL4-S', standing: 'active' }, version: 2 }).ok, false, 'invalid ISD rank refused');
assert.equal(usr(commissioner, plain, { ...plain, isd: { rank: 'Operative', clearance: 'CL5', standing: 'active' }, version: 2 }).ok, false, 'ISD clearance must match the ISD rank');

// Badge: an agent records only their OWN.
const withBadge = { ...inducted, isd: { ...inducted.isd, badgeNumber: '404' }, version: 3 };
const self = { ...inducted, id: 'u9' };
assert.equal(usr(self, inducted, withBadge).action, 'SET_ISD_BADGE', 'an agent records their own badge number');
assert.equal(usr(inspector, inducted, withBadge).ok, false, 'an agent cannot set someone else\'s badge');
assert.equal(usr(commissioner, inducted, withBadge).ok, false, 'even ISD command uses the membership path, not the badge path, for others');

console.log('OK — ISD covert redaction, ISD-ladder authority, badge and induction gate hold.');
