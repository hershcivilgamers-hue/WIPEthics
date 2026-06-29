// =============================================================================
// index.js — CAIRO.AIC API Worker.
//
// The privileged path between the app and the D1 database. Every request that
// touches data is authenticated against a server-issued session, and every read
// and write is filtered/authorized server-side using the SAME permission gates
// the app uses (imported directly from ../../js, so they cannot drift). Password
// hashing reuses the app's PBKDF2 (crypto.js), so the salt+hash format is
// identical and existing credentials work unchanged.
//
// The core is `handle(request, repo, env)`. The default export wraps it with a
// real D1-backed repo; tests call it with an in-memory repo.
// =============================================================================

import { makeCredential, verifyPassword } from '../../js/crypto.js';
import { makeD1Repo } from './repo.js';
import { authorizeWrite } from './gate.js';
import { buildSnapshot, redactUser, redactDirective, redactCompartment } from './redact.js';
import { canReadDirective, compartmentClears } from '../../js/permissions.js';

const WRITABLE = new Set(['users', 'directives', 'subjects', 'cases', 'compartments', 'activity', 'recruits', 'promo_reqs']);
const SNAPSHOT = ['users', 'directives', 'subjects', 'cases', 'compartments', 'activity', 'recruits', 'promo_reqs', 'audit'];

