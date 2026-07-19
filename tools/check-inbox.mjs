// =============================================================================
// check-inbox.mjs — self-check for the For-Your-Attention inbox state (REC-05).
// No framework: run with `node`, it throws on the first failed assertion.
//
//   node tools/check-inbox.mjs
//
// Guards the behaviours the inbox depends on: a stable key that changes when the
// situation changes, seen/done/snooze semantics, snooze expiry re-surfacing an
// item as unread, and pruning of state for notifications that no longer exist.
// =============================================================================

import assert from 'node:assert';

// localStorage shim (Node has none). inbox.js only touches it inside function
// bodies, so setting it before the dynamic import is sufficient.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { notifKey, partitionNotes, unreadCount, markSeen, markDone, snooze, restore, loadState } =
  await import('../js/inbox.js');

const uid = 'u1';
const DAY = 24 * 3600000;
const A = { tone: 'warn', icon: 'x', text: 'Case EC-1 awaits a ruling', hash: '#/case/c1' };
const B = { tone: 'info', icon: '@', text: 'X mentioned you in POI-1', hash: '#/subject/s1' };
const C = { tone: 'warn', icon: '+', text: '1 access request awaiting approval', hash: '#/admin' };
const items = [A, B, C];
const kA = notifKey(A); const kB = notifKey(B); const kC = notifKey(C);

// 1. Key is stable for the same situation and changes when it does.
assert.equal(notifKey({ ...A }), kA, 'same item -> same key');
assert.notEqual(notifKey({ ...C, text: '2 access requests awaiting approval' }), kC, 'count change -> new key');
assert.equal(new Set([kA, kB, kC]).size, 3, 'distinct items -> distinct keys');

// 2. Fresh: everything active and unread.
let p = partitionNotes(uid, items);
assert.equal(p.active.length, 3, 'all active initially');
assert.ok(p.active.every((n) => n._unread), 'all unread initially');
assert.equal(unreadCount(uid, items), 3, 'unread count = 3');

// 3. Mark seen clears the unread badge; items stay active.
markSeen(uid, [kA, kB, kC]);
assert.equal(unreadCount(uid, items), 0, 'seen -> unread 0');
p = partitionNotes(uid, items);
assert.equal(p.active.length, 3, 'still active after seen');
assert.ok(p.active.every((n) => !n._unread), 'none unread after seen');

// 4. Done removes an item from active into cleared.
markDone(uid, kA);
p = partitionNotes(uid, items);
assert.deepEqual(p.active.map((n) => n._key).sort(), [kB, kC].sort(), 'A left active');
assert.deepEqual(p.cleared.map((n) => n._key), [kA], 'A is cleared');
assert.equal(unreadCount(uid, items), 0, 'done item not counted');

// 5. Restore brings it back.
restore(uid, kA);
p = partitionNotes(uid, items);
assert.equal(p.active.length, 3, 'restore -> A active again');

// 6. Snooze hides an item and does not badge it.
const t0 = Date.now();
snooze(uid, kB, t0 + DAY);
p = partitionNotes(uid, items, t0);
assert.deepEqual(p.snoozed.map((n) => n._key), [kB], 'B is snoozed');
assert.ok(!p.active.some((n) => n._key === kB), 'B not active while snoozed');
assert.equal(unreadCount(uid, items, t0), 0, 'snoozed item not counted');

// 7. When the snooze lapses, the item returns AND is unread again.
p = partitionNotes(uid, items, t0 + 2 * DAY);
const bBack = p.active.find((n) => n._key === kB);
assert.ok(bBack, 'B returns to active after snooze lapses');
assert.ok(bBack._unread, 'returned item is unread');
assert.equal(unreadCount(uid, items, t0 + 2 * DAY), 1, 'returned item counts as unread');

// 8. Pruning: state for notifications that no longer exist is dropped.
markSeen(uid, [kA, kB, kC]);
markDone(uid, kC);
partitionNotes(uid, [A]); // B and C no longer in the feed
const st = loadState(uid);
assert.ok(!(kB in st.seen), 'seen pruned for absent B');
assert.ok(!(kC in st.done), 'done pruned for absent C');
assert.ok(kA in st.seen, 'seen kept for present A');

console.log('OK — inbox seen/done/snooze + key stability + pruning hold.');
