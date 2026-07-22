// =============================================================================
// check-isd.mjs — Internal Security Department: covert visibility + authority.
//   node tools/check-isd.mjs
//
// The ship-blocking invariant: a non-ISD operator's snapshot must be
// indistinguishable from one in a world where the department does not exist.
// Also proves ISD authority is judged on the ISD ladder, never the cover post.
// =============================================================================

import assert from 'node:assert';
import { isISD, isdWeight, canManageISD, accessLevel, canManageOrg, canViewSubject } from '../js/permissions.js';
import { RANKS, RANK_CLEARANCE, clearanceForRank,
  ACTIVITY_REQ_DEFAULT, activityStatus, activityRequirement } from '../js/constants.js';
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

// Reading an agent OUT (isd -> null) is the same authority as reading in.
const readOut = { ...inducted, isd: null, version: 3 };
assert.equal(usr(commissioner, inducted, readOut).action, 'SET_ISD_MEMBERSHIP', 'ISD command reads an agent out');
assert.equal(usr(omegaMgr, inducted, readOut).ok, false, 'an Omega manager cannot read an agent out');

// Rank/clearance integrity.
assert.equal(usr(commissioner, plain, { ...plain, isd: { rank: 'Overlord', clearance: 'CL4-S', standing: 'active' }, version: 2 }).ok, false, 'invalid ISD rank refused');
assert.equal(usr(commissioner, plain, { ...plain, isd: { rank: 'Operative', clearance: 'CL5', standing: 'active' }, version: 2 }).ok, false, 'ISD clearance must match the ISD rank');

// Badge: an agent records only their OWN.
const withBadge = { ...inducted, isd: { ...inducted.isd, badgeNumber: '404' }, version: 3 };
const self = { ...inducted, id: 'u9' };
assert.equal(usr(self, inducted, withBadge).action, 'SET_ISD_BADGE', 'an agent records their own badge number');
assert.equal(usr(inspector, inducted, withBadge).ok, false, 'an agent cannot set someone else\'s badge');
assert.equal(usr(commissioner, inducted, withBadge).ok, false, 'even ISD command uses the membership path, not the badge path, for others');

// --- Promotion on the ISD ladder ---------------------------------------------
// Rank moves realign the ISD clearance and reset the ISD checklist, and must
// leave the cover post completely alone.
const agent = {
  id: 'u8', designation: 'O1-8', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3',
  accountStatus: 'active', version: 1, deleted: false,
  isd: { rank: 'Operative', clearance: 'CL3', standing: 'active', badgeNumber: '9', promoChecks: ['a', 'b'] },
};
const promoted = {
  ...agent, version: 2,
  isd: { rank: 'Investigator', clearance: clearanceForRank('isd', 'Investigator'), standing: 'active', badgeNumber: '9', promoChecks: [] },
};
assert.equal(usr(commissioner, agent, promoted).action, 'SET_ISD_MEMBERSHIP', 'ISD command promotes on the ISD ladder');
assert.equal(usr(inspector, agent, promoted).ok, false, 'an Inspector cannot promote');
assert.equal(promoted.org, agent.org, 'cover org untouched');
assert.equal(promoted.rank, agent.rank, 'cover rank untouched');
assert.equal(promoted.clearance, agent.clearance, 'cover clearance untouched');

// An ISD move may NOT ride along with a cover-post rank change.
const both = { ...promoted, rank: 'Command Sergeant', clearance: 'CL3' };
assert.notEqual(usr(commissioner, agent, both).action, 'SET_ISD_MEMBERSHIP',
  'an ISD rank change cannot be combined with a cover-post rank change');

// Ticking the ISD checklist is ISD command's, and touches only isd.
const ticked = { ...agent, version: 2, isd: { ...agent.isd, promoChecks: ['a', 'b', 'c'] } };
assert.equal(usr(commissioner, agent, ticked).action, 'SET_ISD_MEMBERSHIP', 'ISD command ticks the ISD checklist');
assert.equal(usr(omegaMgr, agent, ticked).ok, false, 'an Omega manager cannot tick an ISD checklist');

