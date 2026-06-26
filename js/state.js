// =============================================================================
// state.js — Session.
//
// Tracks who is currently signed in. The session id is persisted with the rest
// of the database, so a page refresh keeps the operator logged in on this
// browser. (For a shared/server deployment this would move to a real session
// token; today it is per-browser, which is correct for a standalone build.)
// =============================================================================

import { loadDb, saveDb, getUser } from './storage.js';

// The user record of the signed-in operator, or null.
export function currentUser() {
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
  loadDb().session.userId = null;
  saveDb();
}
