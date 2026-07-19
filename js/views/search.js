// =============================================================================
// views/search.js — Organisation-wide search.
//
// One query across personnel, recruitment candidates, surveillance subjects,
// tribunal cases, operations, intelligence sources and directives. Search is
// bound by the same access rules as everything else, so it can never be used to
// discover something the operator cannot already reach:
//   • personnel are matched only on always-visible identity (designation,
//     codename, organisation, rank) — never on redactable fields;
//   • subjects and cases above the operator's clearance are excluded entirely
//     (a sealed record cannot be matched on content it hides);
//   • operations and intelligence sources follow their registers' own rule
//     (clearance and stake; assignees and handlers see their own);
//   • recruitment candidates are visible to the unit's cadre and CL5 only;
//   • a directive is matched on its body ONLY when the operator is cleared to
//     read that body — otherwise only its open reference and subject.
// Opening any result routes to its detail view, where the gate is enforced
// again as defence in depth.
//
// The access-filtered gathering lives in searchRecords() so the Search view AND
// the command palette read the SAME index and the SAME redaction rules.
// =============================================================================

import { users, subjects, cases, directives, recruits, operations, intel } from '../storage.js';
import {
  canViewSubject, canViewCase, canReadDirective,
  canViewRecruitment, canViewOperation, canViewIntel,
} from '../permissions.js';
import {
  CASE_KIND, CASE_STATUS, SUBJECT_CLASS, ORGS,
  RECRUIT_STAGE, OPERATION_KIND, OPERATION_STATUS, INTEL_SOURCE_TYPE, INTEL_STATUS,
} from '../constants.js';
import { esc, clearanceBadge, orgTag } from '../ui.js';

let query = '';
export function setQuery(q) { query = q || ''; }
export function getQuery() { return query; }

const MAX_PER_GROUP = 25;
const hit = (q, text) => text.toLowerCase().includes(q);

// Access-filtered gathering, shared by the view and the command palette. Returns
// grouped, structured results (uncapped — each consumer caps as it likes) plus a
// count of records kept out of the search entirely by the operator's access.
export function searchRecords(actor, q) {
  const ql = (q || '').trim().toLowerCase();
  if (!actor || ql.length < 2) return { groups: [], excluded: 0, total: 0, tooShort: true };

  const personnel = users()
    .filter((u) => !u.deleted && u.accountStatus === 'active')
    .filter((u) => hit(ql, `${u.designation} ${u.codename} ${ORGS[u.org]?.name || u.org} ${u.rank || ''}`));

  const subjAll = subjects().filter((s) => !s.deleted);
  const subjViewable = subjAll.filter((s) => canViewSubject(actor, s));
  const subjSealed = subjAll.length - subjViewable.length;
  const subjMatch = subjViewable.filter((s) => hit(ql, `${s.ref} ${s.alias} ${s.lastKnownLocation || ''}`));

  const caseAll = cases().filter((c) => !c.deleted);
  const caseViewable = caseAll.filter((c) => canViewCase(actor, c));
  const caseSealed = caseAll.length - caseViewable.length;
  const caseMatch = caseViewable.filter((c) => hit(ql, `${c.ref} ${c.title} ${c.summary || ''}`));

  const dirMatch = directives()
    .filter((d) => !d.deleted)
    .filter((d) => {
      const base = `${d.ref} ${d.title}`;
      const text = canReadDirective(actor, d) ? `${base} ${d.body || ''}` : base;
      return hit(ql, text);
    });

  const recMatch = recruits()
    .filter((r) => !r.deleted && canViewRecruitment(actor, r))
    .filter((r) => hit(ql, `${r.ref} ${r.name} ${r.department || ''}`));

  const opAll = operations().filter((o) => !o.deleted);
  const opViewable = opAll.filter((o) => canViewOperation(actor, o));
  const opSealed = opAll.length - opViewable.length;
  const opMatch = opViewable.filter((o) => hit(ql, `${o.ref} ${o.name} ${o.location || ''} ${o.objective || ''}`));

  const srcAll = intel().filter((s) => !s.deleted);
  const srcViewable = srcAll.filter((s) => canViewIntel(actor, s));
  const srcSealed = srcAll.length - srcViewable.length;
  const srcMatch = srcViewable.filter((s) => hit(ql, `${s.ref} ${s.codename} ${s.tasking || ''} ${s.cover || ''}`));

  const groups = [];
  const add = (key, title, type, items) => { if (items.length) groups.push({ key, title, type, items }); };

  add('personnel', 'Personnel', 'Personnel', personnel.map((u) => ({
    href: `#/personnel/${u.id}`, ref: u.designation, name: `“${esc(u.codename)}”`,
    badges: `${orgTag(u.org)} ${clearanceBadge(u.clearance)}`,
  })));
  add('candidate', 'Recruitment candidates', 'Candidate', recMatch.map((r) => ({
    href: `#/recruit/${r.id}`, ref: r.ref, name: esc(r.name),
    badges: `${orgTag(r.org)} <span class="badge badge--${RECRUIT_STAGE[r.stage]?.tone || 'muted'}">${esc(RECRUIT_STAGE[r.stage]?.label || r.stage)}</span>`,
  })));
  add('subject', 'Surveillance subjects', 'Subject', subjMatch.map((s) => ({
    href: `#/subject/${s.id}`, ref: s.ref, name: `“${esc(s.alias)}”`,
    badges: `<span class="subj-kind subj-kind--${SUBJECT_CLASS[s.kind]?.tone || 'muted'}">${esc(SUBJECT_CLASS[s.kind]?.short || s.kind)}</span> ${orgTag(s.org)} ${clearanceBadge(s.clearance)}`,
  })));
  add('case', 'Tribunal cases', 'Case', caseMatch.map((c) => ({
    href: `#/case/${c.id}`, ref: c.ref, name: esc(c.title),
    badges: `<span class="badge badge--${CASE_STATUS[c.status]?.tone || 'muted'}">${esc(CASE_STATUS[c.status]?.label || c.status)}</span> ${clearanceBadge(c.clearance)}`,
  })));
  add('operation', 'Operations', 'Operation', opMatch.map((o) => ({
    href: `#/operation/${o.id}`, ref: o.ref, name: esc(o.name),
    badges: `<span class="badge badge--${OPERATION_KIND[o.kind]?.tone || 'muted'}">${esc(OPERATION_KIND[o.kind]?.label || o.kind)}</span> <span class="badge badge--${OPERATION_STATUS[o.status]?.tone || 'muted'}">${esc(OPERATION_STATUS[o.status]?.label || o.status)}</span> ${clearanceBadge(o.clearance)}`,
  })));
  add('source', 'Intelligence sources', 'Source', srcMatch.map((s) => ({
    href: `#/source/${s.id}`, ref: s.ref, name: `“${esc(s.codename)}”`,
    badges: `<span class="badge badge--${INTEL_SOURCE_TYPE[s.type]?.tone || 'muted'}">${esc(INTEL_SOURCE_TYPE[s.type]?.label || s.type)}</span> <span class="badge badge--${INTEL_STATUS[s.status]?.tone || 'muted'}">${esc(INTEL_STATUS[s.status]?.label || s.status)}</span> ${clearanceBadge(s.clearance)}`,
  })));
  add('directive', 'Directives', 'Directive', dirMatch.map((d) => ({
    href: `#/directive/${d.id}`, ref: d.ref, name: esc(d.title),
    badges: `${orgTag(d.org)} ${clearanceBadge(d.clearance)}${d.status === 'rescinded' ? ' <span class="badge badge--muted">Rescinded</span>' : ''}`,
  })));

  const excluded = subjSealed + caseSealed + opSealed + srcSealed;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return { groups, excluded, total, tooShort: false };
}

