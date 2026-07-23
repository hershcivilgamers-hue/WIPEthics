// =============================================================================
// moderation.js — the Administrator's removal affordance.
//
// An Administrator (staff, granted in Command Administration) may pull ANY post
// that should never have been published. The Worker already authorises that on
// every collection; this is the matching control, so the power is actually
// reachable from the record you are looking at.
//
// Rendered on a record's detail view whenever the operator can moderate AND the
// view is not already offering them its own Remove — so Command keeps the
// ordinary button and staff get this one, and nobody sees two.
//
// Removal is the soft, restorable kind used everywhere else: the record goes to
// the recycle bin, where Command can restore it. Nothing is destroyed.
// =============================================================================

import { canModerate } from './permissions.js';
import { confirmDialog, toast } from './ui.js';
import { logAction } from './audit.js';

// `already` — pass the view's own "can I remove this" right. When true the
// ordinary control is on screen and this returns nothing.
export function moderationBar(actor, { already = false } = {}) {
  if (already || !canModerate(actor)) return '';
  return `<div class="actionbar actionbar--staff">
    <button class="btn btn--sm btn--danger" data-act="mod-remove"
      title="Administrator moderation — sends this record to the recycle bin">⚑ Remove (staff)</button>
    <span class="muted-text">Administrator — you have no ordinary authority over this record.</span>
  </div>`;
}

// Wire the bar's button. `get` re-reads the record (so we never write a stale
// copy), `upsert` persists it, `backHash` is where to land after removal.
export function wireModerationBar(host, app, { label, get, upsert, backHash }) {
  const btn = host.querySelector('[data-act="mod-remove"]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Remove as staff',
      message: `Remove ${label} to the recycle bin? This is an Administrator action and is written to the audit log. Command can restore it from Administration.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const fresh = get();
    if (!fresh) { app.refresh(); return; }
    fresh.deleted = true;
    fresh.deletedAt = new Date().toISOString();
    fresh.updatedAt = fresh.deletedAt;
    fresh.version = (fresh.version || 1) + 1;
    upsert(fresh);
    logAction(app.user, 'MODERATE_REMOVE', `${label} removed by an Administrator.`);
    toast('Removed to the recycle bin.', 'success');
    if (backHash) app.navigate(backHash); else app.refresh();
  });
}
