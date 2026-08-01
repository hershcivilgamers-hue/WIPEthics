-- Migration: add the commendations collection (Commendation nominations).
-- Apply to the live D1 at/ before the deploy that ships commendations:
--   npx wrangler d1 execute cairo-aic --remote --file worker/migrate-commendations.sql
-- Idempotent (IF NOT EXISTS), so it is safe to run more than once.

CREATE TABLE IF NOT EXISTS commendations (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commendations_org ON commendations (org);
