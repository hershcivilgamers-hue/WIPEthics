// =============================================================================
// check-isd-investigations.mjs — the ISD multi-stage investigative protocol.
//   node tools/check-isd-investigations.mjs
//
// Covers the tiered authority (Operative reads, Investigator files, Inspector
// opens, command adjudicates), the one-step stage protocol, the append-only
// record, and the covert snapshot filter.
// =============================================================================

import assert from 'node:assert';
import { authorizeWrite } from '../worker/src/gate.js';
import { buildSnapshot } from '../worker/src/redact.js';
import { INVESTIGATION_PIPELINE, investigationNextStage } from '../js/constants.js';

// The mask derives from the cover post, so the cast is built from cover ranks.
const isd = (coverRank, coverClearance, id) => ({
  id, designation: `O1-${id}`, org: 'omega-1', rank: coverRank, clearance: coverClearance,
  isd: { standing: 'active' },
});
const operative    = isd('Private',    'CL3',   'p1'); // → Operative
const investigator = isd('Sergeant',   'CL3',   'v1'); // → Investigator
const inspector    = isd('Lieutenant', 'CL4-J', 'i1'); // → Inspector
const commissioner = isd('Captain',    'CL4-J', 'c1'); // → Commissioner
const outsider  = { id: 'o1', designation: 'O1-2', org: 'omega-1', rank: 'Major', clearance: 'CL4-S' };
const cl5       = { id: 'd1', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };

const inv = (actor, cur, next) => authorizeWrite('investigations', actor, cur, next, {});
const base = {
  id: 'inv1', ref: 'ISD-INV-0001', org: 'isd', subjectUserId: 'u9',
  stage: 'referral', entries: [{ id: 'e1', ts: 't', by: 'O1-v1', type: 'note', text: 'a' }],
  disposition: null, version: 1, deleted: false,
};

// --- Pipeline ----------------------------------------------------------------
assert.deepEqual(INVESTIGATION_PIPELINE, ['referral', 'preliminary', 'active', 'adjudication', 'closed']);
assert.equal(investigationNextStage('referral'), 'preliminary');
assert.equal(investigationNextStage('closed'), null, 'closed is terminal');

// --- Covert: outsiders are told nothing ---------------------------------------
const outVerdict = inv(outsider, null, base);
assert.equal(outVerdict.ok, false, 'an outsider cannot write an investigation');
assert.equal(outVerdict.error, 'No such record.', 'the refusal must not confirm the record exists');
const db = { users: [], investigations: [{ ...base, deleted: false }], audit: [] };
assert.equal(JSON.parse(JSON.stringify(buildSnapshot(outsider, db))).investigations.length, 0, 'outsider snapshot carries none');
assert.equal(buildSnapshot(inspector, db).investigations.length, 1, 'the Department sees them');
assert.equal(buildSnapshot(cl5, db).investigations.length, 1, 'CL5 sees them');

// --- Filing ------------------------------------------------------------------
assert.equal(inv(investigator, null, base).action, 'OPEN_INVESTIGATION', 'an Investigator files a referral');
assert.equal(inv(operative, null, base).ok, false, 'an Operative files nothing on their own authority');
assert.equal(inv(investigator, null, { ...base, stage: 'active' }).ok, false, 'a matter opens as a referral');
assert.equal(inv(investigator, null, { ...base, disposition: 'substantiated' }).ok, false, 'no disposition on arrival');

// --- Append-only record -------------------------------------------------------
const added = { ...base, entries: [...base.entries, { id: 'e2', ts: 't2', by: 'O1-v1', type: 'note', text: 'b' }], version: 2 };
assert.equal(inv(investigator, base, added).action, 'LOG_INVESTIGATION', 'an Investigator records to the file');
assert.equal(inv(operative, base, added).ok, false, 'an Operative may not add to the record');
assert.equal(inv(investigator, added, { ...added, entries: base.entries, version: 3 }).ok, false, 'entries cannot be removed');
const closed = { ...base, stage: 'closed', disposition: 'unsubstantiated' };
assert.equal(inv(commissioner, closed, { ...closed, entries: added.entries, version: 2 }).ok, false, 'a closed matter cannot be added to');

// --- Stage protocol: one step, tiered authority -------------------------------
const prelim = { ...base, stage: 'preliminary', version: 2 };
assert.equal(inv(investigator, base, prelim).action, 'ADVANCE_INVESTIGATION', 'referral -> preliminary');
assert.equal(inv(investigator, base, { ...base, stage: 'active', version: 2 }).ok, false, 'stages move one step at a time');

const active = { ...prelim, stage: 'active', version: 3 };
assert.equal(inv(inspector, prelim, active).action, 'ADVANCE_INVESTIGATION', 'an Inspector opens the investigation');
assert.equal(inv(investigator, prelim, active).ok, false, 'an Investigator cannot open it');

const adjud = { ...active, stage: 'adjudication', version: 4 };
assert.equal(inv(commissioner, active, adjud).action, 'ADVANCE_INVESTIGATION', 'command takes it to adjudication');
assert.equal(inv(inspector, active, adjud).ok, false, 'an Inspector cannot adjudicate');

// --- Closure needs a valid disposition ---------------------------------------
assert.equal(inv(commissioner, adjud, { ...adjud, stage: 'closed', version: 5 }).ok, false, 'closure needs a disposition');
assert.equal(inv(commissioner, adjud, { ...adjud, stage: 'closed', disposition: 'nonsense', version: 5 }).ok, false, 'unknown disposition refused');
assert.equal(inv(commissioner, adjud, { ...adjud, stage: 'closed', disposition: 'substantiated', version: 5 }).action,
  'ADVANCE_INVESTIGATION', 'command closes with a disposition');
assert.equal(inv(commissioner, active, { ...active, disposition: 'substantiated', version: 4 }).ok, false,
  'a disposition is only recorded at closure');

// --- Withdrawal is command's --------------------------------------------------
assert.equal(inv(commissioner, base, { ...base, deleted: true, version: 2 }).action, 'REMOVE_INVESTIGATION');
assert.equal(inv(investigator, base, { ...base, deleted: true, version: 2 }).ok, false, 'an Investigator cannot withdraw');

console.log('OK — ISD investigations: covert reads, tiered authority, one-step protocol and append-only record hold.');
