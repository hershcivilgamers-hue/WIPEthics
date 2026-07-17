// =============================================================================
// theme.js — Display themes.
//
// A per-device display preference (not synced — how you like the screen to look
// is personal to the device, not part of the shared record). Each theme is a
// set of CSS-variable overrides in tokens.css, selected by a data-theme
// attribute on the document root. Applied at import time so there is no flash
// of the default theme before the saved one loads.
// =============================================================================

export const THEMES = [
  { id: 'graphite', label: 'Registry' },
  { id: 'amber', label: 'Amber CRT' },
  { id: 'green', label: 'Green CRT' },
  { id: 'nightwatch', label: 'Nightwatch' },
];

const KEY = 'cairo.theme';
const valid = (id) => THEMES.some((t) => t.id === id);

export function getTheme() {
  try { const v = localStorage.getItem(KEY); return valid(v) ? v : 'graphite'; } catch (_) { return 'graphite'; }
}

export function applyTheme(id) {
  const theme = valid(id) ? id : 'graphite';
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function setTheme(id) {
  try { localStorage.setItem(KEY, valid(id) ? id : 'graphite'); } catch (_) { /* private mode */ }
  applyTheme(id);
}

// Apply the saved theme as soon as this module is imported.
applyTheme(getTheme());
