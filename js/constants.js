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

// --- Operational activity & requirements ------------------------------------
// Each operator has an activity record: a log of self-reported sessions, each
// carrying the HOURS played, a note of what they did, and optional tags to the
// work that backs it up (orders/operations/PoI/Targets). Status is DERIVED from
// the hours logged in the current week against the unit's requirement — it is
// never a stored field, only manually overridable by a manager.
//
// ACTIVITY record shape:
//   { id, userId, org,
//     log:[{ id, at(ms), hours, note, tags:[{kind,id,label}], by }],
//     override:{ status, by, at, reason }|null,
//     createdBy, createdAt, updatedAt, version, deleted, deletedAt }

// Default activity requirements. Admin-editable (see the activity requirements
// config); these are the fallback values.
export const ACTIVITY_REQ_DEFAULT = {
  omegaWeekly: 5,
  omegaMonthly: 25,
  ethicsWeekly: 1,
  ethicsNeedsInteraction: true,
};

// The activity requirements live in a single global `settings` record under this
// id, edited by CL5 in Administration. mergeActivityReqs coerces a stored record
// into a safe, complete requirements object, falling back to the defaults for
// any missing or malformed field.
export const ACTIVITY_REQ_SETTING_ID = 'activity-requirements';
export function mergeActivityReqs(data) {
  const d = data || {};
  const num = (v, fb) => (Number.isFinite(+v) && +v >= 0 ? +v : fb);
  return {
    omegaWeekly: num(d.omegaWeekly, ACTIVITY_REQ_DEFAULT.omegaWeekly),
    omegaMonthly: num(d.omegaMonthly, ACTIVITY_REQ_DEFAULT.omegaMonthly),
    ethicsWeekly: num(d.ethicsWeekly, ACTIVITY_REQ_DEFAULT.ethicsWeekly),
    ethicsNeedsInteraction: typeof d.ethicsNeedsInteraction === 'boolean' ? d.ethicsNeedsInteraction : ACTIVITY_REQ_DEFAULT.ethicsNeedsInteraction,
  };
}

// What a given operator must meet. Omega-1 carry the weekly+monthly hours rule;
// Ethics Assistants a light weekly rule plus an interaction; every other
// Committee role and all of Command are exempt.
export function activityRequirement(user, reqs = ACTIVITY_REQ_DEFAULT) {
  if (!user) return { exempt: true };
  if (user.org === 'omega-1') {
    return { weekly: reqs.omegaWeekly, monthly: reqs.omegaMonthly, needsInteraction: false, exempt: false };
  }
  if (user.org === 'ethics-committee' && user.rank === 'Assistant') {
    return { weekly: reqs.ethicsWeekly, monthly: 0, needsInteraction: !!reqs.ethicsNeedsInteraction, exempt: false };
  }
  return { exempt: true };
}

// Kinds of contribution an activity entry can be tagged against.
export const ACTIVITY_TAG_KIND = {
  order:     { code: 'order',     label: 'Order' },        // a directive / standing order
  operation: { code: 'operation', label: 'Operation' },    // a deployment-log operation (when built)
  subject:   { code: 'subject',   label: 'PoI / Target' }, // a surveillance subject
};

// Activity status presentation.
export const ACTIVITY_STATUS = {
  active:   { code: 'active',   label: 'Active',      tone: 'ok' },
  semi:     { code: 'semi',     label: 'Semi-Active', tone: 'warn' },
  inactive: { code: 'inactive', label: 'Inactive',    tone: 'bad' },
  leave:    { code: 'leave',    label: 'On Leave',    tone: 'info' },
  exempt:   { code: 'exempt',   label: 'Exempt',      tone: 'muted' },
};
export const ACTIVITY_STATUS_ORDER = ['active', 'semi', 'inactive', 'leave', 'exempt'];

