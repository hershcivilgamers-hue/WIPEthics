// =============================================================================
// redact.js — Server-side redaction for the data snapshot.
//
// The whole point of moving to a Worker is that enforcement happens on the
// server, not in the browser. So the snapshot the API returns is already
// filtered to what the viewer is allowed to see — a CL3 operator literally
// never receives a CL5 case, a withheld directive body, or another operator's
// legal name. The browser still redacts for display, but it can only redact
// what it is given, and it is given nothing it shouldn't have.
//
// These rules mirror the dossier/export redaction in the app (full / partial /
// name-only) and the hard/soft gates for subjects, cases and directives. If the
// app's redaction policy changes, change it here too.
// =============================================================================

import {
  accessLevel, canReadDirective, canViewSubject, canViewCase, isCL5,
  compartmentClears, readIntoCompartment, canManageCompartment,
  canViewActivity, canViewRecruitment, canViewOperation, isAssignedToOperation,
  canViewIntel, isAssignedToIntel, canViewTraining,
} from '../../js/permissions.js';

// A user record with credential material and (per access level) sensitive
// fields removed. salt/passwordHash are NEVER sent to any client.
export function redactUser(actor, user) {
  const level = accessLevel(actor, user);
  const base = {
    id: user.id,
    designation: user.designation,
    codename: user.codename,
    org: user.org,
    rank: user.rank ?? null,
    clearance: user.clearance ?? null,
    status: user.status,
    accountStatus: user.accountStatus,
    requestedOrg: user.requestedOrg ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    version: user.version,
    deleted: !!user.deleted,
    deletedAt: user.deletedAt ?? null,
    accessLevel: level,
    tags: Array.isArray(user.tags) ? user.tags : [],
  };

  if (level === 'full') {
    return {
      ...base,
      realName: user.realName ?? null,
      username: user.username,
      awards: user.awards ?? [],
      strikes: user.strikes ?? [],
      leave: user.leave ?? null,
      notes: user.notes ?? [],
      events: user.events ?? [],
      promoChecks: user.promoChecks ?? [],
      trainings: user.trainings ?? [],
    };
  }

  if (level === 'partial') {
    return {
      ...base,
      realName: '[REDACTED]',
      // Disciplinary reasons, command notes and leave reason are withheld;
      // counts/dates remain so the UI can show "N strikes" and leave status.
      strikes: (user.strikes ?? []).map((s) => ({ id: s.id, date: s.date })),
      leave: user.leave ? { type: user.leave.type, from: user.leave.from, to: user.leave.to } : null,
      awards: user.awards ?? [],
      events: user.events ?? [],
      notes: [],
      promoChecks: user.promoChecks ?? [],
      trainings: user.trainings ?? [],
    };
  }

  // name-only: identity confirmation only.
  return {
    ...base,
    realName: '[REDACTED]',
    strikes: [],
    leave: null,
    awards: [],
    events: [],
    notes: [],
    promoChecks: [],
  };
}

// A directive's existence/reference/title is open; the body is gated (soft) by
// BOTH the clearance floor and, if the directive is compartmented, Need-To-Know.
// The caveat (codeword) is shown either way — like a handling marking on a cover
// sheet — so a reader knows the body is withheld behind a compartment.
export function redactDirective(actor, d, compMap) {
  const out = {
    id: d.id, ref: d.ref, org: d.org, clearance: d.clearance, title: d.title,
    issuedBy: d.issuedBy, status: d.status, createdAt: d.createdAt,
    updatedAt: d.updatedAt, version: d.version, deleted: !!d.deleted,
    deletedAt: d.deletedAt ?? null,
  };
  if (d.compartment) {
    out.compartment = d.compartment;
    out.compartmented = true;
    const c = compMap && (compMap.get ? compMap.get(d.compartment) : compMap[d.compartment]);
    out.compartmentName = c ? c.name : null;
  }
  const clears = canReadDirective(actor, d) && compartmentClears(actor, d, compMap);
  if (clears) { out.body = d.body; out.acks = d.acks || {}; }
  else out.bodyWithheld = true;
  return out;
}

