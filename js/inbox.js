// =============================================================================
// inbox.js — per-operator state for the "For Your Attention" feed (REC-05).
//
// The feed itself is derived fresh on every load (see notifications.js) and has
// no stored identity. This layer gives each derived item a STABLE key and keeps
// a little per-operator state in localStorage — what has been seen, snoozed, or
// marked done — so an attention item can actually be cleared instead of nagging
// forever. State is per-device (there is no server store yet) and degrades to a
// plain always-unread feed if localStorage is unavailable.
// =============================================================================

const VERSION = 1;
const DAY = 24 * 3600000;
export const SNOOZE_MS = DAY;
const keyFor = (userId) => `cairo.inbox.${userId || 'anon'}`;

// A stable identity for a derived notification. Its link (`hash`) plus its text
// — which carries the refs, names and counts — uniquely describes the situation,
// and changes when the situation does, so a dismissed "1 request" correctly
// resurfaces as "2 requests".
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export function notifKey(item) {
  return hashStr(`${item.hash || ''}${item.text || ''}`);
}

function emptyState() { return { v: VERSION, seen: {}, done: {}, snoozed: {} }; }

export function loadState(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    return { v: VERSION, seen: s.seen || {}, done: s.done || {}, snoozed: s.snoozed || {} };
  } catch (_) { return emptyState(); }
}
function save(userId, state) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(state)); } catch (_) { /* private mode */ }
}

// Split a freshly-built feed into active / snoozed / cleared, tagging each item
// with `_key` and (for active) `_unread`. Prunes state for items that no longer
// exist and for expired snoozes, then persists.
export function partitionNotes(userId, items, now = Date.now()) {
  const st = loadState(userId);
  const present = new Set(items.map(notifKey));
  for (const map of [st.seen, st.done]) {
    for (const k of Object.keys(map)) if (!present.has(k)) delete map[k];
  }
  for (const k of Object.keys(st.snoozed)) {
    if (!present.has(k) || st.snoozed[k] <= now) delete st.snoozed[k];
  }
  const active = []; const snoozed = []; const cleared = [];
  for (const it of items) {
    const k = notifKey(it);
    it._key = k;
    if (st.done[k]) { cleared.push(it); continue; }
    const until = st.snoozed[k];
    if (until && until > now) { it._snoozeUntil = until; snoozed.push(it); continue; }
    it._unread = !st.seen[k];
    active.push(it);
  }
  save(userId, st);
  return { active, snoozed, cleared };
}

// The nav-badge count: active AND unread. A pure read (no prune/save) so it is
// cheap to call on every re-render.
export function unreadCount(userId, items, now = Date.now()) {
  const st = loadState(userId);
  let n = 0;
  for (const it of items) {
    const k = notifKey(it);
    if (st.done[k]) continue;
    const until = st.snoozed[k];
    if (until && until > now) continue;
    if (!st.seen[k]) n += 1;
  }
  return n;
}

export function markSeen(userId, keys) {
  const st = loadState(userId);
  for (const k of keys) st.seen[k] = 1;
  save(userId, st);
}
export function markDone(userId, key) {
  const st = loadState(userId);
  st.done[key] = Date.now();
  save(userId, st);
}
export function snooze(userId, key, until = Date.now() + DAY) {
  const st = loadState(userId);
  st.snoozed[key] = until;
  delete st.seen[key]; // so it re-badges when the snooze lapses
  save(userId, st);
}
export function restore(userId, key) {
  const st = loadState(userId);
  delete st.done[key];
  delete st.snoozed[key];
  save(userId, st);
}