// Period boundaries — a Monday-start week and a calendar month, in local time.
export function weekStart(now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
export function monthStart(now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(1);
  return d.getTime();
}
export function sumHours(log, since, now = Date.now()) {
  return (log || []).filter((e) => e.at >= since && e.at <= now).reduce((s, e) => s + (Number(e.hours) || 0), 0);
}
function hasInteractionSince(log, since, now = Date.now()) {
  return (log || []).some((e) => e.at >= since && e.at <= now && ((e.note && e.note.trim()) || (e.tags && e.tags.length)));
}

// Derive an operator's activity status. Order of precedence: on authorised leave
// (suppressed to 'leave', no breach) → exempt role → a manager's manual override
// → otherwise Active when the weekly requirement is met (hours, plus an
// interaction for Assistants), Semi-Active for some-but-under, Inactive for
// nothing logged this week. Returns the derived hours so callers can show them.
export function activityStatus(user, record, reqs = ACTIVITY_REQ_DEFAULT, now = Date.now()) {
  const req = activityRequirement(user, reqs);
  const wk = weekStart(now), mo = monthStart(now);
  const log = (record && record.log) || [];
  const weekHours = sumHours(log, wk, now);
  const monthHours = sumHours(log, mo, now);
  const onLeave = !!user && (user.status === 'loa' || !!user.leave);

  const base = { weekHours, monthHours, req, manual: false, onLeave: false, exempt: false };
  if (onLeave) return { ...base, key: 'leave', onLeave: true };
  if (req.exempt) return { ...base, key: 'exempt', exempt: true };

  const ov = record && record.override;
  if (ov && ov.status) {
    return { ...base, key: ov.status, manual: true, overrideBy: ov.by, overrideAt: ov.at, overrideReason: ov.reason };
  }

  const anyThisWeek = log.some((e) => e.at >= wk && e.at <= now);
  if (!anyThisWeek) return { ...base, key: 'inactive' };
  const meetsHours = weekHours >= (req.weekly || 0);
  const meetsInteraction = req.needsInteraction ? hasInteractionSince(log, wk, now) : true;
  return { ...base, key: (meetsHours && meetsInteraction) ? 'active' : 'semi' };
}

// A breach is any non-exempt operator who is Semi-Active or Inactive (i.e. under
// the requirement) and not on authorised leave or manually cleared.
export function activityInBreach(user, record, reqs = ACTIVITY_REQ_DEFAULT, now = Date.now()) {
  const k = activityStatus(user, record, reqs, now).key;
  return k === 'semi' || k === 'inactive';
}

// --- Recruitment (two org-specific pipelines) -------------------------------
// Omega-1 runs a scouting pipeline; the Ethics Committee runs an application /
// interview pipeline for Assistants. Both share the candidate record, comment
// thread and CL4 yes/no vote, but differ in stages and who advances them:
//   • Omega-1:  Scouting -> Greenlit -> Tryout -> Archived   (any CL4 advances)
//   • Ethics:   Application -> Interview -> Archived          (CL5 advances)
//
// RECRUIT record shape:
//   { id, ref, name, steamId, department, rank, org, stage, archiveStatus,
//     archiveReason, applicationLink, tag, comments:[{id,by,at,text,stage}],
//     votes:{userId:'yes'|'no'}, tryoutStrikes:[{id,by,at,weight,reason}],
//     interviewSeed (int; re-roll counter for the deterministic bank draw),
//     customQuestions:[{id,prompt,valid,weak,by,at}] (CL5-added, Ethics only),
//     personnelFileId, createdBy, createdAt, updatedAt, version, deleted,
//     deletedAt }
export const RECRUIT_STAGE = {
  // Omega-1 scouting pipeline
  scouting: { code: 'scouting', label: 'Scouting', tone: 'info',  blurb: 'Under scouting review \u2014 any CL4 may comment, deny, or advance.' },
  greenlit: { code: 'greenlit', label: 'Greenlit', tone: 'warn',  blurb: 'CL4 vote \u2014 a majority of Yes advances to tryout.' },
  tryout:   { code: 'tryout',   label: 'Tryout',   tone: 'info',  blurb: 'In tryout \u2014 approval opens the operator\u2019s personnel file.' },
  // Ethics Committee Assistant pipeline
  application: { code: 'application', label: 'Application', tone: 'info', blurb: 'Under review \u2014 the CL4 cadre may comment and vote; CL5 decides.' },
  interview:   { code: 'interview',   label: 'Interview',   tone: 'warn', blurb: 'Interview stage \u2014 CL5 only.' },
  // shared terminal
  archived: { code: 'archived', label: 'Archived', tone: 'muted', blurb: 'Closed.' },
};
export const RECRUIT_STAGE_ORDER = ['scouting', 'greenlit', 'tryout', 'application', 'interview', 'archived'];
export const RECRUIT_PIPELINE_OMEGA = ['scouting', 'greenlit', 'tryout'];
export const RECRUIT_PIPELINE_ETHICS = ['application', 'interview'];
export function recruitPipeline(org) { return org === 'ethics-committee' ? RECRUIT_PIPELINE_ETHICS : RECRUIT_PIPELINE_OMEGA; }
export function recruitFirstStage(org) { return org === 'ethics-committee' ? 'application' : 'scouting'; }

// Archive outcomes.
export const RECRUIT_ARCHIVE = {
  approved: { code: 'approved', label: 'Approved', tone: 'ok' },
  denied:   { code: 'denied',   label: 'Denied',   tone: 'bad' },
};

// Omega-1 candidate departments (fixed list).
export const OMEGA_DEPARTMENTS = [
  'Research Department',
  'Medical Department',
  'General Security Department',
  'Internal Security Department',
  'Department of External Affairs',
  'MTF Nu-7',
  'MTF Epsilon-11',
];

// Ethics application handling tags (informational labels, set by the cadre).
export const ETHICS_APP_TAG = {
  'in-progress':  { code: 'in-progress',  label: 'In Progress',        tone: 'info' },
  'to-interview': { code: 'to-interview', label: 'Taken to Interview', tone: 'warn' },
  accepted:       { code: 'accepted',     label: 'Accepted',           tone: 'ok' },
  denied:         { code: 'denied',       label: 'Denied',             tone: 'bad' },
};
export const ETHICS_APP_TAG_ORDER = ['in-progress', 'to-interview', 'accepted', 'denied'];

// Tryout strike weights and a fail threshold (a full strike's worth fails).
export const TRYOUT_STRIKE_HALF = 0.5;
export const TRYOUT_STRIKE_FULL = 1;
export function tryoutStrikeTotal(strikes) {
  return (strikes || []).reduce((sum, s) => sum + (Number(s.weight) || 0), 0);
}

// Count votes on a candidate -> { yes, no, total, majorityYes }.
export function tallyVotes(votes) {
  const vals = Object.values(votes || {});
  const yes = vals.filter((v) => v === 'yes').length;
  const no = vals.filter((v) => v === 'no').length;
  return { yes, no, total: vals.length, majorityYes: yes > no && yes > 0 };
}

// --- Operations & deployment log --------------------------------------------
// The unit's record of operations it runs. An operation is clearance-gated like
// a surveillance subject and may additionally carry a Need-To-Know caveat. An
// operator ASSIGNED to an operation (lead or participant) can always see it and
// file field log entries to it, even without the management right — running the
// operation (status, outcome, assignments, classification) is for managers.
//
// OPERATION record shape:
//   { id, ref, name, kind, org, status, clearance, compartment,
//     lead, participants:[userId], location, objective,
//     log:[{id,ts,by,type,text}], outcome:{result,text,at,by}|null,
//     linkedSubjectIds:[], startedAt, concludedAt,
//     createdBy, createdAt, updatedAt, version, deleted, deletedAt }
export const OPERATION_KIND = {
  deployment:  { code: 'deployment',  label: 'Deployment',  short: 'DEPLOY', tone: 'info' },
  patrol:      { code: 'patrol',      label: 'Patrol',      short: 'PATROL', tone: 'muted' },
  containment: { code: 'containment', label: 'Containment', short: 'CONTAIN', tone: 'warn' },
  response:    { code: 'response',    label: 'Rapid Response', short: 'RESP', tone: 'bad' },
  standby:     { code: 'standby',     label: 'Standby',     short: 'STANDBY', tone: 'muted' },
  training:    { code: 'training',    label: 'Training Op', short: 'TRAIN', tone: 'info' },
};
export const OPERATION_KIND_ORDER = ['deployment', 'patrol', 'containment', 'response', 'standby', 'training'];

export const OPERATION_STATUS = {
  planned:   { code: 'planned',   label: 'Planned',   tone: 'muted' },
  active:    { code: 'active',    label: 'Active',    tone: 'ok' },
  concluded: { code: 'concluded', label: 'Concluded', tone: 'info' },
  aborted:   { code: 'aborted',   label: 'Aborted',   tone: 'bad' },
};
export const OPERATION_STATUS_ORDER = ['planned', 'active', 'concluded', 'aborted'];

export const OPERATION_RESULT = {
  success: { code: 'success', label: 'Objective Met',       tone: 'ok' },
  partial: { code: 'partial', label: 'Partial Success',     tone: 'warn' },
  failed:  { code: 'failed',  label: 'Objective Not Met',   tone: 'bad' },
  scrubbed:{ code: 'scrubbed',label: 'Scrubbed',            tone: 'muted' },
};
export const OPERATION_RESULT_ORDER = ['success', 'partial', 'failed', 'scrubbed'];

// Operation log entry kinds.
export const OP_LOG_TYPE = {
  order:    { code: 'order',    label: 'Order',     tone: 'info' },
  movement: { code: 'movement', label: 'Movement',  tone: 'muted' },
  contact:  { code: 'contact',  label: 'Contact',   tone: 'bad' },
  intel:    { code: 'intel',    label: 'Intel',     tone: 'info' },
  status:   { code: 'status',   label: 'Status',    tone: 'ok' },
  note:     { code: 'note',     label: 'Note',      tone: 'muted' },
};
export const OP_LOG_TYPE_ORDER = ['order', 'movement', 'contact', 'intel', 'status', 'note'];

// ---------------------------------------------------------------------------
// Intelligence sources & informants.
//
// INTEL SOURCE record shape:
//   { id, ref, codename, type, org, status, reliability, clearance, compartment,
//     handler, cover, tasking,
//     reports:[{id,at,by,credibility,text}], linkedSubjectIds:[],
//     openedAt, closedAt, createdBy, createdAt, updatedAt, version, deleted, deletedAt }
//
// Reliability and credibility follow the standard intelligence "Admiralty"
// scale: a source is graded A-F for how dependable it has proved, and each
// report is graded 1-6 for how credible that specific information is.
// ---------------------------------------------------------------------------
export const INTEL_SOURCE_TYPE = {
  informant: { code: 'informant', label: 'Informant',        short: 'HUMINT', tone: 'info' },
  defector:  { code: 'defector',  label: 'Defector',         short: 'DEFECT', tone: 'warn' },
  technical: { code: 'technical', label: 'Technical Source', short: 'TECH',   tone: 'muted' },
  intercept: { code: 'intercept', label: 'Intercept',        short: 'SIGINT', tone: 'muted' },
  liaison:   { code: 'liaison',   label: 'Liaison',          short: 'LIAISON',tone: 'info' },
  walk_in:   { code: 'walk_in',   label: 'Walk-in',          short: 'WALKIN', tone: 'muted' },
};
export const INTEL_SOURCE_TYPE_ORDER = ['informant', 'defector', 'technical', 'intercept', 'liaison', 'walk_in'];

export const INTEL_STATUS = {
  active:    { code: 'active',    label: 'Active',    tone: 'ok' },
  probation: { code: 'probation', label: 'Probation', tone: 'warn' },
  dormant:   { code: 'dormant',   label: 'Dormant',   tone: 'muted' },
  burned:    { code: 'burned',    label: 'Burned',    tone: 'bad' },
  closed:    { code: 'closed',    label: 'Closed',    tone: 'info' },
};
export const INTEL_STATUS_ORDER = ['active', 'probation', 'dormant', 'burned', 'closed'];

// Source reliability (Admiralty A-F): how dependable the source has proved.
export const INTEL_RELIABILITY = {
  A: { code: 'A', label: 'A \u2014 Reliable',            tone: 'ok' },
  B: { code: 'B', label: 'B \u2014 Usually Reliable',    tone: 'ok' },
  C: { code: 'C', label: 'C \u2014 Fairly Reliable',     tone: 'info' },
  D: { code: 'D', label: 'D \u2014 Not Usually Reliable',tone: 'warn' },
  E: { code: 'E', label: 'E \u2014 Unreliable',          tone: 'bad' },
  F: { code: 'F', label: 'F \u2014 Cannot Be Judged',    tone: 'muted' },
};
export const INTEL_RELIABILITY_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];

