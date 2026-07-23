// =============================================================================
// views/directives.js — Standing orders board.
//
// Directive cards grouped by organisation. A directive carries a minimum
// clearance; operators below it see a locked placeholder rather than the body.
// Managers (CL4·S+ with a stake in the org) can issue new directives and
// rescind existing ones.
// =============================================================================

import { ORGS, ORG_ORDER, CLEARANCE_ORDER, CLEARANCES, clearanceWeight } from '../constants.js';
import { directives, getDirective, upsertDirective, compartments, getCompartment, isServerMode, newId, users } from '../storage.js';
import { canManageDirectives, canReadDirective, canSeeDirective, isCL5, readIntoCompartment } from '../permissions.js';
import { logAction } from '../audit.js';
import { moderationBar, wireModerationBar } from '../moderation.js';
import { exportDirective } from '../export.js';
import { esc, fmtDate, fmtDateTime, clearanceBadge, orgTag, monogram, toast, openModal, confirmDialog } from '../ui.js';

// --- Need-To-Know caveat (kept local so ui.js stays domain-agnostic) --------
function caveatName(d) {
  if (!d || !d.compartment) return null;
  return d.compartmentName || (getCompartment(d.compartment) || {}).name || 'COMPARTMENTED';
}
const caveatChip = (name) => `<span class="caveat-chip">\u25c8 ${esc(name)}</span>`;
function caveatBanner(d) {
  const n = caveatName(d);
  return n ? `<div class="caveat-banner">\u25c8 NEED-TO-KNOW \u00b7 ${esc(n)} \u00b7 handling restricted to read-in personnel</div>` : '';
}
// Whether THIS viewer may read the body. In server mode the Worker has already
// applied both the clearance gate and Need-To-Know, so a delivered body is
// readable; standalone mode applies both gates locally.
function bodyReadable(actor, d) {
  if (isServerMode()) return !d.bodyWithheld && typeof d.body === 'string';
  if (!canReadDirective(actor, d)) return false;
  if (d.compartment && !isCL5(actor)) {
    const c = getCompartment(d.compartment);
    if (!c || !readIntoCompartment(actor, c)) return false;
  }
  return true;
}
function withheldReason(d) {
  const n = caveatName(d);
  if (n) return `\u25a0\u25a0\u25a0 Restricted \u2014 NEED-TO-KNOW: ${esc(n)} (and ${esc(CLEARANCES[d.clearance].label)}) \u25a0\u25a0\u25a0`;
  return `\u25a0\u25a0\u25a0 Content restricted \u2014 requires ${esc(CLEARANCES[d.clearance].label)} \u25a0\u25a0\u25a0`;
}
function fileableCompartments(actor) {
  return compartments().filter((c) => !c.deleted
    && (isCL5(actor) || c.access === 'member' || readIntoCompartment(actor, c)));
}
// The extra departments an order has been tagged into (beyond its home org).
function audienceOrgs(d) {
  return (Array.isArray(d.audience) ? d.audience : []).filter((o) => o !== d.org && ORGS[o]);
}