function uid() { return (globalThis.crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`); }
function randomToken() {
  const a = new Uint8Array(32);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env?.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// Resolve the acting operator from the Bearer token, or null.
async function authenticate(request, repo) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { actor: null, token: null };
  const token = m[1];
  const sess = await repo.getSession(token);
  if (!sess) return { actor: null, token };
  if (sess.expires_at && sess.expires_at < new Date().toISOString()) {
    await repo.deleteSession(token);
    return { actor: null, token };
  }
  const actor = await repo.getById('users', sess.user_id);
  if (!actor || actor.deleted) return { actor: null, token };
  return { actor, token };
}

async function fullDb(repo) {
  const db = {};
  for (const c of SNAPSHOT) db[c === 'promo_reqs' ? 'promoReqs' : c] = await repo.listAll(c);
  return db;
}

// Lookup of live compartments (keyed by id), used to gate compartmented records
// and to attach caveat markers on write responses.
async function compMapFor(repo) {
  const map = new Map();
  for (const c of await repo.listAll('compartments')) {
    if (c && !c.deleted) map.set(c.id, c);
  }
  return map;
}

// Map of operator id -> clearance, so the gate can enforce a compartment's
// clearance floor when reading someone in.
async function clearanceMap(repo) {
  const out = {};
  for (const u of await repo.listAll('users')) out[u.id] = u.clearance;
  return out;
}

// --- handlers ---------------------------------------------------------------
async function login(request, repo, env) {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;
  if (!username || !password) return json({ error: 'Username and password are required.' }, 400, env);
  const user = await repo.getUserByUsername(username);
  const okUser = user && !user.deleted && user.accountStatus === 'active';
  // Always run the hash compare (even on a miss) to avoid leaking which usernames exist.
  const ok = okUser && await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) return json({ error: 'Invalid credentials.' }, 401, env);

  await repo.pruneSessions(new Date().toISOString());
  const token = randomToken();
  const now = new Date();
  const ttlH = Number(env?.SESSION_TTL_HOURS || 12);
  const expires = new Date(now.getTime() + ttlH * 3600 * 1000);
  await repo.createSession(token, user.id, now.toISOString(), expires.toISOString());
  await repo.addAudit({ id: uid(), ts: now.toISOString(), actor: user.designation, action: 'LOGIN', detail: 'Signed in.' });
  return json({ token, user: redactUser(user, user) }, 200, env);
}

async function register(request, repo, env) {
  const body = await request.json().catch(() => ({}));
  const { codename, username, password, requestedOrg } = body;
  if (!codename || !username || !password || !requestedOrg) {
    return json({ error: 'Codename, username, password and organisation are required.' }, 400, env);
  }
  const existing = await repo.getUserByUsername(username);
  if (existing) return json({ error: 'That operator ID is already in use.' }, 409, env);

  const { salt, hash } = await makeCredential(password);
  const now = new Date().toISOString();
  const record = {
    id: `usr-${uid()}`,
    designation: 'PENDING',
    codename,
    realName: '[REDACTED]',
    org: requestedOrg,
    rank: null,
    clearance: null,
    status: 'active',
    username,
    salt,
    passwordHash: hash,
    accountStatus: 'pending',
    requestedOrg,
    awards: [], strikes: [], promoChecks: [], leave: null, notes: [], events: [],
    createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
  };
  await repo.insert('users', record);
  await repo.addAudit({ id: uid(), ts: now, actor: codename, action: 'REGISTRATION', detail: `Access requested for ${requestedOrg}.` });
  return json({ ok: true }, 201, env);
}

async function getData(actor, repo, env) {
  const db = await fullDb(repo);
  return json(buildSnapshot(actor, db), 200, env);
}

function redactForActor(collection, actor, record, compMap) {
  if (collection === 'users') return redactUser(actor, record);
  if (collection === 'directives') return redactDirective(actor, record, compMap);
  if (collection === 'compartments') return redactCompartment(actor, record);
  if ((collection === 'subjects' || collection === 'cases') && record && record.compartment) {
    const c = compMap && compMap.get(record.compartment);
    return { ...record, compartmentName: c ? c.name : null };
  }
  return record; // subjects/cases/promo_reqs are hard-gated wholesale
}

async function writeRecord(collection, id, actor, request, repo, env) {
  if (!WRITABLE.has(collection)) return json({ error: 'Unknown collection.' }, 404, env);
  const incoming = await request.json().catch(() => null);
  if (!incoming || incoming.id !== id) return json({ error: 'Malformed record.' }, 400, env);

  // Optional audit hints from the client; never stored in the record. The
  // server prefers the label it derives from the diff (see gate.js).
  const clientAction = typeof incoming._action === 'string' ? incoming._action.slice(0, 40) : null;
  const clientDetail = typeof incoming._detail === 'string' ? incoming._detail.slice(0, 200) : null;
  delete incoming._action; delete incoming._detail;

  // Strip the presentation-only fields the server itself adds when redacting on
  // read (accessLevel on users, bodyWithheld on directives, the compartment
  // caveat markers and roster counts). The client holds a redacted copy and
  // sends it straight back on a write, so if these survived they would (a) make
  // the gate's diff see a phantom change — turning a plain promotion into an
  // illegal "rank change combined with other edits" — and (b) get persisted as
  // junk. They are recomputed on every read regardless.
  delete incoming.accessLevel;
  delete incoming.bodyWithheld;
  delete incoming.compartmentName;
  delete incoming.compartmented;
  delete incoming.membersCount;
  delete incoming.access;

  const cur = await repo.getById(collection, id);
  // Context the authorizers need to reason beyond the single record: the live
  // compartment map (Need-To-Know gating) and, for roster writes, every
  // operator's clearance (the read-in floor check).
  const compMap = await compMapFor(repo);
  const ctx = { compMap };
  if (collection === 'compartments') ctx.clearanceOf = await clearanceMap(repo);
  const verdict = authorizeWrite(collection, actor, cur, incoming, ctx);
  if (!verdict.ok) return json({ error: verdict.error }, verdict.status, env);

  // Integrity: the server owns credentials, timestamps and version numbers,
  // and preserves any field the actor isn't cleared to see so a partial edit
  // can't blank it.
  if (collection === 'users') {
    if (cur) { incoming.salt = cur.salt; incoming.passwordHash = cur.passwordHash; }
    else if (!incoming.salt || !incoming.passwordHash) {
      const { salt, hash } = await makeCredential(randomToken());
      incoming.salt = salt; incoming.passwordHash = hash;
    }
    if (!incoming.username) return json({ error: 'A new operator needs an operator ID.' }, 400, env);
  }
  if (collection === 'directives' && cur
      && !(canReadDirective(actor, cur) && compartmentClears(actor, cur, compMap))) {
    incoming.body = cur.body; // editor manages metadata but cannot read/replace the body
  }
  incoming.updatedAt = new Date().toISOString();

  if (cur) {
    incoming.version = (cur.version || 1) + 1;
    const changed = await repo.update(collection, incoming, cur.version || 1);
    if (changed === 0) return json({ error: 'This record was changed elsewhere. Reload and retry.' }, 409, env);
  } else {
    incoming.version = 1;
    await repo.insert(collection, incoming);
  }

  await repo.addAudit({ id: uid(), ts: incoming.updatedAt, actor: actor.designation, action: verdict.action || clientAction || 'WRITE', detail: verdict.detail || clientDetail || `${collection}:${id}` });
  return json({ record: redactForActor(collection, actor, incoming, compMap) }, 200, env);
}

async function deleteRecord(collection, id, actor, repo, env) {
  // Only the promotion-requirements registry is hard-deleted; everything else
  // is soft-deleted through a normal write.
  if (collection !== 'promo_reqs') return json({ error: 'Use a soft delete (PUT) for this collection.' }, 400, env);
  const verdict = authorizeWrite('promo_reqs', actor, await repo.getById('promo_reqs', id), {});
  if (!verdict.ok) return json({ error: verdict.error }, verdict.status, env);
  await repo.hardDelete('promo_reqs', id);
  await repo.addAudit({ id: uid(), ts: new Date().toISOString(), actor: actor.designation, action: 'REMOVE_PROMO_REQ', detail: `promo_reqs:${id}` });
  return json({ ok: true }, 200, env);
}

// --- router -----------------------------------------------------------------
export async function handle(request, repo, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/'); // e.g. ['api','users','id']
  if (parts[0] !== 'api') return json({ error: 'Not found.' }, 404, env);

  // Open endpoints.
  if (parts[1] === 'login' && request.method === 'POST') return login(request, repo, env);
  if (parts[1] === 'register' && request.method === 'POST') return register(request, repo, env);

  // Everything else requires a valid session.
  const { actor, token } = await authenticate(request, repo);
  if (!actor) return json({ error: 'Not authenticated.' }, 401, env);

  if (parts[1] === 'logout' && request.method === 'POST') {
    if (token) await repo.deleteSession(token);
    return json({ ok: true }, 200, env);
  }
  if (parts[1] === 'me' && request.method === 'GET') return json({ user: redactUser(actor, actor) }, 200, env);
  if (parts[1] === 'data' && request.method === 'GET') return getData(actor, repo, env);

  // Collection writes: /api/:collection/:id
  if (parts.length === 3) {
    const [, collection, id] = parts;
    if (request.method === 'PUT') return writeRecord(collection, id, actor, request, repo, env);
    if (request.method === 'DELETE') return deleteRecord(collection, id, actor, repo, env);
  }

  return json({ error: 'Not found.' }, 404, env);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, makeD1Repo(env.DB), env);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Server error.', detail: String(err && err.message || err) }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
      });
    }
  },
};
