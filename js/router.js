// =============================================================================
// router.js — Routing, navigation structure and access guards.
//
// CAIRO uses hash routing (#/overview, #/personnel/usr_123) so it works on
// static hosting with no server rewrites. This file is the single source of
// truth for: what routes exist, what each one is called in the sidebar, and who
// is allowed to reach it. app.js reads from here to build the nav and to guard
// navigation.
// =============================================================================

import { CONFIG } from './config.js';
import { canViewCommandRoster, canAccessAdmin, canManageOrg, canParticipateRecruitment, isCL5 } from './permissions.js';

// Each recruitment feed is for the unit's CL4 cadre (a stake in that org), or CL5.
const canSeeOmegaRecruitment = (u) => isCL5(u) || canParticipateRecruitment(u, 'omega-1');
const canSeeEthicsRecruitment = (u) => isCL5(u) || canParticipateRecruitment(u, 'ethics-committee');
const canSeeDocket = (u) => isCL5(u) || u.org === 'ethics-committee' || u.org === 'command';
const canSeeAnyRecruitment = (u) => canSeeOmegaRecruitment(u) || canSeeEthicsRecruitment(u);
const canSeeDeployments = (u) => isCL5(u) || u.org === 'omega-1' || u.org === 'command';
const canSeeIntel = (u) => isCL5(u) || u.org === 'omega-1' || u.org === 'command';
const canSeeDashboard = (u) => isCL5(u) || u.org === 'omega-1' || u.org === 'command';
// Engagement scoring is a Sr CL4 command tool (CL4·Senior with an Omega stake, or CL5).
const canSeeEngagement = (u) => isCL5(u) || canManageOrg(u, 'omega-1');
// Evidence is self-service for Omega personnel (submit their own), plus managers/CL5 (review).
const canSeeEvidence = (u) => isCL5(u) || u.org === 'omega-1' || canManageOrg(u, 'omega-1');

// Sidebar structure, grouped by organisation. `feature` ties an item to a
// CONFIG feature flag; `guard` ties it to a permission check.
export const NAV = [
  {
    group: 'CAIRO',
    items: [
      { name: 'overview',     hash: '#/overview',     label: 'Command Overview' },
      { name: 'notifications', hash: '#/notifications', label: 'For Your Attention' },
      { name: 'search',       hash: '#/search',       label: 'Search' },
      { name: 'surveillance', hash: '#/surveillance', label: 'Surveillance',    feature: 'surveillance' },
      { name: 'compartments', hash: '#/compartments', label: 'Need-To-Know',    feature: 'compartments' },
      { name: 'operations',   hash: '#/operations',   label: 'Readiness',       feature: 'operations' },
      { name: 'trainings',    hash: '#/trainings',    label: 'Trainings',       feature: 'trainings' },
      { name: 'directives',   hash: '#/directives',   label: 'Standing Orders', feature: 'directives' },
      { name: 'documents',    hash: '#/documents',    label: 'Documents', feature: 'documents' },
      { name: 'terminal',     hash: '#/terminal',     label: 'CAIRO Terminal', feature: 'terminal' },
      { name: 'activity',     hash: '#/activity',     label: 'Activity Log',    feature: 'activityLog' },
      { name: 'blacklist',    hash: '#/blacklist',    label: 'Blacklist',       feature: 'blacklist' },
    ],
  },
  {
    group: 'MTF Omega-1',
    items: [
      { name: 'dashboard',     hash: '#/dashboard',           label: 'Situation Board', feature: 'dashboard', guard: canSeeDashboard },
      { name: 'omega-1',       hash: '#/omega-1',             label: 'Personnel Files' },
      { name: 'recruit-omega', hash: '#/omega-1/recruitment', label: 'Recruitment', feature: 'recruitment', guard: canSeeOmegaRecruitment },
      { name: 'deployments',   hash: '#/deployments',        label: 'Deployment Log', feature: 'deployments', guard: canSeeDeployments },
      { name: 'intel',         hash: '#/intel',              label: 'Intelligence',   feature: 'intel', guard: canSeeIntel },
      { name: 'engagement',    hash: '#/engagement',         label: 'Engagement',     feature: 'engagement', guard: canSeeEngagement },
      { name: 'evidence',      hash: '#/evidence',           label: 'Evidence',       feature: 'evidence', guard: canSeeEvidence },
    ],
  },
  {
    group: 'Ethics Committee',
    items: [
      { name: 'docket',         hash: '#/docket',             label: 'Docket Board', feature: 'dashboard', guard: canSeeDocket },
      { name: 'ethics',         hash: '#/ethics',             label: 'Personnel Files' },
      { name: 'tribunals',      hash: '#/tribunals',          label: 'Case Docket', feature: 'tribunals' },
      { name: 'recruit-ethics', hash: '#/ethics/recruitment', label: 'Assistant Applications', feature: 'recruitment', guard: canSeeEthicsRecruitment },
    ],
  },
  {
    group: 'Site Command',
    items: [
      { name: 'command', hash: '#/command', label: 'Personnel Files', guard: canViewCommandRoster },
      { name: 'admin',   hash: '#/admin',   label: 'Administration',  guard: canAccessAdmin },
    ],
  },
];

