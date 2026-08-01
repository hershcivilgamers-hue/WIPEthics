// =============================================================================
// incidents.js — Incident / breach reports.
//
// A fileable record of a breach, infraction or security incident. Any active
// operator may file one; it names a unit and (optionally) the operators
// involved, carries a severity and an append-only log, and is closed by that
// unit's command (or CL5). Not covert — visibility is unit command, CL5, and
// the reporter (see canViewIncident). Escalation to a tribunal is left to the
// existing Investigations/Tribunals flow; a closed report is a sealed record.
//   ponytail: no structured escalation link yet — refer via a tribunal filing
//   if one is warranted. Add a caseId + "Refer" button here if that becomes a
//   routine step.
// =============================================================================

import { esc, fmtDate, fmtDateTime, relTime, orgTag, toast, openModal, readoutStrip, countUp } from '../ui.js';
import { incidents, getIncident, upsertIncident, getUser, users, newId } from '../storage.js';
import { isCL5, canFileIncident, canViewIncident, canManageIncident } from '../permissions.js';
import { INCIDENT_SEVERITY, ORGS, ORG_ORDER } from '../constants.js';
import { logAction } from '../audit.js';

const SEV_ORDER = ['critical', 'severe', 'moderate', 'low'];
const sevBadge = (s) => {
  const meta = INCIDENT_SEVERITY[s] || { label: s || '—', tone: 'muted' };
  return `<span class="badge badge--${meta.tone}">${esc(meta.label)}</span>`;
};
const involvedTags = (rec) => (rec.involved || [])
  .map((id) => { const u = getUser(id); return u ? `<a class="rec-link" href="#/personnel/${esc(u.id)}">${esc(u.designation)} · ${esc(u.codename)}</a>` : null; })
  .filter(Boolean).join(', ') || '<span class="muted-text">—</span>';

