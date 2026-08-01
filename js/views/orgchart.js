// =============================================================================
// views/orgchart.js — Chain of command.
//
// A read-only, at-a-glance hierarchy: each organisation's rank ladder from the
// top down, with the operators who hold each rung. Purely a re-presentation of
// the roster the viewer already receives — no new data, no new access. The
// Internal Security ladder appears only to the Department (or CL5), and uses the
// derived ISD rank/badge rather than the cover post.
// =============================================================================

import { RANKS, ORGS, ORG_ORDER, clearanceForRank, isdRankFor, isdBadgeFor } from '../constants.js';
import { users } from '../storage.js';
import { isISD, isdMember, isCL5, canSeeISD } from '../permissions.js';
import { esc, clearanceBadge, orgTag, monogram } from '../ui.js';

// Group members onto a rank ladder — senior tier first — plus an "Unlisted"
// bucket for anyone whose rank is off the ladder (a data quirk, never dropped).
// Pure and exported so the grouping is unit-tested.
export function ladderTiers(ranks, members, rankOf, clearanceOf) {
  const tiers = ranks.map((rank) => ({
    rank,
    clearance: clearanceOf(rank),
    members: members.filter((m) => rankOf(m) === rank),
  }));
  const onLadder = new Set(ranks);
  const off = members.filter((m) => !onLadder.has(rankOf(m)));
  if (off.length) tiers.push({ rank: 'Unlisted', clearance: null, members: off });
  return tiers;
}

function chip(u, label) {
  const dim = u.status && u.status !== 'active' ? ' oc-chip--dim' : '';
  return `<button class="oc-chip${dim}" data-nav="#/personnel/${esc(u.id)}">
    <span class="avatar avatar--${ORGS[u.org].tone} avatar--sm">${esc(monogram(u.codename))}</span>
    <span class="oc-chip__id"><span class="mono">${esc(label)}</span> <span class="oc-chip__name">${esc(u.codename)}</span></span>
  </button>`;
}

function ladderSection(heading, tiers, labelOf) {
  const total = tiers.reduce((n, t) => n + t.members.length, 0);
  const rows = tiers.filter((t) => t.members.length).map((t) => `
    <div class="ladder__tier">
      <div class="ladder__rank">
        <span class="ladder__rank-name">${esc(t.rank)}</span>
        ${t.clearance ? clearanceBadge(t.clearance) : ''}
      </div>
      <div class="ladder__members">${t.members.map((m) => chip(m, labelOf(m))).join('')}</div>
    </div>`).join('');
  return `<section class="card">
    <div class="card__title">${heading} <span class="muted-text">· ${total}</span></div>
    <div class="card__body"><div class="ladder">${rows || '<div class="req-empty">No personnel on this ladder.</div>'}</div></div>
  </section>`;
}

export function render(host, app) {
  const actor = app.user;
  const roster = users().filter((u) => !u.deleted && u.accountStatus !== 'pending');

  const sections = [];
  for (const org of ORG_ORDER) {
    const members = roster.filter((u) => u.org === org);
    if (!members.length) continue;
    const tiers = ladderTiers(RANKS[org] || [], members, (m) => m.rank, (r) => clearanceForRank(org, r));
    sections.push(ladderSection(`${orgTag(org)} ${esc(ORGS[org].name)}`, tiers, (m) => m.designation));
  }

  // Internal Security ladder — derived rank + 6/2-series badge; covert, so shown
  // only to those who may see the Department at all.
  if (canSeeISD(actor)) {
    const isd = roster.filter((u) => isdMember(u));
    if (isd.length) {
      const tiers = ladderTiers(RANKS.isd, isd, (m) => isdRankFor(m), (r) => clearanceForRank('isd', r));
      sections.push(ladderSection(`${orgTag('isd')} ${esc(ORGS.isd.name)}`, tiers, (m) => `#${isdBadgeFor(m) || '—'}`));
    }
  }

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · Structure</div>
        <h1 class="page-title">Chain of Command</h1>
        <div class="page-sub">Rank hierarchy by organisation · senior first</div>
      </div>
    </div>
    ${sections.join('')}`;

  host.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => app.navigate(b.dataset.nav)));
}
