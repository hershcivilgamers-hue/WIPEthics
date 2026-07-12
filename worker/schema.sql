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

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);

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

-- Omega-1 operations & deployment log. Clearance-gated like subjects; may carry
-- a Need-To-Know caveat. data.lead / data.participants link operators.
CREATE TABLE IF NOT EXISTS operations (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operations_org ON operations (org);

CREATE TABLE IF NOT EXISTS intel (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intel_org ON intel (org);

CREATE TABLE IF NOT EXISTS blacklist (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blacklist_org ON blacklist (org);

CREATE TABLE IF NOT EXISTS trainings (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trainings_org ON trainings (org);

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

-- Weekly per-operator engagement scores (Sr CL4 command tool).
CREATE TABLE IF NOT EXISTS engagement (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engagement_org ON engagement (org);

CREATE TABLE IF NOT EXISTS promo_reqs (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  data        TEXT NOT NULL
);

-- Global configuration (e.g. the activity requirements). One record per setting
-- key; readable by all authenticated operators, writable at CL5.
CREATE TABLE IF NOT EXISTS settings (
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

-- Failed sign-in throttle. One row per key ("ip:<addr>" or "user:<name>"): a
-- sliding count of recent failures and, once the limit is hit, a lockout stamp.
-- Cleared on a successful sign-in. Additive and safe to re-run.
CREATE TABLE IF NOT EXISTS auth_throttle (
  key          TEXT PRIMARY KEY,
  attempts     INTEGER NOT NULL DEFAULT 0,
  window_start TEXT,
  locked_until TEXT
);

-- Small key/value bag for bookkeeping (e.g. when the dataset was seeded).
CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT
);
