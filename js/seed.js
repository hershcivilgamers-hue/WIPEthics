// =============================================================================
// seed.js — Initial data.
//
// Populates a fresh database with a believable slice of Foundation personnel
// across both organisations and the Command tier, plus a few standing
// directives. Runs once; after the first load the `seededAt` stamp prevents it
// re-running, so operator edits are never overwritten.
//
// Seeding is async because password hashing is async.
// =============================================================================

import { loadDb, saveDb, newId } from './storage.js';
import { makeCredential } from './crypto.js';
import { logAction } from './audit.js';

// Demo logins surfaced on the sign-in screen. Keeping this list in one place
// means the credentials shown to the user always match what is seeded.
export const DEMO_LOGINS = [
  { username: 'director', password: 'Thaumiel-5',   note: 'CL5 \u00b7 Command \u2014 full access' },
  { username: 'vanguard', password: 'LeftHand-4',   note: 'CL4\u00b7S \u00b7 Omega-1 \u2014 task-force command' },
  { username: 'warrant',  password: 'Warrant-4',    note: 'CL4\u00b7J \u00b7 Omega-1 \u2014 junior command (Lieutenant)' },
  { username: 'advocate', password: 'Conscience-4', note: 'CL4\u00b7J \u00b7 Ethics \u2014 junior member' },
  { username: 'bailiff',  password: 'Operative-3',  note: 'CL3 \u00b7 Omega-1 \u2014 operative (sees redaction)' },
];

