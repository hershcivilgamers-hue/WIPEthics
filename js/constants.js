// =============================================================================
// constants.js — The domain model.
//
// This is the single source of truth for the organisational rules of the
// Foundation as CAIRO models them: clearance tiers, the two organisations,
// rank ladders, and the lifecycle states a record can be in.
//
// Changing a label here changes it everywhere in the system.
// =============================================================================

// --- Clearance tiers --------------------------------------------------------
// `weight` is the numeric ordering used by the permission engine. Higher beats
// lower. CL4 is split into Junior / Senior sub-tiers, each its own weight.
export const CLEARANCES = {
  'CL3':   { code: 'CL3',   weight: 3, name: 'Clearance Level 3',          label: 'CL3',   tone: 'cl3', blurb: 'Secret — operational personnel.' },
  'CL4-J': { code: 'CL4-J', weight: 4, name: 'Clearance Level 4 · Junior', label: 'CL4·J', tone: 'cl4', blurb: 'Top Secret — junior command.' },
  'CL4-S': { code: 'CL4-S', weight: 5, name: 'Clearance Level 4 · Senior', label: 'CL4·S', tone: 'cl4', blurb: 'Top Secret — senior command.' },
  'CL5':   { code: 'CL5',   weight: 6, name: 'Clearance Level 5',          label: 'CL5',   tone: 'cl5', blurb: 'Thaumiel — site command & oversight.' },
};

// Order used when populating dropdowns, lowest to highest.
export const CLEARANCE_ORDER = ['CL3', 'CL4-J', 'CL4-S', 'CL5'];

// --- Organisations ----------------------------------------------------------
// `command` is the cross-org administration tier (where CAIRO itself is run
// from). Command personnel can act across both operational organisations.
export const ORGS = {
  'omega-1': {
    code: 'omega-1',
    name: 'MTF Omega-1',
    short: 'Omega-1',
    motto: 'Law\u2019s Left Hand',
    tone: 'omega',
  },
  'ethics-committee': {
    code: 'ethics-committee',
    name: 'Ethics Committee',
    short: 'Ethics',
    motto: 'Oversight \u00b7 Review \u00b7 Conscience',
    tone: 'ethics',
  },
  'command': {
    code: 'command',
    name: 'Site Command',
    short: 'Command',
    motto: 'CAIRO Administration',
    tone: 'command',
  },
};

export const ORG_ORDER = ['omega-1', 'ethics-committee', 'command'];

// --- Rank ladders (per organisation) ----------------------------------------
// Ordered HIGH -> LOW: index 0 is the most senior rank. The next promotion
// from a given rank is therefore the entry at (rankIndex - 1); the next
// demotion is (rankIndex + 1).
export const RANKS = {
  'omega-1': [
    'Commander',         // Sr CL4
    'Major',             // Sr CL4
    'Captain',           // Jr CL4
    'Lieutenant',        // Jr CL4
    'Command Sergeant',  // CL3
    'Sergeant',          // CL3
    'Corporal',          // CL3
    'Lance Corporal',    // CL3
    'Specialist',        // CL3
    'Private',           // CL3
  ],
  'ethics-committee': [
    'Chairman',          // CL5
    'Member',            // CL5
    'Assistant',         // Jr CL4
  ],
  'command': ['Director', 'Liaison'],
};

// The clearance tier each rank carries. Promotion/demotion keeps an operator's
// clearance aligned to their rank's tier. (Command ranks are administrative and
// keep their separately-assigned clearance.)
export const RANK_CLEARANCE = {
  'omega-1': {
    'Commander': 'CL4-S', 'Major': 'CL4-S',
    'Captain': 'CL4-J', 'Lieutenant': 'CL4-J',
    'Command Sergeant': 'CL3', 'Sergeant': 'CL3', 'Corporal': 'CL3',
    'Lance Corporal': 'CL3', 'Specialist': 'CL3', 'Private': 'CL3',
  },
  'ethics-committee': {
    'Chairman': 'CL5', 'Member': 'CL5', 'Assistant': 'CL4-J',
  },
};

