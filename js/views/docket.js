// =============================================================================
// views/docket.js — Ethics Committee Docket Board.
//
// The Committee's counterpart to Omega-1's Situation Board: a one-page rollup of
// oversight posture — open proceedings and where they stand, Assistant
// applications awaiting a decision, this committee's own standing orders and
// their acknowledgement compliance, and recent rulings.
//
// Like the Situation Board it stores nothing. Every figure is derived at render
// time from records the viewer already holds, through the same access rules each
// register enforces (cases by clearance, applications by the cadre rule, orders
// by readability). In server mode the snapshot is already redacted per viewer,
// so a sealed proceeding a member cannot see never reaches their board.
// =============================================================================

import {
  CASE_KIND, CASE_STATUS, RULING_FINDING, RECRUIT_STAGE, ETHICS_APP_TAG,
} from '../constants.js';
import { cases, recruits, directives, users } from '../storage.js';
import {
  canViewCase, canViewRecruitment, canReadDirective, canManageDirectives,
} from '../permissions.js';
import { esc, fmtDate, fmtDateTime, relTime } from '../ui.js';

const ORG = 'ethics-committee';
const LIVE_CASE = new Set(['open', 'in-session', 'deliberation']);

const kindBadge = (k) => { const m = CASE_KIND[k] || { short: k, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.short || m.label)}</span>`; };
const caseStatusBadge = (s) => { const m = CASE_STATUS[s] || { label: s, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const findingBadge = (f) => { const m = RULING_FINDING[f] || { label: f, tone: 'muted' }; return `<span class="badge badge--${m.tone}">${esc(m.label)}</span>`; };
const caveat = (c) => (c.compartment ? `<span class="badge badge--warn" title="Need-to-Know">${esc(c.compartmentName || 'COMPARTMENTED')}</span>` : '');
const caseTs = (c) => new Date(c.updatedAt || c.createdAt).getTime();

// --- Derived model (testable) -----------------------------------------------
export function buildModel(actor, now = Date.now()) {
  const visCases = cases().filter((c) => !c.deleted && canViewCase(actor, c));
  const live = visCases.filter((c) => LIVE_CASE.has(c.status)).sort((a, b) => caseTs(b) - caseTs(a));
  const awaitingRuling = live.filter((c) => c.status === 'deliberation').length;
  const recentRulings = visCases
    .filter((c) => c.ruling && c.ruling.ts)
    .sort((a, b) => new Date(b.ruling.ts) - new Date(a.ruling.ts))
    .slice(0, 6);

  // Assistant applications still in the pipeline.
  const visRec = recruits().filter((r) => !r.deleted && r.org === ORG && r.stage !== 'archived' && canViewRecruitment(actor, r));
  const applications = visRec.filter((r) => r.stage === 'application').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const interviews = visRec.filter((r) => r.stage === 'interview').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  // This committee's own standing orders, with acknowledgement compliance.
  const canManage = canManageDirectives(actor, ORG);
  const roster = users().filter((u) => !u.deleted && u.accountStatus === 'active' && u.status !== 'discharged' && u.org === ORG);
  const orders = directives()
    .filter((d) => !d.deleted && d.org === ORG && d.status !== 'rescinded')
    .map((d) => {
      const eligible = roster.filter((u) => canReadDirective(u, d));
      const signed = eligible.filter((u) => (d.acks || {})[u.id]).length;
      return { id: d.id, ref: d.ref, title: d.title, clearance: d.clearance, compartment: d.compartment, compartmentName: d.compartmentName, eligible: eligible.length, signed, canRead: canReadDirective(actor, d) };
    })
    .sort((a, b) => (a.eligible - a.signed) - (b.eligible - b.signed) === 0 ? a.ref.localeCompare(b.ref) : (b.eligible - b.signed) - (a.eligible - a.signed));
  const ordersOutstanding = orders.reduce((n, o) => n + Math.max(0, o.eligible - o.signed), 0);

  return {
    now,
    cases: { live, openCount: visCases.filter((c) => c.status === 'open').length, awaitingRuling },
    recentRulings,
    applications,
    interviews,
    orders: canManage ? orders : [],
    ordersOutstanding: canManage ? ordersOutstanding : 0,
    canManage,
  };
}

// --- Render -----------------------------------------------------------------
export function render(host, app) {
  const m = buildModel(app.user);

  const stat = (n, k, tone, sub) => `
    <div class="card stat${tone ? ` stat--${tone}` : ''}">
      <div class="stat__n">${esc(String(n))}</div>
      <div class="stat__k">${esc(k)}</div>
      ${sub ? `<div class="stat__sub">${esc(sub)}</div>` : ''}
    </div>`;

  const caseRows = m.cases.live.length ? m.cases.live.map((c) => `
    <div class="dash-row" data-go="#/case/${esc(c.id)}" tabindex="0">
      <span class="mono">${esc(c.ref)}</span>
      <span class="dash-row__grow">${esc(c.title)}</span>
      ${kindBadge(c.kind)} ${caseStatusBadge(c.status)} ${caveat(c)}
    </div>`).join('') : '<div class="empty">No live proceedings.</div>';

  const appRows = (m.applications.length || m.interviews.length) ? [
    ...m.interviews.map((r) => `
      <div class="dash-row" data-go="#/recruit/${esc(r.id)}" tabindex="0">
        <span class="dash-row__grow">${esc(r.name)}</span>
        <span class="badge badge--${RECRUIT_STAGE.interview.tone}">${esc(RECRUIT_STAGE.interview.label)}</span>
      </div>`),
    ...m.applications.map((r) => `
      <div class="dash-row" data-go="#/recruit/${esc(r.id)}" tabindex="0">
        <span class="dash-row__grow">${esc(r.name)}</span>
        ${r.tag ? `<span class="badge badge--${(ETHICS_APP_TAG[r.tag] || { tone: 'muted' }).tone}">${esc((ETHICS_APP_TAG[r.tag] || { label: r.tag }).label)}</span>` : ''}
        <span class="badge badge--${RECRUIT_STAGE.application.tone}">${esc(RECRUIT_STAGE.application.label)}</span>
      </div>`),
  ].join('') : '<div class="empty">No applications in progress.</div>';

  const rulingRows = m.recentRulings.length ? `<ul class="timeline">${m.recentRulings.map((c) => `
    <li class="tl__item dash-go" data-go="#/case/${esc(c.id)}" tabindex="0">
      <span class="tl__dot tl__dot--${esc((RULING_FINDING[c.ruling.finding] || { tone: 'muted' }).tone)}"></span>
      <div class="tl__body">
        <div class="tl__text">${findingBadge(c.ruling.finding)} <strong style="margin:0 4px">${esc(c.title)}</strong></div>
        <div class="tl__meta"><span class="mono">${esc(c.ref)}</span> \u00b7 ${relTime(new Date(c.ruling.ts).toISOString())}</div>
      </div>
    </li>`).join('')}</ul>` : '<div class="empty">No rulings on record.</div>';

  const orderRows = m.canManage ? (m.orders.length ? m.orders.map((o) => {
    const out = Math.max(0, o.eligible - o.signed);
    return `<div class="dash-row" data-go="#/directive/${esc(o.id)}" tabindex="0">
      <span class="mono">${esc(o.ref)}</span>
      <span class="dash-row__grow">${esc(o.title)}</span>
      <span class="badge badge--${out ? 'warn' : 'ok'}">${o.signed}/${o.eligible} signed</span>
    </div>`;
  }).join('') : '<div class="empty">No standing orders in force.</div>') : '';

  const foot = (hash, label) => `<div class="card__foot"><button class="btn btn--ghost btn--sm" data-go="${esc(hash)}">${esc(label)} \u2192</button></div>`;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Ethics Committee</div>
        <h1 class="page-title">Docket Board</h1>
        <div class="page-sub">Oversight posture at a glance \u00b7 as of ${fmtDateTime(new Date(m.now).toISOString())}</div>
      </div>
    </div>

    <div class="stat-strip">
      ${stat(m.cases.live.length, 'Live Proceedings', m.cases.live.length ? 'warn' : 'ok')}
      ${stat(m.cases.openCount, 'Newly Open', null)}
      ${stat(m.cases.awaitingRuling, 'Awaiting Ruling', m.cases.awaitingRuling ? 'warn' : 'ok')}
      ${stat(m.applications.length + m.interviews.length, 'Applications', null, m.interviews.length ? `${m.interviews.length} at interview` : '')}
      ${m.canManage ? stat(m.ordersOutstanding, 'Acks Outstanding', m.ordersOutstanding ? 'bad' : 'ok') : ''}
    </div>

    <div class="dash-grid">
      <section class="card">
        <div class="card__title">Live proceedings <span class="muted-text">(${m.cases.live.length})</span></div>
        <div class="card__body"><div class="dash-list">${caseRows}</div>${foot('#/tribunals', 'Case Docket')}</div>
      </section>
      <section class="card">
        <div class="card__title">Assistant applications <span class="muted-text">(${m.applications.length + m.interviews.length})</span></div>
        <div class="card__body"><div class="dash-list">${appRows}</div>${foot('#/ethics/recruitment', 'Applications')}</div>
      </section>
      <section class="card">
        <div class="card__title">Recent rulings</div>
        <div class="card__body">${rulingRows}${foot('#/tribunals', 'Case Docket')}</div>
      </section>
      ${m.canManage ? `<section class="card">
        <div class="card__title">Standing orders \u2014 acknowledgement</div>
        <div class="card__body"><div class="dash-list">${orderRows}</div>${foot('#/directives', 'Standing Orders')}</div>
      </section>` : ''}
    </div>
  `;

  host.querySelectorAll('[data-go]').forEach((el) => {
    const go = () => app.navigate(el.dataset.go);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
