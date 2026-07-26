// Chain-of-command ladder grouping: senior tier first, empty tiers kept,
// off-ladder ranks collected into "Unlisted" (never dropped).
import assert from 'node:assert';
import { ladderTiers } from '../js/views/orgchart.js';

const ranks = ['Director', 'Commissioner', 'Inspector', 'Investigator', 'Operative'];
const m = (rank, id) => ({ id, rank });
const members = [m('Operative', 'a'), m('Director', 'b'), m('Operative', 'c'), m('Inspector', 'd'), m('Ghost', 'e')];
const clr = (r) => (r === 'Director' ? 'CL4-S' : 'CL3');

const tiers = ladderTiers(ranks, members, (x) => x.rank, clr);
assert.deepEqual(tiers.map((t) => t.rank), [...ranks, 'Unlisted'], 'senior first, off-ladder last');
assert.equal(tiers[0].members.length, 1, 'one Director');
assert.equal(tiers[0].clearance, 'CL4-S');
assert.equal(tiers[1].members.length, 0, 'Commissioner tier kept even when empty');
assert.equal(tiers.find((t) => t.rank === 'Operative').members.length, 2);
const unlisted = tiers.find((t) => t.rank === 'Unlisted');
assert.equal(unlisted.members.length, 1, 'off-ladder rank collected, never dropped');
assert.equal(unlisted.clearance, null);

const clean = ladderTiers(ranks, [m('Director', 'b')], (x) => x.rank, clr);
assert.ok(!clean.some((t) => t.rank === 'Unlisted'), 'no Unlisted tier when all ranks are on-ladder');

console.log('orgchart OK');
