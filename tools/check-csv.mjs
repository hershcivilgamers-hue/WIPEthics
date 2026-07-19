// =============================================================================
// check-csv.mjs — self-check for CSV export (REC-04).
// No framework: run with `node`, it throws on the first failed assertion.
//
//   node tools/check-csv.mjs
//
// Guards RFC-4180 escaping (quote / comma / newline), the UTF-8 BOM, null cells
// and the column mapping.
// =============================================================================

import assert from 'node:assert';
import { toCSV } from '../js/csv.js';

const cols = [
  { header: 'Ref', value: (r) => r.ref },
  { header: 'Name', value: (r) => r.name },
  { header: 'Note', value: (r) => r.note },
];
const rows = [
  { ref: 'O1-1', name: 'Vanguard', note: 'ok' },
  { ref: 'O1-2', name: 'Smith, "J"', note: 'has, comma' },
  { ref: 'O1-3', name: 'line\nbreak', note: null },
];

const out = toCSV(cols, rows);
assert.equal(out.charCodeAt(0), 0xFEFF, 'starts with a UTF-8 BOM');

const body = out.slice(1);
const lines = body.split('\r\n');
assert.equal(lines[0], 'Ref,Name,Note', 'header row');
assert.equal(lines[1], 'O1-1,Vanguard,ok', 'plain row unquoted');
assert.equal(lines[2], 'O1-2,"Smith, ""J""","has, comma"', 'quote + comma escaped (doubled quotes)');
assert.ok(body.includes('"line\nbreak"'), 'embedded newline forces quoting');
assert.ok(out.trimEnd().endsWith(','), 'null cell renders empty');

// A single-column export with no rows is just the header.
assert.equal(toCSV([{ header: 'X', value: (r) => r.x }], []).slice(1), 'X\r\n', 'empty body = header only');

console.log('OK — CSV escaping + BOM + null handling hold.');
