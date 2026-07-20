// =============================================================================
// insignia.js — rank insignia, drawn in-house as SVG.
//
// The emblems are ORIGINAL vector devices in the app's own hand (matching the
// sidebar sigil and org crests), styled to read as authentic military rank:
// pips and crowns for officers, chevrons for the ranks, a laurel for the
// Committee, a command star for Site Command. Because they are original simple
// devices — not copies of any national insignia file — there is no copyright or
// trademark question, they scale crisply, recolour with the theme, and cost no
// storage.
//
// BACKUP PATH: each rank may instead point at a real insignia IMAGE via the IMG
// registry below. Populate an entry with a data-URI (or a committed asset path)
// and rankInsignia() prefers it over the SVG — a drop-in override, no render
// changes needed. Left empty by default so nothing unlicensed ships.
// =============================================================================

import { esc } from './ui.js';

// --- Image backup registry (empty by default). org -> rank -> src ------------
// e.g. IMG['omega-1'].Commander = 'data:image/png;base64,…' or '/assets/…png'.
export const IMG = {
  'omega-1': {},
  'ethics-committee': {},
  command: {},
};

// --- SVG primitives (100×100 viewBox, gold via currentColor) -----------------
// An eight-pointed "pip" — the Star of the Order of the Bath that British Army
// officer rank insignia depict, rendered as our own device (sharp points from
// alternating long/short radii).
function pipAt(cx, cy, r) {
  let pts = '';
  for (let k = 0; k < 16; k += 1) {
    const a = -Math.PI / 2 + (k * Math.PI) / 8;
    const rr = k % 2 ? r * 0.4 : r;
    pts += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)} `;
  }
  return `<polygon points="${pts.trim()}" fill="currentColor"/>`;
}
function pipsRow(n, y = 52, r = 15) {
  const gap = 30;
  const x0 = 50 - ((n - 1) * gap) / 2;
  let out = '';
  for (let k = 0; k < n; k += 1) out += pipAt(x0 + k * gap, y, r);
  return out;
}
function pipsCol(n, r = 12) {
  const gap = 22;
  const y0 = 50 - ((n - 1) * gap) / 2;
  let out = '';
  for (let k = 0; k < n; k += 1) out += pipAt(50, y0 + k * gap, r);
  return out;
}
function chevrons(n) {
  let out = '';
  const baseY = 74;
  for (let k = 0; k < n; k += 1) {
    const y = baseY - k * 19;
    out += `<path d="M16,${y} L50,${y - 20} L84,${y}" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return out;
}
// A King's Crown: jewelled base, three raised points capped with pearls, and a
// monde-and-cross rising from the centre. Original device, not a traced file.
function crown(cy = 40) {
  return `<path d="M27,${cy} L30,${cy - 16} L40,${cy - 6} L50,${cy - 20} L60,${cy - 6} L70,${cy - 16} L73,${cy} Z" fill="currentColor"/>`
    + `<rect x="27" y="${cy + 2}" width="46" height="8" rx="2" fill="currentColor"/>`
    + `<circle cx="30" cy="${cy - 16}" r="3.5" fill="currentColor"/><circle cx="50" cy="${cy - 20}" r="3.5" fill="currentColor"/><circle cx="70" cy="${cy - 16}" r="3.5" fill="currentColor"/>`
    + `<circle cx="50" cy="${cy - 23}" r="2.6" fill="currentColor"/>`
    + `<rect x="48.7" y="${cy - 30}" width="2.6" height="8" rx="1" fill="currentColor"/><rect x="46" y="${cy - 27.7}" width="8" height="2.6" rx="1" fill="currentColor"/>`;
}
function star(cx = 50, cy = 50, r = 30) {
  let pts = '';
  for (let k = 0; k < 10; k += 1) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.42 : r;
    pts += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)} `;
  }
  return `<polygon points="${pts.trim()}" fill="currentColor"/>`;
}
function laurel(inner) {
  return `<path d="M32,18 C12,38 12,64 32,84" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".85"/>`
    + `<path d="M68,18 C88,38 88,64 68,84" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".85"/>`
    + inner;
}
const tab = () => '<rect x="22" y="43" width="56" height="14" rx="7" fill="currentColor"/>';

// --- Rank -> device ----------------------------------------------------------
const DEVICE = {
  'omega-1': {
    Commander: () => crown(34) + pipsRow(1, 74, 15),
    Major: () => crown(50),
    Captain: () => pipsRow(3),
    Lieutenant: () => pipsRow(2),
    'Command Sergeant': () => chevrons(3) + star(50, 18, 12),
    Sergeant: () => chevrons(3),
    Corporal: () => chevrons(2),
    'Lance Corporal': () => chevrons(1),
    Specialist: () => tab(),
    Private: () => '',
  },
  'ethics-committee': {
    Chairman: () => laurel(pipsCol(3)),
    Member: () => laurel(pipsCol(2)),
    Assistant: () => laurel(pipsCol(1)),
  },
  command: {
    Director: () => laurel(star(50, 52, 22)),
    Liaison: () => star(50, 50, 26),
  },
};

// Whether this org+rank has a device (so callers can skip the wrapper markup).
export function hasInsignia(org, rank) {
  return !!(IMG[org] && IMG[org][rank]) || !!(DEVICE[org] && DEVICE[org][rank] && DEVICE[org][rank]());
}

// The insignia markup (an <img> backup if registered, else the SVG), or '' when
// the rank carries no device (e.g. Private). `size` is px.
export function rankInsignia(org, rank, { size = 22 } = {}) {
  const src = IMG[org] && IMG[org][rank];
  if (src) {
    return `<img class="insignia" src="${esc(src)}" width="${size}" height="${size}" alt="${esc(rank || '')} insignia" title="${esc(rank || '')}" />`;
  }
  const fn = DEVICE[org] && DEVICE[org][rank];
  const inner = fn ? fn() : '';
  if (!inner) return '';
  return `<span class="insignia" title="${esc(rank || '')}" aria-hidden="true"><svg viewBox="0 0 100 100" width="${size}" height="${size}">${inner}</svg></span>`;
}
