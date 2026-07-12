// =============================================================================
// storage.js — Persistence.
//
// Two modes, chosen by CONFIG.apiBaseUrl:
//
//   • Standalone (apiBaseUrl null): the entire dataset lives as one JSON blob
//     under CONFIG.storageKey in localStorage, with an in-memory fallback for
//     private/sandboxed contexts. This is the original offline-safe behaviour.
//
//   • Server (apiBaseUrl set): the in-memory working copy is filled from the
//     Worker (already filtered to what the operator may see), and every change
//     is pushed back per-record over the network — localStorage is not used.
//     The network plumbing lives in api.js; the write/error orchestration in
//     sync.js, which registers a handler here at boot.
//
// Either way, everything else in the app reads and writes through this module —
// no other file touches localStorage or the network for data.
// =============================================================================

import { CONFIG } from './config.js';

const KEY = CONFIG.storageKey;

// Shape of an empty database.
function emptyDb() {
  return {
    meta: { version: CONFIG.version, seededAt: null },
    users: [],
    directives: [],
    documents: [],
    subjects: [],
    cases: [],
    compartments: [],
    activity: [],
    recruits: [],
    operations: [],
    intel: [],
    blacklist: [],
    trainings: [],
    engagement: [],
    promoReqs: [],
    settings: [],
    audit: [],
    session: { userId: null },
  };
}

// --- Backend detection (standalone mode) ------------------------------------
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
      backend = 'memory';
    }
  }
  memoryStore[KEY] = value;
}

// --- Server mode ------------------------------------------------------------
export function isServerMode() { return !!CONFIG.apiBaseUrl; }

// A { write(collection, record), remove(collection, id) } handler, registered
// by sync.js when running against the Worker.
let sync = null;
export function setSync(handler) { sync = handler; }

// API collection name -> in-memory db key.
function cacheKey(collection) { return collection === 'promo_reqs' ? 'promoReqs' : collection; }

// Replace the working copy from a server snapshot (already redacted per viewer).
export function applyServerSnapshot(snap) {
  const base = emptyDb();
  db = {
    ...base,
    users: snap.users || [],
    directives: snap.directives || [],
    documents: snap.documents || [],
    subjects: snap.subjects || [],
    cases: snap.cases || [],
    compartments: snap.compartments || [],
    activity: snap.activity || [],
    recruits: snap.recruits || [],
    operations: snap.operations || [],
    intel: snap.intel || [],
    trainings: snap.trainings || [],
    engagement: snap.engagement || [],
    blacklist: snap.blacklist || [],
    promoReqs: snap.promoReqs || [],
    settings: snap.settings || [],
    audit: snap.audit || [],
    meta: { ...base.meta, seededAt: 'server' },
    session: { userId: null },
  };
  return db;
}

// Silently adopt a server-canonical record into the cache (no re-push), so the
// local copy carries the server's version/timestamp after a successful save.
export function applyServerRecord(collection, record) {
  if (!record) return;
  const list = loadDb()[cacheKey(collection)];
  if (!list) return;
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) list[idx] = record; else list.push(record);
}

// Persist after a mutation: push to the server in server mode, else save local.
function afterWrite(collection, record) {
  if (isServerMode()) { if (sync) sync.write(collection, record); }
  else saveDb();
}
function afterDelete(collection, id) {
  if (isServerMode()) { if (sync) sync.remove(collection, id); }
  else saveDb();
}

// --- Public API -------------------------------------------------------------

// In-memory working copy of the database.
let db = null;