// Index of a rank within its ladder (-1 if unknown). Lower index = more senior.
export function rankIndex(org, rank) {
  const ladder = RANKS[org] || [];
  return ladder.indexOf(rank);
}
// The rank one step up (more senior), or null at the top / if unknown.
export function rankUp(org, rank) {
  const i = rankIndex(org, rank);
  if (i <= 0) return null;
  return RANKS[org][i - 1];
}
// The rank one step down (more junior), or null at the bottom / if unknown.
export function rankDown(org, rank) {
  const ladder = RANKS[org] || [];
  const i = rankIndex(org, rank);
  if (i < 0 || i >= ladder.length - 1) return null;
  return ladder[i + 1];
}
// The clearance tier a rank carries, or null if the org doesn't map ranks.
export function clearanceForRank(org, rank) {
  return RANK_CLEARANCE[org]?.[rank] || null;
}

// --- Personnel status (the operational lifecycle of a record) ---------------
export const STATUSES = {
  active:     { code: 'active',     label: 'Active',     tone: 'ok' },
  loa:        { code: 'loa',        label: 'On Leave',   tone: 'warn' },
  suspended:  { code: 'suspended',  label: 'Suspended',  tone: 'bad' },
  reassigned: { code: 'reassigned', label: 'Reassigned', tone: 'muted' },
  terminated: { code: 'terminated', label: 'Terminated', tone: 'muted' },
  deceased:   { code: 'deceased',   label: 'Deceased',   tone: 'muted' },
};

export const STATUS_ORDER = ['active', 'loa', 'suspended', 'reassigned', 'terminated', 'deceased'];

// --- Account status (the access lifecycle of a login) -----------------------
export const ACCOUNT_STATUS = {
  pending:  { code: 'pending',  label: 'Pending Approval', tone: 'warn' },
  active:   { code: 'active',   label: 'Active',           tone: 'ok' },
  disabled: { code: 'disabled', label: 'Disabled',         tone: 'muted' },
};

// --- Strike policy ----------------------------------------------------------
// Number of active strikes that flags a record for command review.
export const STRIKE_LIMIT = 3;

// --- Surveillance: subject classification -----------------------------------
// A POI is watched; a TARGET is actively pursued / to be contained.
export const SUBJECT_CLASS = {
  poi:    { code: 'poi',    label: 'Person of Interest', short: 'POI',    tone: 'info' },
  target: { code: 'target', label: 'Acquisition Target', short: 'TARGET', tone: 'bad' },
};
export const SUBJECT_CLASS_ORDER = ['poi', 'target'];

// --- Surveillance: threat assessment ----------------------------------------
export const THREAT_LEVELS = {
  low:      { code: 'low',      label: 'Low',      tone: 'ok',    weight: 1 },
  moderate: { code: 'moderate', label: 'Moderate', tone: 'warn',  weight: 2 },
  high:     { code: 'high',     label: 'High',     tone: 'bad',   weight: 3 },
  critical: { code: 'critical', label: 'Critical', tone: 'bad',   weight: 4 },
};
export const THREAT_ORDER = ['low', 'moderate', 'high', 'critical'];

// --- Surveillance: case status ----------------------------------------------
export const SUBJECT_STATUS = {
  active:    { code: 'active',    label: 'Active Watch', tone: 'ok' },
  located:   { code: 'located',   label: 'Located',      tone: 'info' },
  detained:  { code: 'detained',  label: 'Detained',     tone: 'warn' },
  contained: { code: 'contained', label: 'Contained',    tone: 'muted' },
  cold:      { code: 'cold',      label: 'Cold',         tone: 'muted' },
  closed:    { code: 'closed',    label: 'Closed',       tone: 'muted' },
};
export const SUBJECT_STATUS_ORDER = ['active', 'located', 'detained', 'contained', 'cold', 'closed'];

