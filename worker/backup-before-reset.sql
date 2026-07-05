PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE directives (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE subjects (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE cases (
  id          TEXT PRIMARY KEY,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE compartments (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE activity (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE operations (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE intel (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE trainings (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER DEFAULT 0,
  version     INTEGER DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE recruits (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE promo_reqs (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE settings (
  id          TEXT PRIMARY KEY,
  org         TEXT,
  data        TEXT NOT NULL
);
CREATE TABLE audit (
  id          TEXT PRIMARY KEY,
  ts          TEXT,
  actor       TEXT,
  action      TEXT,
  detail      TEXT
);
CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  TEXT,
  expires_at  TEXT
);
CREATE TABLE auth_throttle (
  key          TEXT PRIMARY KEY,
  attempts     INTEGER NOT NULL DEFAULT 0,
  window_start TEXT,
  locked_until TEXT
);
CREATE TABLE meta (
  key         TEXT PRIMARY KEY,
  value       TEXT
);
CREATE INDEX idx_users_org ON users (org);
CREATE INDEX idx_users_deleted ON users (deleted);
CREATE INDEX idx_compartments_org ON compartments (org);
CREATE INDEX idx_activity_org ON activity (org);
CREATE INDEX idx_operations_org ON operations (org);
CREATE INDEX idx_intel_org ON intel (org);
CREATE INDEX idx_trainings_org ON trainings (org);
CREATE INDEX idx_recruits_org ON recruits (org);
CREATE INDEX idx_audit_ts ON audit (ts);
CREATE INDEX idx_sessions_user ON sessions (user_id);
