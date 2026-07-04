// =============================================================================
// views/dashboard.js — Omega-1 Situation Board.
//
// A one-page rollup of the unit's posture: headcount, derived readiness with
// the current breaches named, authorised leave, live operations, a feed of
// intelligence reports from the last seven days, and the scouting pipeline.
//
// The board stores nothing of its own. Every figure is computed at render time
// from records the viewer already holds — readiness through the SAME derivation
// the Readiness board uses (constants.js), operations/intel/recruits through the
// same canView* checks their registers use. In server mode the snapshot arriving
// from the Worker is already redacted per viewer, so a CL3 operative's board
// simply reflects the smaller world they are cleared to see.
// =============================================================================

import {
  ACTIVITY_STATUS, ACTIVITY_REQ_SETTING_ID, mergeActivityReqs, activityStatus,
  OPERATION_KIND, INTEL_CREDIBILITY, RECRUIT_STAGE, RECRUIT_PIPELINE_OMEGA,
} from '../constants.js';
import {
  users, getActivityForUser, getSetting, operations, intel, recruits,
} from '../storage.js';
import { canViewOperation, canViewIntel, canViewRecruitment } from '../permissions.js';
import { esc, fmtDate, fmtDateTime, relTime } from '../ui.js';
import { openLog } from './operations.js';

const ORG = 'omega-1';
const SEVEN_DAYS = 7 * 24 * 3600000;

