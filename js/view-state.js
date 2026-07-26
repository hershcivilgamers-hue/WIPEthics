// =============================================================================
// view-state.js — remembered list filters ("saved views").
//
// List views (rosters, the docket, surveillance, the blacklist) each keep a
// module-level `filter` object mutated by their toolbar handlers. Wrapping that
// object in persistedFilter() makes the operator's last filter survive a reload
// or a trip elsewhere in the app — the same convenience the activity log already
// had, extended everywhere for free: a single `const filter =` line changes, the
// handlers are untouched (the Proxy persists on every `filter.x = …`).
//
// Filters are UI preference, not data — stored per-browser in localStorage, and
// a corrupt/blocked store simply falls back to the defaults.
// =============================================================================

const key = (name) => `cairo.filter.${name}`;

export function persistedFilter(name, defaults) {
  let init = { ...defaults };
  try {
    const raw = localStorage.getItem(key(name));
    if (raw) init = { ...defaults, ...JSON.parse(raw) };
  } catch (_) { /* unavailable or corrupt — use defaults */ }
  return new Proxy(init, {
    set(target, prop, value) {
      target[prop] = value;
      try { localStorage.setItem(key(name), JSON.stringify(target)); } catch (_) { /* best effort */ }
      return true;
    },
  });
}

// Clear a view's remembered filter (e.g. a future "reset" control).
export function clearPersistedFilter(name) {
  try { localStorage.removeItem(key(name)); } catch (_) { /* ignore */ }
}
