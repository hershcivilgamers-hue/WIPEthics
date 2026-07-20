// =============================================================================
// check-insight.mjs — self-check for the Command analytics aggregations (REC-08).
// No framework: run with `node`, it throws on the first failed assertion.
//
//   node tools/check-insight.mjs
//
// The render() is verified in a browser; these are the pure functions behind it,
// exercised against fixed data and a fixed `now` so the buckets are deterministic.
// =============================================================================

import assert from 'node:assert';
import { funnel, conversion, medianAgeByStage, throughput, outcomeMix, byKind } from '../js/views/insight.js';

const NOW = Date.UTC(2026, 6, 20);
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const RECRUITS = [
  { stage: 'scouting', comments: [{ stage: 'scouting', ts: daysAgo(4) }] },
  { stage: 'scouting', comments: [{ stage: 'scouting', ts: daysAgo(10) }] },
  { stage: 'greenlit', comments: [{ stage: 'greenlit', ts: daysAgo(6) }] },
  { stage: 'interview', comments: [{ stage: 'application', ts: daysAgo(20) }, { stage: 'interview', ts: daysAgo(9) }] },
  { stage: 'archived', archiveStatus: 'approved' },
  { stage: 'archived', archiveStatus: 'approved' },
  { stage: 'archived', archiveStatus: 'denied' },
  { stage: 'tryout', deleted: true }, // soft-deleted — excluded everywhere
];

// --- funnel: counts per live stage, 'archived' is never a funnel stage -------
const f = funnel(RECRUITS);
const fmap = Object.fromEntries(f.map((s) => [s.stage, s.count]));
assert.equal(fmap.scouting, 2, 'two in scouting');
assert.equal(fmap.greenlit, 1, 'one in greenlit');
assert.equal(fmap.tryout, 0, 'the tryout candidate is soft-deleted');
assert.equal(fmap.interview, 1, 'one in interview');
assert.ok(!f.some((s) => s.stage === 'archived'), 'archived is the exit, not a funnel stage');

// --- conversion: approved / (approved + denied) ------------------------------
const c = conversion(RECRUITS);
assert.equal(c.approved, 2);
assert.equal(c.denied, 1);
assert.equal(c.total, 3);
assert.ok(Math.abs(c.rate - 2 / 3) < 1e-9, 'rate is 2/3');
assert.equal(conversion([]).rate, null, 'no decisions -> null rate (no divide-by-zero)');

// --- median age in current stage (from the latest same-stage comment) --------
const ages = medianAgeByStage(RECRUITS, NOW);
assert.equal(ages.scouting, 4, 'lower-median of [4,10] days');
assert.equal(ages.greenlit, 6);
assert.equal(ages.interview, 9, 'uses the interview-stage comment, not the older application one');
assert.equal(ages.tryout, null, 'empty stage -> null');

// --- throughput: opened (createdAt) & concluded (ruling.ts) per week ----------
const CASES = [
  { kind: 'review', createdAt: daysAgo(2) },
  { kind: 'inquiry', createdAt: daysAgo(9) },
  { kind: 'tribunal', createdAt: daysAgo(3), ruling: { ts: daysAgo(1), finding: 'upheld' } },
  { kind: 'review', createdAt: daysAgo(40), ruling: { ts: daysAgo(8), finding: 'dismissed' } },
  { kind: 'review', deleted: true, createdAt: daysAgo(1) }, // excluded
];
const tp = throughput(CASES, 8, NOW);
assert.equal(tp.length, 8, 'eight weekly buckets');
assert.equal(tp[7].opened, 2, 'this week: opened at 2d and 3d');
assert.equal(tp[7].concluded, 1, 'this week: concluded at 1d');
assert.equal(tp[6].opened, 1, 'last week: opened at 9d');
assert.equal(tp[6].concluded, 1, 'last week: concluded at 8d');

// --- outcome mix & by-kind ---------------------------------------------------
const om = Object.fromEntries(outcomeMix(CASES).map((m) => [m.finding, m.count]));
assert.equal(om.upheld, 1);
assert.equal(om.dismissed, 1);
assert.equal(om.referred, 0);
assert.equal(outcomeMix(CASES).length, 4, 'all four findings represented, even at zero');

const bk = Object.fromEntries(byKind(CASES).map((k) => [k.kind, k.count]));
assert.equal(bk.review, 2, 'two live reviews (the deleted one excluded)');
assert.equal(bk.tribunal, 1);
assert.equal(bk.inquiry, 1);

console.log('OK — funnel, conversion, median age, throughput buckets, outcome mix and by-kind hold.');
