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
  // PBKDF2 work factor. Cloudflare Workers caps PBKDF2 at 100000 iterations, and
  // the Worker is the server-side authority that hashes on login/registration,
  // so this must not exceed 100000 — higher throws "iteration counts above
  // 100000 are not supported" at runtime. (Changing this invalidates existing
  // password hashes, so regenerate seed.sql and re-run it after any change.)
  pbkdf2Iterations: 100000,

  // Server backend (Cloudflare Worker + D1). When set, the app authenticates
  // against this API, loads the data the signed-in operator is cleared to see,
  // and saves every change back through it — with permissions enforced
  // server-side. Set to null to run fully standalone on localStorage instead.
  apiBaseUrl: 'https://cairo-aic-api.hershcivilgamers.workers.dev',

  // Feature switches — flip to false to hide a module without deleting code.
  features: {
    directives: true,
    surveillance: true,
    tribunals: true,
    activityLog: true,
    compartments: true,
    operations: true,
    deployments: true,
    intel: true,
    trainings: true,
    dashboard: true,
    // Passive tab refresh in server mode (on return-to-tab + a slow interval),
    // so colleagues' changes appear without a manual reload.
    autoRefresh: true,
    notifications: true,
    recruitment: true,
    recycleBin: true,
    selfRegistration: true,
  },
};
