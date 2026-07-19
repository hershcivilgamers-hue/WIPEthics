// =============================================================================
// check-record-history.mjs — self-check for the per-record history (REC-09).
// No framework: run with `node`, it throws on the first failed assertion.
//
//   node tools/check-record-history.mjs
//
// Covers the subtle part — whole-token identifier matching, so "O1-9" never
// picks up an entry about "O1-90" — and the historyFor filter/limit composition.
// =============================================================================

import assert from 'node:assert';
import { setDb } from '../js/storage.js';
import { detailMatches, historyFor } from '../js/record-history.js';

// --- detailMatches: whole-token boundaries ----------------------------------
assert.ok(detailMatches('Promoted O1-9 to Captain.', 'O1-9'), 'matches the identifier as a whole token');
assert.ok(detailMatches('O1-9 acknowledged the directive.', 'O1-9'), 'matches at the start of the detail');
assert.ok(detailMatches('Cleared for access: O1-9', 'O1-9'), 'matches at the end of the detail');

assert.ok(!detailMatches('Promoted O1-90 to Major.', 'O1-9'), 'does NOT match a longer designation (O1-90)');
assert.ok(!detailMatches('Reassigned XO1-9 to the annex.', 'O1-9'), 'does NOT match a longer prefix (XO1-9)');
assert.ok(!detailMatches('', 'O1-9'), 'empty detail never matches');
assert.ok(!detailMatches('Anything at all.', ''), 'empty id never matches');

// Refs with a dot are a common case — the dot is escaped, not treated as "any".
assert.ok(detailMatches('Opened case ETH-2231.A for review.', 'ETH-2231.A'), 'dotted ref matches literally');
assert.ok(!detailMatches('Opened case ETH-2231XA for review.', 'ETH-2231.A'), 'the dot is a literal, not a wildcard');

// --- historyFor: filter + newest-first slice --------------------------------
const entry = (id, action, detail, ts) => ({ id, ts, actorId: 'a', actor: 'D-1', action, detail });
setDb({
  audit: [
    entry('1', 'PROMOTE', 'Promoted O1-9 to Captain.', 3000),
    entry('2', 'NOTE_ADD', 'Filed a note on O1-90.', 2000), // must not leak into O1-9
    entry('3', 'STRIKE', 'Issued a strike to O1-9.', 1000),
    entry('4', 'CASE_OPEN', 'Opened case ETH-2231.A.', 500),
  ],
});

const personHist = historyFor({ designation: 'O1-9' }, 'personnel');
assert.equal(personHist.length, 2, 'O1-9 sees exactly its two entries (not the O1-90 one)');
assert.deepEqual(personHist.map((a) => a.id), ['1', '3'], 'entries keep their stored (newest-first) order');

const caseHist = historyFor({ ref: 'ETH-2231.A' }, 'case');
assert.equal(caseHist.length, 1, 'the case sees its single entry by ref');

assert.deepEqual(historyFor(null, 'personnel'), [], 'a missing record yields no history');
assert.deepEqual(historyFor({ designation: 'O1-9' }, 'personnel', 1).map((a) => a.id), ['1'], 'limit caps the result');

console.log('OK — record-history boundary matching, ref escaping, filter and limit hold.');
