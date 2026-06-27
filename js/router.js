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
import { canViewCommandRoster, canAccessAdmin } from './permissions.js';

// Sidebar structure, grouped by organisation. `feature` ties an item to a
// CONFIG feature flag; `guard` ties it to a permission check.
export const NAV = [
  {
    group: 'CAIRO',
    items: [
      { name: 'overview',     hash: '#/overview',     label: 'Command Overview' },
      { name: 'surveillance', hash: '#/surveillance', label: 'Surveillance',    feature: 'surveillance' },
      { name: 'directives',   hash: '#/directives',   label: 'Standing Orders', feature: 'directives' },
      { name: 'activity',     hash: '#/activity',     label: 'Activity Log',    feature: 'activityLog' },
    ],
  },
  {
    group: 'MTF Omega-1',
    items: [
      { name: 'omega-1', hash: '#/omega-1', label: 'Personnel Files' },
    ],
  },
  {
    group: 'Ethics Committee',
    items: [
      { name: 'ethics', hash: '#/ethics', label: 'Personnel Files' },
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
};

// Routes disabled by a CONFIG feature flag.
function featureBlocked(name) {
  if (name === 'directives') return !CONFIG.features.directives;
  if (name === 'activity') return !CONFIG.features.activityLog;
  if (name === 'surveillance' || name === 'subject') return !CONFIG.features.surveillance;
  return false;
}

const TOP_LEVEL = ['overview', 'surveillance', 'directives', 'activity', 'omega-1', 'ethics', 'command', 'admin'];

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
