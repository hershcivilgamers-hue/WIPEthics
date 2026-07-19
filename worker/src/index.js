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
import { askCairo, validateMessage, checkRate } from './terminal.js';
import { authorizeWrite } from './gate.js';
import { assessInterview } from './interview-assess.js';
import { buildSnapshot, redactUser, redactDirective, redactCompartment, redactDocument } from './redact.js';
import { canReadDirective, compartmentClears, canManageOrg, isCL5, canParticipateRecruitment } from '../../js/permissions.js';
import { CLEARANCES } from '../../js/constants.js';

const WRITABLE = new Set(['users', 'documents', 'directives', 'subjects', 'cases', 'compartments', 'activity', 'recruits', 'operations', 'intel', 'trainings', 'engagement', 'evidence', 'blacklist', 'promo_reqs', 'settings']);
const SNAPSHOT = ['users', 'documents', 'directives', 'subjects', 'cases', 'compartments', 'activity', 'recruits', 'operations', 'intel', 'trainings', 'engagement', 'evidence', 'blacklist', 'promo_reqs', 'settings', 'audit'];

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
// Resolve the CORS origin for this request. ALLOWED_ORIGIN may be a single value
// or a comma-separated allowlist; the matching request origin is echoed back so
// several sites (e.g. a github.io address and a custom domain) can be permitted.
// "*" stays fully permissive for local testing. Returns an env clone carrying the
// single resolved origin, so the rest of the handler is unchanged.
function withResolvedOrigin(env, request) {
  const configured = (env && env.ALLOWED_ORIGIN) || '*';
  if (configured === '*') return env || {};
  const list = configured.split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const allow = list.includes(origin) ? origin : (list[0] || '*');
  return { ...env, ALLOWED_ORIGIN: allow };
}
function json(data, status, env, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env), ...(extraHeaders || {}) },
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
  // A suspension takes effect immediately: existing sessions are refused and
  // dropped, not merely new sign-ins (login already requires an active account).
  if (actor.accountStatus === 'suspended') {
    await repo.deleteSession(token);
    return { actor: null, token };
  }
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
// --- failed sign-in throttle -----------------------------------------------
// Tracks failures per key ("ip:<addr>" and "user:<name>") in a sliding window
// and imposes a timed lockout once the limit is reached. Keeps brute-forcing
// expensive without locking a real user out for long.
function throttleConf(env) {
  return {
    max: Number((env && env.LOGIN_MAX_ATTEMPTS) || 6),
    windowMs: Number((env && env.LOGIN_WINDOW_MIN) || 15) * 60000,
    lockMs: Number((env && env.LOGIN_LOCK_MIN) || 15) * 60000,
  };
}
async function throttleLockedUntil(repo, keys, nowMs) {
  let until = 0;
  for (const k of keys) {
    const row = await repo.getThrottle(k);
    if (row && row.locked_until) {
      const t = Date.parse(row.locked_until);
      if (t > nowMs && t > until) until = t;
    }
  }
  return until;
}
async function throttleFail(repo, keys, env, nowMs) {
  const { max, windowMs, lockMs } = throttleConf(env);
  for (const k of keys) {
    const row = await repo.getThrottle(k);
    let attempts = 1; let windowStart = nowMs;
    if (row && row.window_start) {
      const ws = Date.parse(row.window_start);
      if (nowMs - ws < windowMs) { attempts = (row.attempts || 0) + 1; windowStart = ws; }
    }
    const lockedUntil = attempts >= max ? new Date(nowMs + lockMs).toISOString() : null;
    await repo.setThrottle(k, attempts, new Date(windowStart).toISOString(), lockedUntil);
  }
}
async function throttleClear(repo, keys) {
  for (const k of keys) await repo.clearThrottle(k);
}

