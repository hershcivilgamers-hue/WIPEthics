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

// A directive's existence/reference/title is open; the body is gated (soft).
export function redactDirective(actor, d) {
  const out = {
    id: d.id, ref: d.ref, org: d.org, clearance: d.clearance, title: d.title,
    issuedBy: d.issuedBy, status: d.status, createdAt: d.createdAt,
    updatedAt: d.updatedAt, version: d.version, deleted: !!d.deleted,
    deletedAt: d.deletedAt ?? null,
  };
  if (canReadDirective(actor, d)) out.body = d.body;
  else out.bodyWithheld = true;
  return out;
}

// Build the snapshot the viewer is allowed to load. Subjects and cases are HARD
// gated — omitted entirely below clearance. The audit log is oversight, CL5
// only. promoReqs are configuration, visible to everyone (the dossier needs
// them).
export function buildSnapshot(actor, db) {
  return {
    users: (db.users || []).filter((u) => !u.deleted).map((u) => redactUser(actor, u)),
    directives: (db.directives || []).filter((d) => !d.deleted).map((d) => redactDirective(actor, d)),
    subjects: (db.subjects || []).filter((s) => !s.deleted && canViewSubject(actor, s)),
    cases: (db.cases || []).filter((c) => !c.deleted && canViewCase(actor, c)),
    promoReqs: db.promoReqs || [],
    audit: isCL5(actor) ? (db.audit || []) : [],
  };
}
