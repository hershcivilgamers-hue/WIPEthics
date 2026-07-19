// =============================================================================
// check-permissions.mjs — a standalone self-check for the surveillance /
// Target-authorisation gate. No framework: run it with `node`, it throws on the
// first failed assertion and prints "OK" if every case holds.
//
//   node tools/check-permissions.mjs
//
// It guards the two behaviours the Ethics Assistant work depends on:
//   1. A CL4·Junior operator with a stake (an Ethics Assistant) may open a
//      Person of Interest and REQUEST a Target.
//   2. Only an Ethics Committee member may AUTHORISE or REFUSE that Target —
//      a request never carries termination authority on its own.
// =============================================================================

import assert from 'node:assert';
import { canManageSubjectsIn, canManageOrg } from '../js/permissions.js';
import { authorizeWrite } from '../worker/src/gate.js';

const assistant = { id: 'a1', designation: 'EC-5', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };
const member    = { id: 'm1', designation: 'EC-3', org: 'ethics-committee', rank: 'Member',    clearance: 'CL5'   };
const omegaMgr  = { id: 'o1', designation: 'O1-2', org: 'omega-1',          rank: 'Major',     clearance: 'CL4-S' };

const ctx = { compMap: new Map() };
const base = { id: 's1', ref: 'POI-1', org: 'ethics-committee', clearance: 'CL3', version: 1, deleted: false };
const poi          = { ...base, kind: 'poi',    authorization: null };
const poiCreate    = { ...base, kind: 'poi',    authorization: null };
const pendingNext  = { ...base, kind: 'target', authorization: { status: 'pending',    requestedBy: 'EC-5' } };
const pendingCur   = { ...base, kind: 'target', authorization: { status: 'pending',    requestedBy: 'EC-5' } };
const authorised   = { ...base, kind: 'target', authorization: { status: 'authorised', by: 'EC-3' } };
const refused      = { ...base, kind: 'target', authorization: { status: 'refused',    by: 'EC-3' } };
const targetNoAuth = { ...base, kind: 'target', authorization: null };

// An Omega subject — a task-force manager has a stake here but not in Ethics.
const oBase        = { ...base, id: 's2', ref: 'POI-2', org: 'omega-1' };
const poiOmega     = { ...oBase, kind: 'poi',    authorization: null };
const pendingOmega = { ...oBase, kind: 'target', authorization: { status: 'pending',    requestedBy: 'O1-2' } };
const authOmega    = { ...oBase, kind: 'target', authorization: { status: 'authorised', by: 'EC-3' } };

const sub = (actor, cur, next) => authorizeWrite('subjects', actor, cur, next, ctx);

// 1. An Assistant (CL4·J, stake) manages subjects; the OLD gate (canManageOrg,
//    CL4·Senior) would have wrongly blocked them — the bug this fix closes.
assert.equal(canManageSubjectsIn(assistant, 'ethics-committee'), true, 'Assistant should manage ethics subjects');
assert.equal(canManageOrg(assistant, 'ethics-committee'), false, 'old CL4·Senior gate would block the Assistant');

// 2. An Assistant may OPEN a Person of Interest server-side.
assert.equal(sub(assistant, null, poiCreate).ok, true, 'Assistant may open a POI');

// 3. An Assistant may REQUEST a Target on an Ethics subject; a task-force
//    manager may request one on their OWN unit's subject.
assert.equal(sub(assistant, poi, pendingNext).action, 'REQUEST_TARGET', 'Assistant may request a Target');
assert.equal(sub(omegaMgr, poiOmega, pendingOmega).action, 'REQUEST_TARGET', 'task-force manager may request a Target');

// 4. Neither may AUTHORISE — only an Ethics member decides.
assert.equal(sub(assistant, pendingCur, authorised).ok, false, 'Assistant may NOT authorise a Target');
assert.equal(sub(omegaMgr, pendingOmega, authOmega).ok, false, 'task-force manager may NOT authorise a Target');