// --- Ethics tribunals: proceeding type --------------------------------------
export const CASE_KIND = {
  review:   { code: 'review',   label: 'Containment Review', short: 'Review',   tone: 'info' },
  tribunal: { code: 'tribunal', label: 'Full Tribunal',      short: 'Tribunal', tone: 'bad' },
  inquiry:  { code: 'inquiry',  label: 'Inquiry',            short: 'Inquiry',  tone: 'warn' },
};
export const CASE_KIND_ORDER = ['review', 'tribunal', 'inquiry'];

// --- Ethics tribunals: case status ------------------------------------------
export const CASE_STATUS = {
  open:         { code: 'open',         label: 'Open',          tone: 'info' },
  'in-session': { code: 'in-session',   label: 'In Session',    tone: 'warn' },
  deliberation: { code: 'deliberation', label: 'Deliberation',  tone: 'warn' },
  ruled:        { code: 'ruled',        label: 'Ruled',         tone: 'ok' },
  dismissed:    { code: 'dismissed',    label: 'Dismissed',     tone: 'muted' },
  closed:       { code: 'closed',       label: 'Closed',        tone: 'muted' },
};
export const CASE_STATUS_ORDER = ['open', 'in-session', 'deliberation', 'ruled', 'dismissed', 'closed'];

// --- Ethics tribunals: ruling finding ---------------------------------------
export const RULING_FINDING = {
  upheld:     { code: 'upheld',     label: 'Complaint Upheld',   tone: 'bad' },
  dismissed:  { code: 'dismissed',  label: 'Dismissed',          tone: 'ok' },
  referred:   { code: 'referred',   label: 'Referred Onward',    tone: 'warn' },
  'no-action': { code: 'no-action', label: 'No Further Action',  tone: 'muted' },
};
export const RULING_FINDING_ORDER = ['upheld', 'dismissed', 'referred', 'no-action'];

// --- Need-To-Know compartments ----------------------------------------------
// A compartment is an access caveat that sits ALONGSIDE the clearance ladder,
// not on it. A record (subject / case / directive) may carry one compartment;
// to see its content an operator must clear the normal clearance gate AND be
// "read into" the compartment (or hold CL5, the universal read override). Who
// may administer a compartment — open it, seal it, read operators in or out —
// follows the standard management rule for the owning organisation.
//
// COMPARTMENT shape:
//   { id, ref, name, codeword, org, clearance (floor), description, status,
//     members:[userId], events:[{type,text,at}],
//     createdBy, createdAt, updatedAt, version, deleted, deletedAt }
//
//   • active — open; operators may be read in (subject to the clearance floor).
//   • sealed — frozen; existing read-ins keep access, but no new read-ins. Used
//     when a compartment is wound down but its records must stay legible.
export const COMPARTMENT_STATUS = {
  active: { code: 'active', label: 'Active', tone: 'ok',    blurb: 'Open \u2014 operators may be read in.' },
  sealed: { code: 'sealed', label: 'Sealed', tone: 'muted', blurb: 'Frozen \u2014 no new read-ins.' },
};
export const COMPARTMENT_STATUS_ORDER = ['active', 'sealed'];

// --- Operational activity & readiness ---------------------------------------
// Each operator has an activity record: a running log of operational check-ins
// (deployments, training, status) plus an optional duty posture. Readiness is
// DERIVED from the most recent entry's age against the thresholds below — so it
// is always current and cannot be set as a field.
//
// ACTIVITY record shape:
//   { id, userId, org, entries:[{id,type,text,by,at}], duty, lastActiveAt,
//     createdBy, createdAt, updatedAt, version, deleted, deletedAt }
export const ACTIVITY_TYPE = {
  'check-in':  { code: 'check-in',  label: 'Check-in',   tone: 'ok' },
  deployment:  { code: 'deployment', label: 'Deployment', tone: 'info' },
  training:    { code: 'training',  label: 'Training',   tone: 'info' },
  standdown:   { code: 'standdown', label: 'Stand-down', tone: 'muted' },
  note:        { code: 'note',      label: 'Note',       tone: 'muted' },
};
export const ACTIVITY_TYPE_ORDER = ['check-in', 'deployment', 'training', 'standdown', 'note'];

