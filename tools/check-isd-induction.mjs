// =============================================================================
// check-isd-induction.mjs — the ISD induction assessment: scoring + write gate.
//   node tools/check-isd-induction.mjs
// =============================================================================

import assert from 'node:assert';
import { scoreInduction, INDUCTION_MAX, INDUCTION_PASS_MARK, INDUCTION_QUESTIONS } from '../js/isd-induction.js';
import { authorizeWrite } from '../worker/src/gate.js';
import { buildSnapshot } from '../worker/src/redact.js';

// The recorded answers that get every point.
const KEY = {};
for (const q of INDUCTION_QUESTIONS) KEY[q.id] = q.options.filter((o) => o.correct).map((o) => o.id);

// --- Scoring -----------------------------------------------------------------
assert.equal(INDUCTION_MAX, 14, 'max = total correct options');
assert.equal(INDUCTION_PASS_MARK, 10, 'pass at 10');
assert.equal(scoreInduction(KEY).score, 14, 'the key scores full marks');
assert.equal(scoreInduction(KEY).passed, true);
assert.equal(scoreInduction({}).score, 0, 'a blank sheet scores nothing');
// A wrong pick on a multi cancels a right one, floored at 0.
assert.equal(scoreInduction({ q2: ['a', 'b', 'c', 'd'] }).perQuestion.q2.gained, 2, '3 right - 1 wrong');
assert.equal(scoreInduction({ q3: ['a', 'b'] }).perQuestion.q3.gained, 0, '1 right - 1 wrong, floored');
// Selecting everything everywhere cannot reach a pass.
const all = {};
for (const q of INDUCTION_QUESTIONS) all[q.id] = q.options.map((o) => o.id);
assert.equal(scoreInduction(all).passed, false, 'blanket-selecting everything fails');
// The single wrong answers score zero, not negative overall.
assert.equal(scoreInduction({ q1: ['a'] }).score, 0, 'a wrong single is 0, not -1');

// --- Cast --------------------------------------------------------------------
const isd = (rank, clearance, id) => ({ id, designation: `O1-${id}`, org: 'omega-1', rank: 'Sergeant', clearance: 'CL3',
  isd: { rank, clearance, standing: 'active' } });
const operative    = isd('Operative',    'CL3',   'p1');
const investigator = isd('Investigator', 'CL3',   'v1');
const commissioner = isd('Commissioner', 'CL4-S', 'c1');
const outsider = { id: 'o1', designation: 'O1-2', org: 'omega-1', rank: 'Major', clearance: 'CL4-S' };
const cl5      = { id: 'd1', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };

const ind = (actor, cur, next) => authorizeWrite('inductions', actor, cur, next, {});
const passing = { id: 'ind1', ref: 'ISD-IND-0001', org: 'isd', candidateName: 'Doe', answers: KEY, outcome: null, inductedUserId: null, version: 1, deleted: false };
const failing = { ...passing, id: 'ind2', ref: 'ISD-IND-0002', answers: { q1: ['b'] } }; // scores 1

// --- Covert ------------------------------------------------------------------
const outVerdict = ind(outsider, null, passing);
assert.equal(outVerdict.ok, false, 'an outsider cannot file');
assert.equal(outVerdict.error, 'No such record.', 'and is not told the record type exists');
const db = { users: [], inductions: [{ ...passing }], audit: [] };
assert.equal(JSON.parse(JSON.stringify(buildSnapshot(outsider, db))).inductions.length, 0, 'outsider snapshot carries none');
assert.equal(buildSnapshot(investigator, db).inductions.length, 1, 'the Department sees them');

// --- Filing / recording ------------------------------------------------------
assert.equal(ind(investigator, null, passing).action, 'OPEN_INDUCTION', 'an Investigator files');
assert.equal(ind(operative, null, passing).ok, false, 'an Operative files nothing');
assert.equal(ind(investigator, null, { ...passing, outcome: 'inducted' }).ok, false, 'no outcome on arrival');
assert.equal(ind(investigator, passing, { ...passing, answers: { ...KEY, q1: ['a'] }, version: 2 }).action, 'EDIT_INDUCTION', 'the recorder corrects answers');
assert.equal(ind(operative, passing, { ...passing, candidateName: 'x', version: 2 }).ok, false, 'an Operative cannot amend');

// --- Outcome is command's, and requires a genuine pass -----------------------
assert.equal(ind(commissioner, passing, { ...passing, outcome: 'inducted', inductedUserId: 'u9', version: 2 }).action, 'DECIDE_INDUCTION', 'command inducts a passing candidate');
assert.equal(ind(investigator, passing, { ...passing, outcome: 'inducted', version: 2 }).ok, false, 'an Investigator cannot decide the outcome');
assert.equal(ind(commissioner, failing, { ...failing, outcome: 'inducted', version: 2 }).ok, false, 'a FAILING candidate cannot be inducted');
assert.equal(ind(commissioner, failing, { ...failing, outcome: 'declined', version: 2 }).action, 'DECIDE_INDUCTION', 'but may be declined');
assert.equal(ind(commissioner, passing, { ...passing, outcome: 'promoted', version: 2 }).ok, false, 'unknown outcome refused');
// Forging the pass by sending a passed flag is impossible: the score is re-derived.
assert.equal(ind(commissioner, failing, { ...failing, answers: KEY, outcome: 'inducted', version: 2 }).action, 'DECIDE_INDUCTION',
  'correcting a failing sheet to the real key then inducting is fine (it now genuinely passes)');

// --- Withdrawal is command's --------------------------------------------------
assert.equal(ind(commissioner, passing, { ...passing, deleted: true, version: 2 }).action, 'REMOVE_INDUCTION');
assert.equal(ind(investigator, passing, { ...passing, deleted: true, version: 2 }).ok, false, 'an Investigator cannot withdraw');

console.log('OK — ISD induction: scoring, covert reads, tiered authority and the pass-to-induct gate hold.');
