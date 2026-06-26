// =============================================================================
// views/directives.js — Standing orders board.
//
// Directive cards grouped by organisation. A directive carries a minimum
// clearance; operators below it see a locked placeholder rather than the body.
// Managers (CL4·S+ with a stake in the org) can issue new directives and
// rescind existing ones.
// =============================================================================

import { ORGS, ORG_ORDER, CLEARANCE_ORDER, CLEARANCES, clearanceWeight } from '../constants.js';
import { directives, getDirective, upsertDirective, newId } from '../storage.js';
import { canManageDirectives } from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, fmtDate, clearanceBadge, orgTag, toast, openModal, confirmDialog } from '../ui.js';

export function render(host, app) {
  const actor = app.user;
  const viewerWeight = clearanceWeight(actor.clearance);
  const all = directives().filter((d) => !d.deleted);

  const groups = ORG_ORDER.map((org) => {
    const list = all.filter((d) => d.org === org)
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || a.ref.localeCompare(b.ref));
    if (!list.length) return '';
    const canManage = canManageDirectives(actor, org);

    const cards = list.map((d) => {
      const visible = viewerWeight >= clearanceWeight(d.clearance);
      const rescinded = d.status === 'rescinded';
      return `
        <article class="directive ${rescinded ? 'directive--rescinded' : ''}">
          <div class="directive__top">
            <span class="mono directive__ref">${esc(d.ref)}</span>
            ${clearanceBadge(d.clearance)}
            ${rescinded ? '<span class="badge badge--muted">Rescinded</span>' : '<span class="badge badge--ok">Active</span>'}
          </div>
          <h3 class="directive__title">${esc(d.title)}</h3>
          ${visible
            ? `<p class="directive__body">${esc(d.body)}</p>`
            : `<p class="directive__locked">\u25a0\u25a0\u25a0 Content restricted \u2014 requires ${esc(CLEARANCES[d.clearance].label)} \u25a0\u25a0\u25a0</p>`}
          <div class="directive__foot">
            <span>Issued ${fmtDate(d.createdAt)} \u00b7 <span class="mono">${esc(d.issuedBy)}</span></span>
            ${canManage && !rescinded ? `<button class="btn btn--xs btn--ghost" data-rescind="${esc(d.id)}">Rescind</button>` : ''}
            ${canManage && rescinded ? `<button class="btn btn--xs btn--ghost" data-reactivate="${esc(d.id)}">Reinstate</button>` : ''}
          </div>
        </article>`;
    }).join('');

    return `
      <section class="dir-group">
        <div class="dir-group__head">
          ${orgTag(org)} <span class="dir-group__name">${esc(ORGS[org].name)}</span>
          ${canManage ? `<button class="btn btn--sm" data-add="${esc(org)}">+ Issue directive</button>` : ''}
        </div>
        <div class="dir-grid">${cards}</div>
      </section>`;
  }).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO</div>
        <h1 class="page-title">Standing Orders</h1>
        <div class="page-sub">Active directives across all organisations</div>
      </div>
    </div>
    ${groups || '<div class="card"><div class="card__body empty">No directives on record.</div></div>'}
  `;

  host.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openIssue(app, b.dataset.add)));
  host.querySelectorAll('[data-rescind]').forEach((b) => b.addEventListener('click', () => setStatus(app, b.dataset.rescind, 'rescinded')));
  host.querySelectorAll('[data-reactivate]').forEach((b) => b.addEventListener('click', () => setStatus(app, b.dataset.reactivate, 'active')));
}

async function setStatus(app, id, status) {
  const d = getDirective(id);
  if (!d) return;
  if (status === 'rescinded') {
    const ok = await confirmDialog({ title: 'Rescind directive', message: `Rescind ${d.ref} \u2014 ${d.title}?`, confirmLabel: 'Rescind', danger: true });
    if (!ok) return;
  }
  d.status = status;
  d.updatedAt = new Date().toISOString();
  d.version = (d.version || 1) + 1;
  upsertDirective(d);
  app.refresh();
  toast(status === 'rescinded' ? 'Directive rescinded.' : 'Directive reinstated.', 'success');
}

function openIssue(app, org) {
  const ceiling = clearanceWeight(app.user.clearance);
  const allowed = CLEARANCE_ORDER.filter((c) => clearanceWeight(c) <= ceiling);
  const prefix = org === 'omega-1' ? 'O1-SO' : org === 'ethics-committee' ? 'EC-DIR' : 'CMD-DIR';
  const nums = directives().filter((d) => d.org === org).length + 1;
  const suggested = `${prefix}-${String(nums).padStart(3, '0')}`;
  const clrOpts = allowed.map((c) => `<option value="${c}">${esc(CLEARANCES[c].label)}</option>`).join('');

  openModal({
    title: `Issue directive \u2014 ${ORGS[org].short}`,
    wide: true,
    body: `
      <div class="field"><label>Reference</label><input id="di-ref" type="text" value="${esc(suggested)}" /></div>
      <div class="field"><label>Title</label><input id="di-title" type="text" placeholder="Directive title" /></div>
      <div class="field"><label>Minimum clearance to read</label><select id="di-clr">${clrOpts}</select></div>
      <div class="field"><label>Body</label><textarea id="di-body" rows="5" placeholder="State the directive\u2026"></textarea></div>
      <div id="di-err" class="auth__error" hidden></div>
    `,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Issue directive', tone: 'primary', onClick: (c, d) => {
          const ref = d.querySelector('#di-ref').value.trim();
          const title = d.querySelector('#di-title').value.trim();
          const clr = d.querySelector('#di-clr').value;
          const bodyText = d.querySelector('#di-body').value.trim();
          const err = d.querySelector('#di-err');
          err.hidden = true;
          if (!ref || !title || !bodyText) { err.textContent = 'Reference, title and body are required.'; err.hidden = false; return; }
          const now = new Date().toISOString();
          upsertDirective({
            id: newId('dir'), ref, org, clearance: clr, title, body: bodyText,
            issuedBy: app.user.designation, status: 'active',
            createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
          });
          logAction(app.user, 'ISSUE_DIRECTIVE', `${ref} issued for ${ORGS[org].short}.`);
          c();
          toast(`Directive ${ref} issued.`, 'success');
          app.refresh();
        } },
    ],
  });
}
