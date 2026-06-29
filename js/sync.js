// =============================================================================
// sync.js — Keeps the working copy and the Worker in step (server mode only).
//
// The app updates its in-memory copy first (so the UI is instant), then this
// module pushes the change to the Worker in the background. On success it
// adopts the server's canonical record. On failure it does the safe thing:
//
//   • 401 — the session is gone: hand back to the sign-in screen.
//   • 409 — someone else changed the record: reload the latest and say so.
//   • 403 / other server error — the server refused: reload truth (undoing the
//     optimistic change) and say so.
//   • Can't reach the server — tell the operator the change wasn't saved.
//
// UI hooks (refresh / toast / onAuthLost) are injected via init(), so this file
// has no UI dependency of its own.
// =============================================================================

import * as api from './api.js';
import { setSync, applyServerSnapshot, applyServerRecord } from './storage.js';

let refresh = () => {};
let toast = () => {};
let onAuthLost = () => {};

async function resync() {
  const snap = await api.fetchSnapshot();
  applyServerSnapshot(snap);
  refresh();
}

async function onError(err) {
  if (err && err.status === 401) {
    onAuthLost();
    toast('Your session has expired. Please sign in again.', 'error');
    return;
  }
  let message;
  if (err && err.status === 409) message = 'That record was changed elsewhere — reloaded the latest version.';
  else if (err && err.status === 403) message = 'The server did not permit that change — it has been undone.';
  else message = 'The change could not be saved and has been undone.';

  try {
    await resync();
  } catch (_) {
    // Couldn't even reach the server to reconcile — be honest about it.
    message = "Couldn't reach the server — your change was not saved.";
  }
  toast(message, 'error');
}

function write(collection, record) {
  api.enqueue(async () => {
    try {
      const res = await api.pushRecord(collection, record);
      if (res && res.record) applyServerRecord(collection, res.record);
    } catch (err) {
      await onError(err);
    }
  });
}

function remove(collection, id) {
  api.enqueue(async () => {
    try {
      await api.removeRecord(collection, id);
    } catch (err) {
      await onError(err);
    }
  });
}

// Wire this module into storage and supply UI callbacks. Call once at boot.
export function init({ refresh: r, toast: t, onAuthLost: a } = {}) {
  refresh = r || refresh;
  toast = t || toast;
  onAuthLost = a || onAuthLost;
  setSync({ write, remove });
}
