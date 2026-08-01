-- Migration: add the incidents collection (Incident / breach reports).
-- Apply to the live D1 before/at the deploy that ships incidents:
--   npx wrangler d1 execute <DB_NAME> --remote --file worker/migrate-incidents.sql
-- Idempotent (IF NOT EXISTS), so it is safe to run more than once.

CREATE TABLE IF NOT EXISTS incidents (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents (org);
