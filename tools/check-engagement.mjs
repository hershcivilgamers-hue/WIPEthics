// =============================================================================
// check-engagement.mjs — self-check for the Omega-1 engagement scoring.
//   node tools/check-engagement.mjs
//
// Covers the pure scoring math (derived scores, override/manual folding, the two
// requirement flags) and the write gate (only Sr CL4 with an Omega stake, or CL5,
// may score).
// =============================================================================

import assert from 'node:assert';
import { engagementAutoScores, engagementResolved, engagementReqs, ENGAGEMENT_TOTAL_MAX } from '../js/constants.js';
import { authorizeWrite } from '../worker/src/gate.js';

// --- Scoring math -----------------------------------------------------------
assert.equal(ENGAGEMENT_TOTAL_MAX, 70, 'total max = sum of section maxes');

const raw = { scoutingCount: 2, ordersCount: 3, poisCount: 1, trainHost: 2, trainAttend: 3, hours: 7.5, host3wk: 2 };
const auto = engagementAutoScores(raw);
assert.equal(auto.scouting, 6, '2 scoutings × 3');
assert.equal(auto.orders, 6, '3 orders × 2');
assert.equal(auto.pois, 2, '1 PoI × 2');
assert.equal(auto.trainings, 9, '2 host × 3 + 3 attend × 1');
assert.equal(auto.activity, 7, 'floor(7.5 hours)');

// Caps hold.
assert.equal(engagementAutoScores({ scoutingCount: 9 }).scouting, 10, 'scouting caps at 10');
assert.equal(engagementAutoScores({ trainHost: 9 }).trainings, 10, 'trainings caps at 10');

// Override + manual folding.
const record = { manual: { evidence: 4, squadron: 8, rp: 5 }, overrides: { scouting: 10 } };
const r = engagementResolved(raw, record);
assert.equal(r.val.scouting, 10, 'override wins over derived');
assert.equal(r.src.scouting, 'override');
assert.equal(r.val.orders, 6, 'un-overridden section stays derived');
assert.equal(r.src.orders, 'auto');
assert.equal(r.val.evidence, 4, 'manual section from record');
assert.equal(r.src.evidence, 'manual');
assert.equal(r.total, 10 + 6 + 4 + 2 + 8 + 9 + 7 + 5, 'total sums resolved values');
// Manual/override clamp to section max.
assert.equal(engagementResolved({}, { manual: { evidence: 99 }, overrides: {} }).val.evidence, 5, 'manual clamps to max');
assert.equal(engagementResolved({}, { manual: {}, overrides: { pois: 99 } }).val.pois, 10, 'override clamps to max');

// Requirements.
assert.deepEqual(engagementReqs(raw, record), { req1: true, req2: true }, 'active week meets both');
assert.deepEqual(engagementReqs({}, null), { req1: false, req2: false }, 'empty week meets neither');
assert.equal(engagementReqs({ scoutingCount: 0, ordersCount: 0, poisCount: 0 }, { manual: { evidence: 3 } }).req1, true, 'evidence alone meets req1');
assert.equal(engagementReqs({ host3wk: 1 }).req2, true, 'one host in three weeks meets req2');

// --- Write gate -------------------------------------------------------------
const srCL4  = { id: 's1', designation: 'O1-2', org: 'omega-1', rank: 'Major',   clearance: 'CL4-S' };
const jrCL4  = { id: 'j1', designation: 'O1-3', org: 'omega-1', rank: 'Lieutenant', clearance: 'CL4-J' };
const cl3    = { id: 'c1', designation: 'O1-7', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3' };
const cl5    = { id: 'd1', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };
const rec = { id: 'eng1', org: 'omega-1', userId: 'u1', manual: {}, overrides: {}, version: 1, deleted: false };
const eng = (actor, cur, next) => authorizeWrite('engagement', actor, cur, next, {});

assert.equal(eng(srCL4, null, rec).action, 'CREATE_ENGAGEMENT', 'Sr CL4 may score');
assert.equal(eng(cl5, null, rec).action, 'CREATE_ENGAGEMENT', 'CL5 may score');
assert.equal(eng(jrCL4, null, rec).ok, false, 'CL4·Junior may NOT score');
assert.equal(eng(cl3, null, rec).ok, false, 'CL3 may NOT score');
assert.equal(eng(srCL4, { ...rec }, { ...rec, version: 2 }).action, 'EDIT_ENGAGEMENT', 'Sr CL4 may re-score');

console.log('OK — engagement scoring + gate hold.');