async function login(request, repo, env) {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;
  if (!username || !password) return json({ error: 'Username and password are required.' }, 400, env);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const keys = [`ip:${ip}`, `user:${String(username).toLowerCase()}`];
  const nowMs = Date.now();
  const lockedUntil = await throttleLockedUntil(repo, keys, nowMs);
  if (lockedUntil) {
    const retry = Math.max(1, Math.ceil((lockedUntil - nowMs) / 1000));
    return json({ error: 'Too many failed sign-in attempts. Please wait and try again.' }, 429, env, { 'Retry-After': String(retry) });
  }

  const user = await repo.getUserByUsername(username);
  const okUser = user && !user.deleted && user.accountStatus === 'active';
  // Always run the hash compare (even on a miss) to avoid leaking which usernames exist.
  const ok = okUser && await verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) {
    await throttleFail(repo, keys, env, nowMs);
    return json({ error: 'Invalid credentials.' }, 401, env);
  }
  await throttleClear(repo, keys);

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
  const { codename, username, password, requestedOrg, requestedRank } = body;
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
    requestedRank: requestedRank || null,
    awards: [], strikes: [], promoChecks: [], leave: null, notes: [], events: [],
    createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
  };
  await repo.insert('users', record);
  await repo.addAudit({ id: uid(), ts: now, actor: codename, action: 'REGISTRATION', detail: `Access requested for ${requestedOrg}${requestedRank ? ` (rank sought: ${requestedRank})` : ''}.` });
  return json({ ok: true }, 201, env);
}

async function getData(actor, repo, env) {
  const db = await fullDb(repo);
  return json(buildSnapshot(actor, db), 200, env);
}