export function render(host, app) {
  const actor = app.user;
  const all = directives().filter((d) => !d.deleted);

  const groups = ORG_ORDER.map((org) => {
    // Addressed, not broadcast: only orders this operator is an audience for.
    const list = all.filter((d) => d.org === org && canSeeDirective(actor, d))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || a.ref.localeCompare(b.ref));
    const canManage = canManageDirectives(actor, org);
    // Skip an org only if it has no directives AND the viewer can't issue any —
    // otherwise a clean database would hide the "Issue directive" button entirely.
    if (!list.length && !canManage) return '';

    const cards = list.map((d) => {
      const visible = bodyReadable(actor, d);
      const rescinded = d.status === 'rescinded';
      const cav = caveatName(d);
      const aud = audienceOrgs(d);
      return `
        <article class="directive ${rescinded ? 'directive--rescinded' : ''}" data-open="${esc(d.id)}" tabindex="0">
          <div class="directive__top">
            <span class="mono directive__ref">${esc(d.ref)}</span>
            ${clearanceBadge(d.clearance)}
            ${cav ? caveatChip(cav) : ''}
            ${rescinded ? '<span class="badge badge--muted">Rescinded</span>' : '<span class="badge badge--ok">Active</span>'}
          </div>
          <h3 class="directive__title">${esc(d.title)}</h3>
          ${aud.length ? `<div class="directive__aud">Also on the board of ${aud.map((o) => orgTag(o)).join(' ')}</div>` : ''}
          ${visible
            ? `<p class="directive__body">${esc(d.body)}</p>`
            : `<p class="directive__locked">${withheldReason(d)}</p>`}
          <div class="directive__foot">
            <span>Issued ${fmtDate(d.createdAt)} \u00b7 <span class="mono">${esc(d.issuedBy)}</span></span>
            <span class="directive__actions">
              ${canManage && !rescinded ? `<button class="btn btn--xs btn--ghost" data-rescind="${esc(d.id)}">Rescind</button>` : ''}
              ${canManage && rescinded ? `<button class="btn btn--xs btn--ghost" data-reactivate="${esc(d.id)}">Reinstate</button>` : ''}
              <span class="row-go">Open \u2192</span>
            </span>
          </div>
        </article>`;
    }).join('');

    return `
      <section class="dir-group">
        <div class="dir-group__head">
          ${orgTag(org)} <span class="dir-group__name">${esc(ORGS[org].name)}</span>
          ${canManage ? `<button class="btn btn--sm" data-add="${esc(org)}">+ Issue directive</button>` : ''}
        </div>
        <div class="dir-grid">${cards || '<div class="empty">No standing orders issued yet.</div>'}</div>
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

  const go = (id) => app.navigate(`#/directive/${id}`);
  host.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => go(card.dataset.open));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(card.dataset.open); });
  });
  host.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openIssue(app, b.dataset.add); }));
  host.querySelectorAll('[data-rescind]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setStatus(app, b.dataset.rescind, 'rescinded'); }));
  host.querySelectorAll('[data-reactivate]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setStatus(app, b.dataset.reactivate, 'active'); }));
}

// ===========================================================================
// DIRECTIVE MEMO (detail view)
// ===========================================================================
export function renderDirective(host, app, id) {
  const actor = app.user;
  const d = getDirective(id);

  // Not found, or not addressed to this operator \u2014 an order off your board reads
  // as absent, never as "restricted". (In server mode the snapshot already
  // withheld it; this is the standalone gate and defence in depth.)
  if (!d || d.deleted || !canSeeDirective(actor, d)) {
    host.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">Directive not found</h1>
      <div class="page-sub">This directive does not exist or has been rescinded from record.</div></div></div>
      <button class="btn btn--ghost" id="back">\u2190 Standing Orders</button>`;
    host.querySelector('#back').addEventListener('click', () => app.navigate('#/directives'));
    return;
  }

  const canRead = bodyReadable(actor, d);
  const canManage = canManageDirectives(actor, d.org);
  const rescinded = d.status === 'rescinded';
  const cav = caveatName(d);
  const aud = audienceOrgs(d);

  const bodyBlock = canRead
    ? `<div class="memo__body">${esc(d.body)}</div>`
    : `<div class="memo__withheld">${withheldReason(d)}</div>`;

  // Acknowledgement: any operator cleared to read an active order may
  // countersign it once. The Worker re-verifies the same rule server-side.
  const myAck = (d.acks || {})[actor.id] || null;
  const canAck = canRead && !rescinded && !myAck && actor.org === d.org;
  const ackStrip = canAck
    ? '<div class="actionbar"><button class="btn btn--sm btn--primary" data-act="ack">Acknowledge this order</button></div>'
    : (myAck ? `<div class="ack-note">Acknowledged by you on ${fmtDate(myAck)}.</div>` : '');

  // Compliance panel for issuers: the addressees — the issuing organisation's
  // personnel who are cleared to read — and who among them has signed.
  let ackPanel = '';
  if (canManage) {
    const eligible = users().filter((u) => !u.deleted && u.accountStatus === 'active' && u.status !== 'discharged' && u.org === d.org && bodyReadable(u, d));
    const signed = eligible.filter((u) => (d.acks || {})[u.id]);
    const outstanding = eligible.filter((u) => !(d.acks || {})[u.id]);
    const row = (u, ts) => `<div class="ack-row"><span class="mono">${esc(u.designation)}</span><span class="ack-row__name">${esc(u.codename || '')}</span><span class="muted-text">${ts ? `Acknowledged ${fmtDate(ts)}` : 'Outstanding'}</span></div>`;
    ackPanel = `
      <section class="card">
        <div class="card__title">Acknowledgements <span class="muted-text">(${signed.length} of ${eligible.length})</span></div>
        <div class="card__body">
          ${outstanding.map((u) => row(u, null)).join('')}
          ${signed.map((u) => row(u, (d.acks || {})[u.id])).join('')}
          ${!eligible.length ? '<div class="empty">No personnel are currently cleared to read this order.</div>' : ''}
        </div>
      </section>`;
  }

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="back">\u2190 Standing Orders</button>
      <button class="btn btn--sm" id="export-directive">\u2913 Export memorandum</button>
    </div>

    <header class="dossier-head">
      <div class="avatar avatar--${ORGS[d.org].tone}">${esc(monogram(d.ref))}</div>
      <div class="dossier-id">
        <div class="dossier-codename">${esc(d.title)}</div>
        <div class="dossier-line">
          <span class="mono">${esc(d.ref)}</span>
          ${orgTag(d.org)}
          ${clearanceBadge(d.clearance)}
          ${cav ? caveatChip(cav) : ''}
          ${rescinded ? '<span class="badge badge--muted">Rescinded</span>' : '<span class="badge badge--ok">In force</span>'}
        </div>
      </div>
    </header>

    ${caveatBanner(d)}
    ${moderationBar(actor, { already: false })}

    ${ackStrip}

    ${canManage ? `<div class="actionbar">
      <button class="btn btn--sm" data-act="audience">Set audience</button>
      ${!rescinded ? '<button class="btn btn--sm btn--danger" data-act="rescind">Rescind</button>' : '<button class="btn btn--sm" data-act="reinstate">Reinstate</button>'}
    </div>` : ''}

    <section class="card memo">
      <div class="memo__head">
        <div class="memo__row"><span class="memo__k">From</span><span class="memo__v">${esc(ORGS[d.org].name)}</span></div>
        <div class="memo__row"><span class="memo__k">To</span><span class="memo__v">All ${esc(ORGS[d.org].short)} personnel at clearance${aud.length ? `, and ${aud.map((o) => esc(ORGS[o].short)).join(', ')}` : ''}</span></div>
        <div class="memo__row"><span class="memo__k">Reference</span><span class="memo__v mono">${esc(d.ref)}</span></div>
        <div class="memo__row"><span class="memo__k">Subject</span><span class="memo__v">${esc(d.title)}</span></div>
        <div class="memo__row"><span class="memo__k">Classification</span><span class="memo__v">${clearanceBadge(d.clearance)}${cav ? ` \u00b7 ${caveatChip(cav)}` : ''}</span></div>
        <div class="memo__row"><span class="memo__k">Issued</span><span class="memo__v">${fmtDate(d.createdAt)} \u00b7 <span class="mono">${esc(d.issuedBy)}</span></span></div>
      </div>
      <div class="memo__rule"></div>
      ${bodyBlock}
    </section>

    ${ackPanel}
  `;

  host.querySelector('#back').addEventListener('click', () => app.navigate('#/directives'));
  host.querySelector('#export-directive').addEventListener('click', () => exportDirective(app, d));
  wireModerationBar(host, app, {
    label: `standing order ${d.ref}`, get: () => getDirective(d.id), upsert: upsertDirective, backHash: '#/directives',
  });
  const rescindBtn = host.querySelector('[data-act="rescind"]');
  if (rescindBtn) rescindBtn.addEventListener('click', () => setStatus(app, d.id, 'rescinded'));
  const reinstateBtn = host.querySelector('[data-act="reinstate"]');
  if (reinstateBtn) reinstateBtn.addEventListener('click', () => setStatus(app, d.id, 'active'));
  const audienceBtn = host.querySelector('[data-act="audience"]');
  if (audienceBtn) audienceBtn.addEventListener('click', () => openAudience(app, d.id));
  const ackBtn = host.querySelector('[data-act="ack"]');
  if (ackBtn) ackBtn.addEventListener('click', () => acknowledge(app, d.id));
}

// Retag which other departments an order appears for. The order's home org
// always sees it; ticking a department adds it to that department's board too
// (the clearance floor and any Need-To-Know caveat still apply). Managers only.
function openAudience(app, id) {
  const d = getDirective(id);
  if (!d || d.deleted) return;
  if (!canManageDirectives(app.user, d.org)) { toast('You cannot manage this order.', 'error'); return; }
  const current = new Set(Array.isArray(d.audience) ? d.audience : []);
  const checks = ORG_ORDER.filter((o) => o !== d.org)
    .map((o) => `<label class="check"><input type="checkbox" class="au-org" value="${esc(o)}" ${current.has(o) ? 'checked' : ''} /> <span>${esc(ORGS[o].name)}</span></label>`).join('');
  openModal({
    title: `Audience — ${d.ref}`,
    body: `<p class="modal__message">${esc(ORGS[d.org].short)} personnel always see this order. Tick other departments to add it to their board too.</p>
      <div class="check-list">${checks}</div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save audience', tone: 'primary', onClick: (c, dlg) => {
          const audience = [...dlg.querySelectorAll('.au-org:checked')].map((i) => i.value);
          const fresh = getDirective(id);
          if (!fresh) { c(); app.refresh(); return; }
          fresh.audience = audience;
          fresh.updatedAt = new Date().toISOString();
          fresh.version = (fresh.version || 1) + 1;
          upsertDirective(fresh);
          logAction(app.user, 'EDIT_DIRECTIVE', `${fresh.ref}: audience updated (${audience.length ? audience.map((o) => ORGS[o].short).join(', ') : 'home org only'}).`);
          c();
          toast('Audience updated.', 'success');
          app.refresh();
        } },
    ],
  });
}

// Countersign an order: adds exactly the operator's own acknowledgement and
// nothing else. The Worker re-verifies the same shape (reader, active order,
// own entry only) before anything persists.
function acknowledge(app, id) {
  const d = getDirective(id);
  if (!d || d.deleted) return;
  if (d.status === 'rescinded') { toast('A rescinded order cannot be acknowledged.', 'error'); return; }
  if (app.user.org !== d.org) { toast('This order is addressed to the issuing organisation\u2019s personnel.', 'error'); return; }
  if (!bodyReadable(app.user, d)) { toast('You are not cleared to read this order.', 'error'); return; }
  if ((d.acks || {})[app.user.id]) { toast('Already acknowledged.', 'info'); return; }
  d.acks = { ...(d.acks || {}), [app.user.id]: new Date().toISOString() };
  d.updatedAt = new Date().toISOString();
  d.version = (d.version || 1) + 1;
  upsertDirective(d);
  logAction(app.user, 'ACK_DIRECTIVE', `Acknowledged ${d.ref}.`);
  toast('Order acknowledged.', 'success');
  app.refresh();
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
  const comps = fileableCompartments(app.user);
  const compOpts = ['<option value="">\u2014 None (uncompartmented) \u2014</option>',
    ...comps.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.codeword || c.name)})</option>`)].join('');
  const audChecks = ORG_ORDER.filter((o) => o !== org)
    .map((o) => `<label class="check"><input type="checkbox" class="di-aud" value="${esc(o)}" /> <span>${esc(ORGS[o].name)}</span></label>`).join('');

  openModal({
    title: `Issue directive \u2014 ${ORGS[org].short}`,
    wide: true,
    body: `
      <div class="field"><label>Reference</label><input id="di-ref" type="text" value="${esc(suggested)}" /></div>
      <div class="field"><label>Title</label><input id="di-title" type="text" placeholder="Directive title" /></div>
      <div class="field"><label>Minimum clearance to read</label><select id="di-clr">${clrOpts}</select></div>
      <div class="field"><label>Need-To-Know compartment</label><select id="di-comp">${compOpts}</select>
        <div class="field__hint">Only compartments you are read into are listed.</div></div>
      <div class="field"><label>Also visible to <span class="muted-text">(optional)</span></label><div class="check-list">${audChecks}</div>
        <div class="field__hint">By default only ${esc(ORGS[org].short)} personnel see this order. Tick other departments to put it on their board too \u2014 the clearance floor still applies.</div></div>
      <div class="field"><label>Body</label><textarea id="di-body" rows="5" placeholder="State the directive\u2026"></textarea></div>
      <div id="di-err" class="auth__error" hidden></div>
    `,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Issue directive', tone: 'primary', onClick: (c, d) => {
          const ref = d.querySelector('#di-ref').value.trim();
          const title = d.querySelector('#di-title').value.trim();
          const clr = d.querySelector('#di-clr').value;
          const comp = d.querySelector('#di-comp').value || null;
          const audience = [...d.querySelectorAll('.di-aud:checked')].map((i) => i.value);
          const bodyText = d.querySelector('#di-body').value.trim();
          const err = d.querySelector('#di-err');
          err.hidden = true;
          if (!ref || !title || !bodyText) { err.textContent = 'Reference, title and body are required.'; err.hidden = false; return; }
          const now = new Date().toISOString();
          upsertDirective({
            id: newId('dir'), ref, org, clearance: clr, title, body: bodyText,
            compartment: comp, audience,
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
