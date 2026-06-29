-- =============================================================================
-- CAIRO.AIC — D1 schema
--
-- One table per collection. Each row keeps a few promoted columns for filtering
-- and optimistic concurrency (id, org, deleted, version, updated_at) plus a
-- `data` column holding the full JSON record exactly as the app uses it. The
-- Worker derives the promoted columns from the record on every write, so they
-- never drift from `data`.
--
-- Apply with:  wrangler d1 execute cairo-aic --remote --file=./schema.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users (org);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users (deleted);

CREATE TABLE IF NOT EXISTS directives (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id          TEXT PRIMARY KEY,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);

-- Need-To-Know compartments. An access caveat orthogonal to the clearance
-- ladder; the roster of read-in operators lives inside `data.members`.
CREATE TABLE IF NOT EXISTS compartments (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compartments_org ON compartments (org);

-- Operational activity / readiness. One record per operator (data.userId links
-- to the user); the running check-in log lives in data.entries.
CREATE TABLE IF NOT EXISTS activity (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_org ON activity (org);

-- Recruitment candidate pipeline (pre-personnel).
CREATE TABLE IF NOT EXISTS recruits (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recruits_org ON recruits (org);

CREATE TABLE IF NOT EXISTS promo_reqs (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  data        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id          TEXT PRIMARY KEY,
  ts          TEXT,
  actor       TEXT,
  action      TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts);

-- Server-issued login sessions. The token is an opaque random string; the app
-- sends it as `Authorization: Bearer <token>`.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  TEXT,
  expires_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- Small key/value bag for bookkeeping (e.g. when the dataset was seeded).
CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT
);
