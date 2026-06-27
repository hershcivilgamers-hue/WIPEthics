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
// Index order is the promotion order, lowest first.
export const RANKS = {
  'omega-1':          ['Recruit', 'Operative', 'Sergeant', 'Lieutenant', 'Commander'],
  'ethics-committee': ['Assistant', 'Member', 'Senior Member', 'Chairman'],
  'command':          ['Liaison', 'Director'],
};

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

// --- Helpers ----------------------------------------------------------------
export const clearanceWeight = (code) => CLEARANCES[code]?.weight ?? 0;
export const orgName = (code) => ORGS[code]?.name ?? code;
export const statusMeta = (code) => STATUSES[code] ?? { code, label: code, tone: 'muted' };