// A compartment, redacted by the viewer's relationship to it:
//   • admin  (canManageCompartment) — full record incl. the read-in roster.
//   • member (read in, not admin)   — description, but not the roster.
//   • none   — existence + counts only (not shipped in the snapshot; see below).
export function redactCompartment(actor, c) {
  const access = canManageCompartment(actor, c)
    ? 'admin'
    : (readIntoCompartment(actor, c) ? 'member' : 'none');
  const base = {
    id: c.id, ref: c.ref, name: c.name, codeword: c.codeword ?? c.name,
    org: c.org, clearance: c.clearance, status: c.status,
    membersCount: Array.isArray(c.members) ? c.members.length : 0,
    createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version,
    deleted: !!c.deleted, deletedAt: c.deletedAt ?? null, access,
  };
  if (access === 'admin') {
    return { ...base, description: c.description ?? '', members: c.members ?? [], events: c.events ?? [] };
  }
  if (access === 'member') {
    return { ...base, description: c.description ?? '' };
  }
  return base;
}

// Attach the compartment codeword to a hard-gated record (subject/case) the
// viewer is allowed to see, so the dossier can show the caveat banner.
function withCaveat(record, compMap) {
  if (!record || !record.compartment) return record;
  const c = compMap && (compMap.get ? compMap.get(record.compartment) : compMap[record.compartment]);
  return { ...record, compartmentName: c ? c.name : null };
}

// Build the snapshot the viewer is allowed to load. Subjects and cases are HARD
// gated — omitted entirely below clearance OR if the viewer isn't read into the
// record's compartment. Directives are soft-gated (existence open, body
// withheld). The audit log is oversight, CL5 only. promoReqs are configuration,
// visible to everyone. The compartments list is scoped to the ones the viewer
// administers or is read into.
export function buildSnapshot(actor, db) {
  // Lookup of live compartments, keyed by id. A removed (soft-deleted)
  // compartment drops out here, so its referencing records fail closed.
  const compMap = new Map();
  for (const c of (db.compartments || [])) {
    if (!c.deleted) compMap.set(c.id, c);
  }

  return {
    users: (db.users || []).filter((u) => !u.deleted).map((u) => redactUser(actor, u)),
    directives: (db.directives || []).filter((d) => !d.deleted).map((d) => redactDirective(actor, d, compMap)),
    subjects: (db.subjects || [])
      .filter((s) => !s.deleted && canViewSubject(actor, s) && compartmentClears(actor, s, compMap))
      .map((s) => withCaveat(s, compMap)),
    cases: (db.cases || [])
      .filter((c) => !c.deleted && canViewCase(actor, c) && compartmentClears(actor, c, compMap))
      .map((c) => withCaveat(c, compMap)),
    compartments: (db.compartments || [])
      .filter((c) => !c.deleted)
      .map((c) => redactCompartment(actor, c))
      .filter((c) => c.access !== 'none'),
    activity: (db.activity || []).filter((a) => !a.deleted && canViewActivity(actor, a)),
    recruits: (db.recruits || []).filter((r) => !r.deleted && canViewRecruitment(actor, r)),
    operations: (db.operations || [])
      .filter((o) => !o.deleted && canViewOperation(actor, o)
        && (isAssignedToOperation(actor, o) || compartmentClears(actor, o, compMap)))
      .map((o) => withCaveat(o, compMap)),
    intel: (db.intel || [])
      .filter((s) => !s.deleted && canViewIntel(actor, s)
        && (isAssignedToIntel(actor, s) || compartmentClears(actor, s, compMap)))
      .map((s) => withCaveat(s, compMap)),
    trainings: (db.trainings || []).filter((t) => !t.deleted && canViewTraining(actor, t)),
    promoReqs: db.promoReqs || [],
    settings: db.settings || [],
    audit: isCL5(actor) ? (db.audit || []) : [],
  };
}
