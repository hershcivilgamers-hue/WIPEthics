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
import { ACTIVITY_REQ_SETTING_ID, ACTIVITY_REQ_DEFAULT, RANK_CLEARANCE } from './constants.js';
import { makeCredential } from './crypto.js';
import { logAction } from './audit.js';

// Demonstration operators for the LOCAL demo only. Their passphrases are
// generated fresh on each install and held in memory \u2014 the repository must never
// contain a working credential. (It previously shipped fixed passwords, which,
// with a live backend configured, published an admin login to anyone reading the
// source. Rotate any account that was seeded from that older revision.)
const DEMO_NOTES = {
  director: 'CL5 \u00b7 Command \u2014 full access',
  vanguard: 'CL4\u00b7S \u00b7 Omega-1 \u2014 task-force command',
  warrant:  'CL4\u00b7J \u00b7 Omega-1 \u2014 junior command (Lieutenant)',
  advocate: 'CL4\u00b7J \u00b7 Ethics \u2014 junior member',
  bailiff:  'CL3 \u00b7 Omega-1 \u2014 operative (sees redaction)',
};

// Populated by buildUser() as the demo dataset is seeded; read by the sign-in
// screen, which only renders it when no real backend is configured.
export const DEMO_LOGINS = [];

function randomPassphrase() {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

function demoPassphrase(username) {
  const password = randomPassphrase();
  DEMO_LOGINS.push({ username, password, note: DEMO_NOTES[username] });
  return password;
}

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
  // Demo accounts draw a freshly generated passphrase (recorded in DEMO_LOGINS
  // for the local sign-in panel); everyone else gets a random, non-demoable one.
  const password = spec.password
    || (DEMO_NOTES[spec.username] ? demoPassphrase(spec.username) : `seed-${newId('pw')}`);
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
    promoChecks: spec.promoChecks ?? [],
    leave: spec.leave ?? null,
    notes: spec.notes ?? [],
    events: spec.events ?? [],
    // Covert Internal Security membership rides alongside the cover post.
    ...(spec.isd ? { isd: spec.isd } : {}),
    createdAt: now,
    updatedAt: now,
    version: 1,
    deleted: false,
    deletedAt: null,
  };
}

// A ready-made ISD caveat for a seed spec — an agent keeps their cover post and
// carries this hidden identity. The ISD rank is derived from that post, so
// membership stores only standing and a badge.
function isdCaveat(badge) {
  return { standing: 'active', badgeNumber: badge, promoChecks: [] };
}

