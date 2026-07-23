// =============================================================================
// check-engagement.mjs — self-check for the Omega-1 engagement scoring.
//   node tools/check-engagement.mjs
//
// Covers the pure scoring math (derived scores, override/manual folding, the two
// requirement flags) and the write gate (only Sr CL4 with an Omega stake, or CL5,
// may score).
// =============================================================================

import assert from 'node:assert';
import { engagementAutoScores, engagementResolved, engagementReqs, ENGAGEMENT_TOTAL_MAX,
  engagementWeekStart, engagementWeekShift, engagementSections, engagementTotalMax } from '../js/constants.js';
import { authorizeWrite } from '../worker/src/gate.js';

// --- Scoring math -----------------------------------------------------------
assert.equal(ENGAGEMENT_TOTAL_MAX, 70, 'total max = sum of section maxes');

const raw = { scoutingCount: 2, ordersCount: 3, poisCount: 1, evidenceCount: 2, trainHost: 2, trainAttend: 3, hours: 7.5, host3wk: 2 };
const auto = engagementAutoScores(raw);
assert.equal(auto.scouting, 6, '2 scoutings × 3');
assert.equal(auto.orders, 6, '3 orders × 2');
assert.equal(auto.pois, 2, '1 PoI × 2');
assert.equal(auto.evidence, 4, '2 counted evidence × 2');
assert.equal(auto.trainings, 9, '2 host × 3 + 3 attend × 1');
assert.equal(auto.activity, 7, 'floor(7.5 hours)');

// Caps hold.
assert.equal(engagementAutoScores({ scoutingCount: 9 }).scouting, 10, 'scouting caps at 10');
assert.equal(engagementAutoScores({ evidenceCount: 9 }).evidence, 5, 'evidence caps at 5');
assert.equal(engagementAutoScores({ trainHost: 9 }).trainings, 10, 'trainings caps at 10');

// Evidence is now derived; only Squadron and RP are manual. Overrides win over
// any derived section (including Evidence).
const record = { manual: { squadron: 8, rp: 5 }, overrides: { scouting: 10, evidence: 3 } };
const r = engagementResolved(raw, record);
assert.equal(r.val.scouting, 10, 'override wins over derived');
assert.equal(r.src.scouting, 'override');
assert.equal(r.val.orders, 6, 'un-overridden section stays derived');
assert.equal(r.src.orders, 'auto');
assert.equal(r.val.evidence, 3, 'evidence override wins over derived');
assert.equal(r.src.evidence, 'override');
assert.equal(r.val.squadron, 8, 'manual section from record');
assert.equal(r.src.squadron, 'manual');
assert.equal(r.total, 10 + 6 + 3 + 2 + 8 + 9 + 7 + 5, 'total sums resolved values');
// Evidence uses its derived value when not overridden.
assert.equal(engagementResolved(raw, { manual: {}, overrides: {} }).val.evidence, 4, 'evidence derived when not overridden');
// Overrides clamp to section max.
assert.equal(engagementResolved({}, { manual: {}, overrides: { pois: 99 } }).val.pois, 10, 'override clamps to max');
assert.equal(engagementResolved({}, { manual: {}, overrides: { evidence: 99 } }).val.evidence, 5, 'evidence override clamps to 5');

// Requirements (raw-only now — evidence comes from the evidence collection).
assert.deepEqual(engagementReqs(raw), { req1: true, req2: true }, 'active week meets both');
assert.deepEqual(engagementReqs({}), { req1: false, req2: false }, 'empty week meets neither');
assert.equal(engagementReqs({ evidenceCount: 1 }).req1, true, 'one counted evidence meets req1');
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

// --- Week navigation is calendar-correct (DST-safe) -------------------------
// engagementWeekStart returns a Sunday-00:00 stamp; shifting by ±1 week and back
// must round-trip to the same stamp, and each shift must land on a Sunday 00:00
// (getDay()===0, midnight) — even across a DST boundary. A fixed 7×24h step
// would drift an hour and break the round-trip, orphaning saved scores.
const w0 = engagementWeekStart(Date.UTC(2026, 2, 15, 12, 0, 0)); // mid-March, near many DST switches
for (let k = -6; k <= 6; k++) {
  const wk = engagementWeekShift(w0, k);
  const d = new Date(wk);
  assert.equal(d.getDay(), 0, `shifted week ${k} lands on a Sunday`);
  assert.equal(d.getHours(), 0, `shifted week ${k} lands at 00:00`);
}
assert.equal(engagementWeekShift(engagementWeekShift(w0, 3), -3), w0, 'shift round-trips exactly');
assert.equal(engagementWeekShift(w0, 0), w0, 'zero shift is identity');