// Duty posture — a manager flags a current state that supersedes derived
// readiness (e.g. away on a long operation, or deliberately stood down).
export const DUTY_STATUS = {
  none:         { code: 'none',         label: 'On roster',  tone: 'muted' },
  deployed:     { code: 'deployed',     label: 'On Operation', tone: 'info' },
  'stood-down': { code: 'stood-down',   label: 'Stood Down', tone: 'muted' },
  leave:        { code: 'leave',        label: 'On Leave',   tone: 'warn' },
};
export const DUTY_STATUS_ORDER = ['none', 'deployed', 'stood-down', 'leave'];

// Readiness states, derived from days since the last logged activity.
export const READINESS = {
  current: { code: 'current', label: 'Current',          tone: 'ok' },
  overdue: { code: 'overdue', label: 'Overdue',          tone: 'warn' },
  breach:  { code: 'breach',  label: 'Activity Breach',  tone: 'bad' },
  unknown: { code: 'unknown', label: 'No Activity',      tone: 'muted' },
};
export const READINESS_OVERDUE_DAYS = 14;
export const READINESS_BREACH_DAYS = 30;
export function readinessFor(lastActiveAt, now = Date.now()) {
  if (!lastActiveAt) return 'unknown';
  const days = (now - new Date(lastActiveAt).getTime()) / 86400000;
  if (days >= READINESS_BREACH_DAYS) return 'breach';
  if (days >= READINESS_OVERDUE_DAYS) return 'overdue';
  return 'current';
}

// --- Recruitment (Omega-1 scouting pipeline) --------------------------------
// The regiment's intake process, run by the unit's CL4 cadre (any CL4, not only
// senior managers). A candidate moves Scouting -> Greenlit -> Tryout, then is
// archived as approved or denied. Greenlit is a CL4 yes/no vote; on a Tryout
// approval the approver is prompted to open the operator's personnel file.
//
// RECRUIT record shape:
//   { id, ref, name, steamId, department, rank, org, stage, archiveStatus,
//     comments:[{id,by,at,text,stage}], votes:{userId:'yes'|'no'},
//     personnelFileId, createdBy, createdAt, updatedAt, version, deleted,
//     deletedAt }
export const RECRUIT_STAGE = {
  scouting: { code: 'scouting', label: 'Scouting', tone: 'info',  step: 0, blurb: 'Under scouting review \u2014 any CL4 may comment, deny, or advance.' },
  greenlit: { code: 'greenlit', label: 'Greenlit', tone: 'warn',  step: 1, blurb: 'CL4 vote \u2014 a majority of Yes advances to tryout.' },
  tryout:   { code: 'tryout',   label: 'Tryout',   tone: 'info',  step: 2, blurb: 'In tryout \u2014 approval opens the operator\u2019s personnel file.' },
  archived: { code: 'archived', label: 'Archived', tone: 'muted', step: 3, blurb: 'Closed.' },
};
export const RECRUIT_STAGE_ORDER = ['scouting', 'greenlit', 'tryout', 'archived'];
// The live pipeline columns (archived is shown separately).
export const RECRUIT_PIPELINE = ['scouting', 'greenlit', 'tryout'];
// Archive outcomes.
export const RECRUIT_ARCHIVE = {
  approved: { code: 'approved', label: 'Approved', tone: 'ok' },
  denied:   { code: 'denied',   label: 'Denied',   tone: 'bad' },
};

// Count votes on a candidate -> { yes, no, total, majorityYes }.
export function tallyVotes(votes) {
  const vals = Object.values(votes || {});
  const yes = vals.filter((v) => v === 'yes').length;
  const no = vals.filter((v) => v === 'no').length;
  return { yes, no, total: vals.length, majorityYes: yes > no && yes > 0 };
}

// --- Helpers ----------------------------------------------------------------
export const clearanceWeight = (code) => CLEARANCES[code]?.weight ?? 0;
export const orgName = (code) => ORGS[code]?.name ?? code;
export const statusMeta = (code) => STATUSES[code] ?? { code, label: code, tone: 'muted' };
