// =============================================================================
// storage.js — Persistence.
//
// The entire dataset lives as one JSON blob under CONFIG.storageKey.
// We try localStorage first; if it is unavailable (private mode, sandboxed
// iframe, storage disabled) we fall back to an in-memory object so the system
// still runs for the session. This mirrors the offline-safe pattern the live
// CAIRO bundle uses, and keeps the app working everywhere.
//
// Everything else in the app reads and writes through this module — no other
// file touches localStorage directly.
// =============================================================================

import { CONFIG } from './config.js';

const KEY = CONFIG.storageKey;

// Shape of an empty database.
function emptyDb() {
  return {
    meta: { version: CONFIG.version, seededAt: null },
    users: [],
    directives: [],
    subjects: [],
    cases: [],
    promoReqs: [],
    audit: [],
    session: { userId: null },
  };
}

// --- Backend detection ------------------------------------------------------
let backend = 'memory';
let memoryStore = {};

function detectLocalStorage() {
  try {
    const probe = '__cairo_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch (_) {
    return false;
  }
}

if (detectLocalStorage()) {
  backend = 'localStorage';
}

export function storageBackend() {
  return backend;
}

// --- Raw read / write -------------------------------------------------------
function readRaw() {
  if (backend === 'localStorage') {
    return window.localStorage.getItem(KEY);
  }
  return memoryStore[KEY] ?? null;
}

function writeRaw(value) {
  if (backend === 'localStorage') {
    try {
      window.localStorage.setItem(KEY, value);
      return;
    } catch (_) {
      // Quota or access error mid-session: degrade to memory, don't crash.
      backend = 'memory';
    }
  }
  memoryStore[KEY] = value;
}

// --- Public API -------------------------------------------------------------

// In-memory working copy of the database. Load once, mutate via save().
let db = null;

export function loadDb() {
  if (db) return db;
  const raw = readRaw();
  if (raw) {
    try {
      db = JSON.parse(raw);
      // Defensive: ensure every top-level collection exists.
      const base = emptyDb();
      db = { ...base, ...db, meta: { ...base.meta, ...(db.meta || {}) } };
    } catch (_) {
      db = emptyDb();
    }
  } else {
    db = emptyDb();
  }
  return db;
}

// Persist the current working copy.
export function saveDb() {
  if (!db) return;
  writeRaw(JSON.stringify(db));
}

// Replace the whole database (used by seeding / reset).
export function setDb(next) {
  db = next;
  saveDb();
  return db;
}

// Wipe everything and reload empty. Used by the "reset system" admin action.
export function clearDb() {
  if (backend === 'localStorage') {
    try { window.localStorage.removeItem(KEY); } catch (_) {}
  }
  delete memoryStore[KEY];
  db = null;
  return loadDb();
}

// --- Collection accessors ---------------------------------------------------
// Convenience getters so views read `users()` rather than reaching into db.
export const users = () => loadDb().users;
export const directives = () => loadDb().directives;
export const subjects = () => loadDb().subjects;
export const cases = () => loadDb().cases;
export const promoReqs = () => loadDb().promoReqs;
export const audit = () => loadDb().audit;
export const meta = () => loadDb().meta;
export const session = () => loadDb().session;

// Find / mutate a single user by id.
export function getUser(id) {
  return users().find((u) => u.id === id) || null;
}

export function upsertUser(user) {
  const list = users();
  const idx = list.findIndex((u) => u.id === user.id);
  if (idx >= 0) list[idx] = user;
  else list.push(user);
  saveDb();
  return user;
}

export function getDirective(id) {
  return directives().find((d) => d.id === id) || null;
}

export function upsertDirective(directive) {
  const list = directives();
  const idx = list.findIndex((d) => d.id === directive.id);
  if (idx >= 0) list[idx] = directive;
  else list.push(directive);
  saveDb();
  return directive;
}

export function getSubject(id) {
  return subjects().find((s) => s.id === id) || null;
}

export function upsertSubject(subject) {
  const list = subjects();
  const idx = list.findIndex((s) => s.id === subject.id);
  if (idx >= 0) list[idx] = subject;
  else list.push(subject);
  saveDb();
  return subject;
}

export function getCase(id) {
  return cases().find((c) => c.id === id) || null;
}

export function upsertCase(record) {
  const list = cases();
  const idx = list.findIndex((c) => c.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  saveDb();
  return record;
}

// Promotion-requirement sets — one per (org, fromRank) transition.
export function getPromoReq(id) {
  return promoReqs().find((r) => r.id === id) || null;
}

export function upsertPromoReq(record) {
  const list = promoReqs();
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  saveDb();
  return record;
}

export function deletePromoReq(id) {
  const db2 = loadDb();
  db2.promoReqs = db2.promoReqs.filter((r) => r.id !== id);
  saveDb();
}

// --- ID generator -----------------------------------------------------------
let counter = 0;
export function newId(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