export function loadDb() {
  if (db) return db;
  // In server mode the working copy is populated by applyServerSnapshot at boot
  // / sign-in. Until then it's an empty shell (never read from localStorage).
  if (isServerMode()) {
    if (!db) db = emptyDb();
    return db;
  }
  const raw = readRaw();
  if (raw) {
    try {
      db = JSON.parse(raw);
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

// Persist the current working copy. No-op in server mode (writes go per-record
// over the network instead).
export function saveDb() {
  if (!db) return;
  if (isServerMode()) return;
  writeRaw(JSON.stringify(db));
}

// Replace the whole database (used by seeding / reset in standalone mode).
export function setDb(next) {
  db = next;
  saveDb();
  return db;
}

// Wipe everything and reload empty (standalone "reset system"). Inert in server
// mode — the data lives on the server, not in this browser.
export function clearDb() {
  if (isServerMode()) return loadDb();
  if (backend === 'localStorage') {
    try { window.localStorage.removeItem(KEY); } catch (_) {}
  }
  delete memoryStore[KEY];
  db = null;
  return loadDb();
}

// --- Collection accessors ---------------------------------------------------
export const users = () => loadDb().users;
export const directives = () => loadDb().directives;
export const documents = () => loadDb().documents;
export const subjects = () => loadDb().subjects;
export const cases = () => loadDb().cases;
export const compartments = () => loadDb().compartments;
export const activity = () => loadDb().activity;
export const recruits = () => loadDb().recruits;
export const operations = () => loadDb().operations;
export const promoReqs = () => loadDb().promoReqs;
export const settings = () => loadDb().settings;
export const audit = () => loadDb().audit;
export const meta = () => loadDb().meta;
export const session = () => loadDb().session;

export function getUser(id) {
  return users().find((u) => u.id === id) || null;
}

export function upsertUser(user) {
  const list = users();
  const idx = list.findIndex((u) => u.id === user.id);
  if (idx >= 0) list[idx] = user;
  else list.push(user);
  afterWrite('users', user);
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
  afterWrite('directives', directive);
  return directive;
}

export function getDocument(id) {
  return documents().find((d) => d.id === id) || null;
}
export function upsertDocument(doc) {
  const list = documents();
  const i = list.findIndex((d) => d.id === doc.id);
  if (i >= 0) list[i] = doc; else list.push(doc);
  afterWrite('documents', doc);
}

export function getSubject(id) {
  return subjects().find((s) => s.id === id) || null;
}

export function upsertSubject(subject) {
  const list = subjects();
  const idx = list.findIndex((s) => s.id === subject.id);
  if (idx >= 0) list[idx] = subject;
  else list.push(subject);
  afterWrite('subjects', subject);
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
  afterWrite('cases', record);
  return record;
}

// Need-To-Know compartments. Soft-deleted (recycle bin) like other records, so
// there is no hard-delete accessor.
export function getCompartment(id) {
  return compartments().find((c) => c.id === id) || null;
}

export function upsertCompartment(record) {
  const list = compartments();
  const idx = list.findIndex((c) => c.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  afterWrite('compartments', record);
  return record;
}

// Operational activity — one record per operator, keyed by userId.
export function getActivity(id) {
  return activity().find((a) => a.id === id) || null;
}
export function getActivityForUser(userId) {
  return activity().find((a) => a.userId === userId) || null;
}
export function upsertActivity(record) {
  const list = activity();
  const idx = list.findIndex((a) => a.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  afterWrite('activity', record);
  return record;
}

// Recruitment candidates.
export function getRecruit(id) {
  return recruits().find((r) => r.id === id) || null;
}
export function upsertRecruit(record) {
  const list = recruits();
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  afterWrite('recruits', record);
  return record;
}

export function getOperation(id) {
  return operations().find((r) => r.id === id) || null;
}
export function upsertOperation(record) {
  const list = operations();
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  afterWrite('operations', record);
  return record;
}

export const intel = () => loadDb().intel;
export function getIntel(id) {
  return intel().find((r) => r.id === id) || null;
}
export function upsertIntel(record) {
  const list = intel();
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  afterWrite('intel', record);
  return record;
}

export const blacklist = () => loadDb().blacklist;
export function getBlacklistEntry(id) {
  return blacklist().find((r) => r.id === id) || null;
}
export function upsertBlacklistEntry(record) {
  const list = blacklist();
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  afterWrite('blacklist', record);
  return record;
}

export const trainings = () => loadDb().trainings;
export function getTraining(id) {
  return trainings().find((r) => r.id === id) || null;
}
export function upsertTraining(record) {
  const list = trainings();
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  afterWrite('trainings', record);
  return record;
}

// Weekly engagement scores — one record per (operator, weekStart).
export const engagement = () => loadDb().engagement;
export function getEngagement(id) {
  return engagement().find((r) => r.id === id) || null;
}
export function getEngagementFor(userId, weekStart) {
  return engagement().find((r) => r.userId === userId && r.weekStart === weekStart && !r.deleted) || null;
}
export function upsertEngagement(record) {
  const list = engagement();
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  afterWrite('engagement', record);
  return record;
}

// Promotion-requirement sets — one per (org, fromRank) transition.
export function getPromoReq(id) {
  return promoReqs().find((r) => r.id === id) || null;
}

export function getSetting(id) {
  return settings().find((r) => r.id === id) || null;
}
export function upsertSetting(record) {
  const list = settings();
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  afterWrite('settings', record);
  return record;
}
export function upsertPromoReq(record) {
  const list = promoReqs();
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  afterWrite('promo_reqs', record);
  return record;
}

export function deletePromoReq(id) {
  const db2 = loadDb();
  db2.promoReqs = db2.promoReqs.filter((r) => r.id !== id);
  afterDelete('promo_reqs', id);
}

// --- ID generator -----------------------------------------------------------
let counter = 0;
export function newId(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
