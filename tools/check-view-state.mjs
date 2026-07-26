// Verifies persistedFilter hydrates from and writes to localStorage, and that
// a blocked/corrupt store falls back to defaults instead of throwing.
import assert from 'node:assert';

let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { persistedFilter, clearPersistedFilter } = await import('../js/view-state.js');

// 1. Defaults when nothing stored.
let f = persistedFilter('t', { q: '', status: 'active' });
assert.equal(f.q, '');
assert.equal(f.status, 'active');

// 2. Set persists to localStorage.
f.q = 'hello';
assert.equal(JSON.parse(store['cairo.filter.t']).q, 'hello');

// 3. A fresh instance hydrates the saved value, keeps other defaults.
let f2 = persistedFilter('t', { q: '', status: 'active' });
assert.equal(f2.q, 'hello');
assert.equal(f2.status, 'active');

// 4. Corrupt store → defaults, no throw.
store['cairo.filter.bad'] = '{not json';
let f3 = persistedFilter('bad', { q: 'def' });
assert.equal(f3.q, 'def');

// 5. Clear removes the key.
clearPersistedFilter('t');
assert.ok(!('cairo.filter.t' in store));

// 6. Blocked store (setItem throws) must not break assignment.
globalThis.localStorage.setItem = () => { throw new Error('blocked'); };
let f4 = persistedFilter('x', { q: '' });
f4.q = 'ok';
assert.equal(f4.q, 'ok');

console.log('view-state OK');
