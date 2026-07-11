// =============================================================================
// check-interview-assess.mjs — self-check for the CAIRO interview-assessment
// feature. No framework: run with `node`, throws on the first failed assertion.
//
//   node tools/check-interview-assess.mjs
//
// Covers the two things most likely to break silently:
//   1. Defensive parsing of the model reply (extractJson / normalizeAssessment) —
//      the model is never trusted to return clean, valid JSON.
//   2. The interview-stage write gate: assignment is CL5-only, responses need CL5
//      or an assigned interviewer, and the verdict field is server-owned.
// =============================================================================

import assert from 'node:assert';
import { extractJson, normalizeAssessment } from '../worker/src/interview-assess.js';
import { authorizeWrite } from '../worker/src/gate.js';

// --- 1. Defensive parsing ---------------------------------------------------
assert.deepEqual(extractJson('Here is the result: {"a":1} — done'), { a: 1 }, 'extract from prose');
assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 }, 'extract from code fence');
assert.deepEqual(extractJson('{"a":[1,2,],}'), { a: [1, 2] }, 'trailing commas repaired');
assert.equal(extractJson('no json here'), null, 'no braces -> null');
assert.equal(extractJson('{bad json}'), null, 'unparseable -> null');
assert.equal(extractJson(42), null, 'non-string -> null');

const ok = normalizeAssessment(
  { perQuestion: [{ id: 'q1', grade: 'strong', rationale: 'good reasoning' }], overall: { recommendation: 'recommend', summary: 'solid' } },
  ['q1'],
);
assert.equal(ok.recommendation, 'recommend');
assert.equal(ok.perQuestion.q1.grade, 'strong');

const clamped = normalizeAssessment(
  { perQuestion: [{ id: 'q1', grade: 'brilliant', rationale: 'x' }], overall: { recommendation: 'yes', summary: 's' } },
  ['q1'],
);
assert.equal(clamped.recommendation, 'reservations', 'unknown recommendation clamps');
assert.equal(clamped.perQuestion.q1.grade, 'acceptable', 'unknown grade clamps');

const dropped = normalizeAssessment(
  { perQuestion: [{ id: 'nope', grade: 'strong' }], overall: { recommendation: 'recommend', summary: 's' } },
  ['q1'],
);
assert.deepEqual(dropped.perQuestion, {}, 'unknown id dropped');
assert.equal(dropped.recommendation, 'recommend');

assert.equal(normalizeAssessment({}, ['q1']), null, 'empty -> null');
assert.equal(normalizeAssessment(null, ['q1']), null, 'null -> null');

// --- 2. Interview-stage write gate ------------------------------------------
const cl5        = { id: 'm1', designation: 'EC-3', org: 'ethics-committee', rank: 'Member',    clearance: 'CL5'   };
const assigned   = { id: 'a1', designation: 'EC-5', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };
const unassigned = { id: 'a2', designation: 'EC-7', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };
const ctx = { compMap: new Map() };
const base = { id: 'r1', ref: 'APP-EC-011', org: 'ethics-committee', stage: 'interview',
  interviewers: ['a1'], interviewResponses: {}, customQuestions: [], votes: {}, version: 1, deleted: false };
const rec = (actor, cur, next) => authorizeWrite('recruits', actor, cur, next, ctx);

// Assign interviewers — CL5 only.
assert.equal(rec(cl5, base, { ...base, interviewers: ['a1', 'a2'] }).action, 'SET_INTERVIEWERS', 'CL5 assigns');
assert.equal(rec(assigned, base, { ...base, interviewers: ['a1', 'a2'] }).ok, false, 'assigned interviewer cannot re-assign');

// Record responses — CL5 or an assigned interviewer, atomic.
const withResp = { ...base, interviewResponses: { q1: { text: 'a considered answer', by: 'EC-5', at: 't' } } };
assert.equal(rec(assigned, base, withResp).action, 'EDIT_INTERVIEW_RESPONSE', 'assigned interviewer records a response');
assert.equal(rec(cl5, base, withResp).action, 'EDIT_INTERVIEW_RESPONSE', 'CL5 records a response');
assert.equal(rec(unassigned, base, withResp).ok, false, 'non-assigned cadre cannot record responses');

// Re-roll / question-set changes stay CL5-only.
assert.equal(rec(assigned, base, { ...base, interviewSeed: 1 }).ok, false, 'assigned interviewer cannot re-roll');
assert.equal(rec(cl5, base, { ...base, interviewSeed: 1 }).ok, true, 'CL5 can re-roll');

// The verdict field is server-owned: forging it alongside a response is ignored by
// the gate (SERVER_OWNED), so the write is still just a response edit.
const forged = { ...withResp, interviewAssessment: { recommendation: 'recommend', summary: 'forged', perQuestion: {} } };
assert.equal(rec(assigned, base, forged).action, 'EDIT_INTERVIEW_RESPONSE', 'forged verdict does not break the gate');

// Regression: application-stage voting still works.
const appCur = { ...base, stage: 'application' };
assert.equal(rec(assigned, appCur, { ...appCur, votes: { a1: 'yes' } }).action, 'VOTE_RECRUIT', 'application vote intact');

console.log('OK — interview assessment parsing + interview-stage gate hold.');
