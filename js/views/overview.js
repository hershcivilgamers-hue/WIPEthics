// =============================================================================
// views/overview.js — Operator Home (the landing console).
//
// A command console: a KPI readout across the top, the operator's personal
// priority feed (the SAME derived source as For Your Attention, so the two
// never disagree), and a side column of readiness, organisation strength and
// the watchlist. Motion lives in home.css, gated on prefers-reduced-motion and
// additive — the page renders fully without it. Every tile links to where the
// work is resolved.
// =============================================================================

import { CONFIG } from '../config.js';
import {
  ORGS, STRIKE_LIMIT, activeStrikeCount,
  activityStatus, mergeActivityReqs, ACTIVITY_REQ_SETTING_ID,
} from '../constants.js';
import { users, directives, subjects, cases, getActivityForUser, getSetting } from '../storage.js';
import { canViewSubject, canViewCase } from '../permissions.js';
import { esc, clearanceBadge, countUp } from '../ui.js';
import { buildNotifications, watchSummary } from './notifications.js';
import { partitionNotes, markDone, snooze } from '../inbox.js';

const HOME_FEED_LIMIT = 8;
const RING_CIRC = 326.7; // 2πr, r=52
const feedTone = (t) => (['bad', 'warn', 'info', 'ok'].includes(t) ? t : 'info');
const orgHash = (org) => (org === 'ethics-committee' ? '#/ethics' : `#/${org}`);
const round1 = (n) => Math.round(n * 10) / 10;

