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

function resultRow(href, type, ref, name, badges) {
  return `
    <a class="result" href="${href}">
      <span class="result__type">${esc(type)}</span>
      <span class="result__ref mono">${esc(ref)}</span>
      <span class="result__name">${name}</span>
      <span class="result__meta">${badges}</span>
      <span class="row-go">Open \u2192</span>
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

  // --- Gathering (each type bound by its own access rule) ---
  const personnel = users()
    .filter((u) => !u.deleted && u.accountStatus === 'active')
    .filter((u) => hit(q, `${u.designation} ${u.codename} ${ORGS[u.org]?.name || u.org} ${u.rank || ''}`));

  const subjAll = subjects().filter((s) => !s.deleted);
  const subjViewable = subjAll.filter((s) => canViewSubject(actor, s));
  const subjSealed = subjAll.length - subjViewable.length;
  const subjMatch = subjViewable.filter((s) => hit(q, `${s.ref} ${s.alias} ${s.lastKnownLocation || ''}`));

  const caseAll = cases().filter((c) => !c.deleted);
  const caseViewable = caseAll.filter((c) => canViewCase(actor, c));
  const caseSealed = caseAll.length - caseViewable.length;
  const caseMatch = caseViewable.filter((c) => hit(q, `${c.ref} ${c.title} ${c.summary || ''}`));

  const dirMatch = directives()
    .filter((d) => !d.deleted)
    .filter((d) => {
      const base = `${d.ref} ${d.title}`;
      const text = canReadDirective(actor, d) ? `${base} ${d.body || ''}` : base;
      return hit(q, text);
    });

  const recMatch = recruits()
    .filter((r) => !r.deleted && canViewRecruitment(actor, r))
    .filter((r) => hit(q, `${r.ref} ${r.name} ${r.department || ''}`));

  const opAll = operations().filter((o) => !o.deleted);
  const opViewable = opAll.filter((o) => canViewOperation(actor, o));
  const opSealed = opAll.length - opViewable.length;
  const opMatch = opViewable.filter((o) => hit(q, `${o.ref} ${o.name} ${o.location || ''} ${o.objective || ''}`));

  const srcAll = intel().filter((s) => !s.deleted);
  const srcViewable = srcAll.filter((s) => canViewIntel(actor, s));
  const srcSealed = srcAll.length - srcViewable.length;
  const srcMatch = srcViewable.filter((s) => hit(q, `${s.ref} ${s.codename} ${s.tasking || ''} ${s.cover || ''}`));

  const total = personnel.length + recMatch.length + subjMatch.length + caseMatch.length
    + opMatch.length + srcMatch.length + dirMatch.length;

  // --- Result groups (only for genuine matches) ---
  const groups = [];

  if (personnel.length) {
    const rows = personnel.slice(0, MAX_PER_GROUP).map((u) =>
      resultRow(`#/personnel/${u.id}`, 'Personnel', u.designation, `\u201c${esc(u.codename)}\u201d`,
        `${orgTag(u.org)} ${clearanceBadge(u.clearance)}`)).join('');
    groups.push(group('Personnel', personnel.length, rows,
      personnel.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  if (recMatch.length) {
    const rows = recMatch.slice(0, MAX_PER_GROUP).map((r) =>
      resultRow(`#/recruit/${r.id}`, 'Candidate', r.ref, esc(r.name),
        `${orgTag(r.org)} <span class="badge badge--${RECRUIT_STAGE[r.stage]?.tone || 'muted'}">${esc(RECRUIT_STAGE[r.stage]?.label || r.stage)}</span>`)).join('');
    groups.push(group('Recruitment candidates', recMatch.length, rows,
      recMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  if (subjMatch.length) {
    const rows = subjMatch.slice(0, MAX_PER_GROUP).map((s) =>
      resultRow(`#/subject/${s.id}`, 'Subject', s.ref, `\u201c${esc(s.alias)}\u201d`,
        `<span class="subj-kind subj-kind--${SUBJECT_CLASS[s.kind]?.tone || 'muted'}">${esc(SUBJECT_CLASS[s.kind]?.short || s.kind)}</span> ${orgTag(s.org)} ${clearanceBadge(s.clearance)}`)).join('');
    groups.push(group('Surveillance subjects', subjMatch.length, rows,
      subjMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  if (caseMatch.length) {
    const rows = caseMatch.slice(0, MAX_PER_GROUP).map((c) =>
      resultRow(`#/case/${c.id}`, 'Case', c.ref, esc(c.title),
        `<span class="badge badge--${CASE_STATUS[c.status]?.tone || 'muted'}">${esc(CASE_STATUS[c.status]?.label || c.status)}</span> ${clearanceBadge(c.clearance)}`)).join('');
    groups.push(group('Tribunal cases', caseMatch.length, rows,
      caseMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  if (opMatch.length) {
    const rows = opMatch.slice(0, MAX_PER_GROUP).map((o) =>
      resultRow(`#/operation/${o.id}`, 'Operation', o.ref, esc(o.name),
        `<span class="badge badge--${OPERATION_KIND[o.kind]?.tone || 'muted'}">${esc(OPERATION_KIND[o.kind]?.label || o.kind)}</span> <span class="badge badge--${OPERATION_STATUS[o.status]?.tone || 'muted'}">${esc(OPERATION_STATUS[o.status]?.label || o.status)}</span> ${clearanceBadge(o.clearance)}`)).join('');
    groups.push(group('Operations', opMatch.length, rows,
      opMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  if (srcMatch.length) {
    const rows = srcMatch.slice(0, MAX_PER_GROUP).map((s) =>
      resultRow(`#/source/${s.id}`, 'Source', s.ref, `\u201c${esc(s.codename)}\u201d`,
        `<span class="badge badge--${INTEL_SOURCE_TYPE[s.type]?.tone || 'muted'}">${esc(INTEL_SOURCE_TYPE[s.type]?.label || s.type)}</span> <span class="badge badge--${INTEL_STATUS[s.status]?.tone || 'muted'}">${esc(INTEL_STATUS[s.status]?.label || s.status)}</span> ${clearanceBadge(s.clearance)}`)).join('');
    groups.push(group('Intelligence sources', srcMatch.length, rows,
      srcMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  if (dirMatch.length) {
    const rows = dirMatch.slice(0, MAX_PER_GROUP).map((d) =>
      resultRow(`#/directive/${d.id}`, 'Directive', d.ref, esc(d.title),
        `${orgTag(d.org)} ${clearanceBadge(d.clearance)}${d.status === 'rescinded' ? ' <span class="badge badge--muted">Rescinded</span>' : ''}`)).join('');
    groups.push(group('Directives', dirMatch.length, rows,
      dirMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  // One honest, persistent note: how many records the operator's access kept
  // out of the search entirely (sealed subjects, cases, operations, sources).
  const tooShort = q.length < 2;
  const excluded = subjSealed + caseSealed + opSealed + srcSealed;
  const excludedNote = (!tooShort && excluded)
    ? `<div class="search-excluded">${excluded} record${excluded > 1 ? 's' : ''} outside your access ${excluded > 1 ? 'were' : 'was'} not searched.</div>`
    : '';

  const body = tooShort
    ? '<div class="search-empty">Type at least two characters to search across personnel, candidates, subjects, cases, operations, sources and directives.</div>'
    : (total
        ? groups.join('') + excludedNote
        : `<div class="search-empty">No records match your search at your clearance.</div>${excludedNote}`);

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO \u00b7 Search</div>
        <h1 class="page-title">Search Records</h1>
        <div class="page-sub">${tooShort ? 'All record types \u00b7 results limited to your access' : `${total} result${total === 1 ? '' : 's'} for \u201c${esc(query.trim())}\u201d`}</div>
      </div>
    </div>

    <div class="toolbar">
      <input id="search-input" class="toolbar__search toolbar__search--wide" type="search" placeholder="Search across all records\u2026" value="${esc(query)}" autocomplete="off" />
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
