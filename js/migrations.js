// =============================================================================
// migrations.js — Forward-only schema migrations.
//
// When a new feature adds a collection, installations that were seeded earlier
// won't have it. Each migration here is idempotent and stamped in `meta`, so it
// runs at most once and never overwrites data the operator has since changed.
// app.js runs these once, right after seeding, on every boot.
// =============================================================================

import { loadDb, saveDb } from './storage.js';
import { buildSeedSubjects, buildSeedCases, buildSeedPromoReqs } from './seed.js';
import { clearanceForRank } from './constants.js';
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

// The rank ladders were restructured (Omega-1 expanded to a full NCO/officer
// ladder; Ethics reduced to Assistant/Member/Chairman). Remap any personnel
// holding a retired rank, realign their clearance to the rank's tier, backfill
// the promotion-progress field, and lay down default promotion requirements.
const RANK_REMAP = {
  'omega-1': { 'Recruit': 'Private', 'Operative': 'Specialist' },
  'ethics-committee': { 'Senior Member': 'Member' },
};
function migrateRanks(db) {
  if (db.meta.ranksMigratedAt) return false;
  let touched = 0;
  for (const u of (db.users || [])) {
    if (!u || !u.org) continue;
    if (!Array.isArray(u.promoChecks)) u.promoChecks = [];
    const remap = RANK_REMAP[u.org];
    if (remap && u.rank && remap[u.rank]) { u.rank = remap[u.rank]; touched++; }
    const tier = clearanceForRank(u.org, u.rank);
    if (tier && u.clearance !== tier) { u.clearance = tier; touched++; }
  }
  if (!db.meta.promoReqsSeededAt) {
    if (!Array.isArray(db.promoReqs)) db.promoReqs = [];
    if (db.promoReqs.length === 0) db.promoReqs = buildSeedPromoReqs('SYSTEM');
    db.meta.promoReqsSeededAt = new Date().toISOString();
  }
  db.meta.ranksMigratedAt = new Date().toISOString();
  if (touched) logAction(null, 'MIGRATION', `Rank ladders restructured; ${touched} personnel field(s) realigned.`);
  return true;
}

export function runMigrations() {
  const db = loadDb();
  let changed = false;
  changed = migrateSurveillance(db) || changed;
  changed = migrateTribunals(db) || changed;
  changed = migrateRanks(db) || changed;
  if (changed) saveDb();
  return changed;
}
