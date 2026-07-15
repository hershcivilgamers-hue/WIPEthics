// =============================================================================
// check-evidence.mjs — self-check for the evidence write gate.
//   node tools/check-evidence.mjs
//
// Evidence is self-service: an operator files their OWN item; a manager files for
// anyone and is the only one who may change a submission's status (count/reject)
// or set the per-operator review flag. Nobody reviews their own evidence.
// =============================================================================

import assert from 'node:assert';
import { authorizeWrite } from '../worker/src/gate.js';

const op     = { id: 'u1', designation: 'O1-9', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3'   };
const other  = { id: 'u2', designation: 'O1-8', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3'   };
const srCL4  = { id: 's1', designation: 'O1-2', org: 'omega-1', rank: 'Major',    clearance: 'CL4-S' };
const jrCL4  = { id: 'j1', designation: 'O1-3', org: 'omega-1', rank: 'Lieutenant', clearance: 'CL4-J' };

const ev = (actor, cur, next) => authorizeWrite('evidence', actor, cur, next, {});
const base = { id: 'ev1', org: 'omega-1', userId: 'u1', title: 'clip', status: 'counted', submittedBy: 'O1-9', version: 1, deleted: false };

// --- Submission -------------------------------------------------------------
assert.equal(ev(op, null, base).action, 'SUBMIT_EVIDENCE', 'operator files own evidence');
assert.equal(ev(op, null, { ...base, submittedBy: 'O1-8' }).ok, false, 'must file in your own name');
assert.equal(ev(other, null, base).ok, false, 'cannot file for another operator');
assert.equal(ev(srCL4, null, base).action, 'SUBMIT_EVIDENCE', 'a manager files for anyone');

// --- Review (status change) is manager-only and atomic ----------------------
const cur = { ...base };
assert.equal(ev(srCL4, cur, { ...cur, status: 'rejected', reviewedBy: 'O1-2', version: 2 }).action, 'REVIEW_EVIDENCE', 'manager reviews');
assert.equal(ev(op, cur, { ...cur, status: 'rejected', version: 2 }).ok, false, 'operator cannot review (self-approve)');
assert.equal(ev(jrCL4, cur, { ...cur, status: 'counted', version: 2 }).ok, false, 'CL4·Junior is not a manager');
assert.equal(ev(srCL4, cur, { ...cur, status: 'rejected', title: 'edited', version: 2 }).ok, false, 'a review cannot ride with other edits');
assert.equal(ev(srCL4, cur, { ...cur, status: 'bogus', version: 2 }).ok, false, 'unknown status refused');

// --- Content edit / withdraw ------------------------------------------------
assert.equal(ev(op, cur, { ...cur, title: 'clip v2', version: 2 }).action, 'EDIT_EVIDENCE', 'submitter edits own content');
assert.equal(ev(op, cur, { ...cur, deleted: true, version: 2 }).action, 'REMOVE_EVIDENCE', 'submitter withdraws own item');
assert.equal(ev(srCL4, cur, { ...cur, deleted: true, version: 2 }).action, 'REMOVE_EVIDENCE', 'manager withdraws any item');

// --- Per-operator review flag lives on the user record, set by a manager -----
const userRec = { id: 'u1', designation: 'O1-9', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3', accountStatus: 'active', version: 1, deleted: false };
const usr = (actor, cur2, next) => authorizeWrite('users', actor, cur2, next, {});
assert.equal(usr(srCL4, userRec, { ...userRec, evidenceReviewRequired: true, version: 2 }).action, 'SET_EVIDENCE_REVIEW', 'manager sets the review flag');
assert.equal(usr(op, userRec, { ...userRec, evidenceReviewRequired: true, version: 2 }).ok, false, 'an operator cannot flag themselves for review');

// --- Server integrity: a self-submission cannot self-approve -----------------
// The gate authorises the write; writeRecord then forces the *status* of a NEW
// self-submission from the operator's review flag, so a client that sends
// status:'counted' for a review-required operator still lands 'pending'.
import { handle } from '../worker/src/index.js';

function memRepo(seedUsers) {
  const usersById = new Map(seedUsers.map((u) => [u.id, u]));
  const inserted = [];
  return {
    _inserted: inserted,
    async getSession(t) { return t === 'TESTTOKEN' ? { user_id: 'u1', expires_at: null } : null; },
    async getById(c, id) { return c === 'users' ? (usersById.get(id) || null) : null; },
    async listAll() { return []; },
    async insert(c, rec) { inserted.push({ c, rec }); },
    async update() { return 1; },
    async addAudit() {},
  };
}
const put = (repo, body) => handle(new Request('https://x/api/evidence/ev9', {
  method: 'PUT',
  headers: { Authorization: 'Bearer TESTTOKEN', 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'ev9', ...body }),
}), repo, { ALLOWED_ORIGIN: '*' });

// self, review required, client lies status:'counted' -> forced to 'pending'
const self = { id: 'u1', designation: 'O1-9', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3', accountStatus: 'active', deleted: false, evidenceReviewRequired: true };
let repo = memRepo([self]);
let res = await put(repo, { org: 'omega-1', userId: 'u1', title: 't', status: 'counted', submittedBy: 'O1-9' });
assert.equal(res.status, 200, 'self-submit accepted');
assert.equal(repo._inserted[0].rec.status, 'pending', 'review-required self-submit is forced to pending (no self-approval)');

// self, NOT flagged -> stays counted
const self2 = { ...self, evidenceReviewRequired: false };
repo = memRepo([self2]);
res = await put(repo, { org: 'omega-1', userId: 'u1', title: 't', status: 'counted', submittedBy: 'O1-9' });
assert.equal(repo._inserted[0].rec.status, 'counted', 'unflagged self-submit counts immediately');

console.log('OK — evidence gate + review-flag + self-approval guard hold.');
