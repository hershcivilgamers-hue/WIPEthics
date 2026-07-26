// =============================================================================
// msg-read.js — per-operator, per-browser "have I read this message" state.
//
// Read receipts are a UI convenience, not shared data — so, like the inbox and
// record-watch state, they live in localStorage and never touch the Worker gate.
// The store is keyed by OPERATOR: two operators signing in on the same browser
// keep separate read state, and one operator's reads never mark another's unread
// messages as seen. A message counts as unread when it is not yours and you have
// not opened its conversation since it arrived.
// =============================================================================

const key = (actorId) => `cairo.msgread.${actorId || 'anon'}`;

function readSet(actorId) {
  try { return new Set(JSON.parse(localStorage.getItem(key(actorId))) || []); }
  catch (_) { return new Set(); }
}
function writeSet(actorId, set) {
  try { localStorage.setItem(key(actorId), JSON.stringify([...set])); } catch (_) { /* best effort */ }
}

export function isRead(actorId, id) { return readSet(actorId).has(id); }

export function markRead(actorId, ids) {
  const set = readSet(actorId);
  for (const id of [].concat(ids)) set.add(id);
  writeSet(actorId, set);
}

// A message is unread when it exists, isn't yours, and you haven't marked it read.
export function isUnread(m, actorId) {
  return !!m && !m.deleted && m.from !== actorId && !isRead(actorId, m.id);
}

// Count of unread messages for an actor across a message list.
export function unreadCount(list, actorId) {
  return (list || []).filter((m) => isUnread(m, actorId)).length;
}
