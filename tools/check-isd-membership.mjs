// =============================================================================
// check-isd-membership.mjs — the ISD identity/visibility split.
//   node tools/check-isd-membership.mjs
//
// Every Omega-1 operator carries an ISD front by default (identity), but a
// junior does NOT thereby gain sight of other agents' covert fronts (visibility
// stays caveat-based). A non-Omega operator can join the Department directly,
// carrying their OWN stored ISD rank and a 2-series badge; Omega fronts derive a
// 6-series badge and their rank from the cover post.
// =============================================================================

import assert from 'node:assert';
import { isISD, isdMember } from '../js/permissions.js';
import { isdRankFor, isdBadgeFor, isdClearanceFor } from '../js/constants.js';
import { authorizeWrite } from '../worker/src/gate.js';

const omegaCpt = { id: 'a', designation: 'O1-7', org: 'omega-1', rank: 'Captain', clearance: 'CL4-J' };
const omegaPvt = { id: 'b', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3' };
const native   = { id: 'n', designation: 'EC-4', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J',
  isd: { standing: 'active', rank: 'Investigator', badgeNumber: '214' } };
const plain    = { id: 'p', designation: 'EC-5', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };

// --- Identity (isdMember) is decoupled from visibility/authority (isISD) ------
assert.equal(isdMember(omegaPvt), true, 'every Omega-1 operator carries a front by default');
assert.equal(isISD(omegaPvt), false, 'but a junior Omega has identity only — no visibility caveat');
assert.equal(isdMember(native), true);
assert.equal(isISD(native), true, 'a read-in native member has both');
assert.equal(isdMember(plain), false, 'a non-Omega operator without a caveat carries no front');
assert.equal(isISD(plain), false);

// --- Badge: Omega derives a 6-series; native carries a stored 2-series ---------
assert.equal(isdBadgeFor(omegaCpt), '607', 'O1-7 -> 607');
assert.equal(isdBadgeFor(omegaPvt), '609');
assert.equal(isdBadgeFor(native), '214');
assert.equal(isdBadgeFor(plain), null, 'no front, no badge');

// --- Rank: Omega derived from cover; native is their own, stored --------------
assert.equal(isdRankFor(omegaCpt), 'Commissioner', 'Captain -> Commissioner (derived)');
assert.equal(isdRankFor(omegaPvt), 'Operative');
assert.equal(isdRankFor(native), 'Investigator', 'native rank is stored, not derived');
assert.equal(isdRankFor({ ...native, isd: { standing: 'active' } }), 'Operative', 'a native member with no rank set defaults to Operative');
assert.equal(isdClearanceFor(native), 'CL3', 'Investigator is CL3');

// --- Gate: a native ISD rank must be a real rung; Omega stored ranks are inert -
const cl5 = { id: 'd', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };
const w = (actor, cur, next) => authorizeWrite('users', actor, cur, next, {});
const nBefore = { ...plain, accountStatus: 'active', version: 1, deleted: false };
const nGood = { ...nBefore, isd: { standing: 'active', rank: 'Inspector', badgeNumber: '215' }, version: 2 };
const nBad  = { ...nBefore, isd: { standing: 'active', rank: 'Commander', badgeNumber: '216' }, version: 2 };
assert.equal(w(cl5, nBefore, nGood).action, 'SET_ISD_MEMBERSHIP', 'a valid native ISD rank is accepted');
assert.equal(w(cl5, nBefore, nBad).ok, false, 'a rank not on the ISD ladder is rejected');
const oBefore = { ...omegaPvt, accountStatus: 'active', version: 1, deleted: false };
const oNext = { ...oBefore, isd: { standing: 'active', rank: 'Director' }, version: 2 };
assert.equal(w(cl5, oBefore, oNext).action, 'SET_ISD_MEMBERSHIP', 'Omega membership write is fine; a stored rank is inert (derived wins)');

console.log('OK — ISD identity/visibility split; derived 6-series + stored 2-series badges; native ranks validated.');