export function render(host, app) {
  const actor = app.user;
  const allUsers = users().filter((u) => !u.deleted);
  const roster = allUsers.filter((u) => u.accountStatus !== 'pending');
  const activeRoster = roster.filter((u) => u.status === 'active').length;
  const flagged = roster.filter((u) => activeStrikeCount(u.strikes) >= STRIKE_LIMIT).length;
  const allDirectives = directives().filter((d) => !d.deleted);
  const activeDirectives = allDirectives.filter((d) => d.status === 'active').length;

  const surveillanceOn = CONFIG.features.surveillance;
  const visibleSubjects = surveillanceOn ? subjects().filter((s) => !s.deleted && canViewSubject(actor, s)) : [];
  const live = ['active', 'located', 'detained'];
  const activeTargets = visibleSubjects.filter((s) => s.kind === 'target' && live.includes(s.status)).length;

  const tribunalsOn = CONFIG.features.tribunals;
  const visibleCases = tribunalsOn ? cases().filter((c) => !c.deleted && canViewCase(actor, c)) : [];
  const openCases = visibleCases.filter((c) => ['open', 'in-session', 'deliberation'].includes(c.status)).length;

  // --- Personal priority feed (unread first) ---
  const activeNotes = partitionNotes(actor.id, buildNotifications(actor)).active;
  const unread = activeNotes.filter((n) => n._unread).length;
  const ordered = [...activeNotes].sort((a, b) => (b._unread ? 1 : 0) - (a._unread ? 1 : 0));
  const shown = ordered.slice(0, HOME_FEED_LIMIT);

  // --- KPI readout: value, label, fill fraction (0-1), alert? ---
  const kpis = [
    { v: roster.length, k: 'On roster', f: roster.length ? activeRoster / roster.length : 0 },
    surveillanceOn && { v: activeTargets, k: 'Active targets', f: visibleSubjects.length ? activeTargets / visibleSubjects.length : 0, alert: activeTargets > 0 },
    tribunalsOn && { v: openCases, k: 'Open cases', f: visibleCases.length ? openCases / visibleCases.length : 0 },
    { v: activeDirectives, k: 'Directives', f: allDirectives.length ? activeDirectives / allDirectives.length : 0 },
    { v: unread, k: 'Unread signals', f: activeNotes.length ? unread / activeNotes.length : 0 },
  ].filter(Boolean);

  const kpiHtml = kpis.map((m) => {
    const w = m.v > 0 ? `${Math.max(4, Math.round(m.f * 100))}%` : '0%';
    return `<div class="oh-kpi ${m.alert ? 'oh-kpi--alert' : ''}">
      <div class="oh-kpi__k">${esc(m.k)}</div>
      <div class="oh-kpi__v" data-count="${m.v}">${m.v}</div>
      <div class="oh-kpi__track"><span class="oh-kpi__fill" style="--w:${w}"></span></div>
    </div>`;
  }).join('');

  const feedHtml = shown.length ? shown.map((n) => `
    <div class="oh-row oh-row--${feedTone(n.tone)}" data-nav="${esc(n.hash)}" role="button" tabindex="0">
      ${n._unread ? '<span class="oh-row__pip"></span>' : ''}
      <span class="oh-row__stripe"></span>
      <span class="oh-row__ic">${n.icon ? esc(n.icon) : '•'}</span>
      <span class="oh-row__txt">${esc(n.text)}</span>
      <span class="oh-row__meta">${esc(relLabel(n.at))}</span>
      <span class="oh-row__actions">
        <button class="note-act" data-snooze="${esc(n._key)}" title="Snooze for a day" aria-label="Snooze for a day">⏰</button>
        <button class="note-act" data-done="${esc(n._key)}" title="Acknowledge" aria-label="Acknowledge">✓</button>
      </span>
    </div>`).join('')
    + (activeNotes.length > shown.length
      ? `<button class="oh-more" data-nav="#/notifications">+ ${activeNotes.length - shown.length} more · view all in For Your Attention →</button>`
      : '')
    : '<div class="oh-empty">Nothing requires your attention right now.</div>';

  // --- Readiness ring (from the operator's own activity requirement) ---
  const reqs = mergeActivityReqs((getSetting(ACTIVITY_REQ_SETTING_ID) || {}).data);
  const st = activityStatus(actor, getActivityForUser(actor.id), reqs, Date.now());
  const readyHtml = readinessCard(st);

  // --- Organisation strength bars ---
  const orgCounts = ['omega-1', 'ethics-committee', 'isd', 'command']
    .map((org) => ({ org, n: roster.filter((u) => u.org === org).length }))
    .filter((o) => o.n > 0);
  const orgMax = Math.max(1, ...orgCounts.map((o) => o.n));
  const orgsHtml = orgCounts.map((o) => `
    <button class="oh-obar oh-obar--${o.org}" data-nav="${orgHash(o.org)}">
      <span class="oh-obar__k">${esc(ORGS[o.org].short)}</span>
      <span class="oh-obar__trk"><span class="oh-obar__fl" style="--w:${Math.max(6, Math.round((o.n / orgMax) * 100))}%"></span></span>
      <span class="oh-obar__v">${o.n}</span>
    </button>`).join('');

  // --- Watchlist (optional; only if the operator watches anything) ---
  const watch = watchSummary(actor);
  const changed = watch.filter((w) => w.changed).length;
  const watchHtml = watch.length ? watch.slice(0, 5).map((w) => `
    <button class="oh-wrow ${w.changed ? 'oh-wrow--changed' : ''}" data-nav="${esc(w.hash)}">
      <span class="oh-wrow__d"></span>
      <span class="oh-wrow__r">${esc(w.label)}</span>
      <span class="oh-wrow__s">${w.changed ? 'changed' : 'no change'}</span>
    </button>`).join('') : '';

  host.innerHTML = `
    <div class="oh-head oh-rise">
      <div>
        <div class="eyebrow">${esc(CONFIG.facility)} · ${esc(CONFIG.systemName)}</div>
        <h1 class="page-title">Operator Home</h1>
        <div class="page-sub">${activeNotes.length ? `${activeNotes.length} item${activeNotes.length === 1 ? '' : 's'} require your attention` : 'All clear — nothing awaiting you'}</div>
      </div>
      <div class="oh-head__id">
        <span class="op-chip"><span class="op-chip__id mono">${esc(actor.designation)}</span><span class="op-chip__name">${esc(actor.codename)}</span>${clearanceBadge(actor.clearance)}</span>
        <span class="oh-clock"><span class="oh-led"></span><span id="oh-clk">--:--:--</span> · SITE-CMD NOMINAL</span>
      </div>
    </div>

    <div class="oh-kpis oh-rise" style="grid-template-columns:repeat(${kpis.length},1fr)">${kpiHtml}</div>

    <div class="oh-grid">
      <section class="card oh-feed oh-rise">
        <div class="oh-card__hd"><span class="oh-card__t">Requires You</span>${unread ? `<span class="oh-tag">${unread} NEW</span>` : ''}</div>
        <div class="oh-feed__body">${feedHtml}</div>
      </section>
      <aside class="oh-col">
        <section class="card oh-rise">
          <div class="oh-card__hd"><span class="oh-card__t">Your Readiness</span><span class="oh-tag">THIS WEEK</span></div>
          ${readyHtml}
        </section>
        ${orgsHtml ? `<section class="card oh-rise">
          <div class="oh-card__hd"><span class="oh-card__t">Organisations</span><span class="oh-tag">${roster.length} ACTIVE</span></div>
          <div class="oh-list">${orgsHtml}</div>
        </section>` : ''}
        ${watchHtml ? `<section class="card oh-rise">
          <div class="oh-card__hd"><span class="oh-card__t">Watchlist</span>${changed ? `<span class="oh-tag">${changed} CHANGED</span>` : ''}</div>
          <div class="oh-list">${watchHtml}</div>
        </section>` : ''}
      </aside>
    </div>
  `;

  host.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('.note-act')) return; app.navigate(b.dataset.nav); }));
  host.querySelectorAll('.oh-row[data-nav]').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('.note-act')) app.navigate(el.dataset.nav); }));
  host.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); markDone(actor.id, b.dataset.done); app.refresh(); }));
  host.querySelectorAll('[data-snooze]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); snooze(actor.id, b.dataset.snooze); app.refresh(); }));
  wireMotion(host);
}