function redactForActor(collection, actor, record, compMap) {
  if (collection === 'users') return redactUser(actor, record);
  if (collection === 'documents') return redactDocument(actor, record);
  if (collection === 'directives') return redactDirective(actor, record, compMap);
  if (collection === 'compartments') return redactCompartment(actor, record);
  if ((collection === 'subjects' || collection === 'cases' || collection === 'operations' || collection === 'intel') && record && record.compartment) {
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
    if (cur) { incoming.salt = cur.salt; incoming.passwordHash = cur.passwordHash; incoming.mustChangePassphrase = cur.mustChangePassphrase ?? false; }
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
  // CAIRO's interview verdict is authored only by the dedicated /assess endpoint.
  // Freeze it from `cur` so an ordinary sync write can neither forge nor blank it.
  if (collection === 'recruits' && cur) incoming.interviewAssessment = cur.interviewAssessment ?? null;
  // A candidate's track is set once at creation (opening a Member candidate needs
  // CL5) and is immutable thereafter. Freeze it from `cur` so no sync write can
  // flip a Member candidate onto the Assistant track (or vice versa) to slip past
  // the CL5-only Member gate. See authorizeRecruit in gate.js.
  if (collection === 'recruits' && cur) incoming.track = cur.track ?? null;
  // Evidence: the status a NEW self-submission lands with follows the operator's
  // review flag — the client cannot choose it, so nobody self-approves an item
  // that was meant for review. A manager may file with any valid status.
  if (collection === 'evidence' && !cur) {
    const target = await repo.getById('users', incoming.userId);
    const reviewReq = !!(target && target.evidenceReviewRequired);
    const isMgr = canManageOrg(actor, incoming.org || 'omega-1');
    if (!isMgr || !['counted', 'pending', 'rejected'].includes(incoming.status)) {
      incoming.status = reviewReq ? 'pending' : 'counted';
    }
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

// Set a new sign-in passphrase for an operator. Hashing happens here (never on
// the client), and the new credential is written straight to the record — the
// generic write path freezes salt/passwordHash, so this dedicated, authorised
// route is the only way credentials can change. A manager may reset accounts in
// an organisation they administer, but never one at a clearance above their own
// (which would let a junior seize a senior's login).
async function resetPassphrase(id, actor, request, repo, env) {
  const target = await repo.getById('users', id);
  if (!target || target.deleted) return json({ error: 'No such operator.' }, 404, env);
  if (!canManageOrg(actor, target.org)) return json({ error: 'You cannot administer accounts in that organisation.' }, 403, env);
  const weight = (u) => (CLEARANCES[u.clearance] ? CLEARANCES[u.clearance].weight : 0);
  if (weight(target) > weight(actor)) return json({ error: 'You cannot reset the passphrase of an operator above your own clearance.' }, 403, env);

  let body; try { body = await request.json(); } catch (_e) { body = {}; }
  const passphrase = (body && body.passphrase ? String(body.passphrase) : '').trim();
  if (passphrase.length < 6) return json({ error: 'A passphrase must be at least 6 characters.' }, 400, env);

  const { salt, hash } = await makeCredential(passphrase);
  const now = new Date().toISOString();
  // The temporary passphrase is known to the administrator, so the operator is
  // forced to replace it at their next sign-in — and every existing session for
  // the account is ended, so a reset also evicts anyone holding a stolen token.
  const updated = { ...target, salt, passwordHash: hash, mustChangePassphrase: true, updatedAt: now, version: (target.version || 1) + 1 };
  updated.events = [{ id: uid(), date: now, type: 'security', text: `Passphrase reset by ${actor.designation}; change required at next sign-in.` }, ...(target.events || [])];
  const changed = await repo.update('users', updated, target.version || 1);
  if (changed === 0) return json({ error: 'This record was changed elsewhere. Reload and retry.' }, 409, env);
  await repo.deleteUserSessions(target.id);
  await repo.addAudit({ id: uid(), ts: now, actor: actor.designation, action: 'RESET_PASSPHRASE', detail: `Passphrase reset for ${target.designation}; sessions ended.` });
  return json({ ok: true, version: updated.version }, 200, env);
}

// Self-service passphrase change: the signed-in operator proves identity with
// their current passphrase, then sets a new one. Hashing is server-side and no
// clearance rule applies — you are only ever changing your own credential.
async function changeMyPassphrase(actor, request, repo, env) {
  let body; try { body = await request.json(); } catch (_e) { body = {}; }
  const current = body && body.currentPassphrase ? String(body.currentPassphrase) : '';
  const next = (body && body.newPassphrase ? String(body.newPassphrase) : '').trim();
  const okCurrent = await verifyPassword(current, actor.salt, actor.passwordHash);
  if (!okCurrent) return json({ error: 'Your current passphrase is incorrect.' }, 403, env);
  if (next.length < 6) return json({ error: 'A passphrase must be at least 6 characters.' }, 400, env);
  const { salt, hash } = await makeCredential(next);
  const now = new Date().toISOString();
  const updated = { ...actor, salt, passwordHash: hash, mustChangePassphrase: false, updatedAt: now, version: (actor.version || 1) + 1 };
  updated.events = [{ id: uid(), date: now, type: 'security', text: 'Passphrase changed by the operator.' }, ...(actor.events || [])];
  const changed = await repo.update('users', updated, actor.version || 1);
  if (changed === 0) return json({ error: 'This record was changed elsewhere. Reload and retry.' }, 409, env);
  await repo.addAudit({ id: uid(), ts: now, actor: actor.designation, action: 'CHANGE_PASSPHRASE', detail: `${actor.designation} changed their passphrase.` });
  return json({ ok: true, version: updated.version }, 200, env);
}

// CAIRO interview assessment. The model runs server-side (keys never reach the
// client); the verdict is written straight onto the recruit as the server-owned
// `interviewAssessment` field. Triggerable by CL5 or an operator CL5 has assigned
// to the interview — advisory only; the pass/fail decision stays with CL5.
async function assessInterviewEndpoint(id, actor, repo, env) {
  const r = await repo.getById('recruits', id);
  if (!r || r.deleted) return json({ error: 'No such candidate.' }, 404, env);
  if (r.org !== 'ethics-committee' || r.stage !== 'interview') {
    return json({ error: 'Assessment is only available for an Ethics application at the interview stage.' }, 409, env);
  }
  const assigned = Array.isArray(r.interviewers) && r.interviewers.includes(actor.id);
  if (!isCL5(actor) && !(assigned && canParticipateRecruitment(actor, 'ethics-committee'))) {
    return json({ error: 'Only CL5 or an assigned interviewer may request an assessment.' }, 403, env);
  }
  const responses = r.interviewResponses || {};
  const anyAnswer = Object.values(responses).some((x) => x && String(x.text || '').trim());
  if (!anyAnswer) return json({ error: 'No responses have been recorded to assess yet.' }, 400, env);

  const rate = checkRate(actor.id);
  if (!rate.ok) return json({ error: rate.error }, 429, env);

  let result;
  try {
    result = await assessInterview(env, r);
  } catch (e) {
    console.error('[assess] provider error:', (e && e.message) || e);
    if (e && e.offline) return json({ error: e.message }, 503, env);
    // Surface the real cause (truncated). This is an operator tool — a generic
    // message just hides whether the provider failed or its output was unparseable.
    return json({ error: `Assessment failed: ${String((e && e.message) || 'the cognition core did not answer').slice(0, 300)}` }, 502, env);
  }

  const now = new Date().toISOString();
  const updated = {
    ...r,
    interviewAssessment: { ...result.assessment, model: result.model, at: now, by: actor.designation },
    updatedAt: now,
    version: (r.version || 1) + 1,
  };
  const changed = await repo.update('recruits', updated, r.version || 1);
  if (changed === 0) return json({ error: 'This candidate was changed elsewhere. Reload and retry.' }, 409, env);
  await repo.addAudit({ id: uid(), ts: now, actor: actor.designation, action: 'ASSESS_INTERVIEW', detail: `CAIRO assessment recorded for ${r.ref}.` });
  return json({ ok: true, assessment: updated.interviewAssessment, version: updated.version }, 200, env);
}

// --- router -----------------------------------------------------------------
export async function handle(request, repo, rawEnv) {
  const env = withResolvedOrigin(rawEnv, request);
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

  // The CAIRO cognition terminal: in-universe AI chat for signed-in operators.
  // Auth first, then a soft per-operator rate limit; the provider call itself
  // lives in terminal.js. Failures return in-character text with real statuses.
  if (parts.length === 2 && parts[1] === 'terminal' && request.method === 'POST') {
    const { actor } = await authenticate(request, repo);
    if (!actor) return json({ error: 'Not signed in.' }, 401, env);
    let body = {};
    try { body = await request.json(); } catch (_) { /* fall through to validation */ }
    const check = validateMessage(body.message);
    if (!check.ok) return json({ error: check.error }, 400, env);
    const rate = checkRate(actor.id);
    if (!rate.ok) return json({ error: rate.error }, 429, env);
    try {
      const reply = await askCairo(env, actor, check.text, body.history);
      return json({ reply }, 200, env);
    } catch (e) {
      // Log the true cause: visible via `wrangler tail`, hidden from the operator.
      console.error('[terminal] provider error:', (e && e.message) || e);
      const msg = e && e.offline ? e.message : 'SIGNAL DEGRADED \u2014 the cognition core did not answer. Retry shortly.';
      return json({ error: msg }, e && e.offline ? 503 : 502, env);
    }
  }

  if (parts[1] === 'logout' && request.method === 'POST') {
    if (token) await repo.deleteSession(token);
    return json({ ok: true }, 200, env);
  }
  if (parts[1] === 'me' && request.method === 'GET') return json({ user: redactUser(actor, actor) }, 200, env);
  if (parts.length === 3 && parts[1] === 'me' && parts[2] === 'passphrase' && request.method === 'POST') {
    return changeMyPassphrase(actor, request, repo, env);
  }
  // Sign out of every device: drop all of the caller's sessions at once.
  if (parts.length === 3 && parts[1] === 'me' && parts[2] === 'sessions' && request.method === 'DELETE') {
    const n = await repo.deleteUserSessions(actor.id);
    await repo.addAudit({ id: uid(), ts: new Date().toISOString(), actor: actor.designation, action: 'SIGN_OUT_ALL', detail: `Signed out of all sessions (${n}).` });
    return json({ ok: true, cleared: n }, 200, env);
  }
  if (parts[1] === 'data' && request.method === 'GET') return getData(actor, repo, env);

  // Collection writes: /api/:collection/:id
  if (parts.length === 3) {
    const [, collection, id] = parts;
    if (request.method === 'PUT') return writeRecord(collection, id, actor, request, repo, env);
    if (request.method === 'DELETE') return deleteRecord(collection, id, actor, repo, env);
  }

  // Credential reset: POST /api/users/:id/passphrase (server hashes; never synced).
  if (parts.length === 4 && parts[1] === 'users' && parts[3] === 'passphrase' && request.method === 'POST') {
    return resetPassphrase(parts[2], actor, request, repo, env);
  }

  // CAIRO interview assessment: POST /api/recruits/:id/assess. The model runs
  // server-side; the verdict is written straight to the record (server-owned).
  if (parts.length === 4 && parts[1] === 'recruits' && parts[3] === 'assess' && request.method === 'POST') {
    return assessInterviewEndpoint(parts[2], actor, repo, env);
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