function resultRow(href, type, ref, name, badges) {
  return `
    <a class="result" href="${href}">
      <span class="result__type">${esc(type)}</span>
      <span class="result__ref mono">${esc(ref)}</span>
      <span class="result__name">${name}</span>
      <span class="result__meta">${badges}</span>
      <span class="row-go">Open →</span>
    </a>`;
}

function group(title, count, rowsHTML, note) {
  return `
    <section class="search-group">
      <div class="search-group__head">${esc(title)} <span class="search-group__count">${count}</span></div>
      ${rowsHTML}
      ${note ? `<div class="search-group__note">${esc(note)}</div>` : ''}
    </section>`;
}

export function render(host, app) {
  const actor = app.user;
  const q = query.trim().toLowerCase();
  const tooShort = q.length < 2;

  const { groups, excluded, total } = tooShort
    ? { groups: [], excluded: 0, total: 0 }
    : searchRecords(actor, query);

  const groupsHTML = groups.map((g) => {
    const rows = g.items.slice(0, MAX_PER_GROUP)
      .map((it) => resultRow(it.href, g.type, it.ref, it.name, it.badges)).join('');
    return group(g.title, g.items.length, rows,
      g.items.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : '');
  }).join('');

  // One honest, persistent note: how many records the operator's access kept
  // out of the search entirely (sealed subjects, cases, operations, sources).
  const excludedNote = (!tooShort && excluded)
    ? `<div class="search-excluded">${excluded} record${excluded > 1 ? 's' : ''} outside your access ${excluded > 1 ? 'were' : 'was'} not searched.</div>`
    : '';

  const body = tooShort
    ? '<div class="search-empty">Type at least two characters to search across personnel, candidates, subjects, cases, operations, sources and directives.</div>'
    : (total
        ? groupsHTML + excludedNote
        : `<div class="search-empty">No records match your search at your clearance.</div>${excludedNote}`);

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · Search</div>
        <h1 class="page-title">Search Records</h1>
        <div class="page-sub">${tooShort ? 'All record types · results limited to your access' : `${total} result${total === 1 ? '' : 's'} for “${esc(query.trim())}”`}</div>
      </div>
    </div>

    <div class="toolbar">
      <input id="search-input" class="toolbar__search toolbar__search--wide" type="search" placeholder="Search across all records…" value="${esc(query)}" autocomplete="off" />
    </div>

    ${body}
  `;

  const input = host.querySelector('#search-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('input', () => {
    setQuery(input.value);
    render(host, app);
  });
}