// --- ISD membership grants NO cross-org reach --------------------------------
// An agent reads other departments exactly as their COVER post allows. A CL3/
// CL4-J agent therefore sees an Ethics or Omega file just as redacted as any
// other outsider — ISD is a caveat, never a skeleton key. (It is also why a
// junior agent never learns Omega-1's affiliation from the system.)
const ethicsMember = { id: 'e1', designation: 'EC-3', org: 'ethics-committee', rank: 'Member', clearance: 'CL5' };
const omegaFile = { id: 'o9', designation: 'O1-9', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3' };

assert.equal(accessLevel(inspector, ethicsMember), accessLevel(cl3, ethicsMember),
  'an ISD Inspector reads an Ethics file exactly as a plain CL3 does');
assert.equal(accessLevel(commissioner, ethicsMember), accessLevel(cl3, ethicsMember),
  'even ISD command gets no cross-org elevation from membership');
assert.equal(canManageOrg(omegaMgr, 'isd'), false, 'a CL4-S outsider gets no free stake in the ISD');
assert.equal(canManageOrg(cl5, 'isd'), true, 'CL5 manages every organisation, ISD included');
// Redaction of a third party is unchanged by the viewer's ISD membership.
assert.deepEqual(redactUser(inspector, omegaFile), redactUser({ ...inspector, isd: undefined }, omegaFile),
  'stripping ISD membership from the viewer changes nothing about what they can read');

// --- Playtime: one activity record, two chains of command --------------------
// An agent logs hours ONCE, under their cover post. Omega command judges those
// hours against Omega's threshold; the Department judges the SAME hours against
// its own. The scope is an explicit argument, so neither can be mistaken for the
// other, and the default stays the operator's own org.
const nowMs = Date.now();
const covered = { id: 'a1', org: 'omega-1', rank: 'Private', clearance: 'CL3', status: 'active',
  isd: { rank: 'Investigator', clearance: 'CL3', standing: 'active' } };
const actRec = { userId: 'a1', log: [{ id: 'l1', at: nowMs - 60000, hours: 4, by: 'O1-9' }] };

const asOmega = activityStatus(covered, actRec, ACTIVITY_REQ_DEFAULT, nowMs);
const asISD = activityStatus(covered, actRec, ACTIVITY_REQ_DEFAULT, nowMs, 'isd');
assert.equal(asOmega.req.weekly, ACTIVITY_REQ_DEFAULT.omegaWeekly, 'the cover chain uses Omega’s threshold');
assert.equal(asISD.req.weekly, ACTIVITY_REQ_DEFAULT.isdWeekly, 'the Department uses its own');
assert.equal(asOmega.weekHours, asISD.weekHours, 'one activity record, not two');
assert.equal(asOmega.key, 'semi', '4h is under Omega’s 5h');
assert.equal(asISD.key, 'active', 'but meets the Department’s 3h');
assert.deepEqual(activityRequirement(covered, ACTIVITY_REQ_DEFAULT),
  activityRequirement(covered, ACTIVITY_REQ_DEFAULT, 'omega-1'),
  'the default scope is the operator’s own org — existing callers are unaffected');
assert.equal(activityRequirement(null, ACTIVITY_REQ_DEFAULT, 'isd').exempt, true, 'no user = exempt');

// --- ISD is walled from termination Targets ----------------------------------
// Internal affairs, not operations: an agent must not see who is marked for
// termination, whatever their cover clearance. POIs and non-ISD are unaffected.
const tgt = { kind: 'target', clearance: 'CL3' };
const poiSub = { kind: 'poi', clearance: 'CL3' };
assert.equal(canViewSubject(commissioner, tgt), false, 'an ISD agent cannot see a Target');
assert.equal(canViewSubject(commissioner, poiSub), true, 'but still sees Persons of Interest');
assert.equal(canViewSubject(omegaMgr, tgt), true, 'a plain Omega manager is unaffected');
assert.equal(canViewSubject(cl5, tgt), true, 'CL5 oversight is exempt');

console.log('OK — ISD covert redaction, ISD-ladder authority, promotion, badge, induction gate, no-cross-org-reach, dual playtime thresholds and target-walling hold.');
