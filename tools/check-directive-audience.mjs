// =============================================================================
// check-directive-audience.mjs — Standing Orders are addressed, not broadcast.
//   node tools/check-directive-audience.mjs
//
// A directive is seen by its home organisation, by departments its author has
// tagged into its audience, and by CL5 — nobody else learns it exists. The BODY
// stays gated by the clearance floor regardless of tagging, and acknowledgement
// remains the home organisation's alone.
// =============================================================================

import assert from 'node:assert';
import { canSeeDirective, canReadDirective } from '../js/permissions.js';
import { buildSnapshot, redactDirective } from '../worker/src/redact.js';
import { authorizeWrite } from '../worker/src/gate.js';

const ctx = { compMap: new Map() };
const dir = (actor, cur, next) => authorizeWrite('directives', actor, cur, next, ctx);

const omegaCl3  = { id: 'o3', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3' };
const omegaMgr  = { id: 'om', designation: 'O1-2', org: 'omega-1', rank: 'Major', clearance: 'CL4-S' };
const ethicsAst = { id: 'ea', designation: 'EC-5', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };
const cl5       = { id: 'd1', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };

const order = { id: 'dir1', ref: 'O1-SO-009', org: 'omega-1', clearance: 'CL3', title: 'Patrol rotation',
  body: 'Rotate at 0600.', audience: [], acks: {}, status: 'active', version: 1, deleted: false };
const tagged = { ...order, id: 'dir2', ref: 'O1-SO-010', audience: ['ethics-committee'] };

// --- Who sees an order at all ------------------------------------------------
assert.equal(canSeeDirective(omegaCl3, order), true, 'the home organisation sees its own order');
assert.equal(canSeeDirective(ethicsAst, order), false, 'an untagged department does not');
assert.equal(canSeeDirective(ethicsAst, tagged), true, 'a tagged department does');
assert.equal(canSeeDirective(cl5, order), true, 'CL5 oversight sees every order');
assert.equal(canSeeDirective(omegaMgr, order), true, 'a manager of the org sees it');

// --- The snapshot withholds the whole record ---------------------------------
const db = { users: [], directives: [order, tagged] };
const forEthics = buildSnapshot(ethicsAst, db);
assert.equal(forEthics.directives.length, 1, 'an outsider snapshot carries only orders addressed to them');
assert.equal(forEthics.directives[0].id, 'dir2');
assert.ok(!JSON.stringify(forEthics).includes('O1-SO-009'), 'an unaddressed order leaves no trace — not even its reference');
assert.equal(buildSnapshot(omegaCl3, db).directives.length, 2, 'the home org sees both');
assert.deepEqual(redactDirective(ethicsAst, tagged, ctx.compMap).audience, ['ethics-committee'], 'audience tags survive redaction');

// --- Tagging widens the board, never the body --------------------------------
const sensitive = { ...tagged, id: 'dir3', ref: 'O1-SO-011', clearance: 'CL4-S' };
const out = redactDirective(ethicsAst, sensitive, ctx.compMap);
assert.equal(out.bodyWithheld, true, 'a tagged reader below the clearance floor still gets no body');
assert.equal(canReadDirective(ethicsAst, sensitive), false);

// --- The write gate ----------------------------------------------------------
assert.equal(dir(omegaMgr, order, { ...order, audience: ['ethics-committee'], version: 2 }).action, 'EDIT_DIRECTIVE',
  'the author’s org manager retags the audience');
assert.equal(dir(ethicsAst, order, { ...order, audience: ['ethics-committee'], version: 2 }).ok, false,
  'no one outside the org’s management can tag themselves in');
assert.equal(dir(omegaCl3, tagged, { ...tagged, acks: { o3: 'now' }, version: 2 }).action, 'ACK_DIRECTIVE',
  'home-org acknowledgement still works on a tagged order');
assert.equal(dir(ethicsAst, tagged, { ...tagged, acks: { ea: 'now' }, version: 2 }).ok, false,
  'a tagged reader is an audience, not an addressee — they do not countersign');

console.log('OK — directive audience: addressed visibility, snapshot withholding, clearance floor and ack scope hold.');