// A readiness card that adapts to the operator's requirement: a ring for those
// with a weekly target, a plain note for the exempt or those on leave.
function readinessCard(st) {
  if (st.onLeave) {
    return '<div class="oh-ready"><div class="oh-ready__meta"><p class="st st--warn">On leave</p><p class="sub">No activity is expected while you are on leave.</p></div></div>';
  }
  if (st.exempt || st.req.exempt) {
    return '<div class="oh-ready"><div class="oh-ready__meta"><p class="st st--ok">No weekly requirement</p><p class="sub">Your posting carries no logged-hours requirement.</p></div></div>';
  }
  const weekly = st.req.weekly || 0;
  const pct = weekly ? Math.min(1, st.weekHours / weekly) : 1;
  const off = RING_CIRC * (1 - pct);
  const tone = st.key === 'active' ? 'ok' : st.key === 'semi' ? 'warn' : 'bad';
  const label = st.key === 'active' ? 'Requirement met' : st.key === 'semi' ? 'Below requirement' : 'Inactive';
  const remaining = round1(Math.max(0, weekly - st.weekHours));
  return `<div class="oh-ready">
    <svg class="oh-ring" width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
      <circle class="trk" cx="56" cy="56" r="52"></circle>
      <circle class="val val--${tone}" cx="56" cy="56" r="52" style="--off:${off.toFixed(1)}"></circle>
      <text class="oh-ring__pct" x="56" y="54" text-anchor="middle">${Math.round(pct * 100)}%</text>
      <text class="oh-ring__u" x="56" y="68" text-anchor="middle">${round1(st.weekHours)} / ${weekly} H</text>
    </svg>
    <div class="oh-ready__meta">
      <p class="st st--${tone}">${label}</p>
      <p class="sub">${round1(st.weekHours)}h logged of ${weekly}h weekly<br>${remaining}h remaining this week</p>
    </div>
  </div>`;
}

// Compact relative label for the feed's right column (mono, terse).
function relLabel(at) {
  if (!at) return '';
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// Live clock + KPI count-up. Progressive enhancement: the DOM already shows the
// final values, so if this never runs (or motion is reduced) nothing is missing.
function wireMotion(host) {
  const clk = host.querySelector('#oh-clk');
  if (clk) {
    const tick = () => {
      const el = document.getElementById('oh-clk');
      if (!el) return; // view navigated away — let the interval lapse
      el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
    };
    tick();
    const t = setInterval(() => { if (!document.getElementById('oh-clk')) { clearInterval(t); } else tick(); }, 1000);
  }
  countUp(host);
}
