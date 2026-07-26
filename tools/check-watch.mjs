// Watch store: baseline recording, change detection, seen re-baselining.
import assert from 'node:assert';
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const w = await import('../js/watch.js');

// Not watched initially.
assert.equal(w.isWatched('sub_1'), false);

// Watch at v3 → baseline 3, no change yet.
w.watch('sub_1', { type: 'subject', hash: '#/subject/sub_1', label: 'subject S-1', version: 3 });
assert.equal(w.isWatched('sub_1'), true);
let e = w.watchList()['sub_1'];
assert.equal(e.base, 3);
assert.equal(e.type, 'subject');

// A change to v4 is "past baseline"; v3 is not.
const changed = (id, v) => { const x = w.watchList()[id]; return x && v > x.base; };
assert.equal(changed('sub_1', 3), false);
assert.equal(changed('sub_1', 4), true);

// Seeing v4 re-baselines; then v4 no longer counts as changed, v5 does.
w.noteWatchSeen('sub_1', 4);
assert.equal(w.watchList()['sub_1'].base, 4);
assert.equal(changed('sub_1', 4), false);
assert.equal(changed('sub_1', 5), true);

// noteWatchSeen never rewinds.
w.noteWatchSeen('sub_1', 2);
assert.equal(w.watchList()['sub_1'].base, 4);

// Unwatch clears it.
w.unwatch('sub_1');
assert.equal(w.isWatched('sub_1'), false);

// Corrupt store → no throw, empty list.
store['cairo.watches'] = '{bad';
assert.deepEqual(w.watchList(), {});

console.log('watch OK');