// Information credibility (Admiralty 1-6): how credible a specific report is.
export const INTEL_CREDIBILITY = {
  1: { code: 1, label: '1 \u2014 Confirmed',        tone: 'ok' },
  2: { code: 2, label: '2 \u2014 Probably True',    tone: 'ok' },
  3: { code: 3, label: '3 \u2014 Possibly True',    tone: 'info' },
  4: { code: 4, label: '4 \u2014 Doubtful',         tone: 'warn' },
  5: { code: 5, label: '5 \u2014 Improbable',       tone: 'bad' },
  6: { code: 6, label: '6 \u2014 Cannot Be Judged', tone: 'muted' },
};
export const INTEL_CREDIBILITY_ORDER = [1, 2, 3, 4, 5, 6];

// ---------------------------------------------------------------------------
// Trainings — a course catalogue, with completions held on personnel files.
//
// COURSE record (trainings collection):
//   { id, ref, code, title, org, category, description,
//     validityMonths (0 = never lapses), clearanceFloor, active,
//     createdBy, createdAt, updatedAt, version, deleted, deletedAt }
//
// COMPLETION (rides on user.trainings[], so it inherits personnel redaction):
//   { id, courseId, awardedBy, awardedAt, expiresAt|null, note }
//
// "Currency" (valid / expiring / lapsed) is DERIVED from expiresAt versus now,
// never stored, so a file is always live — the same approach as readiness.
// ---------------------------------------------------------------------------
export const TRAINING_CATEGORY = {
  induction:  { code: 'induction',  label: 'Induction',       tone: 'info' },
  weapons:    { code: 'weapons',    label: 'Weapons & Force', tone: 'warn' },
  containment:{ code: 'containment',label: 'Containment',     tone: 'warn' },
  medical:    { code: 'medical',    label: 'Medical',         tone: 'ok' },
  records:    { code: 'records',    label: 'Records & Conduct', tone: 'muted' },
  command:    { code: 'command',    label: 'Command',         tone: 'info' },
};
export const TRAINING_CATEGORY_ORDER = ['induction', 'weapons', 'containment', 'medical', 'records', 'command'];

