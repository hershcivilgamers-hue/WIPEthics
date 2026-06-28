// =============================================================================
// migrations.js — Forward-only schema migrations.
//
// When a new feature adds a collection, installations that were seeded earlier
// won't have it. Each migration here is idempotent and stamped in `meta`, so it
// runs at most once and never overwrites data the operator has since changed.
// app.js runs these once, right after seeding, on every boot.
// =============================================================================

import { loadDb, saveDb } from './storage.js';
import { buildSeedSubjects, buildSeedCases } from './seed.js';
import { logAction } from './audit.js';

// Surveillance was added after the initial release. If this install predates it
// (no stamp) and has no subjects of its own, lay down the demo subjects once.
function migrateSurveillance(db) {
  if (db.meta.surveillanceSeededAt) return false;
  if (!Array.isArray(db.subjects)) db.subjects = [];
  if (db.subjects.length === 0) {
    db.subjects = buildSeedSubjects();
    logAction(null, 'MIGRATION', 'Surveillance module initialised for existing installation.');
  }
  db.meta.surveillanceSeededAt = new Date().toISOString();
  return true;
}

// Tribunals were added after surveillance. Same idempotent, non-destructive
// backfill — resolving case links against whatever personnel/subjects exist.
function migrateTribunals(db) {
  if (db.meta.tribunalsSeededAt) return false;
  if (!Array.isArray(db.cases)) db.cases = [];
  if (db.cases.length === 0) {
    db.cases = buildSeedCases(db.users || [], db.subjects || []);
    logAction(null, 'MIGRATION', 'Ethics tribunal module initialised for existing installation.');
  }
  db.meta.tribunalsSeededAt = new Date().toISOString();
  return true;
}

export function runMigrations() {
  const db = loadDb();
  let changed = false;
  changed = migrateSurveillance(db) || changed;
  changed = migrateTribunals(db) || changed;
  if (changed) saveDb();
  return changed;
}
