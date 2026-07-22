// =============================================================================
// check-tribunal-court.mjs — the Internal Security → Committee court flow.
//   node tools/check-tribunal-court.mjs
//
// ISD (any clearance) requests a tribunal; an Ethics Assistant and above grants
// or throws it out; ISD presents exhibits; the Committee rules each in or out.
// Exhibits are append-only and their substance is immutable once presented.
// =============================================================================

import assert from 'node:assert';
import { authorizeWrite } from '../worker/src/gate.js';
import { canViewCase } from '../js/permissions.js';

const ctx = { compMap: new Map() };
const cs = (actor, cur, next) => authorizeWrite('cases', actor, cur, next, ctx);

// Cast — an ISD agent whose cover post is a CL3 Omega private (so authority is
// clearly the ISD caveat, not clearance), an Ethics Assistant/Member, and others.
const isdAgent   = { id: 'i1', designation: 'O1-7', org: 'omega-1', rank: 'Private', clearance: 'CL3', isd: { rank: 'Investigator', clearance: 'CL3', standing: 'active' } };
const assistant  = { id: 'a1', designation: 'EC-5', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };
const ethicsMgr  = { id: 'm1', designation: 'EC-3', org: 'ethics-committee', rank: 'Member', clearance: 'CL5' };
const omegaMgr   = { id: 'o1', designation: 'O1-2', org: 'omega-1', rank: 'Major', clearance: 'CL4-S' };
const cl3        = { id: 'c1', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3' };

const base = { id: 'case1', ref: 'EC-CASE-26-010', kind: 'inquiry', clearance: 'CL3', title: 'Matter',
  panelIds: [], votes: {}, exhibits: [], entries: [], ruling: null, createdBy: 'O1-7', version: 1, deleted: false };
const requested = { ...base, status: 'requested' };

// --- Filing a request --------------------------------------------------------
assert.equal(cs(isdAgent, null, requested).action, 'REQUEST_TRIBUNAL', 'ISD (any clearance) files a request');
assert.equal(cs(cl3, null, requested).ok, false, 'a plain CL3 operator cannot request a tribunal');
assert.equal(cs(omegaMgr, null, requested).ok, false, 'a non-ISD Omega manager cannot request one');
assert.equal(cs(isdAgent, null, { ...requested, ruling: { text: 'x' } }).ok, false, 'a request arrives with no ruling');

// A normally-opened case (Ethics manager, status open) still works via the manager gate.
assert.equal(cs(ethicsMgr, null, { ...base, status: 'open' }).action, 'CREATE_CASE', 'Ethics still opens a case directly');
assert.equal(cs(isdAgent, null, { ...base, status: 'open' }).ok, false, 'ISD cannot open a case directly — only request');

// --- Granting / throwing out the request -------------------------------------
const opened = { ...requested, status: 'open', version: 2 };
assert.equal(cs(assistant, requested, opened).action, 'APPROVE_TRIBUNAL', 'an Assistant may grant a request');
assert.equal(cs(ethicsMgr, requested, { ...requested, status: 'dismissed', version: 2 }).action, 'REJECT_TRIBUNAL', 'a Member may throw one out');
assert.equal(cs(isdAgent, requested, opened).ok, false, 'the requester cannot grant their own request');
assert.equal(cs(omegaMgr, requested, opened).ok, false, 'an Omega manager cannot act on a request');
assert.equal(cs(assistant, requested, { ...requested, status: 'ruled', version: 2 }).ok, false, 'a request only grants or dismisses');

// --- Filer visibility --------------------------------------------------------
assert.equal(canViewCase(isdAgent, { ...requested, clearance: 'CL5' }), true, 'the filer sees their own matter above their clearance');
assert.equal(canViewCase(cl3, { ...requested, clearance: 'CL5', createdBy: 'someone-else' }), false, 'a non-filer below clearance does not');

// --- Exhibits: present, then rule --------------------------------------------
const ex1 = { id: 'x1', by: 'O1-7', title: 'Bodycam', detail: 'clip', status: 'submitted' };
const withEx = { ...opened, exhibits: [ex1], version: 3 };
assert.equal(cs(isdAgent, opened, withEx).action, 'SUBMIT_EXHIBIT', 'ISD presents an exhibit');
assert.equal(cs(isdAgent, opened, { ...opened, exhibits: [{ ...ex1, status: 'accepted' }], version: 3 }).ok, false, 'a presented exhibit must be status submitted');
assert.equal(cs(isdAgent, opened, { ...opened, exhibits: [{ ...ex1, by: 'EC-5' }], version: 3 }).ok, false, 'an exhibit is presented in your own name');
assert.equal(cs(cl3, opened, withEx).ok, false, 'an unrelated CL3 cannot present evidence');

// Rule it in / out — the Committee, one at a time, substance immutable.
const accepted = { ...withEx, exhibits: [{ ...ex1, status: 'accepted', ruledBy: 'EC-5' }], version: 4 };
assert.equal(cs(assistant, withEx, accepted).action, 'RULE_EXHIBIT', 'an Assistant accepts an exhibit');
assert.equal(cs(assistant, withEx, { ...withEx, exhibits: [{ ...ex1, status: 'rejected', ruledBy: 'EC-5' }], version: 4 }).action, 'RULE_EXHIBIT', 'or throws it out');
assert.equal(cs(isdAgent, withEx, accepted).ok, false, 'the prosecutor cannot rule on their own exhibit');
assert.equal(cs(assistant, withEx, { ...withEx, exhibits: [{ ...ex1, status: 'accepted', title: 'tampered' }], version: 4 }).ok, false, 'an exhibit’s substance cannot be altered while ruling');
assert.equal(cs(assistant, withEx, { ...withEx, exhibits: [], version: 4 }).ok, false, 'exhibits cannot be removed');

console.log('OK — tribunal court flow: request, Assistant review, exhibit presentation and ruling hold.');
