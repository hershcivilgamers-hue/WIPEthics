// =============================================================================
// ui.js — Shared interface helpers.
//
// Small, dependency-free utilities used across every view: HTML escaping, date
// formatting, badge markup, redaction bars, toast notifications and a modal
// dialog with promise-based confirmation. Keeping these here avoids each view
// reinventing them and keeps the visual language consistent.
// =============================================================================

import { CLEARANCES, STATUSES, ORGS, ACCOUNT_STATUS } from './constants.js';

// --- Escaping & elements ----------------------------------------------------
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape text for HTML AND turn bare http(s) URLs into clickable links. Safe by
// construction: every segment is escaped; only well-formed URLs become anchors.
// Used to render free-text log / report / docket entries that may carry a pasted
// link (e.g. a clip or screenshot cited as engagement evidence).
export function linkify(value) {
  const s = value === null || value === undefined ? '' : String(value);
  const re = /(https?:\/\/[^\s<>"'()]+)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    out += esc(s.slice(last, m.index));
    const url = m[1];
    out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
    last = m.index + url.length;
  }
  out += esc(s.slice(last));
  return out;
}

// Build a DOM node from an HTML string (returns the first element).
export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

// --- Dates ------------------------------------------------------------------
export function fmtDate(isoString) {
  if (!isoString) return '\u2014';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function fmtDateTime(isoString) {
  if (!isoString) return '\u2014';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function relTime(isoString) {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(isoString);
}

// --- Badges & tags ----------------------------------------------------------
export function clearanceBadge(code) {
  const c = CLEARANCES[code];
  if (!c) return `<span class="badge badge--muted">UNCLASSED</span>`;
  return `<span class="badge badge--${c.tone}" title="${esc(c.name)}">${esc(c.label)}</span>`;
}

export function statusBadge(code) {
  const s = STATUSES[code] || { label: code, tone: 'muted' };
  return `<span class="badge badge--${s.tone}">${esc(s.label)}</span>`;
}

export function accountBadge(code) {
  const a = ACCOUNT_STATUS[code] || { label: code, tone: 'muted' };
  return `<span class="badge badge--${a.tone}">${esc(a.label)}</span>`;
}

export function orgTag(code) {
  const o = ORGS[code];
  if (!o) return `<span class="org-tag">${esc(code)}</span>`;
  return `<span class="org-tag org-tag--${o.tone}">${esc(o.short)}</span>`;
}

// Two-letter monogram for the dossier avatar block.
export function monogram(codename) {
  if (!codename) return '\u2588\u2588';
  const parts = codename.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// --- Redaction --------------------------------------------------------------
// A solid bar standing in for content the operator may not see.
export function redacted(approxChars = 12) {
  const w = Math.max(4, Math.min(40, approxChars));
  return `<span class="redacted" style="--rw:${w}ch" aria-label="redacted">REDACTED</span>`;
}

// --- Toasts -----------------------------------------------------------------
function toastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = el('<div id="toast-root" class="toast-root" role="status" aria-live="polite"></div>');
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, tone = 'info', ms = 3200) {
  const node = el(`<div class="toast toast--${tone}">${esc(message)}</div>`);
  toastRoot().appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast--in'));
  setTimeout(() => {
    node.classList.remove('toast--in');
    setTimeout(() => node.remove(), 240);
  }, ms);
}

// --- Modal dialog -----------------------------------------------------------
let activeModal = null;

// Everything a keyboard user can land on inside the dialog.
const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keep Tab inside the open dialog — a modal that leaks focus to the page behind
// it is unusable by keyboard and confusing under a screen reader.
function trapTab(e, dialog) {
  if (e.key !== 'Tab') return;
  const items = [...dialog.querySelectorAll(MODAL_FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function teardownModal() {
  if (!activeModal) return;
  document.removeEventListener('keydown', activeModal.onKey);
  activeModal.backdrop.remove();
  // Return focus to whatever opened the dialog, so keyboard users aren't
  // dumped at the top of the document.
  const opener = activeModal.opener;
  activeModal = null;
  if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
}

// Open a modal. `body` may be an HTML string or a DOM node. `actions` is an
// array of { label, tone, onClick(close) }. Returns the dialog element so the
// caller can query its inputs.
export function openModal({ title, body, actions = [], wide = false }) {
  closeModal();
  const backdrop = el('<div class="modal-backdrop"></div>');
  const dialog = el(`
    <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
      <header class="modal__head">
        <h2 class="modal__title">${esc(title)}</h2>
        <button class="modal__close" data-close aria-label="Close">\u00d7</button>
      </header>
      <div class="modal__body"></div>
      <footer class="modal__foot"></footer>
    </div>
  `);

  const bodyHost = dialog.querySelector('.modal__body');
  if (typeof body === 'string') bodyHost.innerHTML = body;
  else if (body instanceof Node) bodyHost.appendChild(body);

  const foot = dialog.querySelector('.modal__foot');
  actions.forEach((a) => {
    const btn = el(`<button class="btn ${a.tone ? `btn--${a.tone}` : ''}">${esc(a.label)}</button>`);
    btn.addEventListener('click', () => a.onClick(closeModal, dialog));
    foot.appendChild(btn);
  });

  const onKey = (e) => {
    if (e.key === 'Escape') { closeModal(); return; }
    trapTab(e, dialog);
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  dialog.querySelector('[data-close]').addEventListener('click', closeModal);
  document.addEventListener('keydown', onKey);

  // Remember what had focus so we can hand it back when the dialog closes.
  const opener = document.activeElement;
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  activeModal = { backdrop, onKey, opener };

  // Focus the first real input for keyboard users — but skip the close button so
  // opening a form doesn't land the caret on "×".
  const focusable = dialog.querySelector('.modal__body input, .modal__body select, .modal__body textarea, .modal__body button')
    || dialog.querySelector('.modal__foot button')
    || dialog.querySelector('[data-close]');
  if (focusable) focusable.focus();

  return dialog;
}

export function closeModal() {
  teardownModal();
}

// Promise-based confirmation dialog. Resolves true / false.
export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'primary', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="modal__message">${esc(message)}</p>`,
      actions: [
        { label: 'Cancel', tone: 'ghost', onClick: (close) => { close(); resolve(false); } },
        { label: confirmLabel, tone: danger ? 'danger' : tone, onClick: (close) => { close(); resolve(true); } },
      ],
    });
  });
}