const SEED_SPECS = [
  {
    designation: 'CMD-1', codename: 'Praetor', org: 'command', rank: 'Director',
    clearance: 'CL5', username: 'director',
    awards: [{ id: 'a1', title: 'Site Stewardship Citation', date: iso(420), note: 'Three years continuous command.' }],
    events: [
      event(900, 'appointment', 'Appointed Site Command Liaison; CAIRO administration assigned.'),
      event(420, 'commendation', 'Site Stewardship Citation issued by O5 review.'),
      event(30, 'directive', 'Issued CMD-DIR-001 — CAIRO Access & Clearance Policy.'),
    ],
  },
  {
    designation: 'O1-1', codename: 'Vanguard', org: 'omega-1', rank: 'Commander',
    clearance: 'CL4-S', username: 'vanguard', isd: isdCaveat('101'),
    awards: [{ id: 'a2', title: 'MTF Command Ribbon', date: iso(300), note: 'Assumed command of Omega-1.' }],
    events: [
      event(600, 'transfer', 'Transferred into the task force from Site security.'),
      event(300, 'promotion', 'Promoted to Commander; assumed task-force lead.'),
      event(12, 'directive', 'Re-issued O1-SO-001 — Standing Orders, Field Conduct.'),
    ],
  },
  {
    designation: 'O1-3', codename: 'Warrant', org: 'omega-1', rank: 'Lieutenant',
    clearance: 'CL4-J', username: 'warrant', isd: isdCaveat('114'),
    awards: [{ id: 'a7', title: 'Field Conduct Commendation', date: iso(70), note: 'Exemplary conduct during containment escort.' }],
    events: [
      event(260, 'transfer', 'Joined the unit as Specialist.'),
      event(70, 'promotion', 'Promoted to Lieutenant; junior command authority assigned.'),
      event(5, 'deployment', 'Led containment escort under task-force command.'),
    ],
  },
  {
    designation: 'O1-4', codename: 'Tariff', org: 'omega-1', rank: 'Lieutenant',
    clearance: 'CL4-J', username: 'tariff', status: 'loa',
    leave: { type: 'LoA', from: iso(9), to: iso(-12), reason: 'Recovery — field injury sustained during containment sweep.' },
    events: [
      event(380, 'transfer', 'Joined the unit as Specialist.'),
      event(140, 'promotion', 'Promoted to Lieutenant.'),
      event(9, 'leave', 'Placed on Leave of Absence pending recovery.'),
    ],
  },
  {
    designation: 'O1-7', codename: 'Bailiff', org: 'omega-1', rank: 'Sergeant',
    clearance: 'CL3', username: 'bailiff', isd: isdCaveat('221'),
    events: [
      event(210, 'transfer', 'Inducted following recruitment review.'),
      event(54, 'training', 'Completed close-protection refresher.'),
    ],
  },
  {
    designation: 'O1-9', codename: 'Probate', org: 'omega-1', rank: 'Private',
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
    designation: 'EC-3', codename: 'Counsel', org: 'ethics-committee', rank: 'Member',
    clearance: 'CL5', username: 'counsel',
    events: [
      event(720, 'appointment', 'Seated as Member.'),
      event(180, 'promotion', 'Confirmed as Senior Member.'),
    ],
  },
  {
    designation: 'EC-5', codename: 'Advocate', org: 'ethics-committee', rank: 'Assistant',
    clearance: 'CL4-J', username: 'advocate',
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
    events: [event(1, 'registration', 'Submitted access request for Internal Enforcement.')],
  },
];

