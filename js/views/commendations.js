// =============================================================================
// commendations.js — Commendation nominations.
//
// Any active operator may nominate another for a commendation. The nominee's
// unit command (or CL5) rules on it; APPROVING grants a decoration onto the
// nominee's record (user.awards) — the same award write Administration uses —
// and marks the nomination approved. Not covert: visible to the nominee's unit
// command, CL5, the nominator, and Administrators.
//   ponytail: award carries title + citation only; wire a medalId picker from
//   the per-org catalogue if a formal medal is wanted.
// =============================================================================

import { esc, fmtDate, fmtDateTime, orgTag, toast, openModal, readoutStrip, countUp } from '../ui.js';
import { commendations, getCommendation, upsertCommendation, getUser, users, newId } from '../storage.js';
import { upsertUser } from '../storage.js';
import { canFileCommendation, canViewCommendation, canManageCommendation } from '../permissions.js';
import { ORGS } from '../constants.js';
import { logAction } from '../audit.js';

const statusBadge = (s) => ({
  pending:  '<span class="badge badge--warn">Pending</span>',
  approved: '<span class="badge badge--ok">Approved</span>',
  declined: '<span class="badge badge--muted">Declined</span>',
}[s] || '');

const nomineeName = (rec) => { const u = getUser(rec.nomineeId); return u ? `${u.designation} · ${u.codename}` : (rec.nomineeTag || '—'); };

export function render(host, app) {
  const actor = app.user;
  const all = commendations().filter((c) => !c.deleted && canViewCommendation(actor, c));
  const pending = all.filter((c) => c.status === 'pending').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const resolved = all.filter((c) => c.status !== 'pending').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const approved = resolved.filter((c) => c.status === 'approved').length;
  const readout = all.length ? readoutStrip([
    { k: 'Pending', count: pending.length, frac: all.length ? pending.length / all.length : 0, tone: pending.length ? 'warn' : undefined },
    { k: 'Approved', count: approved, frac: all.length ? approved / all.length : 0, tone: 'ok' },
    { k: 'Total', count: all.length, frac: 1 },
  ]) : '';

  const cards = pending.length ? pending.map((c) => `
    <article class="recruit-card" data-id="${esc(c.id)}" tabindex="0">
      <div class="recruit-card__top"><span class="mono">${esc(c.ref)}</span> ${orgTag(c.org)}</div>
      <div class="recruit-card__name">${esc(c.title)}</div>
      <div class="recruit-card__meta">For ${esc(nomineeName(c))}</div>
      <div class="recruit-card__foot"><span class="muted-text">by ${esc(c.nominatedByTag || '—')}</span><span class="row-go">Open →</span></div>
    </article>`).join('') : '<div class="empty">No pending nominations.</div>';

  const rows = resolved.map((c) => `
    <tr data-id="${esc(c.id)}" tabindex="0">
      <td class="mono">${esc(c.ref)}</td>
      <td class="cell-name">${esc(c.title)}</td>
      <td>${esc(nomineeName(c))}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${fmtDate(c.updatedAt)}</td>
      <td class="cell-right"><span class="row-go">Open →</span></td>
    </tr>`).join('');

  host.innerHTML = `
    <div class="page-head rise">
      <div>
        <div class="eyebrow">CAIRO · Honours</div>
        <h1 class="page-title">Commendations</h1>
        <div class="page-sub">Nominate an operator · ruled on by unit command · approval grants the decoration</div>
      </div>
      ${canFileCommendation(actor) ? '<button class="btn btn--primary" id="com-new">+ Nominate</button>' : ''}
    </div>

    ${readout}

    <div class="pipeline pipeline--2 rise" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${cards}</div>

    ${resolved.length ? `<section class="card rise" style="margin-top:18px">
      <div class="card__title">Ruled</div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Commendation</th><th>Nominee</th><th>Status</th><th>Ruled</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>` : ''}
  `;

  host.querySelectorAll('[data-id]').forEach((el) => {
    const go = () => openRecord(app, el.dataset.id);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  const add = host.querySelector('#com-new');
  if (add) add.addEventListener('click', () => openNominate(app));
  countUp(host);
}

function openRecord(app, id) {
  const rec = getCommendation(id);
  if (!rec) return;
  const actor = app.user;
  const pendingState = rec.status === 'pending';
  const mayRule = pendingState && canManageCommendation(actor, rec);

  openModal({
    title: `${rec.ref} — ${rec.title}`,
    wide: true,
    body: `
      <div class="kv"><span class="kv__k">Status</span><span class="kv__v">${statusBadge(rec.status)}</span></div>
      <div class="kv"><span class="kv__k">Nominee</span><span class="kv__v">${getUser(rec.nomineeId) ? `<a class="rec-link" href="#/personnel/${esc(rec.nomineeId)}">${esc(nomineeName(rec))}</a>` : esc(nomineeName(rec))}</span></div>
      <div class="kv"><span class="kv__k">Unit</span><span class="kv__v">${orgTag(rec.org)} ${esc((ORGS[rec.org] || {}).name || '')}</span></div>
      <div class="kv"><span class="kv__k">Nominated</span><span class="kv__v">${fmtDate(rec.createdAt)} · <span class="mono">${esc(rec.nominatedByTag || '—')}</span></span></div>
      <div class="card__subtitle" style="margin-top:10px">Citation</div>
      <p>${esc(rec.citation || 'No citation recorded.')}</p>
      ${rec.status !== 'pending' ? `<p class="field__hint" style="margin-top:8px">${rec.status === 'approved' ? 'Approved' : 'Declined'} by <span class="mono">${esc(rec.resolvedByTag || '—')}</span> · ${fmtDateTime(rec.resolvedAt)}.${rec.status === 'approved' ? ' The decoration was recorded on the nominee’s file.' : ''}</p>` : ''}
      ${pendingState && !mayRule ? '<p class="field__hint" style="margin-top:8px">Awaiting the nominee’s unit command to rule.</p>' : ''}
    `,
    actions: [
      ...(mayRule ? [
        { label: 'Approve — grant decoration', tone: 'primary', onClick: (c) => { rule(app, id, 'approved'); c(); } },
        { label: 'Decline', tone: 'ghost', onClick: (c) => { rule(app, id, 'declined'); c(); } },
      ] : [{ label: 'Done', tone: 'ghost', onClick: (c) => c() }]),
    ],
  });
}

function nextRef() { return `COM-${String(commendations().length + 1).padStart(3, '0')}`; }

function openNominate(app) {
  const actor = app.user;
  const roster = users().filter((u) => !u.deleted && u.accountStatus === 'active' && u.id !== actor.id)
    .sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
  const opts = roster.map((u) => `<option value="${esc(u.id)}" data-org="${esc(u.org)}">${esc(u.designation)} · ${esc(u.codename)} (${esc((ORGS[u.org] || {}).short || u.org)})</option>`).join('');

  openModal({
    title: 'Nominate for a commendation',
    body: `
      <div class="field"><label>Operator</label><select id="com-nominee">${opts}</select></div>
      <div class="field"><label>Commendation</label><input id="com-title" type="text" placeholder="e.g. Commendation for Valour" /></div>
      <div class="field"><label>Citation</label><textarea id="com-citation" rows="4" placeholder="Why this operator is deserving."></textarea></div>
    `,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Submit nomination', tone: 'primary', onClick: (c, d) => {
          const sel = d.querySelector('#com-nominee');
          const nomineeId = sel.value;
          const nominee = getUser(nomineeId);
          const title = d.querySelector('#com-title').value.trim();
          const citation = d.querySelector('#com-citation').value.trim();
          if (!nominee) { toast('Choose an operator.', 'error'); return; }
          if (!title) { toast('A nomination needs a title.', 'error'); return; }
          const now = new Date().toISOString();
          const rec = {
            id: newId('com'), ref: nextRef(), org: nominee.org,
            nomineeId, nomineeTag: `${nominee.designation} · ${nominee.codename}`,
            title, citation, status: 'pending',
            nominatedBy: actor.id, nominatedByTag: actor.designation,
            resolvedBy: null, resolvedByTag: null, resolvedAt: null,
            createdAt: now, updatedAt: now, deleted: false, version: 1,
          };
          upsertCommendation(rec);
          logAction(actor, 'OPEN_COMMENDATION', `Nominated ${rec.nomineeTag} — ${title} (${rec.ref}).`);
          c();
          toast('Nomination submitted.', 'success');
          app.refresh();
        } },
    ],
  });
}

