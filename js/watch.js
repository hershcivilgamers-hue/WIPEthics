// =============================================================================
// watch.js — per-operator record watch ("keep an eye on this").
//
// Watching a record remembers, per-browser, the record's version at the moment
// you started watching. buildNotifications then surfaces a single "changed since
// you started watching" note whenever the live record has moved past that
// baseline. Opening the record re-baselines it (you've now seen the latest), so
// the note clears the way it does on any tracker — no inbox bookkeeping needed.
//
// It is pure preference, stored in localStorage; it never writes to the record
// and inherits the viewer's access rules — the notification side re-checks
// canView, so a record you can no longer see raises nothing. Mirrors the
// moderation.js affordance pattern: an HTML button + a wire helper.
// =============================================================================

import { toast } from './ui.js';

const KEY = 'cairo.watches';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch (_) { return {}; }
}
function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) { /* best effort */ }
}

export function isWatched(id) { return !!readAll()[id]; }
export function watchList() { return readAll(); }

export function watch(id, { type, hash, label, version }) {
  const map = readAll();
  map[id] = { type, hash, label, base: version || 1, at: Date.now() };
  writeAll(map);
}
export function unwatch(id) {
  const map = readAll();
  delete map[id];
  writeAll(map);
}

// Re-baseline a watched record to `version` once the operator has seen it.
// Only ever advances the baseline, never rewinds it.
export function noteWatchSeen(id, version) {
  const map = readAll();
  const w = map[id];
  if (w && (version || 1) > w.base) { w.base = version; writeAll(map); }
}

// --- UI affordance ----------------------------------------------------------
export function watchButton(id) {
  const on = isWatched(id);
  return `<button class="btn btn--sm ${on ? 'is-watching' : ''}" data-act="watch" aria-pressed="${on}"
    title="${on ? 'Stop watching this record' : 'Watch this record — be notified when it changes'}">${on ? '★ Watching' : '☆ Watch'}</button>`;
}

// Wire the toggle. Pass the record's current { id, type, hash, label, version }.
// Opening the view also marks the current version as seen, so a "changed" note
// for a record you're now looking at doesn't linger.
export function wireWatchButton(host, app, { id, type, hash, label, version }) {
  noteWatchSeen(id, version);
  const btn = host.querySelector('[data-act="watch"]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (isWatched(id)) { unwatch(id); toast('No longer watching this record.', 'info'); }
    else { watch(id, { type, hash, label, version }); toast('Watching — you’ll be notified when it changes.', 'success'); }
    app.refresh();
  });
}