const DIRECTIVE_SPECS = [
  {
    ref: 'O1-SO-001', org: 'omega-1', clearance: 'CL3', status: 'active',
    title: 'Standing Orders \u2014 Field Conduct',
    issuedBy: 'O1-1', daysAgo: 12,
    body: 'All operatives maintain weapons-tight posture until a containment breach is confirmed by the deployment lead. After-action reports are filed within twelve hours of return to site. Deviation is recorded as a strike.',
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
      { daysAgo: 40, type: 'intel',  by: 'O1-1', text: 'Designated acquisition target by task-force command.' },
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
    summary: 'Referral from unit command following a third active strike against the named operative. The Committee convened to determine whether the pattern warranted escalation.',
    summons: [{ who: 'O1-9', daysAgo: 28, reason: 'Appear before the Committee to answer for repeated conduct infractions.' }],
    entries: [
      { daysAgo: 30, type: 'filing',    by: 'EC-1', text: 'Case opened on referral from unit command.' },
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
// Default Omega-1 promotion-requirement sets for the lower ladder, where most
// personnel sit. CL5 can edit, add or remove these in Administration.
function reqItems(...texts) {
  return texts.map((t) => ({ id: newId('rq'), text: t }));
}
export function buildSeedPromoReqs(by) {
  const now = new Date().toISOString();
  const T = [
    ['Private', 'Specialist', ['Complete induction and basic orientation.', 'Log three supervised field deployments.']],
    ['Specialist', 'Lance Corporal', ['Pass marksmanship and equipment qualification.', 'Maintain a clean conduct record for thirty days.']],
    ['Lance Corporal', 'Corporal', ['Complete the small-unit tactics course.', 'Receive a positive deployment after-action review.']],
    ['Corporal', 'Sergeant', ['Serve as fireteam second on two operations.', 'Pass the NCO readiness assessment.']],
    ['Sergeant', 'Command Sergeant', ['Lead a deployment as acting NCO.', 'Complete the senior NCO leadership board.']],
    ['Command Sergeant', 'Lieutenant', ['Secure a written endorsement from a CL4 officer.', 'Pass the junior command commissioning board.']],
  ];
  return T.map(([fromRank, toRank, items]) => ({
    id: newId('preq'),
    org: 'omega-1',
    fromRank,
    toRank,
    items: reqItems(...items),
    createdBy: by || 'SYSTEM',
    updatedAt: now,
    version: 1,
  }));
}

// --- Need-To-Know compartments ----------------------------------------------
// Demonstrates the orthogonality of compartments and clearance: IRONWOOD reads
// in a CL3 operator (Bailiff) while leaving a higher-cleared one (Warrant)
// outside it; AZURE WAKE gates a senior surveillance target; GLASS COURT is a
// sealed Committee compartment. Members are resolved from designations at build
// time. Each compartment also tags a record (set in ensureSeeded) so the caveat
// banners and withheld bodies are visible from first load.
const COMPARTMENT_SPECS = [
  {
    ref: 'NTK-IRONWOOD', name: 'IRONWOOD', codeword: 'IRONWOOD', org: 'omega-1',
    clearance: 'CL3', status: 'active',
    description: 'Field-conduct standing orders handling for the active task force. Read-in is by operational need, independent of clearance tier.',
    members: ['O1-1', 'O1-7'],
    events: [{ daysAgo: 60, type: 'opened', text: 'Compartment opened by Site Command.' }],
  },
  {
    ref: 'NTK-AZURE-WAKE', name: 'AZURE WAKE', codeword: 'AZURE WAKE', org: 'omega-1',
    clearance: 'CL4-J', status: 'active',
    description: 'Acquisition handling for a senior pursuit target. Indoctrination restricted to the pursuit cell.',
    members: ['O1-1', 'O1-3'],
    events: [{ daysAgo: 21, type: 'opened', text: 'Compartment opened on target escalation.' }],
  },
  {
    ref: 'NTK-GLASS-COURT', name: 'GLASS COURT', codeword: 'GLASS COURT', org: 'ethics-committee',
    clearance: 'CL4-J', status: 'sealed',
    description: 'Sealed witness-conduct compartment. Frozen pending close of the related inquiry; existing read-ins retain access.',
    members: ['EC-1', 'EC-5'],
    events: [
      { daysAgo: 16, type: 'opened', text: 'Compartment opened for the witness inquiry.' },
      { daysAgo: 4,  type: 'sealed', text: 'Sealed pending deliberation; no further read-ins.' },
    ],
  },
];

export function buildSeedCompartments(userList) {
  const idFor = (d) => (userList.find((u) => u.designation === d) || {}).id || null;
  return COMPARTMENT_SPECS.map((c) => {
    const created = iso(c.daysAgo ?? 60);
    return {
      id: newId('cmp'),
      ref: c.ref,
      name: c.name,
      codeword: c.codeword,
      org: c.org,
      clearance: c.clearance,
      description: c.description,
      status: c.status,
      members: (c.members || []).map(idFor).filter(Boolean),
      events: (c.events || []).map((e) => ({ id: newId('cev'), at: iso(e.daysAgo), type: e.type, text: e.text })),
      createdBy: 'CMD-1',
      createdAt: created,
      updatedAt: created,
      version: 1,
      deleted: false,
      deletedAt: null,
    };
  });
}

// --- Operational activity seed ----------------------------------------------
// Records spread across readiness states so the board shows Current / Overdue /
// Breach from first load. lastActiveAt drives the derived readiness.
const ACTIVITY_SPECS = [
  // who, sessions: [ [hoursAgo, hours, note, tagOrderRef?, tagSubjectRef?] ]
  { who: 'O1-1', sessions: [[2, 3, 'Led a Sector 12 containment escort.', 'O1-SO-001', 'TGT-118'], [5, 3, 'Ran a breach-response drill with the section.']] }, // 6h this week -> Active
  { who: 'O1-3', sessions: [[4, 2, 'Forward acquisition watch \u2014 a quiet shift.']] }, // 2h -> Semi-Active
  { who: 'O1-7', sessions: [[12 * 24, 8, 'Close-protection rotation (last week).']] },     // last week -> Inactive
  { who: 'O1-9', sessions: [] },                                                            // nothing logged -> Inactive
];
const OPERATION_SPECS = [
  { ref: 'OP-O1-0001', name: 'SECTOR 12 CORDON', kind: 'deployment', clearance: 'CL3', status: 'active',
    lead: 'O1-1', team: ['O1-3', 'O1-7'], location: 'Sector 12', objective: 'Maintain the outer cordon during the containment escort.',
    startedHoursAgo: 30, targets: ['TGT-118'],
    log: [['note', 60, 'Operation opened.'], ['order', 48, 'Cordon posture set; two-team rotation.'], ['movement', 30, 'Teams deployed forward to Sector 12.'], ['contact', 6, 'Brief contact at the north gate; no breach.']] },
  { ref: 'OP-O1-0002', name: 'IRONWOOD VIGIL', kind: 'containment', clearance: 'CL4-S', status: 'planned',
    lead: 'O1-1', team: ['O1-3'], location: '[COMPARTMENTED]', objective: 'Standby containment posture pending IRONWOOD tasking.',
    compartmentRef: 'NTK-IRONWOOD', log: [['note', 20, 'Operation drafted under IRONWOOD.']] },
  { ref: 'OP-O1-0003', name: 'GREY FERRY PATROL', kind: 'patrol', clearance: 'CL3', status: 'concluded',
    lead: 'O1-7', team: ['O1-9'], location: 'Grey Ferry line', objective: 'Routine patrol of the Grey Ferry approach.',
    startedHoursAgo: 240, concludedHoursAgo: 210, outcome: { result: 'success', text: 'Patrol completed without incident.' },
    log: [['note', 260, 'Operation opened.'], ['movement', 240, 'Patrol commenced.'], ['status', 210, 'Patrol concluded.']] },
  { ref: 'OP-O1-0004', name: 'RAPID ANSWER', kind: 'response', clearance: 'CL3', status: 'aborted',
    lead: 'O1-3', team: [], location: 'Sector 4', objective: 'Rapid response to a reported disturbance.',
    concludedHoursAgo: 180, log: [['note', 200, 'Response spun up.'], ['status', 180, 'Stood down; false alarm. Operation aborted.']] },
];
export function buildSeedOperations(userList, db) {
  const idOf = (d) => (userList.find((u) => u.designation === d) || {}).id || null;
  const subId = (ref) => (db.subjects.find((x) => x.ref === ref) || {}).id || null;
  const compId = (ref) => (db.compartments.find((x) => x.ref === ref) || {}).id || null;
  const now = Date.now();
  return OPERATION_SPECS.map((s) => ({
    id: newId('op'), ref: s.ref, name: s.name, kind: s.kind, org: 'omega-1',
    status: s.status, clearance: s.clearance, compartment: s.compartmentRef ? compId(s.compartmentRef) : null,
    lead: s.lead ? idOf(s.lead) : null,
    participants: (s.team || []).map(idOf).filter(Boolean),
    location: s.location || '', objective: s.objective || '',
    log: (s.log || []).map(([type, hoursAgo, text]) => ({ id: newId('ol'), at: now - hoursAgo * 3600000, by: s.lead || 'O1-1', type, text })),
    outcome: s.outcome ? { result: s.outcome.result, text: s.outcome.text, at: new Date(now - (s.concludedHoursAgo || 0) * 3600000).toISOString(), by: s.lead || 'O1-1' } : null,
    linkedSubjectIds: (s.targets || []).map(subId).filter(Boolean),
    startedAt: s.startedHoursAgo ? new Date(now - s.startedHoursAgo * 3600000).toISOString() : null,
    concludedAt: s.concludedHoursAgo ? new Date(now - s.concludedHoursAgo * 3600000).toISOString() : null,
    createdBy: s.lead || 'O1-1', createdAt: new Date(now - ((s.log && s.log[0] && s.log[0][1]) || 60) * 3600000).toISOString(),
    updatedAt: new Date(now).toISOString(), version: 1, deleted: false, deletedAt: null,
  }));
}

const INTEL_SPECS = [
  { ref: 'SRC-O1-0001', codename: 'GOLDFINCH', type: 'informant', clearance: 'CL4-J', status: 'active', reliability: 'B',
    handler: 'O1-1', cover: 'Dockside fixer, Grey Ferry wharf.', tasking: 'Report movement of persons of interest through the Grey Ferry approach.',
    targets: ['TGT-118'],
    reports: [[6, 200, 'Source opened; initial contact established.'], [2, 120, 'PoI seen meeting an unknown party at the north wharf.'], [3, 30, 'Chatter of a shipment expected within the week; unconfirmed.']] },
  { ref: 'SRC-O1-0002', codename: 'NIGHTJAR', type: 'informant', clearance: 'CL4-S', status: 'probation', reliability: 'C',
    handler: 'O1-3', cover: '[COMPARTMENTED]', tasking: 'Access reporting under IRONWOOD. Handling restricted.',
    compartmentRef: 'NTK-IRONWOOD',
    reports: [[6, 40, 'Source recruited under IRONWOOD; on probation pending vetting.'], [4, 12, 'Single-source claim, not yet corroborated.']] },
  { ref: 'SRC-O1-0003', codename: 'GREY HERON', type: 'intercept', clearance: 'CL3', status: 'dormant', reliability: 'D',
    handler: 'O1-7', cover: 'Passive line intercept, sector exchange.', tasking: 'Monitor the sector exchange for keyword hits.',
    reports: [[6, 300, 'Intercept established.'], [5, 210, 'Volume low; product thin. Stood to dormant.']] },
  { ref: 'SRC-O1-0004', codename: 'KESTREL', type: 'defector', clearance: 'CL4-J', status: 'burned', reliability: 'E',
    handler: 'O1-3', cover: 'Former hostile-group liaison.', tasking: 'Debrief on prior affiliations.',
    closedHoursAgo: 150,
    reports: [[6, 260, 'Walk-in defector; debrief opened.'], [3, 220, 'Useful background on prior affiliations.'], [6, 150, 'Source compromised; marked burned and stood down.']] },
];
export function buildSeedIntel(userList, db) {
  const idOf = (d) => (userList.find((u) => u.designation === d) || {}).id || null;
  const subId = (ref) => (db.subjects.find((x) => x.ref === ref) || {}).id || null;
  const compId = (ref) => (db.compartments.find((x) => x.ref === ref) || {}).id || null;
  const now = Date.now();
  return INTEL_SPECS.map((s) => ({
    id: newId('src'), ref: s.ref, codename: s.codename, type: s.type, org: 'omega-1',
    status: s.status, reliability: s.reliability,
    clearance: s.clearance, compartment: s.compartmentRef ? compId(s.compartmentRef) : null,
    handler: s.handler ? idOf(s.handler) : null, cover: s.cover || '', tasking: s.tasking || '',
    reports: (s.reports || []).map(([credibility, hoursAgo, text]) => ({ id: newId('ir'), at: now - hoursAgo * 3600000, by: s.handler || 'O1-1', credibility, text })),
    linkedSubjectIds: (s.targets || []).map(subId).filter(Boolean),
    openedAt: new Date(now - ((s.reports && s.reports[0] && s.reports[0][1]) || 200) * 3600000).toISOString(),
    closedAt: s.closedHoursAgo ? new Date(now - s.closedHoursAgo * 3600000).toISOString() : null,
    createdBy: s.handler || 'O1-1', createdAt: new Date(now - ((s.reports && s.reports[0] && s.reports[0][1]) || 200) * 3600000).toISOString(),
    updatedAt: new Date(now).toISOString(), version: 1, deleted: false, deletedAt: null,
  }));
}

const TRAINING_SPECS = [
  { code: 'O1-IND', title: 'Unit Induction', org: 'omega-1', category: 'induction', validityMonths: 0, clearanceFloor: null, description: 'Baseline unit induction and standing-order familiarisation.' },
  { code: 'O1-CQB', title: 'Close-Quarters Battle Refresher', org: 'omega-1', category: 'weapons', validityMonths: 12, clearanceFloor: 'CL3', description: 'Annual weapons handling and close-protection refresher.' },
  { code: 'O1-CON', title: 'Containment Breach Response', org: 'omega-1', category: 'containment', validityMonths: 24, clearanceFloor: 'CL3', description: 'Procedures for anomalous containment breach response.' },
  { code: 'O1-MED', title: 'Field Trauma Care', org: 'omega-1', category: 'medical', validityMonths: 24, clearanceFloor: null, description: 'Field trauma and casualty stabilisation.' },
  { code: 'EC-REC', title: 'Records & Conduct Certification', org: 'ethics-committee', category: 'records', validityMonths: 24, clearanceFloor: null, description: 'Handling of committee records and conduct standards.' },
  { code: 'EC-REV', title: 'Review Board Procedure', org: 'ethics-committee', category: 'command', validityMonths: 0, clearanceFloor: 'CL4-J', description: 'Seating and conduct of a review board.' },
];
export function buildSeedTrainings() {
  const now = new Date();
  return TRAINING_SPECS.map((s, i) => ({
    id: newId('trn'), ref: `TRN-${String(i + 1).padStart(3, '0')}`, code: s.code, title: s.title,
    org: s.org, category: s.category, description: s.description,
    validityMonths: s.validityMonths, clearanceFloor: s.clearanceFloor, active: true,
    createdBy: 'SYSTEM', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    version: 1, deleted: false, deletedAt: null,
  }));
}

// Attach a few completions to seed personnel so files show currency out of the
// box — including one lapsed and one expiring, to exercise the derived states.
export function attachSeedCompletions(userList, courses) {
  const course = (code) => courses.find((c) => c.code === code);
  const byD = (d) => userList.find((u) => u.designation === d);
  const now = Date.now();
  const grant = (u, code, monthsAgo, by) => {
    if (!u) return; const c = course(code); if (!c) return;
    const awardedAt = new Date(now - monthsAgo * 30 * 86400000).toISOString();
    const expiresAt = c.validityMonths ? new Date(new Date(awardedAt).setMonth(new Date(awardedAt).getMonth() + c.validityMonths)).toISOString() : null;
    u.trainings = u.trainings || [];
    u.trainings.push({ id: newId('cmp'), courseId: c.id, awardedBy: by || 'O1-1', awardedAt, expiresAt, note: '' });
  };
  // Vanguard (O1-1): current across the board.
  grant(byD('O1-1'), 'O1-IND', 20, 'CMD-1'); grant(byD('O1-1'), 'O1-CQB', 2, 'CMD-1'); grant(byD('O1-1'), 'O1-CON', 6, 'CMD-1');
  // Bailiff (O1-7): induction fine, CQB LAPSED (14 months on a 12-month cert).
  grant(byD('O1-7'), 'O1-IND', 18, 'O1-1'); grant(byD('O1-7'), 'O1-CQB', 14, 'O1-1');
  // Warrant (O1-3): CQB EXPIRING (about a fortnight of a 12-month cert remaining).
  grant(byD('O1-3'), 'O1-IND', 15, 'O1-1'); grant(byD('O1-3'), 'O1-CQB', 11.5, 'O1-1'); grant(byD('O1-3'), 'O1-MED', 3, 'O1-1');
  // Advocate (EC-5): committee certs.
  grant(byD('EC-5'), 'EC-REC', 4, 'EC-1');
}

export function buildSeedActivity(userList, db) {
  const byD = (d) => userList.find((u) => u.designation === d);
  const dirId = (ref) => (db.directives.find((x) => x.ref === ref) || {}).id || null;
  const dirLabel = (ref) => { const d = db.directives.find((x) => x.ref === ref); return d ? `${d.ref} ${d.title || ''}`.trim() : ref; };
  const subId = (ref) => (db.subjects.find((x) => x.ref === ref) || {}).id || null;
  const subLabel = (ref) => { const s = db.subjects.find((x) => x.ref === ref); return s ? `${s.ref} ${s.alias || ''}`.trim() : ref; };
  const now = Date.now();
  return ACTIVITY_SPECS.map((s) => {
    const u = byD(s.who);
    if (!u) return null;
    const log = (s.sessions || []).map(([hoursAgo, hours, note, orderRef, subjRef]) => {
      const tags = [];
      if (orderRef && dirId(orderRef)) tags.push({ kind: 'order', id: dirId(orderRef), label: dirLabel(orderRef) });
      if (subjRef && subId(subjRef)) tags.push({ kind: 'subject', id: subId(subjRef), label: subLabel(subjRef) });
      return { id: newId('al'), at: now - hoursAgo * 3600000, hours, note, tags, by: u.designation };
    });
    return {
      id: newId('actr'), userId: u.id, org: u.org,
      log, override: s.override || null,
      createdBy: u.designation, createdAt: iso(60), updatedAt: new Date(now).toISOString(),
      version: 1, deleted: false, deletedAt: null,
    };
  }).filter(Boolean);
}

// --- Recruitment seed (both org pipelines) ----------------------------------
const RECRUIT_SPECS = [
  // Omega-1 scouting pipeline
  {
    ref: 'SCT-0042', name: 'Rourke, T.', steamId: 'STEAM_0:1:44290183', department: 'General Security Department', rank: 'Trooper',
    org: 'omega-1', stage: 'scouting',
    comments: [['O1-3', 6, 'scouting', 'Strong showing on the last two joint patrols. Flagged for scouting.']], votes: {},
  },
  {
    ref: 'SCT-0039', name: 'Vane, L.', steamId: 'STEAM_0:0:51120947', department: 'Internal Security Department', rank: 'Specialist',
    org: 'omega-1', stage: 'greenlit',
    comments: [['O1-3', 12, 'scouting', 'Scouted from containment detail; consistent conduct.'], ['O1-1', 5, 'greenlit', 'Put up for greenlight vote.']],
    votes: { O1_1: 'yes', O1_3: 'yes' },
  },
  {
    ref: 'SCT-0036', name: 'Hadley, R.', steamId: 'STEAM_0:1:60884412', department: 'MTF Epsilon-11', rank: 'Corporal',
    org: 'omega-1', stage: 'tryout',
    comments: [['O1-1', 18, 'scouting', 'Scouted after the Sector 9 callout.'], ['O1-1', 11, 'greenlit', 'Greenlit on a clear majority.'], ['O1-3', 4, 'tryout', 'Tryout scheduled; awaiting assessment.']],
    votes: { O1_1: 'yes', O1_3: 'yes' },
    tryoutStrikes: [['O1-3', 2, 0.5, 'Late to the assessed deployment.']],
  },
  {
    ref: 'SCT-0031', name: 'Croft, M.', steamId: 'STEAM_0:0:33910228', department: 'Research Department', rank: 'Trooper',
    org: 'omega-1', stage: 'archived', archiveStatus: 'denied',
    comments: [['O1-3', 40, 'scouting', 'Scouted, but conduct flags surfaced during review.'], ['O1-1', 33, 'scouting', 'Denied at scouting \u2014 insufficient record.']], votes: {},
  },
  // Ethics Committee Assistant pipeline
  {
    ref: 'APP-EC-014', name: 'Wexley, P.', steamId: 'STEAM_0:1:71223388', department: 'Ethics Committee', rank: 'Assistant Candidate',
    org: 'ethics-committee', stage: 'application', tag: 'in-progress', applicationLink: 'https://forum.example/app/ec-014',
    comments: [['EC-5', 8, 'application', 'Application received; thoughtful written responses.'], ['EC-3', 3, 'application', 'Supportive \u2014 recommend taking to interview.']],
    votes: { EC_3: 'yes', EC_5: 'yes' },
  },
  {
    ref: 'APP-EC-011', name: 'Aldous, R.', steamId: 'STEAM_0:0:80551247', department: 'Ethics Committee', rank: 'Assistant Candidate',
    org: 'ethics-committee', stage: 'interview', tag: 'to-interview', applicationLink: 'https://forum.example/app/ec-011',
    comments: [['EC-5', 20, 'application', 'Strong application; majority support.'], ['EC-1', 9, 'interview', 'Advanced to interview. Scheduling pending.']],
    votes: { EC_1: 'yes', EC_3: 'yes', EC_5: 'yes' },
  },
  // Ethics Committee Member track (CL5-only onboarding of Committee Members)
  {
    ref: 'APP-ECM-002', name: 'Sarratt, V.', steamId: 'STEAM_0:1:90114276', department: 'Ethics Committee', rank: 'Member Candidate',
    org: 'ethics-committee', track: 'member', stage: 'application', tag: 'in-progress',
    comments: [['EC-1', 10, 'application', 'Nominated for the Committee — a decade of sound rulings as an Assistant.'], ['EC-3', 4, 'application', 'Concur; the nomination should proceed to interview.']],
    votes: { EC_1: 'yes', EC_3: 'yes' },
  },
];
export function buildSeedRecruits(userList) {
  const idOf = (d) => (userList.find((u) => u.designation === d) || {}).id || null;
  // Vote keys in the specs use safe placeholders (O1_1) -> resolve to user ids.
  const resolveVotes = (votes) => {
    const out = {};
    for (const [k, v] of Object.entries(votes || {})) {
      const id = idOf(k.replace('_', '-'));
      if (id) out[id] = v;
    }
    return out;
  };
  return RECRUIT_SPECS.map((r) => {
    const created = iso(45);
    return {
      id: newId('rec'), ref: r.ref, name: r.name, steamId: r.steamId,
      department: r.department, rank: r.rank, org: r.org,
      ...(r.track ? { track: r.track } : {}),
      stage: r.stage, archiveStatus: r.archiveStatus ?? null, archiveReason: r.archiveReason ?? null,
      applicationLink: r.applicationLink ?? '', tag: r.tag ?? null,
      comments: (r.comments || []).map(([by, daysAgo, stage, text]) => ({ id: newId('rc'), by, ts: iso(daysAgo), stage, text })),
      votes: resolveVotes(r.votes),
      tryoutStrikes: (r.tryoutStrikes || []).map(([by, daysAgo, weight, reason]) => ({ id: newId('strk'), by, ts: iso(daysAgo), weight, reason })),
      personnelFileId: null,
      createdBy: r.comments?.[0]?.[0] || 'O1-1', createdAt: created, updatedAt: iso(3),
      version: 1, deleted: false, deletedAt: null,
    };
  });
}

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
  db.compartments = buildSeedCompartments(db.users);
  db.activity = buildSeedActivity(db.users, db);
  db.operations = buildSeedOperations(db.users, db);
  db.intel = buildSeedIntel(db.users, db);
  db.recruits = buildSeedRecruits(db.users);
  db.trainings = buildSeedTrainings();
  attachSeedCompletions(db.users, db.trainings);
  db.promoReqs = buildSeedPromoReqs('CMD-1');
  db.settings = [{ id: ACTIVITY_REQ_SETTING_ID, org: 'command', data: { ...ACTIVITY_REQ_DEFAULT } }];

  // Tag a record into each operational compartment so the Need-To-Know caveats
  // are visible on first load. Records reference a compartment by its id.
  const compIdByRef = (r) => (db.compartments.find((c) => c.ref === r) || {}).id || null;
  const tagSubject = (ref, compRef) => { const s = db.subjects.find((x) => x.ref === ref); if (s) s.compartment = compIdByRef(compRef); };
  const tagDirective = (ref, compRef) => { const d = db.directives.find((x) => x.ref === ref); if (d) d.compartment = compIdByRef(compRef); };
  const tagCase = (ref, compRef) => { const c = db.cases.find((x) => x.ref === ref); if (c) c.compartment = compIdByRef(compRef); };
  tagSubject('TGT-118', 'NTK-AZURE-WAKE');
  tagDirective('O1-SO-001', 'NTK-IRONWOOD');
  tagCase('EC-CASE-26-009', 'NTK-GLASS-COURT');

  db.meta.seededAt = new Date().toISOString();
  db.meta.surveillanceSeededAt = new Date().toISOString();
  db.meta.tribunalsSeededAt = new Date().toISOString();
  db.meta.compartmentsSeededAt = new Date().toISOString();
  db.meta.activitySeededAt = new Date().toISOString();
  db.meta.recruitsSeededAt = new Date().toISOString();
  db.meta.promoReqsSeededAt = new Date().toISOString();
  saveDb();
  logAction(null, 'SYSTEM_INIT', 'CAIRO dataset initialised with seed personnel, directives, surveillance subjects and tribunal cases.');
  return db;
}