function rule(app, id, outcome) {
  const actor = app.user;
  const fresh = getCommendation(id);
  if (!fresh || fresh.status !== 'pending') return;
  const now = new Date().toISOString();
  // Approval grants the decoration onto the nominee's record first, so the
  // commendation is never marked approved without the award actually landing.
  if (outcome === 'approved') {
    const nominee = getUser(fresh.nomineeId);
    if (!nominee) { toast('Nominee record not found.', 'error'); return; }
    nominee.awards = [...(nominee.awards || []), {
      id: newId('awd'), title: fresh.title, note: fresh.citation || '',
      medalId: null, date: now, by: actor.designation,
    }];
    nominee.updatedAt = now;
    nominee.version = (nominee.version || 1) + 1;
    upsertUser(nominee);
  }
  fresh.status = outcome;
  fresh.resolvedBy = actor.id;
  fresh.resolvedByTag = actor.designation;
  fresh.resolvedAt = now;
  fresh.updatedAt = now;
  fresh.version = (fresh.version || 1) + 1;
  upsertCommendation(fresh);
  logAction(actor, outcome === 'approved' ? 'APPROVE_COMMENDATION' : 'DECLINE_COMMENDATION', `${fresh.ref} ${outcome} for ${fresh.nomineeTag}.`);
  toast(outcome === 'approved' ? 'Approved — decoration recorded.' : 'Nomination declined.', 'success');
  app.refresh();
}
