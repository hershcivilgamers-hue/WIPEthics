// =============================================================================
// state.js — Session.
//
// Tracks who is currently signed in.
//
//   • Standalone mode: the session id is persisted with the rest of the
//     database, so a refresh keeps the operator signed in on this browser.
//   • Server mode: the operator is whoever the Worker authenticated; their
//     record comes from /api/login (or /api/me on a refresh) and is held here.
//     The session itself is a server-issued token, managed in api.js.
// =============================================================================

import { loadDb, saveDb, getUser, isServerMode } from './storage.js';

// The signed-in operator's record in server mode.
let serverUser = null;
export function setServerUser(u) { serverUser = u || null; }

// The user record of the signed-in operator, or null.
export function currentUser() {
  if (isServerMode()) {
    if (!serverUser || serverUser.deleted || serverUser.accountStatus !== 'active') return null;
    return serverUser;
  }
  const id = loadDb().session.userId;
  if (!id) return null;
  const user = getUser(id);
  // Guard against a stale session pointing at a deleted/disabled account.
  if (!user || user.deleted || user.accountStatus !== 'active') return null;
  return user;
}

export function isAuthenticated() {
  return currentUser() !== null;
}

export function startSession(userId) {
  loadDb().session.userId = userId;
  saveDb();
}

export function endSession() {
  if (isServerMode()) { serverUser = null; return; }
  loadDb().session.userId = null;
  saveDb();
}
