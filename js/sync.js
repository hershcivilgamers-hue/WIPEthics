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
import { CONFIG } from './config.js';
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

// ---------------------------------------------------------------------------
// Passive refresh — keeps long-open tabs current with colleagues' changes.
//
// Triggers: returning to the tab (visibility/focus) and a slow interval while
// the tab is visible. Safeguards, in order of importance:
//   • never fires while the operator is typing or has a dialog open, so a
//     re-render can't yank a half-written form away;
//   • runs through the write queue, so it can never overwrite an optimistic
//     change whose push is still in flight;
//   • re-renders only when the snapshot actually differs from the last one;
//   • stays silent on network failures (the write path already reports real
//     errors loudly) — only a dead session (401) is surfaced, once.
// ---------------------------------------------------------------------------
// ponytail: 30s polling, not live push — WebSockets/Durable Objects if a
// same-page edit ever needs to appear in under half a minute.
const AUTO_REFRESH_MS = 30000;     // tick while the tab is visible
const REFRESH_MIN_GAP_MS = 10000;  // focus events can arrive in bursts
let refreshTimer = null;
let lastTickAt = 0;
let lastSnapshotJson = null;
let tickRunning = false;

function operatorIsBusy() {
  try {
    if (document.querySelector('.modal-backdrop')) return true;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || ''))) return true;
  } catch (_) { /* no DOM available — treat as not busy */ }
  return false;
}

export async function autoRefreshTick(force = false) {
  if (!api.serverMode() || !api.getToken()) return;
  try { if (document.visibilityState && document.visibilityState !== 'visible') return; } catch (_) { /* no DOM */ }
  const now = Date.now();
  if (!force && now - lastTickAt < REFRESH_MIN_GAP_MS) return;
  if (operatorIsBusy()) return;
  lastTickAt = now;
  return api.enqueue(async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const snap = await api.fetchSnapshot();
      const json = JSON.stringify(snap);
      if (json !== lastSnapshotJson) {
        if (operatorIsBusy()) return; // began typing while we fetched — next tick will catch up
        lastSnapshotJson = json;
        applyServerSnapshot(snap);
        refresh();
      }
    } catch (err) {
      if (err && err.status === 401) {
        onAuthLost();
        toast('Your session has expired. Please sign in again.', 'error');
      }
      // Anything else stays silent — this is a background nicety.
    } finally {
      tickRunning = false;
    }
  });
}

function disarmAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }
function armAutoRefresh() {
  disarmAutoRefresh();
  refreshTimer = setInterval(() => autoRefreshTick(false), AUTO_REFRESH_MS);
  // Under Node (the test harness) don't let the interval hold the process open.
  if (refreshTimer && typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

export function startAutoRefresh() {
  if (!api.serverMode()) return;
  if (CONFIG.features && CONFIG.features.autoRefresh === false) return;
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { autoRefreshTick(true); armAutoRefresh(); }
      else disarmAutoRefresh();
    });
    window.addEventListener('focus', () => autoRefreshTick(false));
  } catch (_) { /* no DOM events available */ }
  armAutoRefresh();
}
