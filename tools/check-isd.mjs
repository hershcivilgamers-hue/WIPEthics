// =============================================================================
// check-isd.mjs — Internal Security Department: covert visibility + authority.
//   node tools/check-isd.mjs
//
// The ship-blocking invariant: a non-ISD operator's snapshot must be
// indistinguishable from one in a world where the department does not exist.
// Also proves ISD authority is judged on the ISD ladder, never the cover post.
// =============================================================================

import assert from 'node:assert';
import { isISD, isdRank, isdWeight, canManageISD, accessLevel, canManageOrg, canViewSubject, knowsOmegaTruth } from '../js/permissions.js';
import { ORGS, setOmegaBranding, RANKS, RANK_CLEARANCE, clearanceForRank, clearanceWeight, isdRankFor,
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
// The mask follows the post, so a member's cover rank fixes their ISD rank. A
// Captain is a Commissioner (CL4-S on the ISD ladder) while their cover post is
// only CL4-J — ISD authority still exceeds cover clearance, it is just derived.
const commissioner = {
  id: 'i1', designation: 'O1-7', org: 'omega-1', rank: 'Captain', clearance: 'CL4-J',
  isd: { standing: 'active', badgeNumber: '114' },
};
const inspector = {
  id: 'i2', designation: 'O1-8', org: 'omega-1', rank: 'Lieutenant', clearance: 'CL4-J',
  isd: { standing: 'active', badgeNumber: '221' },
};
// A CL3-covered member, for the "no cross-org reach" checks.
const operative = {
  id: 'i3', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3',
  isd: { standing: 'active', badgeNumber: '9' },
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
assert.equal(canManageISD(commissioner), true, 'a Captain derives Commissioner (CL4-S) and runs the department');
assert.equal(canManageISD(operative), false, 'a Private derives Operative — no ISD command');
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

// --- Minting: a record BORN with a front (the ISD intake path) ---------------
// Needs both halves — posting-org creation authority AND ISD command — and the
// front obeys induction integrity. Also the closed hole: an org manager cannot
// quietly embed `isd` in an ordinary personnel creation.
const covComm = { id: 'i5', designation: 'O1-2', org: 'omega-1', rank: 'Commander', clearance: 'CL4-S',
  isd: { standing: 'active' } };
const born = { id: 'nb', designation: 'O1-12', org: 'omega-1', rank: 'Private', clearance: 'CL3',
  accountStatus: 'active', version: 1, deleted: false,
  isd: { standing: 'active', badgeNumber: null, promoChecks: [] } };
assert.equal(usr(cl5, null, born).action, 'CREATE_PERSONNEL', 'CL5 mints an agent in one write');
assert.equal(usr(covComm, null, born).ok, false, 'even an ISD Commissioner cannot mint — assigning the posting clearance is CL5’s (canSetClearance)');
assert.equal(usr(commissioner, null, born).ok, false, 'ISD command on a junior cover cannot mint postings');
// The closed hole: with no clearance set, the clearance rule stays silent — the
// front check alone must still stop an org manager embedding `isd` at creation.
assert.equal(usr(omegaMgr, null, { ...born, clearance: null }).ok, false, 'an org manager cannot embed a front in an ordinary creation');

// Reading an agent OUT (isd -> null) is the same authority as reading in.
const readOut = { ...inducted, isd: null, version: 3 };
assert.equal(usr(commissioner, inducted, readOut).action, 'SET_ISD_MEMBERSHIP', 'ISD command reads an agent out');
assert.equal(usr(omegaMgr, inducted, readOut).ok, false, 'an Omega manager cannot read an agent out');

// Badge: an agent records only their OWN.
const withBadge = { ...inducted, isd: { ...inducted.isd, badgeNumber: '404' }, version: 3 };
const self = { ...inducted, id: 'u9' };
assert.equal(usr(self, inducted, withBadge).action, 'SET_ISD_BADGE', 'an agent records their own badge number');
assert.equal(usr(inspector, inducted, withBadge).ok, false, 'an agent cannot set someone else\'s badge');
assert.equal(usr(commissioner, inducted, withBadge).ok, false, 'even ISD command uses the membership path, not the badge path, for others');

// --- The masquerade: MTF Omega-1 vs the "Internal Enforcement" cover story ---
// Omega-1 is the covert unit; to CL4-J and below it is branded Internal
// Enforcement, ISD's SWAT arm. CL4-S+ and every Ethics member see the truth.
assert.equal(knowsOmegaTruth(cl5), true);
assert.equal(knowsOmegaTruth(omegaMgr), true, 'CL4-S command knows the unit’s true colours');
assert.equal(knowsOmegaTruth({ org: 'ethics-committee', clearance: 'CL4-J' }), true, 'every Ethics member knows its own instrument');
assert.equal(knowsOmegaTruth(cl3), false, 'juniors get the cover story');
assert.equal(knowsOmegaTruth(commissioner), false, 'an ISD front alone does not read you in — the posting clearance rules');
assert.equal(knowsOmegaTruth(null), false, 'the signed-out screen is junior');

setOmegaBranding(false);
assert.equal(ORGS['omega-1'].name, 'Internal Enforcement', 'junior branding renames the unit everywhere');
assert.equal(ORGS['omega-1'].short, 'IE');
setOmegaBranding(true);
assert.equal(ORGS['omega-1'].name, 'MTF Omega-1', 'the high side (server, tests, seniors) sees the truth');

// --- Sign-up ISD interest: covert flag, then normal induction ----------------
// A prospective officer flags Internal Security at registration. The flag is as
// covert as membership (CL5/ISD only) and never itself grants the caveat — that
// still runs through induction on an isolated write, flag and all.
const pendISD = { id: 'p1', designation: 'PENDING', codename: 'Aspirant', org: 'omega-1', rank: null, clearance: null,
  accountStatus: 'pending', requestedOrg: 'omega-1', requestedRank: null, requestedISD: 'Investigator', version: 1, deleted: false };

assert.ok(!('requestedISD' in redactUser(cl3, pendISD)), 'an outsider never learns of an ISD sign-up request');
assert.ok(!('requestedISD' in redactUser(omegaMgr, pendISD)), 'even an Omega manager does not');
assert.equal(redactUser(cl5, pendISD).requestedISD, 'Investigator', 'Command sees the request — and the ISD rank sought');
assert.equal(redactUser(commissioner, pendISD).requestedISD, 'Investigator', 'ISD command sees it, to induct at that rank');

// Approval activates the cover post; the flag rides along, ungranted.
const activated = { ...pendISD, accountStatus: 'active', rank: 'Private', clearance: 'CL3', designation: 'O1-11', version: 2 };
assert.equal(usr(cl5, pendISD, activated).action, 'APPROVE_REGISTRATION', 'Command approves the cover post');
assert.ok(!('isd' in activated), 'approval grants NO caveat — the account is a plain cover post');

// Induction afterwards is the usual isolated isd write; the standing flag does not trip changedOutside.
const activeFlagged = { id: 'p1', designation: 'O1-11', org: 'omega-1', rank: 'Private', clearance: 'CL3', accountStatus: 'active', requestedISD: true, version: 2, deleted: false };
const inductedFlagged = { ...activeFlagged, isd: { standing: 'active', badgeNumber: null }, version: 3 };
assert.equal(usr(commissioner, activeFlagged, inductedFlagged).action, 'SET_ISD_MEMBERSHIP', 'induction still passes with the sign-up flag present');

// --- The mask follows the post -----------------------------------------------
// Omega-1 sits inside ISD's rank structure, so an agent's ISD rank is DERIVED
// from their cover rank. There is no separate ISD ladder to climb: promotion in
// the unit IS promotion in the Department, and the two can never drift.
const maskOf = (rank) => isdRankFor({ org: 'omega-1', rank });
assert.equal(maskOf('Private'), 'Operative');
assert.equal(maskOf('Specialist'), 'Operative');
assert.equal(maskOf('Lance Corporal'), 'Operative');
assert.equal(maskOf('Corporal'), 'Investigator');
assert.equal(maskOf('Sergeant'), 'Investigator');
assert.equal(maskOf('Command Sergeant'), 'Investigator');
assert.equal(maskOf('Lieutenant'), 'Inspector');
assert.equal(maskOf('Captain'), 'Commissioner');
assert.equal(maskOf('Major'), 'Commissioner');
assert.equal(maskOf('Commander'), 'Director');
assert.equal(isdRankFor({ org: 'ethics-committee', rank: 'Member' }), null, 'only Omega-1 wears the mask');

const agent = {
  id: 'u8', designation: 'O1-8', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3',
  accountStatus: 'active', promoChecks: [], version: 1, deleted: false,
  isd: { standing: 'active', badgeNumber: '9' },
};
assert.equal(isdRank(agent), 'Investigator', 'a Sergeant presents as an Investigator');
const liftedToLt = { ...agent, rank: 'Lieutenant', clearance: 'CL4-J' };
assert.equal(isdRank(liftedToLt), 'Inspector', 'promoting the cover post promotes the mask');
assert.equal(isdWeight(liftedToLt), clearanceWeight('CL4-J'), 'and carries the mask rank’s clearance');

// The security property: a forged stored rank buys NOTHING, because nothing
// reads it — authority is recomputed from the cover post every time.
const forged = { ...agent, isd: { standing: 'active', badgeNumber: '9', rank: 'Director', clearance: 'CL4-S' } };
assert.equal(isdRank(forged), 'Investigator', 'a smuggled isd.rank is ignored');
assert.equal(canManageISD(forged), false, 'and cannot buy ISD command');

// Membership itself is still ISD command's to grant or revoke.
const readOut2 = { ...agent, isd: null, version: 2 };
assert.equal(usr(commissioner, agent, readOut2).action, 'SET_ISD_MEMBERSHIP', 'ISD command reads an agent out');
assert.equal(usr(omegaMgr, agent, readOut2).ok, false, 'an Omega manager cannot');

// --- ISD membership grants NO cross-org reach --------------------------------
// An agent reads other departments exactly as their COVER post allows. A CL3/
// CL4-J agent therefore sees an Ethics or Omega file just as redacted as any
// other outsider — ISD is a caveat, never a skeleton key. (It is also why a
// junior agent never learns Omega-1's affiliation from the system.)
const ethicsMember = { id: 'e1', designation: 'EC-3', org: 'ethics-committee', rank: 'Member', clearance: 'CL5' };
const omegaFile = { id: 'o9', designation: 'O1-9', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3' };

assert.equal(accessLevel(operative, ethicsMember), accessLevel(cl3, ethicsMember),
  'a CL3-covered agent reads an Ethics file exactly as a plain CL3 does');
assert.equal(accessLevel(commissioner, ethicsMember), accessLevel({ ...commissioner, isd: undefined }, ethicsMember),
  'ISD command gets no cross-org elevation from membership — only their cover post counts');
assert.equal(canManageOrg(omegaMgr, 'isd'), false, 'a CL4-S outsider gets no free stake in the ISD');
assert.equal(canManageOrg(cl5, 'isd'), true, 'CL5 manages every organisation, ISD included');
// Redaction of a third party is unchanged by the viewer's ISD membership.
assert.deepEqual(redactUser(operative, omegaFile), redactUser({ ...operative, isd: undefined }, omegaFile),
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

console.log('OK — ISD covert redaction, ISD-ladder authority, promotion, badge, induction gate, sign-up interest flag, no-cross-org-reach, dual playtime thresholds and target-walling hold.');
