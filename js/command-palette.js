// =============================================================================
// command-palette.js — ⌘K / Ctrl-K quick switcher.
//
// One keystroke to jump to any module the operator can reach, or any record the
// organisation-wide index can surface for them. Navigation visibility reuses
// router.isRouteAllowed and records reuse searchRecords(), so the palette can
// never reveal a destination or a record the operator could not already open —
// the gate is the same one the sidebar and the Search view already enforce.
// =============================================================================

import { NAV, isRouteAllowed } from './router.js';
import { searchRecords, setQuery as setSearchQuery } from './views/search.js';
import { esc } from './ui.js';

let overlay = null;    // the mounted palette element, or null when closed
let lastFocus = null;  // element to restore focus to on close
let installed = false; // guard so the global shortcut binds exactly once

const RECORDS_PER_GROUP = 6; // keep the palette tight; the full Search view shows the rest

// Flatten the sidebar to the destinations THIS operator may actually reach.
function navTargets(user) {
  const out = [];
  for (const group of NAV) {
    for (const item of group.items) {
      if (isRouteAllowed(item.name, user)) out.push({ label: item.label, sub: group.group, hash: item.hash });
    }
  }
  return out;
}

export function openPalette(app) {
  if (overlay || !app || !app.user) return;
  lastFocus = document.activeElement;

  overlay = document.createElement('div');
  overlay.className = 'cmdk-backdrop';
  overlay.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="cmdk__head">
        <span class="cmdk__glyph" aria-hidden="true">⌘K</span>
        <input id="cmdk-input" class="cmdk__input" type="text" role="combobox" aria-expanded="true"
          aria-controls="cmdk-list" aria-autocomplete="list" autocomplete="off" spellcheck="false"
          placeholder="Jump to a module, or search records…" />
      </div>
      <div id="cmdk-list" class="cmdk__list" role="listbox" aria-label="Results"></div>
      <div class="cmdk__foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#cmdk-input');
  const list = overlay.querySelector('#cmdk-list');
  let flat = [];
  let sel = 0;

  // Build the sections for the current query. Nav + a full-search fallback are
  // always available; records only once the query is specific enough to matter.
  function sectionsFor(raw) {
    const query = raw.trim();
    const ql = query.toLowerCase();
    const sections = [];

    let navs = navTargets(app.user);
    if (ql) navs = navs.filter((n) => `${n.label} ${n.sub}`.toLowerCase().includes(ql));
    if (navs.length) {
      sections.push({ label: 'Go to', items: navs.map((n) => ({
        kind: 'nav', label: n.label, meta: n.sub,
        activate: () => { close(); app.navigate(n.hash); },
      })) });
    }

    if (query.length >= 2) {
      const { groups } = searchRecords(app.user, query);
      for (const g of groups) {
        sections.push({ label: g.title, items: g.items.slice(0, RECORDS_PER_GROUP).map((it) => ({
          kind: 'record', label: it.ref, name: it.name, meta: it.badges,
          activate: () => { close(); app.navigate(it.href); },
        })) });
      }
    }

    if (query) {
      sections.push({ label: '', items: [{
        kind: 'action', label: `Search all records for “${query}”`, meta: '',
        activate: () => { setSearchQuery(query); close(); app.navigate('#/search'); },
      }] });
    }
    return sections;
  }

  function draw() {
    const sections = sectionsFor(input.value);
    flat = [];
    let html = '';
    for (const s of sections) {
      if (s.label) html += `<div class="cmdk__group">${esc(s.label)}</div>`;
      for (const it of s.items) {
        const idx = flat.length;
        flat.push(it);
        const label = it.kind === 'record'
          ? `<span class="cmdk__ref">${esc(it.label)}</span> <span class="cmdk__name">${it.name || ''}</span>`
          : esc(it.label);
        html += `<div class="cmdk__item cmdk__item--${it.kind}" role="option" id="cmdk-opt-${idx}" data-idx="${idx}" aria-selected="false">`
          + `<span class="cmdk__text">${label}</span>`
          + `<span class="cmdk__meta">${it.meta || ''}</span>`
          + `</div>`;
      }
    }
    if (!flat.length) html = '<div class="cmdk__empty">No matches. Try a designation, reference or module name.</div>';
    list.innerHTML = html;
    if (sel >= flat.length) sel = Math.max(0, flat.length - 1);
    paint();
  }

  function paint() {
    const rows = [...list.querySelectorAll('.cmdk__item')];
    rows.forEach((el, i) => {
      const on = i === sel;
      el.classList.toggle('cmdk__item--active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', flat.length ? `cmdk-opt-${sel}` : '');
  }

  const move = (d) => { if (flat.length) { sel = (sel + d + flat.length) % flat.length; paint(); } };
  const activate = () => { const it = flat[sel]; if (it) it.activate(); };

  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); } // keep focus trapped in the palette
  });
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.cmdk__item'); if (!row) return;
    const i = Number(row.dataset.idx); if (i !== sel) { sel = i; paint(); }
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.cmdk__item'); if (!row) return;
    sel = Number(row.dataset.idx); activate();
  });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  draw();
  input.focus();
  // Belt-and-suspenders: re-assert focus after layout so the operator can type
  // immediately even if opening stole focus for a frame.
  requestAnimationFrame(() => { if (overlay) input.focus(); });
}

function close() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (_) { /* focus is best-effort */ } }
  lastFocus = null;
}

// Bind the global ⌘K / Ctrl-K shortcut once. Toggles the palette open/closed.
export function installPaletteShortcut(app) {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (overlay) close(); else openPalette(app);
    }
  });
}
