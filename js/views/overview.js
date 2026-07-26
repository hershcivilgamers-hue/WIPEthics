// =============================================================================
// views/overview.js — Operator home.
//
// The landing screen. Command-wide metrics sit up top for context, but the
// heart of the page is a personal, role-aware feed: the very items this operator
// is responsible for, drawn from the SAME derived source as For Your Attention
// (buildNotifications), so the home and the inbox never disagree. Each item
// links straight to where it is resolved.
// =============================================================================

import { CONFIG } from '../config.js';
import { ORGS, ORG_ORDER, STRIKE_LIMIT, activeStrikeCount } from '../constants.js';
import { users, directives, subjects, cases } from '../storage.js';
import { canApproveRegistrations, canViewSubject, canViewCase } from '../permissions.js';
import { esc, clearanceBadge, orgTag } from '../ui.js';
import { buildNotifications } from './notifications.js';
import { partitionNotes } from '../inbox.js';

const HOME_FEED_LIMIT = 8;
// The queue bar only has info/warn/bad; fold the calmer tones onto info.
const barTone = (t) => (t === 'bad' || t === 'warn' ? t : 'info');

export function render(host, app) {
  const actor = app.user;
  const allUsers = users().filter((u) => !u.deleted);
  const roster = allUsers.filter((u) => u.accountStatus !== 'pending');
  const pending = allUsers.filter((u) => u.accountStatus === 'pending');
  const onLeave = roster.filter((u) => u.status === 'loa');
  const flagged = roster.filter((u) => activeStrikeCount(u.strikes) >= STRIKE_LIMIT);
  const activeDirectives = directives().filter((d) => !d.deleted && d.status === 'active');

  const surveillanceOn = CONFIG.features.surveillance;
  const visibleSubjects = surveillanceOn
    ? subjects().filter((s) => !s.deleted && canViewSubject(actor, s))
    : [];
  const liveStatuses = ['active', 'located', 'detained'];
  const activeTargets = visibleSubjects.filter((s) => s.kind === 'target' && liveStatuses.includes(s.status));

  const tribunalsOn = CONFIG.features.tribunals;
  const visibleCases = tribunalsOn ? cases().filter((c) => !c.deleted && canViewCase(actor, c)) : [];
  const openCases = visibleCases.filter((c) => ['open', 'in-session', 'deliberation'].includes(c.status));

  // --- Personal feed: the same items as For Your Attention, unread first ---
  const active = partitionNotes(actor.id, buildNotifications(actor)).active;
  const unread = active.filter((n) => n._unread).length;
  const ordered = [...active].sort((a, b) => (b._unread ? 1 : 0) - (a._unread ? 1 : 0));
  const shown = ordered.slice(0, HOME_FEED_LIMIT);

  const feedHtml = shown.length ? shown.map((n) => `
    <button class="req ${n._unread ? 'req--unread' : ''}" data-nav="${esc(n.hash)}">
      <span class="req__bar req__bar--${barTone(n.tone)}"></span>
      <span class="req__text"><span class="req__title">${n.icon ? `${esc(n.icon)} ` : ''}${esc(n.text)}</span></span>
      <span class="req__go">→</span>
    </button>`).join('') + (active.length > shown.length ? `
    <button class="req req--more" data-nav="#/notifications">
      <span class="req__text"><span class="req__sub">+${active.length - shown.length} more · view all in For Your Attention</span></span>
      <span class="req__go">→</span>
    </button>` : '') : `
    <div class="req-empty">Nothing requires your attention right now.</div>`;

  // --- Org breakdown ---
  const orgCards = ORG_ORDER.map((org) => {
    const list = roster.filter((u) => u.org === org);
    if (!list.length) return '';
    const activeN = list.filter((u) => u.status === 'active').length;
    return `
      <button class="orgcard" data-nav="#/${org === 'ethics-committee' ? 'ethics' : org}">
        <div class="orgcard__top">${orgTag(org)}<span class="orgcard__count">${list.length}</span></div>
        <div class="orgcard__name">${esc(ORGS[org].name)}</div>
        <div class="orgcard__sub">${activeN} active · ${list.length - activeN} other</div>
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
        <div class="eyebrow">${esc(CONFIG.facility)} · ${esc(CONFIG.systemName)}</div>
        <h1 class="page-title">Operator Home</h1>
        <div class="page-sub">Signed in as <span class="mono">${esc(actor.designation)}</span> · ${esc(actor.codename)} ${clearanceBadge(actor.clearance)}</div>
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
        <div class="card__title">Requires You${unread ? ` <span class="badge badge--warn">${unread} new</span>` : ''}</div>
        <div class="card__body req-list">${feedHtml}</div>
      </section>
      <section class="card">
        <div class="card__title">Organisations</div>
        <div class="card__body orgcard-grid">${orgCards}</div>
      </section>
    </div>
  `;

  host.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => app.navigate(b.dataset.nav)));
}
