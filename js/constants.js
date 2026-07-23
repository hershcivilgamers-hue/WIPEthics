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
// --- The masquerade ----------------------------------------------------------
// Omega-1 is the covert department: its members present as Internal Security in
// their day-to-day work, and to CL4-J and below the unit itself is branded
// "Internal Enforcement" \u2014 ISD's SWAT arm. Only CL4-S+ and the Ethics Committee
// know MTF Omega-1 and its true purpose. The name/short below are getters keyed
// on a per-session flag (set from knowsOmegaTruth at render time), so every
// call site \u2014 org tags, dropdowns, exports, search \u2014 brands itself. Default is
// the truth: the Worker, tests and seed all operate on the high side.
let omegaTruthVisible = true;
export function setOmegaBranding(truth) { omegaTruthVisible = !!truth; }

export const ORGS = {
  'omega-1': {
    code: 'omega-1',
    get name() { return omegaTruthVisible ? 'MTF Omega-1' : 'Internal Enforcement'; },
    get short() { return omegaTruthVisible ? 'Omega-1' : 'IE'; },
    get motto() { return omegaTruthVisible ? 'Law\u2019s Left Hand' : 'Order Through Vigilance'; },
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
  // The Committee's covert internal-security arm. An operator's ORG is never
  // 'isd' — membership is an orthogonal caveat carried on user.isd, so an agent
  // keeps their cover post. This entry supplies the labels/tone only.
  'isd': {
    code: 'isd',
    name: 'Internal Security Department',
    short: 'ISD',
    motto: 'The Foundation Within',
    tone: 'isd',
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
  // ISD ladder. Tops out at CL4·S — there is deliberately no CL5 in the ISD, so
  // it can never outrank the Committee it answers to. An agent's rank on this
  // ladder is DERIVED from their Omega-1 cover rank (see isdRankFor), never
  // stored, so the mask and the post can never drift apart.
  'isd': [
    'Director',          // Sr CL4
    'Commissioner',      // Sr CL4
    'Inspector',         // Jr CL4
    'Investigator',      // CL3
    'Operative',         // CL3
  ],
};

// Omega-1 wears the ISD mask, so the unit sits inside ISD's rank structure: an
// operative's public Internal Security rank follows their cover rank. Derived,
// never stored — a stored rank could be forged or drift after a promotion, and
// promotion on the cover ladder IS promotion on the ISD one.
export const ISD_RANK_BY_COVER = {
  'Commander': 'Director',
  'Major': 'Commissioner',
  'Captain': 'Commissioner',
  'Lieutenant': 'Inspector',
  'Command Sergeant': 'Investigator',
  'Sergeant': 'Investigator',
  'Corporal': 'Investigator',
  'Lance Corporal': 'Operative',
  'Specialist': 'Operative',
  'Private': 'Operative',
};
// The ISD rank an operator presents, or null if their post carries no mask.
export function isdRankFor(user) {
  if (!user || user.org !== 'omega-1') return null;
  return ISD_RANK_BY_COVER[user.rank] || null;
}
// The clearance that ISD rank carries (the ladder's own tier, not the cover's).
export function isdClearanceFor(user) {
  const rank = isdRankFor(user);
  return rank ? (RANK_CLEARANCE.isd[rank] || null) : null;
}

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
  'isd': {
    'Director': 'CL4-S', 'Commissioner': 'CL4-S',
    'Inspector': 'CL4-J',
    'Investigator': 'CL3', 'Operative': 'CL3',
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

// Has this operator ticked every item on the promotion checklist for their
// current rank's transition? `reqSet` is the promo_reqs record for (org,fromRank).
// A transition with no defined items is never "complete" (nothing to meet yet).
export function promoChecklistComplete(user, reqSet) {
  const items = (reqSet && reqSet.items) || [];
  if (!items.length) return false;
  const checked = new Set(user?.promoChecks || []);
  return items.every((it) => checked.has(it.id));
}

// --- Personnel status (the operational lifecycle of a record) ---------------
export const STATUSES = {
  active:     { code: 'active',     label: 'Active',     tone: 'ok' },
  loa:        { code: 'loa',        label: 'On Leave',   tone: 'warn' },
  suspended:  { code: 'suspended',  label: 'Suspended',  tone: 'bad' },
  reassigned: { code: 'reassigned', label: 'Reassigned', tone: 'muted' },
  discharged: { code: 'discharged', label: 'Discharged', tone: 'muted' },
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
// A strike is VOIDED if it was lifted by a manager or overturned on appeal.
// Voided strikes remain on the record as history — nothing on a disciplinary
// record ever disappears — but they no longer count toward the flag/limit.
// (The redaction layer sends partial viewers a precomputed `voided` flag.)
export function strikeVoided(strike) {
  if (!strike) return false;
  if (strike.voided === true) return true;
  if (strike.lifted) return true;
  return !!(strike.appeal && strike.appeal.status === 'overturned');
}
// A strike may also carry an optional expiry. An expired strike likewise stays
// on the record as history but no longer counts toward the flag/limit.
export function strikeActive(strike, now = Date.now()) {
  if (!strike) return false;
  if (strikeVoided(strike)) return false;
  if (!strike.expiresAt) return true;
  return new Date(strike.expiresAt).getTime() > now;
}
export function activeStrikeCount(strikes, now = Date.now()) {
  return (strikes || []).filter((s) => strikeActive(s, now)).length;
}

// --- Surveillance: subject classification -----------------------------------
// A POI is watched; a TARGET is actively pursued / to be contained.
export const SUBJECT_CLASS = {
  poi:    { code: 'poi',    label: 'Person of Interest', short: 'POI',    tone: 'info' },
  target: { code: 'target', label: 'Acquisition Target', short: 'TARGET', tone: 'bad' },
};
export const SUBJECT_CLASS_ORDER = ['poi', 'target'];

// --- Blacklist registry -----------------------------------------------------
// A cross-department "do not admit / do not engage" register. Entries are
// visible to all signed-in personnel; managers of the raising organisation (and
// CL5) maintain them.
export const BLACKLIST_SEVERITY = {
  advisory: { code: 'advisory', label: 'Advisory',      tone: 'muted' },
  barred:   { code: 'barred',   label: 'Barred',        tone: 'warn' },
  hostile:  { code: 'hostile',  label: 'Hostile / KOS', tone: 'bad' },
};
export const BLACKLIST_SEVERITY_ORDER = ['advisory', 'barred', 'hostile'];
export const BLACKLIST_STATUS = {
  active: { code: 'active', label: 'Active',  tone: 'bad' },
  lifted: { code: 'lifted', label: 'Lifted',  tone: 'muted' },
};
export const BLACKLIST_STATUS_ORDER = ['active', 'lifted'];

// External blacklists: departments may publish their lists as Google Sheets.
// A "published to the web" sheet exposes a CSV endpoint we can fetch and parse
// client-side. Sources (a label + CSV URL) are stored in one settings row.
export const EXTERNAL_BLACKLIST_SETTING_ID = 'external-blacklists';
export function normalizeSheetSources(data) {
  const list = (data && Array.isArray(data.sources)) ? data.sources : [];
  const seen = new Set();
  return list
    .filter((s) => s && typeof s.id === 'string' && typeof s.label === 'string' && s.label.trim() && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .map((s) => ({ id: s.id, label: s.label.trim(), url: s.url.trim() }));
}
// Turn a Google Sheets share/edit URL into its CSV export endpoint where we can.
export function toSheetCsvUrl(url) {
  const u = String(url).trim();
  // Already a CSV/gviz endpoint.
  if (/output=csv|tqx=out:csv/.test(u)) return u;
  // Published-to-web pubhtml → pub?output=csv
  let m = u.match(/\/spreadsheets\/d\/e\/([^/]+)\/pubhtml/);
  if (m) return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv`;
  // Standard /spreadsheets/d/<id>/edit#gid=<gid>
  m = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) {
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
    return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
  }
  return u;
}
// Minimal RFC-4180-ish CSV parser (handles quotes, commas and newlines).
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let i = 0; let inQuotes = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i += 1; continue; }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => (c || '').trim()));
}
// Map parsed CSV rows into blacklist-shaped entries by matching common headers.
export function mapSheetRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const find = (...names) => { for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx >= 0) return idx; } return -1; };
  const iName = find('name', 'user', 'handle', 'individual', 'alias');
  const iId = find('steam', 'id', 'identifier', 'discord');
  const iReason = find('reason', 'note', 'detail', 'offen', 'why');
  const iSev = find('severity', 'tier', 'level', 'status');
  return rows.slice(1).map((r, n) => ({
    _row: n + 2,
    name: (iName >= 0 ? r[iName] : r[0] || '').trim(),
    identifier: (iId >= 0 ? (r[iId] || '').trim() : ''),
    reason: (iReason >= 0 ? (r[iReason] || '').trim() : ''),
    severity: (iSev >= 0 ? (r[iSev] || '').trim() : ''),
  })).filter((e) => e.name);
}

// A Target is a termination authorisation, so it carries an authorisation state.
// A target is only "live" once an Ethics Committee member has authorised it;
// until then it is pending and must not be acted on.
export const TARGET_AUTH = {
  pending:  { code: 'pending',  label: 'Pending Ethics Authorisation', tone: 'warn' },
  authorised: { code: 'authorised', label: 'Authorised for Termination', tone: 'bad' },
  refused:  { code: 'refused',  label: 'Authorisation Refused', tone: 'muted' },
};
// Returns the authorisation state of a subject record (POIs have none).
export function targetAuthState(subject) {
  if (!subject || subject.kind !== 'target') return null;
  const a = subject.authorization;
  if (a && a.status) return a.status;
  return 'pending';
}

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
  requested:    { code: 'requested',    label: 'Requested',     tone: 'info' },
  open:         { code: 'open',         label: 'Open',          tone: 'info' },
  'in-session': { code: 'in-session',   label: 'In Session',    tone: 'warn' },
  deliberation: { code: 'deliberation', label: 'Deliberation',  tone: 'warn' },
  ruled:        { code: 'ruled',        label: 'Ruled',         tone: 'ok' },
  dismissed:    { code: 'dismissed',    label: 'Dismissed',     tone: 'muted' },
  closed:       { code: 'closed',       label: 'Closed',        tone: 'muted' },
};
export const CASE_STATUS_ORDER = ['requested', 'open', 'in-session', 'deliberation', 'ruled', 'dismissed', 'closed'];

// Court exhibits presented to a case. Internal Security (the prosecutor) submits
// them; the Committee rules each in (accepted) or out (rejected). Like a real
// court, thrown-out evidence stays on the record marked rejected — nothing is
// deleted.
export const EXHIBIT_STATUS = {
  submitted: { code: 'submitted', label: 'Submitted', tone: 'info' },
  accepted:  { code: 'accepted',  label: 'Accepted',  tone: 'ok' },
  rejected:  { code: 'rejected',  label: 'Thrown out', tone: 'bad' },
};

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
  // Internal Security is covert casework rather than field presence, so the
  // Department sets its own (lighter) weekly expectation.
  isdWeekly: 3,
  isdNeedsInteraction: false,
};

// The activity requirements live in a single global `settings` record under this
// id, edited by CL5 in Administration. mergeActivityReqs coerces a stored record
// into a safe, complete requirements object, falling back to the defaults for
// any missing or malformed field.
export const ACTIVITY_REQ_SETTING_ID = 'activity-requirements';

// --- Personnel tags ---------------------------------------------------------
// A managed vocabulary of role/attribute labels (e.g. "Development Manager")
// defined in Administration and assigned to personnel. The catalogue lives in
// one settings row; each user carries an array of tag ids in `user.tags`.
export const PERSONNEL_TAGS_SETTING_ID = 'personnel-tags';
export const TAG_COLORS = ['slate', 'cyan', 'green', 'amber', 'violet', 'red'];

// --- Medals / awards catalogue ----------------------------------------------
// A per-organisation catalogue of medals defined in Administration and awarded
// to personnel (awards ride on user.awards). Keyed by org so Omega-1 and the
// Ethics Committee maintain their own decorations separately.
export const MEDALS_SETTING_ID = 'medals-catalogue';
export function normalizeMedalCatalog(data) {
  const src = (data && typeof data.byOrg === 'object' && data.byOrg) || {};
  const out = {};
  for (const org of ['omega-1', 'ethics-committee', 'command']) {
    const list = Array.isArray(src[org]) ? src[org] : [];
    const seen = new Set();
    out[org] = list
      .filter((m) => m && typeof m.id === 'string' && typeof m.label === 'string' && m.label.trim())
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .map((m) => ({ id: m.id, label: m.label.trim(), description: (m.description || '').trim() }));
  }
  return out;
}
// Normalise a stored catalogue into a clean [{id,label,color}] list.
export function normalizeTagCatalog(data) {
  const list = (data && Array.isArray(data.tags)) ? data.tags : [];
  const seen = new Set();
  return list
    .filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string' && t.label.trim())
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .map((t) => ({ id: t.id, label: t.label.trim(), color: TAG_COLORS.includes(t.color) ? t.color : 'slate' }));
}

export function mergeActivityReqs(data) {
  const d = data || {};
  const num = (v, fb) => (Number.isFinite(+v) && +v >= 0 ? +v : fb);
  return {
    omegaWeekly: num(d.omegaWeekly, ACTIVITY_REQ_DEFAULT.omegaWeekly),
    omegaMonthly: num(d.omegaMonthly, ACTIVITY_REQ_DEFAULT.omegaMonthly),
    ethicsWeekly: num(d.ethicsWeekly, ACTIVITY_REQ_DEFAULT.ethicsWeekly),
    ethicsNeedsInteraction: typeof d.ethicsNeedsInteraction === 'boolean' ? d.ethicsNeedsInteraction : ACTIVITY_REQ_DEFAULT.ethicsNeedsInteraction,
    isdWeekly: num(d.isdWeekly, ACTIVITY_REQ_DEFAULT.isdWeekly),
    isdNeedsInteraction: typeof d.isdNeedsInteraction === 'boolean' ? d.isdNeedsInteraction : ACTIVITY_REQ_DEFAULT.isdNeedsInteraction,
  };
}

// What a given operator must meet. Omega-1 carry the weekly+monthly hours rule;
// Ethics Assistants a light weekly rule plus an interaction; every other
// Committee role and all of Command are exempt.
// `org` names the chain of command doing the judging, and defaults to the
// operator's own. It is an explicit parameter because an ISD agent logs their
// hours ONCE, under their cover post: Omega command judges those hours against
// Omega's threshold, while the Department judges the SAME hours against its own.
// One record, two expectations — mirroring the two rank ladders.
export function activityRequirement(user, reqs = ACTIVITY_REQ_DEFAULT, org = null) {
  if (!user) return { exempt: true };
  const scope = org || user.org;
  if (scope === 'isd') {
    return { weekly: reqs.isdWeekly, monthly: 0, needsInteraction: !!reqs.isdNeedsInteraction, exempt: false };
  }
  if (scope === 'omega-1') {
    return { weekly: reqs.omegaWeekly, monthly: reqs.omegaMonthly, needsInteraction: false, exempt: false };
  }
  if (scope === 'ethics-committee' && user.rank === 'Assistant') {
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
export function activityStatus(user, record, reqs = ACTIVITY_REQ_DEFAULT, now = Date.now(), org = null) {
  const req = activityRequirement(user, reqs, org);
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

// --- Omega-1 weekly engagement score ----------------------------------------
// A per-operator weekly score across eight sections. Six are DERIVED from the
// records the system already holds (scouting, orders, evidence, PoIs, trainings,
// activity); two are entered by a Sr CL4 reviewer (squadron, RP). The reviewer
// may also OVERRIDE any derived score for quality. The review week runs Sunday→
// Saturday, matching the unit's practice ("backdate from the previous Saturday").
//
// Evidence is derived from the evidence collection (see evidence.js): each
// counted submission for the week is worth `evidencePer` points, capped at 5.
//
// ENGAGEMENT record (one per operator per week; manual fields only — derived
// scores are recomputed on read, never stored):
//   { id, userId, org:'omega-1', weekStart(ms),
//     manual:{ squadron, rp },
//     overrides:{ scouting?, orders?, evidence?, pois?, trainings?, activity? },
//     note, by, createdAt, updatedAt, version, deleted, deletedAt }
// Each organisation scores different work, so the section set is per-org. Omega
// scores field engagement; the ISD scores casework. Everything downstream takes
// an `org` and defaults to Omega, so existing callers are unaffected.
export const ENGAGEMENT_SECTIONS_BY_ORG = {
  'omega-1': [
    { key: 'scouting',  label: 'Scouting',       max: 10, mode: 'auto' },
    { key: 'orders',    label: 'Orders',         max: 10, mode: 'auto' },
    { key: 'evidence',  label: 'Evidence',       max: 5,  mode: 'auto' },
    { key: 'pois',      label: 'PoIs / Targets', max: 10, mode: 'auto' },
    { key: 'squadron',  label: 'Squadron',       max: 10, mode: 'manual' },
    { key: 'trainings', label: 'Trainings',      max: 10, mode: 'auto' },
    { key: 'activity',  label: 'Activity',       max: 10, mode: 'auto' },
    { key: 'rp',        label: 'RP',             max: 5,  mode: 'manual' },
  ],
  // Internal Security is measured on casework, not field presence: matters
  // referred, work recorded to files, and matters brought to a disposition.
  'isd': [
    { key: 'referrals',    label: 'Referrals',    max: 10, mode: 'auto' },
    { key: 'casework',     label: 'Casework',     max: 10, mode: 'auto' },
    { key: 'dispositions', label: 'Dispositions', max: 10, mode: 'auto' },
    { key: 'trainings',    label: 'Trainings',    max: 10, mode: 'auto' },
    { key: 'activity',     label: 'Activity',     max: 10, mode: 'auto' },
    { key: 'discretion',   label: 'Discretion',   max: 5,  mode: 'manual' },
    { key: 'conduct',      label: 'Conduct',      max: 5,  mode: 'manual' },
  ],
};
export const ENGAGEMENT_ORG_DEFAULT = 'omega-1';
export function engagementSections(org = ENGAGEMENT_ORG_DEFAULT) {
  return ENGAGEMENT_SECTIONS_BY_ORG[org] || ENGAGEMENT_SECTIONS_BY_ORG[ENGAGEMENT_ORG_DEFAULT];
}
export function engagementMaxFor(org = ENGAGEMENT_ORG_DEFAULT) {
  return Object.fromEntries(engagementSections(org).map((s) => [s.key, s.max]));
}
export function engagementTotalMax(org = ENGAGEMENT_ORG_DEFAULT) {
  return engagementSections(org).reduce((sum, s) => sum + s.max, 0);
}

// Back-compatible Omega aliases (the board and its self-check predate the split).
export const ENGAGEMENT_SECTIONS = ENGAGEMENT_SECTIONS_BY_ORG['omega-1'];
export const ENGAGEMENT_MANUAL_KEYS = ENGAGEMENT_SECTIONS.filter((s) => s.mode === 'manual').map((s) => s.key);
export const ENGAGEMENT_OVERRIDE_KEYS = ENGAGEMENT_SECTIONS.filter((s) => s.mode === 'auto').map((s) => s.key);
export const ENGAGEMENT_MAX = Object.fromEntries(ENGAGEMENT_SECTIONS.map((s) => [s.key, s.max]));
export const ENGAGEMENT_TOTAL_MAX = ENGAGEMENT_SECTIONS.reduce((s, x) => s + x.max, 0); // 70
// Point weights (tune here). Count-per-point for the count sections; host/attend
// for trainings. Activity maps logged hours straight to points (capped).
export const ENGAGEMENT_WEIGHTS = {
  scoutingPer: 3, ordersPer: 2, evidencePer: 2, poisPer: 2, trainHost: 3, trainAttend: 1,
  // ISD casework: a referral is worth more than a single file entry; bringing a
  // matter to a disposition is the heaviest single act.
  referralsPer: 3, caseworkPer: 1, dispositionsPer: 3,
};
export const ENGAGEMENT_WEEK_MS = 7 * 24 * 3600000;

// --- Evidence submissions ---------------------------------------------------
// Operators submit evidence of their weekly engagement; each counted item feeds
// the derived Evidence score above. By default a submission counts immediately;
// an operator flagged `evidenceReviewRequired` has submissions land as 'pending'
// until a reviewer counts or rejects them.
//   EVIDENCE record: { id, org:'omega-1', userId, weekStart(ms), title, link,
//     note, status:'counted'|'pending'|'rejected', submittedBy, reviewedBy,
//     reviewedAt, createdAt, updatedAt, version, deleted, deletedAt }
// --- ISD investigations ------------------------------------------------------
// The Department's "stringently defined multi-stage investigative protocol".
// A matter is REFERRED, given a PRELIMINARY look, opened as ACTIVE, put to
// ADJUDICATION, then CLOSED with a disposition. Substantiated matters are
// referred to the Ethics Committee — ISD investigates, the Committee rules.
//   INVESTIGATION: { id, ref, subjectUserId, openedBy, stage, summary,
//     entries:[{id,ts,by,type,text}], disposition, caseId, compartment,
//     createdAt, updatedAt, version, deleted, deletedAt }
export const INVESTIGATION_STAGE = {
  referral:     { code: 'referral',     label: 'Referral',     tone: 'muted', blurb: 'Filed for assessment — not yet an investigation.' },
  preliminary:  { code: 'preliminary',  label: 'Preliminary',  tone: 'info',  blurb: 'Preliminary enquiry — establishing whether there is a case.' },
  active:       { code: 'active',       label: 'Active',       tone: 'warn',  blurb: 'Open investigation — evidence and interviews in progress.' },
  adjudication: { code: 'adjudication', label: 'Adjudication', tone: 'warn',  blurb: 'Before ISD command for a disposition.' },
  closed:       { code: 'closed',       label: 'Closed',       tone: 'muted', blurb: 'Concluded.' },
};
export const INVESTIGATION_PIPELINE = ['referral', 'preliminary', 'active', 'adjudication', 'closed'];
export const INVESTIGATION_DISPOSITION = {
  unsubstantiated: { code: 'unsubstantiated', label: 'Unsubstantiated', tone: 'ok'   },
  substantiated:   { code: 'substantiated',   label: 'Substantiated',   tone: 'bad'  },
  referred:        { code: 'referred',        label: 'Referred to the Committee', tone: 'warn' },
};
// A stage may only move one step forward, or be closed from adjudication. The
// gate enforces this; the view only offers what is lawful.
export function investigationNextStage(stage) {
  const i = INVESTIGATION_PIPELINE.indexOf(stage);
  return i >= 0 && i < INVESTIGATION_PIPELINE.length - 1 ? INVESTIGATION_PIPELINE[i + 1] : null;
}

export const EVIDENCE_STATUS = {
  counted:  { code: 'counted',  label: 'Counted',  tone: 'ok' },
  pending:  { code: 'pending',  label: 'In review', tone: 'warn' },
  rejected: { code: 'rejected', label: 'Rejected', tone: 'bad' },
};
export const evidenceCounts = (e) => !!e && !e.deleted && e.status === 'counted';

// Sunday 00:00 (local) of the review week containing `now`.
export function engagementWeekStart(now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return d.getTime();
}
// Shift a (Sunday-00:00) week start by whole weeks, staying on the calendar so
// it survives DST. Navigating with a fixed 7×24h step drifts an hour across a
// DST boundary, so the shifted stamp no longer equals the canonical weekStart a
// score was saved under — the week reads empty and a duplicate record is made.
export function engagementWeekShift(weekStart, deltaWeeks) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + deltaWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function clampEngagement(v, max) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(max, n));
}

// Pure: derived scores from a raw event-count bundle (see engagement.js gather).
//   raw = { scoutingCount, ordersCount, poisCount, trainHost, trainAttend, hours, host3wk }
export function engagementAutoScores(raw = {}, org = ENGAGEMENT_ORG_DEFAULT) {
  const w = ENGAGEMENT_WEIGHTS;
  const max = engagementMaxFor(org);
  if (org === 'isd') {
    return {
      referrals:    clampEngagement((raw.referralsCount || 0) * w.referralsPer, max.referrals),
      casework:     clampEngagement((raw.caseworkCount || 0) * w.caseworkPer, max.casework),
      dispositions: clampEngagement((raw.dispositionsCount || 0) * w.dispositionsPer, max.dispositions),
      trainings:    clampEngagement((raw.trainHost || 0) * w.trainHost + (raw.trainAttend || 0) * w.trainAttend, max.trainings),
      activity:     clampEngagement(Math.floor(raw.hours || 0), max.activity),
    };
  }
  return {
    scouting:  clampEngagement((raw.scoutingCount || 0) * w.scoutingPer, max.scouting),
    orders:    clampEngagement((raw.ordersCount || 0) * w.ordersPer, max.orders),
    pois:      clampEngagement((raw.poisCount || 0) * w.poisPer, max.pois),
    evidence:  clampEngagement((raw.evidenceCount || 0) * w.evidencePer, max.evidence),
    trainings: clampEngagement((raw.trainHost || 0) * w.trainHost + (raw.trainAttend || 0) * w.trainAttend, max.trainings),
    activity:  clampEngagement(Math.floor(raw.hours || 0), max.activity),
  };
}

export function engagementResolved(raw = {}, record = null, org = ENGAGEMENT_ORG_DEFAULT) {
  const auto = engagementAutoScores(raw, org);
  const ov = (record && record.overrides) || {};
  const man = (record && record.manual) || {};
  const val = {}; const src = {};
  for (const s of engagementSections(org)) {
    if (s.mode === 'manual') { val[s.key] = clampEngagement(man[s.key], s.max); src[s.key] = 'manual'; continue; }
    const o = ov[s.key];
    if (o !== undefined && o !== null && o !== '') { val[s.key] = clampEngagement(o, s.max); src[s.key] = 'override'; }
    else { val[s.key] = auto[s.key]; src[s.key] = 'auto'; }
  }
  const total = Object.values(val).reduce((a, b) => a + b, 0);
  return { val, src, auto, total };
}

// Pure: the two engagement requirements. Req1 — ≥1 Scouting/Order/Evidence/PoI
// engagement this week. Req2 — ≥1 training hosted in the trailing three weeks.
export function engagementReqs(raw = {}, org = ENGAGEMENT_ORG_DEFAULT) {
  if (org === 'isd') {
    // One investigative contribution this week, and a matter carried in the
    // trailing three weeks — the Department's equivalent of Omega's two.
    const contributions = (raw.referralsCount || 0) + (raw.caseworkCount || 0) + (raw.dispositionsCount || 0);
    return { req1: contributions >= 1, req2: (raw.contrib3wk || 0) >= 1 };
  }
  const engagements = (raw.scoutingCount || 0) + (raw.ordersCount || 0)
    + (raw.poisCount || 0) + (raw.evidenceCount || 0);
  return { req1: engagements >= 1, req2: (raw.host3wk || 0) >= 1 };
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

// Ethics candidate tracks. 'assistant' is the default, CL4-cadre pipeline;
// 'member' onboards Committee Members and is CL5-only (see permissions.js).
// Both share the Application → Interview → Archived stages.
export const RECRUIT_TRACK = {
  assistant: { code: 'assistant', label: 'Assistant', candidateRank: 'Assistant Candidate', role: 'an Assistant to the Ethics Committee' },
  member:    { code: 'member',    label: 'Member',    candidateRank: 'Member Candidate',    role: 'a Member of the Ethics Committee' },
};
export function recruitTrack(record) {
  return record && record.track === 'member' ? 'member' : 'assistant';
}

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
// --- Ethics committee: deliberative votes -----------------------------------
// For non-tribunal matters (an inquiry, or a vote on whether to open one) the
// seated panel records a position. Formal tribunals are decided by a ruling,
// not a poll, so voting is offered for reviews and inquiries.
export const CASE_VOTE = {
  favour:  { code: 'favour',  label: 'In Favour',  tone: 'ok' },
  oppose:  { code: 'oppose',  label: 'Opposed',    tone: 'bad' },
  abstain: { code: 'abstain', label: 'Abstaining', tone: 'muted' },
};
export const CASE_VOTE_ORDER = ['favour', 'oppose', 'abstain'];
export function tallyCaseVotes(votes) {
  const vals = Object.values(votes || {});
  const favour = vals.filter((v) => v === 'favour').length;
  const oppose = vals.filter((v) => v === 'oppose').length;
  const abstain = vals.filter((v) => v === 'abstain').length;
  return { favour, oppose, abstain, cast: vals.length, carried: favour > oppose && favour > 0 };
}
// Voting applies to deliberative (non-tribunal) matters.
export function caseTakesVote(kind) {
  return kind === 'inquiry' || kind === 'review';
}

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