// --- ISD engagement: a different section set on the same machinery -----------
const isdSecs = engagementSections('isd').map((s) => s.key);
assert.deepEqual(isdSecs, ['referrals', 'casework', 'dispositions', 'trainings', 'activity', 'discretion', 'conduct'],
  'the ISD scores casework, not field presence');
assert.equal(engagementTotalMax('isd'), 60, 'ISD total = 10+10+10+10+10+5+5');
assert.equal(engagementTotalMax('omega-1'), 70, 'Omega is untouched by the split');
assert.deepEqual(engagementSections(), engagementSections('omega-1'), 'the default org is Omega');
assert.deepEqual(engagementSections('nonsense'), engagementSections('omega-1'), 'an unknown org falls back to Omega');

const isdRaw = { referralsCount: 2, caseworkCount: 4, dispositionsCount: 1, trainHost: 1, trainAttend: 2, hours: 5.9, contrib3wk: 3 };
const isdAuto = engagementAutoScores(isdRaw, 'isd');
assert.equal(isdAuto.referrals, 6, '2 referrals × 3');
assert.equal(isdAuto.casework, 4, '4 entries × 1');
assert.equal(isdAuto.dispositions, 3, '1 disposition × 3');
assert.equal(isdAuto.trainings, 5, '1 host × 3 + 2 attend × 1');
assert.equal(isdAuto.activity, 5, 'floor(5.9 hours)');
assert.equal(engagementAutoScores({ referralsCount: 99 }, 'isd').referrals, 10, 'referrals cap');
assert.equal(isdAuto.scouting, undefined, 'ISD has no Omega sections');

const isdRes = engagementResolved(isdRaw, { manual: { discretion: 4, conduct: 5 }, overrides: { casework: 9 } }, 'isd');
assert.equal(isdRes.val.casework, 9, 'override wins');
assert.equal(isdRes.src.casework, 'override');
assert.equal(isdRes.val.discretion, 4, 'manual section');
assert.equal(isdRes.total, 6 + 9 + 3 + 5 + 5 + 4 + 5, 'ISD total sums its own sections');

assert.deepEqual(engagementReqs(isdRaw, 'isd'), { req1: true, req2: true }, 'an active ISD week meets both');
assert.deepEqual(engagementReqs({}, 'isd'), { req1: false, req2: false }, 'an empty ISD week meets neither');
assert.equal(engagementReqs({ caseworkCount: 1 }, 'isd').req1, true, 'one contribution meets req1');
assert.equal(engagementReqs({ contrib3wk: 1 }, 'isd').req2, true, 'a matter carried meets req2');

// Gate: ISD scoring answers to ISD command, judged on the ISD ladder — which is
// derived from the cover post, so a Captain is a Commissioner (CL4-S) while the
// cover itself is only CL4-J.
const isdCmd = { id: 'x1', designation: 'O1-7', org: 'omega-1', rank: 'Captain', clearance: 'CL4-J',
  isd: { standing: 'active' } };
const isdInspector = { id: 'x2', designation: 'O1-8', org: 'omega-1', rank: 'Lieutenant', clearance: 'CL4-J',
  isd: { standing: 'active' } };
const isdRec = { id: 'eng2', org: 'isd', userId: 'u1', manual: {}, overrides: {}, version: 1, deleted: false };
assert.equal(eng(isdCmd, null, isdRec).action, 'CREATE_ENGAGEMENT', 'ISD command scores — CL4-S on the ISD ladder, above their CL4-J cover');
assert.equal(eng(isdInspector, null, isdRec).ok, false, 'an Inspector does not score');
assert.equal(eng(srCL4, null, isdRec).ok, false, 'an Omega CL4-S cannot score ISD agents');
assert.equal(eng(cl5, null, isdRec).action, 'CREATE_ENGAGEMENT', 'CL5 always may');

console.log('OK — engagement scoring (Omega + ISD) + gate hold.');
