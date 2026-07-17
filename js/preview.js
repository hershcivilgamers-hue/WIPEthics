// =============================================================================
// preview.js — CL5-only redesign preview gate.
//
// The Ethics Committee UMS redesign ships as a review build gated to Command
// (CL5) operators. This module owns the on/off state and applies it by setting
// data-preview="on" on <html> (which activates styles/preview.css) and telling
// export.js to render documents in the preview paper language.
//
// Non-CL5 operators — and CL5 with the preview switched off — see the
// production design untouched. The preference is per-device (like the theme),
// never synced, and defaults to ON for CL5 so the owner sees the redesign
// without hunting for a switch.
// =============================================================================

import { setDocPreview } from './export.js';

const KEY = 'cairo.preview';

// Only Command / CL5 may see the preview.
export function previewAllowed(user) {
  return !!user && user.clearance === 'CL5';
}

// Whether the preview is currently active for this operator on this device.
export function previewOn(user) {
  if (!previewAllowed(user)) return false;
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === '1'; // default ON for CL5
  } catch (_) {
    return true;
  }
}

export function setPreviewPref(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* private mode */ }
}

// Reflect the current state onto the document + document exporter. Safe to call
// with a null user (sign-in screen) — it clears preview mode.
export function applyPreview(user) {
  const on = previewOn(user);
  const el = typeof document !== 'undefined' ? document.documentElement : null;
  if (el) {
    if (on) el.setAttribute('data-preview', 'on');
    else el.removeAttribute('data-preview');
  }
  setDocPreview(on);
  return on;
}
