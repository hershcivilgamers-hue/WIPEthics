// =============================================================================
// audit.js — Significant-action logging.
//
// A lightweight, append-only record of who did what. Logins, edits, clearance
// changes, approvals, deletions and similar actions are recorded here and shown
// in the Activity view. Entries are capped so the log can't grow without bound.
// =============================================================================

import { loadDb, saveDb, newId } from './storage.js';

const MAX_ENTRIES = 500;

// Record an action. `actor` is the user record performing it (may be null for
// system events such as seeding). `detail` is a short human-readable string.
export function logAction(actor, action, detail = '') {
  const entry = {
    id: newId('aud'),
    ts: new Date().toISOString(),
    actorId: actor?.id ?? null,
    actor: actor?.designation ?? 'SYSTEM',
    action,
    detail,
  };
  const db = loadDb();
  db.audit.unshift(entry);
  if (db.audit.length > MAX_ENTRIES) db.audit.length = MAX_ENTRIES;
  saveDb();
  return entry;
}

export function recentActions(limit = 100) {
  return loadDb().audit.slice(0, limit);
}
