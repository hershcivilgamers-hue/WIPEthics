// =============================================================================
// check-staleness.mjs — self-check for the board staleness/SLA rule (REC-07).
// No framework: run with `node`, it throws on the first failed assertion.
//
//   node tools/check-staleness.mjs
//
// Guards the thresholds, the active-state gating (archived / concluded records
// never go stale), and the chip's tone/label.
// =============================================================================

import assert from 'node:assert';

const { staleness, stalenessBadge } = await import('../js/staleness.js');

const now = Date.parse('2026-07-19T12:00:00Z');
const DAY = 24 * 3600000;
const ago = (d) => new Date(now - d * DAY).toISOString();

// --- Recruitment candidates (warn 7 / overdue 14, by last activity) ---
assert.equal(staleness({ stage: 'application', updatedAt: ago(5) }, 'recruit', now).stale, false, 'fresh recruit');
assert.equal(staleness({ stage: 'application', updatedAt: ago(8) }, 'recruit', now).level, 'warn', 'recruit warn');
assert.equal(staleness({ stage: 'interview', updatedAt: ago(20) }, 'recruit', now).level, 'overdue', 'recruit overdue');
assert.equal(staleness({ stage: 'archived', updatedAt: ago(30) }, 'recruit', now).stale, false, 'archived recruit never stale');

// --- Tribunal cases (warn 10 / overdue 21, by last activity) ---
assert.equal(staleness({ status: 'deliberation', updatedAt: ago(5) }, 'case', now).stale, false, 'fresh case');
assert.equal(staleness({ status: 'open', updatedAt: ago(12) }, 'case', now).level, 'warn', 'case warn');
assert.equal(staleness({ status: 'in-session', updatedAt: ago(25) }, 'case', now).level, 'overdue', 'case overdue');
assert.equal(staleness({ status: 'ruled', updatedAt: ago(40) }, 'case', now).stale, false, 'ruled case never stale');
assert.equal(staleness({ status: 'closed', updatedAt: ago(40) }, 'case', now).stale, false, 'closed case never stale');

// --- Surveillance targets (warn 3 / overdue 7, by authorisation request) ---
assert.equal(staleness({ kind: 'target', authorization: { status: 'pending', requestedAt: ago(1) } }, 'target', now).stale, false, 'fresh pending');
assert.equal(staleness({ kind: 'target', authorization: { status: 'pending', requestedAt: ago(4) } }, 'target', now).level, 'warn', 'target warn');
assert.equal(staleness({ kind: 'target', authorization: { status: 'pending', requestedAt: ago(10) } }, 'target', now).level, 'overdue', 'target overdue');
assert.equal(staleness({ kind: 'target', authorization: { status: 'authorised', at: ago(30) } }, 'target', now).stale, false, 'authorised never stale');
assert.equal(staleness({ kind: 'poi', authorization: null }, 'target', now).stale, false, 'a POI is not a pending target');

// --- Chip output ---
assert.equal(stalenessBadge({ status: 'open', updatedAt: ago(3) }, 'case', now), '', 'fresh -> no chip');
const warnB = stalenessBadge({ status: 'open', updatedAt: ago(12) }, 'case', now);
assert.ok(warnB.includes('badge--warn') && warnB.includes('12d'), 'warn chip carries tone + days');
const overB = stalenessBadge({ status: 'open', updatedAt: ago(25) }, 'case', now);
assert.ok(overB.includes('badge--bad') && overB.includes('25d'), 'overdue chip carries tone + days');

console.log('OK — staleness thresholds + active-state gating + chip output hold.');