// Currency states for a completion (or its absence), with display + sort order.
export const TRAINING_CURRENCY = {
  valid:    { code: 'valid',    label: 'Current',   tone: 'ok' },
  expiring: { code: 'expiring', label: 'Expiring',  tone: 'warn' },
  lapsed:   { code: 'lapsed',   label: 'Lapsed',    tone: 'bad' },
  missing:  { code: 'missing',  label: 'Not held',  tone: 'muted' },
};
// A completion is "expiring" within this window of its expiry.
export const TRAINING_EXPIRING_DAYS = 30;

// Derive currency for a completion record (or null/undefined if not held).
export function trainingCurrency(completion, now = Date.now()) {
  if (!completion) return 'missing';
  if (!completion.expiresAt) return 'valid';
  const exp = new Date(completion.expiresAt).getTime();
  if (exp <= now) return 'lapsed';
  if (exp <= now + TRAINING_EXPIRING_DAYS * 86400000) return 'expiring';
  return 'valid';
}

// Given a validity in months, the ISO expiry from an award date (or null).
export function trainingExpiry(awardedAtIso, validityMonths) {
  if (!validityMonths) return null;
  const d = new Date(awardedAtIso);
  d.setMonth(d.getMonth() + Number(validityMonths));
  return d.toISOString();
}

// --- Helpers ----------------------------------------------------------------
export const clearanceWeight = (code) => CLEARANCES[code]?.weight ?? 0;
export const orgName = (code) => ORGS[code]?.name ?? code;
export const statusMeta = (code) => STATUSES[code] ?? { code, label: code, tone: 'muted' };
