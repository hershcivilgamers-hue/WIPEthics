// =============================================================================
// config.js — Per-deployment configuration.
//
// These are the values you are most likely to change for a given deployment.
// Domain rules (clearances, ranks, etc.) live in constants.js instead.
// =============================================================================

export const CONFIG = {
  // Shown in the title bar and classification banners.
  systemName: 'CAIRO.AIC',
  systemSubtitle: 'Automated Identity & Clearance',
  facility: 'SITE-CMD',
  version: '1.0.0',

  // localStorage key under which the entire dataset is stored.
  // Bump the suffix (…v2) if you ever change the data shape and want a clean slate.
  storageKey: 'cairo.aic.v1',

  // Password hashing strength. Higher = slower = more secure.
  pbkdf2Iterations: 150000,

  // Reserved for a future server backend (Cloudflare Worker / Firebase REST).
  // Left null so the system runs fully standalone today.
  apiBaseUrl: null,

  // Feature switches — flip to false to hide a module without deleting code.
  features: {
    directives: true,
    surveillance: true,
    activityLog: true,
    recycleBin: true,
    selfRegistration: true,
  },
};