function iso(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function event(daysAgo, type, text) {
  return { id: newId('evt'), date: iso(daysAgo), type, text };
}

async function buildUser(spec) {
  const now = new Date().toISOString();
  // Every account gets a credential. Demo accounts use the disclosed password;
  // the rest get a random one (active personnel, but not login-demoable).
  const password = spec.password || `seed-${newId('pw')}`;
  const { salt, hash } = await makeCredential(password);

  return {
    id: newId('usr'),
    designation: spec.designation,
    codename: spec.codename,
    realName: spec.realName ?? '[REDACTED]',
    org: spec.org,
    rank: spec.rank ?? null,
    clearance: spec.clearance ?? null,
    status: spec.status ?? 'active',
    username: spec.username,
    salt,
    passwordHash: hash,
    accountStatus: spec.accountStatus ?? 'active',
    requestedOrg: spec.requestedOrg ?? null,
    awards: spec.awards ?? [],
    strikes: spec.strikes ?? [],
    leave: spec.leave ?? null,
    notes: spec.notes ?? [],
    events: spec.events ?? [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    deleted: false,
    deletedAt: null,
  };
}

const SEED_SPECS = [
  {
    designation: 'CMD-1', codename: 'Praetor', org: 'command', rank: 'Director',
    clearance: 'CL5', username: 'director', password: 'Thaumiel-5',
    awards: [{ id: 'a1', title: 'Site Stewardship Citation', date: iso(420), note: 'Three years continuous command.' }],
    events: [
      event(900, 'appointment', 'Appointed Site Command Liaison; CAIRO administration assigned.'),
      event(420, 'commendation', 'Site Stewardship Citation issued by O5 review.'),
      event(30, 'directive', 'Issued CMD-DIR-001 — CAIRO Access & Clearance Policy.'),
    ],
  },
  {
    designation: 'O1-1', codename: 'Vanguard', org: 'omega-1', rank: 'Commander',
    clearance: 'CL4-S', username: 'vanguard', password: 'LeftHand-4',
    awards: [{ id: 'a2', title: 'MTF Command Ribbon', date: iso(300), note: 'Assumed command of Omega-1.' }],
    events: [
      event(600, 'transfer', 'Transferred into MTF Omega-1 from Site security.'),
      event(300, 'promotion', 'Promoted to Commander; assumed task-force lead.'),
      event(12, 'directive', 'Re-issued O1-SO-001 — Standing Orders, Field Conduct.'),
    ],
  },
  {
    designation: 'O1-3', codename: 'Warrant', org: 'omega-1', rank: 'Lieutenant',
    clearance: 'CL4-J', username: 'warrant', password: 'Warrant-4',
    awards: [{ id: 'a7', title: 'Field Conduct Commendation', date: iso(70), note: 'Exemplary conduct during containment escort.' }],
    events: [
      event(260, 'transfer', 'Joined Omega-1 as Operative.'),
      event(70, 'promotion', 'Promoted to Lieutenant; junior command authority assigned.'),
      event(5, 'deployment', 'Led containment escort under task-force command.'),
    ],
  },
  {
    designation: 'O1-4', codename: 'Tariff', org: 'omega-1', rank: 'Lieutenant',
    clearance: 'CL4-J', username: 'tariff', status: 'loa',
    leave: { type: 'LoA', from: iso(9), to: iso(-12), reason: 'Recovery — field injury sustained during containment sweep.' },
    events: [
      event(380, 'transfer', 'Joined Omega-1 as Operative.'),
      event(140, 'promotion', 'Promoted to Lieutenant.'),
      event(9, 'leave', 'Placed on Leave of Absence pending recovery.'),
    ],
  },
  {
    designation: 'O1-7', codename: 'Bailiff', org: 'omega-1', rank: 'Operative',
    clearance: 'CL3', username: 'bailiff', password: 'Operative-3',
    events: [
      event(210, 'transfer', 'Inducted into Omega-1 following recruitment review.'),
      event(54, 'training', 'Completed close-protection refresher.'),
    ],
  },
  {
    designation: 'O1-9', codename: 'Probate', org: 'omega-1', rank: 'Recruit',
    clearance: 'CL3', username: 'probate', status: 'active',
    strikes: [
      { id: 's1', reason: 'Late to deployment muster.', date: iso(40), by: 'O1-1' },
      { id: 's2', reason: 'Incomplete after-action report.', date: iso(22), by: 'O1-1' },
      { id: 's3', reason: 'Unauthorised equipment sign-out.', date: iso(6), by: 'O1-1' },
    ],
    events: [
      event(70, 'transfer', 'Provisional induction as Recruit.'),
      event(6, 'strike', 'Third active strike recorded — flagged for command review.'),
    ],
  },
  {
    designation: 'EC-1', codename: 'Arbiter', org: 'ethics-committee', rank: 'Chairman',
    clearance: 'CL5', username: 'arbiter',
    awards: [{ id: 'a3', title: 'Oversight Service Medal', date: iso(500), note: 'Decade of committee service.' }],
    events: [
      event(1800, 'appointment', 'Appointed to the Ethics Committee.'),
      event(500, 'appointment', 'Elevated to Chairman.'),
      event(20, 'ruling', 'Presided over tribunal EC-CASE-26-007.'),
    ],
  },
  {
    designation: 'EC-3', codename: 'Counsel', org: 'ethics-committee', rank: 'Senior Member',
    clearance: 'CL4-S', username: 'counsel',
    events: [
      event(720, 'appointment', 'Seated as Member.'),
      event(180, 'promotion', 'Confirmed as Senior Member.'),
    ],
  },
  {
    designation: 'EC-5', codename: 'Advocate', org: 'ethics-committee', rank: 'Assistant',
    clearance: 'CL4-J', username: 'advocate', password: 'Conscience-4',
    events: [
      event(95, 'appointment', 'Appointed Ethics Committee Assistant.'),
      event(40, 'training', 'Completed records-handling certification.'),
    ],
  },
  // A pending registration — appears in Admin → Registrations awaiting approval.
  {
    designation: 'PEND-1', codename: 'Sentinel', org: 'omega-1', rank: null,
    clearance: null, username: 'sentinel', password: 'Aspirant-1',
    accountStatus: 'pending', requestedOrg: 'omega-1',
    events: [event(1, 'registration', 'Submitted access request for MTF Omega-1.')],
  },
];

const DIRECTIVE_SPECS = [
  {
    ref: 'O1-SO-001', org: 'omega-1', clearance: 'CL3', status: 'active',
    title: 'Standing Orders \u2014 Field Conduct',
    issuedBy: 'O1-1', daysAgo: 12,
    body: 'All Omega-1 operatives maintain weapons-tight posture until a containment breach is confirmed by the deployment lead. After-action reports are filed within twelve hours of return to site. Deviation is recorded as a strike.',
  },
  {
    ref: 'EC-DIR-014', org: 'ethics-committee', clearance: 'CL4-J', status: 'active',
    title: 'Containment Ethics Review Protocol',
    issuedBy: 'EC-1', daysAgo: 20,
    body: 'Any containment procedure resulting in Class-D attrition above threshold is referred to the Committee for review within five working days. Reviewing members recuse themselves from cases involving their own prior rulings.',
  },
  {
    ref: 'CMD-DIR-001', org: 'command', clearance: 'CL3', status: 'active',
    title: 'CAIRO Access & Clearance Policy',
    issuedBy: 'CMD-1', daysAgo: 30,
    body: 'Access to CAIRO is granted on a need-to-know basis. Clearance is assigned by Command and may not be self-amended. Registrations require CL5 approval before activation. Credentials are personal and non-transferable.',
  },
];

// --- Surveillance subjects --------------------------------------------------
// Sensitivity (`clearance`) is deliberately spread across tiers so the access
// gate is demonstrable: TGT-090 is CL5-only, TGT-118 is CL4·S+, the POIs are
// visible lower down.
const SUBJECT_SPECS = [
  {
    ref: 'POI-2207', alias: 'Cassette', kind: 'poi', org: 'omega-1',
    threat: 'moderate', clearance: 'CL3', status: 'active', daysAgo: 26,
    lastKnownLocation: 'Metro corridor, Sector 12',
    createdBy: 'O1-1',
    summary: 'Suspected courier moving anomalous media between two unaffiliated groups of interest. Non-hostile to date; observe and map contacts.',
    logs: [
      { daysAgo: 26, type: 'intel',    by: 'O1-1', text: 'Watch opened following recovered handoff footage.' },
      { daysAgo: 11, type: 'sighting', by: 'O1-7', text: 'Observed at transit hub; met one unidentified contact for under two minutes.' },
      { daysAgo: 3,  type: 'note',     by: 'O1-1', text: 'Pattern suggests weekly cadence. Maintain passive watch.' },
    ],
  },
  {
    ref: 'TGT-118', alias: 'Hollow King', kind: 'target', org: 'omega-1',
    threat: 'critical', clearance: 'CL4-S', status: 'located', daysAgo: 40,
    lastKnownLocation: 'Disused rail depot (under confirmation)',
    createdBy: 'O1-1',
    summary: 'High-priority acquisition target linked to two containment breaches. Approach only with task-force authorisation.',
    logs: [
      { daysAgo: 40, type: 'intel',  by: 'O1-1', text: 'Designated acquisition target by Omega-1 command.' },
      { daysAgo: 9,  type: 'status', by: 'O1-1', text: 'Location narrowed to depot district; surveillance assets repositioned.' },
      { daysAgo: 1,  type: 'sighting', by: 'O1-7', text: 'Probable visual confirmation pending corroboration.' },
    ],
  },
  {
    ref: 'POI-2231', alias: 'Ledger', kind: 'poi', org: 'ethics-committee',
    threat: 'low', clearance: 'CL4-J', status: 'active', daysAgo: 18,
    lastKnownLocation: 'Internal — pending interview',
    createdBy: 'EC-1',
    summary: 'Witness in an open ethics review whose account conflicts with the incident record. Under watch pending tribunal scheduling.',
    logs: [
      { daysAgo: 18, type: 'note',  by: 'EC-1', text: 'Flagged for observation by the Committee pending review EC-CASE scheduling.' },
      { daysAgo: 5,  type: 'intel', by: 'EC-3', text: 'Account inconsistencies catalogued for tribunal reference.' },
    ],
  },
  {
    ref: 'TGT-090', alias: 'Surgeon', kind: 'target', org: 'command',
    threat: 'high', clearance: 'CL5', status: 'active', daysAgo: 55,
    lastKnownLocation: '[SEALED]',
    createdBy: 'CMD-1',
    summary: 'Command-restricted acquisition target. Details sealed at CL5. Cross-organisational coordination via Site Command only.',
    logs: [
      { daysAgo: 55, type: 'intel',  by: 'CMD-1', text: 'Target designated under Command seal; access restricted to CL5.' },
      { daysAgo: 7,  type: 'status', by: 'CMD-1', text: 'Coordination tasking issued to both organisations on a need-to-know basis.' },
    ],
  },
];

// Build the surveillance subject records. Exported so a migration can backfill
// installations that were seeded before surveillance existed.
export function buildSeedSubjects() {
  return SUBJECT_SPECS.map((s) => {
    const created = iso(s.daysAgo);
    return {
      id: newId('sub'),
      ref: s.ref,
      alias: s.alias,
      realName: s.realName ?? '[UNIDENTIFIED]',
      kind: s.kind,
      org: s.org,
      threat: s.threat,
      clearance: s.clearance,
      status: s.status,
      summary: s.summary,
      lastKnownLocation: s.lastKnownLocation ?? '',
      logs: (s.logs || []).map((l) => ({
        id: newId('log'), ts: iso(l.daysAgo), by: l.by, type: l.type, text: l.text,
      })),
      createdBy: s.createdBy,
      createdAt: created,
      updatedAt: created,
      version: 1,
      deleted: false,
      deletedAt: null,
    };
  });
}

// --- Ethics tribunal cases --------------------------------------------------
// Cases cross-reference personnel (respondent, panel) and surveillance subjects
// by their stable references, resolved to ids at build time.
const CASE_SPECS = [
  {
    ref: 'EC-CASE-26-002', title: 'Operative Disciplinary Tribunal \u2014 Probate',
    kind: 'tribunal', clearance: 'CL3', status: 'ruled', daysAgo: 30,
    respondent: 'O1-9', panel: ['EC-1', 'EC-3'], subjects: [],
    summary: 'Referral from Omega-1 command following a third active strike against the named operative. The Committee convened to determine whether the pattern warranted escalation.',
    summons: [{ who: 'O1-9', daysAgo: 28, reason: 'Appear before the Committee to answer for repeated conduct infractions.' }],
    entries: [
      { daysAgo: 30, type: 'filing',    by: 'EC-1', text: 'Case opened on referral from Omega-1 command.' },
      { daysAgo: 28, type: 'testimony', by: 'EC-3', text: 'Respondent testimony heard; mitigating circumstances noted for the record.' },
      { daysAgo: 26, type: 'ruling',    by: 'EC-1', text: 'Panel ruling entered and served.' },
    ],
    ruling: { daysAgo: 26, by: 'EC-1', finding: 'upheld', rationale: 'A pattern of infractions was established on the record and not adequately rebutted.', measures: 'Final written warning; probation extended ninety days; reassignment review deferred pending conduct.' },
  },
  {
    ref: 'EC-CASE-26-009', title: 'Witness Conduct Inquiry \u2014 Ledger',
    kind: 'inquiry', clearance: 'CL4-J', status: 'deliberation', daysAgo: 16,
    respondent: null, respondentName: '[EXTERNAL WITNESS]', panel: ['EC-1', 'EC-5'], subjects: ['POI-2231'],
    summary: 'Inquiry into discrepancies between a witness account and the incident record, referred from an open surveillance watch. The Committee is in deliberation.',
    summons: [],
    entries: [
      { daysAgo: 16, type: 'filing', by: 'EC-1', text: 'Inquiry opened into witness account discrepancies referred from surveillance.' },
      { daysAgo: 6,  type: 'motion', by: 'EC-5', text: 'Motion to admit the surveillance log as a supporting record; granted.' },
    ],
    ruling: null,
  },
  {
    ref: 'EC-CASE-26-014', title: 'Containment Attrition Review \u2014 Sector 12',
    kind: 'review', clearance: 'CL4-J', status: 'in-session', daysAgo: 8,
    respondent: 'O1-1', panel: ['EC-1', 'EC-3'], subjects: [],
    summary: 'Review under EC-DIR-014 following Class-D attrition above threshold during a Sector 12 containment operation. Commanding officer summoned to provide account.',
    summons: [{ who: 'O1-1', daysAgo: 7, reason: 'Provide command account of the Sector 12 containment operation.' }],
    entries: [
      { daysAgo: 8, type: 'filing',    by: 'EC-1', text: 'Review opened under EC-DIR-014 following attrition above threshold.' },
      { daysAgo: 3, type: 'testimony', by: 'EC-3', text: 'Commanding officer account recorded; further evidence requested.' },
    ],
    ruling: null,
  },
];

// Build tribunal case records, resolving references against the supplied
// personnel and subjects. Exported so a migration can backfill old installs.
export function buildSeedCases(userList, subjectList) {
  const userByDesig = (d) => userList.find((u) => u.designation === d);
  const subByRef = (r) => subjectList.find((s) => s.ref === r);

  return CASE_SPECS.map((c) => {
    const created = iso(c.daysAgo);
    const respondent = c.respondent ? userByDesig(c.respondent) : null;
    return {
      id: newId('case'),
      ref: c.ref,
      title: c.title,
      kind: c.kind,
      clearance: c.clearance,
      status: c.status,
      summary: c.summary,
      respondentId: respondent ? respondent.id : null,
      respondentName: respondent ? null : (c.respondentName || '[UNNAMED]'),
      panelIds: (c.panel || []).map(userByDesig).filter(Boolean).map((u) => u.id),
      linkedSubjectIds: (c.subjects || []).map(subByRef).filter(Boolean).map((s) => s.id),
      summons: (c.summons || []).map((m) => {
        const t = userByDesig(m.who);
        return { id: newId('sum'), ts: iso(m.daysAgo), by: 'EC-1', targetId: t ? t.id : null, targetName: t ? null : m.who, reason: m.reason };
      }),
      entries: (c.entries || []).map((e) => ({ id: newId('ent'), ts: iso(e.daysAgo), by: e.by, type: e.type, text: e.text })),
      ruling: c.ruling ? {
        ts: iso(c.ruling.daysAgo), by: c.ruling.by, finding: c.ruling.finding,
        rationale: c.ruling.rationale, measures: c.ruling.measures,
      } : null,
      createdBy: 'EC-1',
      createdAt: created,
      updatedAt: created,
      version: 1,
      deleted: false,
      deletedAt: null,
    };
  });
}

// Build the full dataset and persist it. No-op if already seeded.
export async function ensureSeeded() {
  const db = loadDb();
  if (db.meta.seededAt) return db;

  db.users = [];
  for (const spec of SEED_SPECS) {
    db.users.push(await buildUser(spec));
  }

  db.directives = DIRECTIVE_SPECS.map((d) => {
    const now = new Date().toISOString();
    return {
      id: newId('dir'),
      ref: d.ref,
      org: d.org,
      clearance: d.clearance,
      title: d.title,
      body: d.body,
      issuedBy: d.issuedBy,
      status: d.status,
      createdAt: iso(d.daysAgo),
      updatedAt: iso(d.daysAgo),
      version: 1,
      deleted: false,
      deletedAt: null,
    };
  });

  db.subjects = buildSeedSubjects();
  db.cases = buildSeedCases(db.users, db.subjects);

  db.meta.seededAt = new Date().toISOString();
  db.meta.surveillanceSeededAt = new Date().toISOString();
  db.meta.tribunalsSeededAt = new Date().toISOString();
  saveDb();
  logAction(null, 'SYSTEM_INIT', 'CAIRO dataset initialised with seed personnel, directives, surveillance subjects and tribunal cases.');
  return db;
}
