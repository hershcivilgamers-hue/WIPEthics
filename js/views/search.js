// =============================================================================
// views/search.js — Organisation-wide search.
//
// One query across personnel, surveillance subjects, tribunal cases and
// directives. Search is bound by the same access rules as everything else, so
// it can never be used to discover something the operator cannot already reach:
//   • personnel are matched only on always-visible identity (designation,
//     codename, organisation, rank) — never on redactable fields;
//   • subjects and cases above the operator's clearance are excluded entirely
//     (a sealed record cannot be matched on content it hides);
//   • a directive is matched on its body ONLY when the operator is cleared to
//     read that body — otherwise only its open reference and subject.
// Opening any result routes to its detail view, where the gate is enforced
// again as defence in depth.
// =============================================================================

import { users, subjects, cases, directives } from '../storage.js';
import { canViewSubject, canViewCase, canReadDirective } from '../permissions.js';
import { CASE_KIND, CASE_STATUS, SUBJECT_CLASS, ORGS } from '../constants.js';
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

  const total = personnel.length + subjMatch.length + caseMatch.length + dirMatch.length;

  // --- Result groups (only for genuine matches) ---
  const groups = [];

  if (personnel.length) {
    const rows = personnel.slice(0, MAX_PER_GROUP).map((u) =>
      resultRow(`#/personnel/${u.id}`, 'Personnel', u.designation, `\u201c${esc(u.codename)}\u201d`,
        `${orgTag(u.org)} ${clearanceBadge(u.clearance)}`)).join('');
    groups.push(group('Personnel', personnel.length, rows,
      personnel.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
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

  if (dirMatch.length) {
    const rows = dirMatch.slice(0, MAX_PER_GROUP).map((d) =>
      resultRow(`#/directive/${d.id}`, 'Directive', d.ref, esc(d.title),
        `${orgTag(d.org)} ${clearanceBadge(d.clearance)}${d.status === 'rescinded' ? ' <span class="badge badge--muted">Rescinded</span>' : ''}`)).join('');
    groups.push(group('Directives', dirMatch.length, rows,
      dirMatch.length > MAX_PER_GROUP ? `Showing the first ${MAX_PER_GROUP}.` : ''));
  }

  // One honest, persistent note: how many records the operator's clearance
  // kept out of the search entirely (sealed subjects and cases).
  const tooShort = q.length < 2;
  const excluded = subjSealed + caseSealed;
  const excludedNote = (!tooShort && excluded)
    ? `<div class="search-excluded">${excluded} record${excluded > 1 ? 's' : ''} above your clearance ${excluded > 1 ? 'were' : 'was'} not searched.</div>`
    : '';

  const body = tooShort
    ? '<div class="search-empty">Type at least two characters to search across personnel, subjects, cases and directives.</div>'
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