// Top-level route guards (also applied to direct URL access, not just nav).
const GUARDS = {
  command: canViewCommandRoster,
  admin: canAccessAdmin,
  'recruit-omega': canSeeOmegaRecruitment,
  deployments: canSeeDeployments,
  operation: canSeeDeployments,
  intel: canSeeIntel,
  source: canSeeIntel,
  dashboard: canSeeDashboard,
  engagement: canSeeEngagement,
  evidence: canSeeEvidence,
  'recruit-ethics': canSeeEthicsRecruitment,
  docket: canSeeDocket,
  recruit: canSeeAnyRecruitment,
};

// Routes disabled by a CONFIG feature flag.
function featureBlocked(name) {
  if (name === 'directives' || name === 'directive') return !CONFIG.features.directives;
  if (name === 'documents' || name === 'document') return !CONFIG.features.documents;
  if (name === 'terminal') return !CONFIG.features.terminal;
  if (name === 'activity') return !CONFIG.features.activityLog;
  if (name === 'surveillance' || name === 'subject') return !CONFIG.features.surveillance;
  if (name === 'tribunals' || name === 'case') return !CONFIG.features.tribunals;
  if (name === 'compartments' || name === 'compartment') return !CONFIG.features.compartments;
  if (name === 'operations') return !CONFIG.features.operations;
  if (name === 'recruit-omega' || name === 'recruit-ethics' || name === 'recruit') return !CONFIG.features.recruitment;
  if (name === 'deployments' || name === 'operation') return !CONFIG.features.deployments;
  if (name === 'intel' || name === 'source') return !CONFIG.features.intel;
  if (name === 'trainings') return !CONFIG.features.trainings;
  if (name === 'blacklist') return !CONFIG.features.blacklist;
  if (name === 'dashboard') return !CONFIG.features.dashboard;
  if (name === 'docket') return !CONFIG.features.dashboard;
  if (name === 'engagement') return !CONFIG.features.engagement;
  if (name === 'evidence') return !CONFIG.features.evidence;
  return false;
}

const TOP_LEVEL = ['overview', 'notifications', 'search', 'surveillance', 'compartments', 'operations', 'trainings', 'deployments', 'intel', 'engagement', 'evidence', 'dashboard', 'docket', 'tribunals', 'directives', 'documents', 'terminal', 'activity', 'blacklist', 'recruit-omega', 'recruit-ethics', 'omega-1', 'ethics', 'command', 'admin'];

// Parse the current location hash into a route { name, params }.
export function parseHash() {
  const raw = (window.location.hash || '#/overview').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'overview', params: {} };
  if (parts[0] === 'personnel' && parts[1]) {
    return { name: 'dossier', params: { id: parts[1] } };
  }
  if (parts[0] === 'subject' && parts[1]) {
    return { name: 'subject', params: { id: parts[1] } };
  }
  if (parts[0] === 'case' && parts[1]) {
    return { name: 'case', params: { id: parts[1] } };
  }
  if (parts[0] === 'directive' && parts[1]) {
    return { name: 'directive', params: { id: parts[1] } };
  }
  if (parts[0] === 'documents') {
    return { name: 'documents', params: {} };
  }
  if (parts[0] === 'document' && parts[1]) {
    return { name: 'document', params: { id: parts[1] } };
  }
  if (parts[0] === 'compartment' && parts[1]) {
    return { name: 'compartment', params: { id: parts[1] } };
  }
  if (parts[0] === 'recruit' && parts[1]) {
    return { name: 'recruit', params: { id: parts[1] } };
  }
  if (parts[0] === 'operation' && parts[1]) {
    return { name: 'operation', params: { id: parts[1] } };
  }
  if (parts[0] === 'source' && parts[1]) {
    return { name: 'source', params: { id: parts[1] } };
  }
  if (parts[0] === 'omega-1' && parts[1] === 'recruitment') {
    return { name: 'recruit-omega', params: {} };
  }
  if (parts[0] === 'ethics' && parts[1] === 'recruitment') {
    return { name: 'recruit-ethics', params: {} };
  }
  if (TOP_LEVEL.includes(parts[0])) {
    return { name: parts[0], params: {} };
  }
  return { name: 'overview', params: {} };
}

// May this user reach this route?
export function isRouteAllowed(name, user) {
  if (featureBlocked(name)) return false;
  const guard = GUARDS[name];
  if (guard && !guard(user)) return false;
  return true;
}

export { featureBlocked };