const statusBadge = (k) => { const m = ACTIVITY_STATUS[k] || { label: k, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const kindBadge = (k) => { const m = OPERATION_KIND[k] || { label: k, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const credBadge = (c) => { const m = INTEL_CREDIBILITY[c] || { code: c, label: String(c), tone: 'muted' }; return `<span class="badge badge--${m.tone}" title="${esc(m.label)}">${esc(String(m.code))}</span>`; };
const lastAt = (log) => { const l = log || []; return l.length ? Math.max(...l.map((e) => e.at)) : null; };
const trunc = (s, n = 96) => { const x = String(s || ''); return x.length > n ? x.slice(0, n - 1) + '\u2026' : x; };

// --- The model: everything the board shows, derived and testable -------------
export function buildModel(actor, now = Date.now()) {
  const rq = mergeActivityReqs((getSetting(ACTIVITY_REQ_SETTING_ID) || {}).data);
  const roster = users().filter((u) => !u.deleted && u.org === ORG && u.status !== 'discharged');

  // Readiness — the same derivation the Readiness board runs, per operator.
  const tallies = { ready: 0, semi: 0, inactive: 0, onLeave: 0, exempt: 0 };
  const breaches = [];
  const leave = [];
  for (const u of roster) {
    const st = activityStatus(u, getActivityForUser(u.id), rq, now);
    if (st.key === 'active') tallies.ready += 1;
    else if (st.key === 'semi') tallies.semi += 1;
    else if (st.key === 'inactive') tallies.inactive += 1;
    else if (st.key === 'leave') tallies.onLeave += 1;
    else if (st.key === 'exempt') tallies.exempt += 1;
    if (st.key === 'semi' || st.key === 'inactive') breaches.push({ id: u.id, designation: u.designation, codename: u.codename || '', key: st.key, weekHours: st.weekHours });
    if (st.key === 'leave') leave.push({ id: u.id, designation: u.designation, codename: u.codename || '', type: (u.leave && u.leave.type) || 'LoA', to: (u.leave && u.leave.to) || null });
  }
  breaches.sort((a, b) => (a.key === b.key ? a.designation.localeCompare(b.designation) : (a.key === 'inactive' ? -1 : 1)));
  leave.sort((a, b) => a.designation.localeCompare(b.designation));

  // Operations — through the same visibility rule the Deployment Log applies.
  const visOps = operations().filter((o) => !o.deleted && canViewOperation(actor, o));
  const activeOps = visOps.filter((o) => o.status === 'active').sort((a, b) => (lastAt(b.log) || 0) - (lastAt(a.log) || 0));
  const plannedCount = visOps.filter((o) => o.status === 'planned').length;

  // Intelligence — visible sources, and their reports from the last seven days.
  const visSrc = intel().filter((s) => !s.deleted && canViewIntel(actor, s));
  const activeSources = visSrc.filter((s) => s.status === 'active' || s.status === 'probation').length;
  const recent = [];
  for (const s of visSrc) {
    for (const e of (s.reports || [])) {
      if (e.at >= now - SEVEN_DAYS && e.at <= now) recent.push({ srcId: s.id, ref: s.ref, codename: s.codename, credibility: e.credibility, text: e.text, at: e.at });
    }
  }
  recent.sort((a, b) => b.at - a.at);

  // Scouting pipeline — live stages only.
  const visRec = recruits().filter((r) => !r.deleted && r.org === ORG && r.stage !== 'archived' && canViewRecruitment(actor, r));
  const pipeline = RECRUIT_PIPELINE_OMEGA.map((stage) => ({
    stage, label: (RECRUIT_STAGE[stage] || { label: stage }).label,
    count: visRec.filter((r) => r.stage === stage).length,
  }));

  return {
    now,
    personnel: { total: roster.length, suspended: roster.filter((u) => u.status === 'suspended').length },
    readiness: tallies,
    breaches,
    leave,
    ops: { active: activeOps, plannedCount },
    intelSum: { activeSources, recent: recent.slice(0, 8) },
    pipeline,
  };
}

// --- Rendering ----------------------------------------------------------------
export function render(host, app) {
  const m = buildModel(app.user);

  const stat = (n, k, tone, sub) => `
    <div class="card stat${tone ? ` stat--${tone}` : ''}">
      <div class="stat__n">${esc(String(n))}</div>
      <div class="stat__k">${esc(k)}</div>
      ${sub ? `<div class="stat__sub">${esc(sub)}</div>` : ''}
    </div>`;

  const breachRows = m.breaches.length ? m.breaches.map((b) => `
    <div class="dash-row" data-go="#/personnel/${esc(b.id)}" tabindex="0">
      <span class="mono">${esc(b.designation)}</span>
      <span class="dash-row__grow">${esc(b.codename)}</span>
      ${statusBadge(b.key)}
    </div>`).join('') : '<div class="empty">No operators in breach.</div>';

  const leaveRows = m.leave.length ? m.leave.map((l) => `
    <div class="dash-row" data-go="#/personnel/${esc(l.id)}" tabindex="0">
      <span class="mono">${esc(l.designation)}</span>
      <span class="dash-row__grow">${esc(l.codename)}</span>
      <span class="muted-text">${esc(l.type)}${l.to ? ` \u00b7 until ${fmtDate(l.to)}` : ''}</span>
    </div>`).join('') : '<div class="empty">No one on authorised leave.</div>';

  const opRows = m.ops.active.length ? m.ops.active.map((o) => `
    <div class="dash-row" data-go="#/operation/${esc(o.id)}" tabindex="0">
      <span class="mono">${esc(o.ref)}</span>
      <span class="dash-row__grow">${esc(o.name)}</span>
      ${kindBadge(o.kind)}
      <span class="muted-text">${lastAt(o.log) ? relTime(new Date(lastAt(o.log)).toISOString()) : '\u2014'}</span>
    </div>`).join('') : '<div class="empty">No operations currently active.</div>';

  const feedRows = m.intelSum.recent.length ? `<ul class="timeline">${m.intelSum.recent.map((e) => `
    <li class="tl__item dash-go" data-go="#/source/${esc(e.srcId)}" tabindex="0">
      <span class="tl__dot tl__dot--${esc((INTEL_CREDIBILITY[e.credibility] || { tone: 'muted' }).tone)}"></span>
      <div class="tl__body">
        <div class="tl__text">${credBadge(e.credibility)} <strong style="margin:0 4px">${esc(e.codename)}</strong> ${esc(trunc(e.text))}</div>
        <div class="tl__meta"><span class="mono">${esc(e.ref)}</span> \u00b7 ${relTime(new Date(e.at).toISOString())}</div>
      </div>
    </li>`).join('')}</ul>` : '<div class="empty">No reports filed in the last seven days.</div>';

  const pipeRows = m.pipeline.map((p) => `
    <div class="kv"><span class="kv__k">${esc(p.label)}</span><span class="kv__v mono">${esc(String(p.count))}</span></div>`).join('');

  const foot = (hash, label) => `<div class="card__foot"><button class="btn btn--ghost btn--sm" data-go="${esc(hash)}">${esc(label)} \u2192</button></div>`;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Omega-1</div>
        <h1 class="page-title">Situation Board</h1>
        <div class="page-sub">Unit posture at a glance \u00b7 as of ${fmtDateTime(new Date(m.now).toISOString())}</div>
      </div>
      <button class="btn btn--primary" id="dash-log-hours">+ Log my hours</button>
    </div>

    <div class="stat-strip">
      ${stat(m.personnel.total, 'Personnel', null, m.personnel.suspended ? `${m.personnel.suspended} suspended` : '')}
      ${stat(m.readiness.ready, 'Ready', 'ok')}
      ${stat(m.breaches.length, 'Breaches', m.breaches.length ? 'bad' : 'ok')}
      ${stat(m.readiness.onLeave, 'On Leave', null)}
      ${stat(m.ops.active.length, 'Live Operations', null, m.ops.plannedCount ? `${m.ops.plannedCount} planned` : '')}
      ${stat(m.intelSum.activeSources, 'Active Sources', null)}
    </div>

    <div class="dash-grid">
      <section class="card">
        <div class="card__title">Readiness breaches <span class="muted-text">(${m.breaches.length})</span></div>
        <div class="card__body"><div class="dash-list">${breachRows}</div>${foot('#/operations', 'Open Readiness')}</div>
      </section>
      <section class="card">
        <div class="card__title">On authorised leave <span class="muted-text">(${m.leave.length})</span></div>
        <div class="card__body"><div class="dash-list">${leaveRows}</div></div>
      </section>
      <section class="card">
        <div class="card__title">Active operations <span class="muted-text">(${m.ops.active.length})</span></div>
        <div class="card__body"><div class="dash-list">${opRows}</div>${foot('#/deployments', 'Deployment Log')}</div>
      </section>
      <section class="card">
        <div class="card__title">Intelligence \u2014 last seven days</div>
        <div class="card__body">${feedRows}${foot('#/intel', 'Intelligence')}</div>
      </section>
      <section class="card">
        <div class="card__title">Scouting pipeline</div>
        <div class="card__body">${pipeRows}${foot('#/omega-1/recruitment', 'Recruitment')}</div>
      </section>
    </div>
  `;

  host.querySelectorAll('[data-go]').forEach((el) => {
    const go = () => app.navigate(el.dataset.go);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  const lh = host.querySelector('#dash-log-hours');
  if (lh) lh.addEventListener('click', () => openLog(app, app.user.id));
}
