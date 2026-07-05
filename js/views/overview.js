// =============================================================================
// views/overview.js — Command overview dashboard.
//
// The landing screen. Shows command-wide metrics and a personal, role-aware
// "Requires You" queue: the items this specific operator is responsible for
// acting on, each linking straight to where it is resolved.
// =============================================================================

import { CONFIG } from '../config.js';
import { ORGS, ORG_ORDER, STRIKE_LIMIT, activeStrikeCount } from '../constants.js';
import { users, directives, subjects, cases } from '../storage.js';
import { canApproveRegistrations, canManageOrg, canViewSubject, canManageSubject, canViewCase, canRuleTribunal } from '../permissions.js';
import { esc, clearanceBadge, orgTag } from '../ui.js';

export function render(host, app) {
  const actor = app.user;
  const allUsers = users().filter((u) => !u.deleted);
  const roster = allUsers.filter((u) => u.accountStatus !== 'pending');
  const pending = allUsers.filter((u) => u.accountStatus === 'pending');
  const onLeave = roster.filter((u) => u.status === 'loa');
  const flagged = roster.filter((u) => activeStrikeCount(u.strikes) >= STRIKE_LIMIT);
  const activeDirectives = directives().filter((d) => !d.deleted && d.status === 'active');

  // Surveillance signals (only the subjects this operator is cleared to see).
  const surveillanceOn = CONFIG.features.surveillance;
  const visibleSubjects = surveillanceOn
    ? subjects().filter((s) => !s.deleted && canViewSubject(actor, s))
    : [];
  const liveStatuses = ['active', 'located', 'detained'];
  const activeTargets = visibleSubjects.filter((s) => s.kind === 'target' && liveStatuses.includes(s.status));
  const criticalWatch = visibleSubjects.filter((s) => s.threat === 'critical' && liveStatuses.includes(s.status) && canManageSubject(actor, s));

  // Tribunal signals (only cases this operator is cleared to see).
  const tribunalsOn = CONFIG.features.tribunals;
  const visibleCases = tribunalsOn ? cases().filter((c) => !c.deleted && canViewCase(actor, c)) : [];
  const openStatuses = ['open', 'in-session', 'deliberation'];
  const openCases = visibleCases.filter((c) => openStatuses.includes(c.status));
  const awaitingRuling = visibleCases.filter((c) => c.status === 'deliberation' && !c.ruling);

  // --- Requires You ---
  const queue = [];
  if (canApproveRegistrations(actor) && pending.length) {
    queue.push({
      tone: 'warn',
      title: `${pending.length} access request${pending.length > 1 ? 's' : ''} awaiting approval`,
      sub: 'Review and assign clearance in Administration.',
      hash: '#/admin',
    });
  }
  const myFlagged = flagged.filter((u) => canManageOrg(actor, u.org));
  myFlagged.slice(0, 4).forEach((u) => {
    queue.push({
      tone: 'bad',
      title: `${u.designation} \u00b7 ${u.codename} is at the strike limit`,
      sub: `${activeStrikeCount(u.strikes)} active strikes \u2014 open the disciplinary record.`,
      hash: `#/personnel/${u.id}`,
    });
  });
  if (actor.status === 'loa') {
    queue.push({ tone: 'info', title: 'You are currently marked on leave', sub: 'Command can return you to active duty.', hash: `#/personnel/${actor.id}` });
  }
  criticalWatch.slice(0, 3).forEach((s) => {
    queue.push({
      tone: 'bad',
      title: `${s.ref} \u00b7 ${s.alias} is a critical-threat ${s.kind === 'target' ? 'target' : 'subject'}`,
      sub: 'Active surveillance at critical threat — review the subject file.',
      hash: `#/subject/${s.id}`,
    });
  });
  if (canRuleTribunal(actor) && awaitingRuling.length) {
    queue.push({
      tone: 'warn',
      title: `${awaitingRuling.length} case${awaitingRuling.length > 1 ? 's are' : ' is'} in deliberation awaiting ruling`,
      sub: 'Enter the Committee ruling on the case docket.',
      hash: '#/tribunals',
    });
  }

  const queueHtml = queue.length ? queue.map((q) => `
    <button class="req" data-nav="${esc(q.hash)}">
      <span class="req__bar req__bar--${q.tone}"></span>
      <span class="req__text"><span class="req__title">${esc(q.title)}</span><span class="req__sub">${esc(q.sub)}</span></span>
      <span class="req__go">\u2192</span>
    </button>`).join('') : `
    <div class="req-empty">Nothing requires your attention right now.</div>`;

  // --- Org breakdown ---
  const orgCards = ORG_ORDER.map((org) => {
    const list = roster.filter((u) => u.org === org);
    if (!list.length) return '';
    const active = list.filter((u) => u.status === 'active').length;
    return `
      <button class="orgcard" data-nav="#/${org === 'ethics-committee' ? 'ethics' : org}">
        <div class="orgcard__top">${orgTag(org)}<span class="orgcard__count">${list.length}</span></div>
        <div class="orgcard__name">${esc(ORGS[org].name)}</div>
        <div class="orgcard__sub">${active} active \u00b7 ${list.length - active} other</div>
      </button>`;
  }).join('');

  const metric = (value, label, tone = '') => `
    <div class="metric ${tone ? `metric--${tone}` : ''}">
      <div class="metric__value">${value}</div>
      <div class="metric__label">${esc(label)}</div>
    </div>`;

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(CONFIG.facility)} \u00b7 ${esc(CONFIG.systemName)}</div>
        <h1 class="page-title">Command Overview</h1>
        <div class="page-sub">Signed in as <span class="mono">${esc(actor.designation)}</span> \u00b7 ${esc(actor.codename)} ${clearanceBadge(actor.clearance)}</div>
      </div>
    </div>

    <div class="metric-row">
      ${metric(roster.length, 'Personnel on roster')}
      ${surveillanceOn ? metric(activeTargets.length, 'Active targets', activeTargets.length ? 'bad' : '') : ''}
      ${tribunalsOn ? metric(openCases.length, 'Open cases', openCases.length ? 'warn' : '') : ''}
      ${metric(activeDirectives.length, 'Active directives')}
      ${metric(onLeave.length, 'On leave', onLeave.length ? 'warn' : '')}
      ${metric(flagged.length, 'At strike limit', flagged.length ? 'bad' : '')}
      ${canApproveRegistrations(actor) ? metric(pending.length, 'Pending approval', pending.length ? 'warn' : '') : ''}
    </div>

    <div class="overview-grid">
      <section class="card">
        <div class="card__title">Requires You</div>
        <div class="card__body req-list">${queueHtml}</div>
      </section>
      <section class="card">
        <div class="card__title">Organisations</div>
        <div class="card__body orgcard-grid">${orgCards}</div>
      </section>
    </div>
  `;

  host.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => app.navigate(b.dataset.nav)));
}