export function render(host, app) {
  const actor = app.user;
  const all = incidents().filter((i) => !i.deleted && canViewIncident(actor, i));
  const open = all.filter((i) => i.status !== 'closed')
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || new Date(b.updatedAt) - new Date(a.updatedAt));
  const closed = all.filter((i) => i.status === 'closed').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const acute = open.filter((i) => i.severity === 'severe' || i.severity === 'critical').length;
  const readout = all.length ? readoutStrip([
    { k: 'Open', count: open.length, frac: all.length ? open.length / all.length : 0, tone: 'ok' },
    { k: 'Acute', count: acute, frac: open.length ? acute / open.length : 0, tone: acute ? 'alert' : undefined },
    { k: 'Closed', count: closed.length, frac: all.length ? closed.length / all.length : 0 },
  ]) : '';

  const cards = open.length ? open.map((r) => `
    <article class="recruit-card" data-id="${esc(r.id)}" tabindex="0">
      <div class="recruit-card__top"><span class="mono">${esc(r.ref)}</span> ${sevBadge(r.severity)} ${orgTag(r.org)}</div>
      <div class="recruit-card__name">${esc(r.title)}</div>
      <div class="recruit-card__meta">${esc(r.summary || 'No summary recorded.')}</div>
      <div class="recruit-card__foot">
        <span class="muted-text">${(r.involved || []).length} involved · ${(r.entries || []).length} entr${(r.entries || []).length === 1 ? 'y' : 'ies'}</span>
        <span class="row-go">Open →</span>
      </div>
    </article>`).join('') : '<div class="empty">No open reports.</div>';

  const closedRows = closed.map((r) => `
    <tr data-id="${esc(r.id)}" tabindex="0">
      <td class="mono">${esc(r.ref)}</td>
      <td class="cell-name">${esc(r.title)}</td>
      <td>${sevBadge(r.severity)}</td>
      <td>${orgTag(r.org)}</td>
      <td>${fmtDate(r.updatedAt)}</td>
      <td class="cell-right"><span class="row-go">Open →</span></td>
    </tr>`).join('');

  host.innerHTML = `
    <div class="page-head rise">
      <div>
        <div class="eyebrow">CAIRO · Conduct &amp; Security</div>
        <h1 class="page-title">Incident Reports</h1>
        <div class="page-sub">Breaches and infractions · filed by any operator · closed by unit command</div>
      </div>
      ${canFileIncident(actor) ? '<button class="btn btn--primary" id="inc-new">+ File a report</button>' : ''}
    </div>

    ${readout}

    <div class="pipeline pipeline--2 rise" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${cards}</div>

    ${closed.length ? `<section class="card rise" style="margin-top:18px">
      <div class="card__title">Closed</div>
      <table class="table">
        <thead><tr><th>Ref</th><th>Title</th><th>Severity</th><th>Unit</th><th>Closed</th><th></th></tr></thead>
        <tbody>${closedRows}</tbody>
      </table>
    </section>` : ''}
  `;

  host.querySelectorAll('[data-id]').forEach((el) => {
    const go = () => openRecord(app, el.dataset.id);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  const add = host.querySelector('#inc-new');
  if (add) add.addEventListener('click', () => openFile(app));
  countUp(host);
}

function openRecord(app, id) {
  const rec = getIncident(id);
  if (!rec) return;
  const actor = app.user;
  const entries = [...(rec.entries || [])].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const thread = entries.length ? entries.map((e) => `
    <li class="tl__item"><span class="tl__dot tl__dot--note"></span>
      <div class="tl__body">
        <div class="tl__text">${esc(e.text)}</div>
        <div class="tl__meta"><span class="mono">${esc(e.by)}</span> · ${esc(e.type || 'note')} · ${fmtDateTime(e.ts)}</div>
      </div></li>`).join('') : '<div class="empty">Nothing recorded yet.</div>';

  const openState = rec.status !== 'closed';
  const mayManage = canManageIncident(actor, rec);

  const dialog = openModal({
    title: `${rec.ref} — ${rec.title}`,
    wide: true,
    body: `
      <div class="kv"><span class="kv__k">Severity</span><span class="kv__v">${sevBadge(rec.severity)} ${openState ? '<span class="badge badge--warn">Open</span>' : '<span class="badge badge--muted">Closed</span>'}</span></div>
      <div class="kv"><span class="kv__k">Unit</span><span class="kv__v">${orgTag(rec.org)} ${esc((ORGS[rec.org] || {}).name || '')}</span></div>
      <div class="kv"><span class="kv__k">Filed</span><span class="kv__v">${fmtDate(rec.createdAt)} · <span class="mono">${esc(rec.reporterTag || '—')}</span></span></div>
      <div class="kv"><span class="kv__k">Involved</span><span class="kv__v">${involvedTags(rec)}</span></div>
      ${rec.summary ? `<div class="card__subtitle" style="margin-top:8px">Summary</div><p>${esc(rec.summary)}</p>` : ''}
      <div class="card__subtitle" style="margin-top:10px">Incident log <span class="muted-text">(append-only)</span></div>
      ${entries.length ? `<ul class="timeline">${thread}</ul>` : thread}
      ${openState ? `
        <div class="comment-box">
          <input id="inc-entry" type="text" placeholder="Add to the log…" />
          <button class="btn btn--sm" id="inc-add">Record</button>
        </div>` : '<p class="field__hint" style="margin-top:8px">This report is closed; its record is sealed.</p>'}
    `,
    actions: [
      ...(openState && mayManage ? [{ label: 'Close report', tone: 'danger', onClick: (c) => { closeIncident(app, id); c(); } }] : []),
      { label: 'Done', tone: 'ghost', onClick: (c) => c() },
    ],
  });

  const addBtn = dialog.querySelector('#inc-add');
  if (addBtn) addBtn.addEventListener('click', () => {
    const input = dialog.querySelector('#inc-entry');
    const text = input.value.trim();
    if (!text) return;
    addEntry(app, id, text);
    dialog.remove();
    openRecord(app, id);
  });
}

function nextRef() {
  const n = incidents().length + 1;
  return `INC-${String(n).padStart(3, '0')}`;
}

function openFile(app) {
  const actor = app.user;
  const orgOpts = ORG_ORDER.map((o) => `<option value="${o}" ${o === actor.org ? 'selected' : ''}>${esc(ORGS[o].name)}</option>`).join('');
  const sevOpts = SEV_ORDER.slice().reverse().map((s) => `<option value="${s}" ${s === 'moderate' ? 'selected' : ''}>${esc(INCIDENT_SEVERITY[s].label)}</option>`).join('');
  const roster = users().filter((u) => !u.deleted && u.accountStatus === 'active')
    .sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
  const involvedOpts = roster.map((u) => `<option value="${esc(u.id)}">${esc(u.designation)} · ${esc(u.codename)}</option>`).join('');

  openModal({
    title: 'File an incident report',
    body: `
      <div class="field"><label>Title</label><input id="inc-title" type="text" placeholder="Short description of the incident" /></div>
      <div class="field"><label>Unit concerned</label><select id="inc-org">${orgOpts}</select></div>
      <div class="field"><label>Severity</label><select id="inc-sev">${sevOpts}</select></div>
      <div class="field"><label>Operators involved <span class="muted-text">(optional — ctrl/cmd-click for several)</span></label>
        <select id="inc-involved" multiple size="5">${involvedOpts}</select></div>
      <div class="field"><label>Summary</label><textarea id="inc-summary" rows="4" placeholder="What happened."></textarea></div>
    `,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'File report', tone: 'primary', onClick: (c, d) => {
          const title = d.querySelector('#inc-title').value.trim();
          if (!title) { toast('A report needs a title.', 'error'); return; }
          const org = d.querySelector('#inc-org').value;
          const severity = d.querySelector('#inc-sev').value;
          const involved = [...d.querySelector('#inc-involved').selectedOptions].map((o) => o.value);
          const summary = d.querySelector('#inc-summary').value.trim();
          const now = new Date().toISOString();
          const rec = {
            id: newId('inc'), ref: nextRef(), org, severity, status: 'open',
            title, summary, involved, reportedBy: actor.id, reporterTag: actor.designation,
            entries: [{ id: newId('ile'), ts: now, by: actor.designation, type: 'filing', text: `Report filed: ${title}` }],
            createdAt: now, updatedAt: now, deleted: false, version: 1,
          };
          upsertIncident(rec);
          logAction(actor, 'OPEN_INCIDENT', `Incident ${rec.ref} filed (${severity}).`);
          c();
          toast('Incident report filed.', 'success');
          app.refresh();
        } },
    ],
  });
}

function addEntry(app, id, text) {
  const fresh = getIncident(id);
  if (!fresh) return;
  const now = new Date().toISOString();
  fresh.entries = [...(fresh.entries || []), { id: newId('ile'), ts: now, by: app.user.designation, type: 'note', text }];
  fresh.updatedAt = now;
  fresh.version = (fresh.version || 1) + 1;
  upsertIncident(fresh);
  logAction(app.user, 'LOG_INCIDENT', `Entry recorded in ${fresh.ref}.`);
}

function closeIncident(app, id) {
  const fresh = getIncident(id);
  if (!fresh) return;
  const now = new Date().toISOString();
  fresh.status = 'closed';
  fresh.entries = [...(fresh.entries || []), { id: newId('ile'), ts: now, by: app.user.designation, type: 'disposition', text: 'Report closed.' }];
  fresh.updatedAt = now;
  fresh.version = (fresh.version || 1) + 1;
  upsertIncident(fresh);
  logAction(app.user, 'CLOSE_INCIDENT', `Incident ${fresh.ref} closed.`);
  toast('Report closed.', 'success');
  app.refresh();
}
