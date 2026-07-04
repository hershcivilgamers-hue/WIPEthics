-- =============================================================================
-- reset.sql — WIPE EVERYTHING.
--
-- Drops every table so that a fresh `schema.sql` + `seed.sql` (or `schema.sql`
-- alone, for a truly empty start) rebuilds the database from nothing. This is
-- IRREVERSIBLE: take a backup first —
--   npx wrangler d1 export cairo-aic --remote --output="backup-before-reset.sql"
--
-- Dropping `sessions` signs everyone out. Dropping `auth_throttle` clears any
-- login lockouts. `meta` holds the schema/seed markers.
-- =============================================================================

DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS directives;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS cases;
DROP TABLE IF EXISTS compartments;
DROP TABLE IF EXISTS activity;
DROP TABLE IF EXISTS operations;
DROP TABLE IF EXISTS intel;
DROP TABLE IF EXISTS trainings;
DROP TABLE IF EXISTS recruits;
DROP TABLE IF EXISTS promo_reqs;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS audit;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_throttle;
DROP TABLE IF EXISTS meta;