// 5. An Ethics member authorises or refuses a pending request.
assert.equal(sub(member, pendingCur, authorised).action, 'AUTHORISE_TARGET', 'Ethics member authorises');
assert.equal(sub(member, pendingCur, refused).action, 'REFUSE_TARGET', 'Ethics member refuses');

// 6. Invariant: a subject can never become a Target with NO authorisation at all.
assert.equal(sub(assistant, poi, targetNoAuth).ok, false, 'a Target needs an authorisation record');

// 7. Recruitment: CL5 (oversight tier) may run ANY pipeline, mirroring the
//    client gate. A CL5 Ethics member acting on an Omega-1 candidate is the case
//    that was wrongly 403'd (client showed the buttons; server denied the write).
const rec = (actor, cur, next) => authorizeWrite('recruits', actor, cur, next, ctx);
const omegaRec  = { id: 'r1', ref: 'SCT-0001', org: 'omega-1', stage: 'scouting', votes: {}, version: 1, deleted: false };
const omegaVote = { ...omegaRec, votes: { m1: 'yes' } };            // member casts own vote
assert.equal(rec(member, omegaRec, omegaVote).action, 'VOTE_RECRUIT', 'CL5 Ethics member may act on an Omega candidate');
assert.equal(rec(omegaMgr, omegaRec, { ...omegaRec, votes: { o1: 'yes' } }).action, 'VOTE_RECRUIT', 'Omega CL4 cadre may act on an Omega candidate');
assert.equal(rec(assistant, omegaRec, { ...omegaRec, votes: { a1: 'yes' } }).ok, false, 'CL4·J Ethics Assistant may NOT touch an Omega candidate');

// 8. The Ethics MEMBER track onboards Committee Members and is Command (CL5)
//    only. The gate judges Member-ness against the STORED record too, so a
//    crafted write cannot escape it by stripping or flipping `track`.
const memberRec = { id: 'r2', ref: 'APP-ECM-016', org: 'ethics-committee', track: 'member',    stage: 'application', votes: {}, version: 1, deleted: false };
const asstRec   = { id: 'r3', ref: 'APP-EC-016',  org: 'ethics-committee', track: 'assistant', stage: 'application', votes: {}, version: 1, deleted: false };
// A CL5 member runs the Member track.
assert.equal(rec(member, memberRec, { ...memberRec, votes: { m1: 'yes' } }).action, 'VOTE_RECRUIT', 'CL5 runs the Member track');
// A CL4·J Assistant cannot — not even by sending a write with `track` flipped to
// 'assistant' or omitted entirely (Member-ness is read from the stored record).
assert.equal(rec(assistant, memberRec, { ...memberRec, track: 'assistant', votes: { a1: 'yes' } }).ok, false, 'CL4 cannot escape the Member gate by flipping track');
assert.equal(rec(assistant, memberRec, { id: 'r2', ref: 'APP-ECM-016', org: 'ethics-committee', stage: 'application', votes: { a1: 'yes' }, version: 1 }).ok, false, 'CL4 cannot escape the Member gate by omitting track');
// Creation is CL5-only, and an Assistant record cannot be flipped into the track.
assert.equal(rec(assistant, null, memberRec).ok, false, 'CL4 cannot open a Member candidate');
assert.equal(rec(member, null, memberRec).action, 'OPEN_RECRUIT', 'CL5 may open a Member candidate');
assert.equal(rec(assistant, asstRec, { ...asstRec, track: 'member' }).ok, false, 'CL4 cannot flip an Assistant into the Member track');
// No regression: a CL4·J Assistant still runs the Assistant track.
assert.equal(rec(assistant, asstRec, { ...asstRec, votes: { a1: 'yes' } }).action, 'VOTE_RECRUIT', 'CL4 Assistant still runs the Assistant track');

console.log('OK — surveillance / Target-authorisation gate holds.');
