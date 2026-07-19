// =============================================================================
// record-history.js — "activity on this file" (REC-09).
//
// The global Activity Log already records who did what; this surfaces the slice
// of it that concerns the record in front of you, so provenance lives where the
// decision is read. Entries reference a record by naming its identifier in the
// detail string (a designation for personnel, a ref for cases and subjects), so
// we match on that identifier with a whole-token boundary — "O1-9" must not
// match "O1-90". The audit stream is CL5-only in the snapshot, so this is a
// Command / oversight view; for anyone else it renders nothing.
// =============================================================================

import { audit } from './storage.js';
import { esc, fmtDateTime } from './ui.js';
import { isCL5 } from './permissions.js';

// Whole-token match: the identifier, not flanked by more of a longer token.
export function detailMatches(detail, id) {
  if (!detail || !id) return false;
  const e = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9-])${e}([^A-Za-z0-9-]|$)`).test(detail);
}

function idsFor(record, kind) {
  if (!record) return [];
  if (kind === 'personnel') return [record.designation].filter(Boolean);
  return [record.ref].filter(Boolean); // case | subject
}

// The audit entries that concern this record, newest first.
export function historyFor(record, kind, limit = 40) {
  const ids = idsFor(record, kind);
  if (!ids.length) return [];
  return audit()
    .filter((a) => ids.some((id) => detailMatches(a.detail, id)))
    .slice(0, limit);
}

const label = (action) => String(action || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

// A "Record History" card (or '' when the actor cannot see the audit stream).
export function renderHistory(actor, record, kind) {
  if (!isCL5(actor)) return '';
  const items = historyFor(record, kind);
  const body = items.length
    ? `<ul class="rh-list">${items.map((a) => `
        <li class="rh-row">
          <span class="rh-row__action">${esc(label(a.action))}</span>
          <span class="rh-row__detail">${esc(a.detail || '')}</span>
          <span class="rh-row__meta"><span class="mono">${esc(a.actor || 'SYSTEM')}</span> · ${esc(fmtDateTime(a.ts))}</span>
        </li>`).join('')}</ul>`
    : '<div class="empty">No recorded actions on this record yet.</div>';
  return `
    <section class="card">
      <div class="card__title">Record History <span class="muted-text">— who changed what, when</span></div>
      <div class="card__body">${body}</div>
    </section>`;
}
