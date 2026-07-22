// =============================================================================
// topbar-search.js — "search as you type" under the top-bar search box.
//
// Typing shows a compact dropdown of the top few hits per record type, right
// under the search box — an entire page isn't needed to find a thread. It reuses
// searchRecords() (the SAME access-filtered index as the full Search view and
// the ⌘K palette), so it can never surface a record the operator cannot open.
// The full Search page remains the "see all" destination, reached by the footer
// row or by pressing Enter with nothing highlighted.
// =============================================================================

import { searchRecords, setQuery as setSearchQuery } from './views/search.js';
import { esc } from './ui.js';

const PER_GROUP = 4; // a tight preview; the full Search view shows the rest

export function attachTopbarSearch(input, app) {
  if (!input || !app || !app.user) return;
  const box = input.closest('.topbar__search-box') || input.parentElement;
  if (!box) return;

  const panel = document.createElement('div');
  panel.className = 'topbar__results';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  box.appendChild(panel);

  let flat = [];  // navigable rows: { href } for a record, { seeAll:true } for the footer
  let sel = -1;   // -1 = nothing highlighted → Enter falls through to the full Search page
  let open = false;

  const goFull = () => { setSearchQuery(input.value); hide(); app.navigate('#/search'); };
  const show = () => { panel.hidden = false; open = true; input.setAttribute('aria-expanded', 'true'); };
  function hide() { panel.hidden = true; open = false; sel = -1; input.setAttribute('aria-expanded', 'false'); }

  function row(idx, ref, name, badges) {
    return `<div class="cmdk__item cmdk__item--record" role="option" data-idx="${idx}">`
      + `<span class="cmdk__text"><span class="cmdk__ref">${esc(ref)}</span> <span class="cmdk__name">${name || ''}</span></span>`
      + `<span class="cmdk__meta">${badges || ''}</span></div>`;
  }

  function render() {
    const q = input.value.trim();
    if (q.length < 2) { hide(); return; }
    const { groups, total } = searchRecords(app.user, q);
    flat = [];
    let html = '';
    if (!total) {
      html = `<div class="cmdk__empty">No records match “${esc(q)}” at your clearance.</div>`;
    } else {
      for (const g of groups) {
        html += `<div class="cmdk__group">${esc(g.title)} <span class="search-group__count">${g.items.length}</span></div>`;
        for (const it of g.items.slice(0, PER_GROUP)) {
          const idx = flat.length; flat.push({ href: it.href });
          html += row(idx, it.ref, it.name, it.badges);
        }
      }
    }
    const seeIdx = flat.length; flat.push({ seeAll: true });
    html += `<div class="cmdk__item cmdk__item--action topbar__results-foot" role="option" data-idx="${seeIdx}">`
      + `<span class="cmdk__text">${total ? `See all results for “${esc(q)}”` : `Search all records for “${esc(q)}”`}</span>`
      + `<span class="cmdk__meta">${total ? `${total} total` : ''}</span></div>`;
    panel.innerHTML = html;
    show();
    if (sel >= flat.length) sel = -1;
    paint();
  }

  function paint() {
    [...panel.querySelectorAll('.cmdk__item')].forEach((el) => {
      const on = Number(el.dataset.idx) === sel;
      el.classList.toggle('cmdk__item--active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  }

  const activate = (idx) => {
    const it = flat[idx]; if (!it) return;
    if (it.seeAll) { goFull(); return; }
    hide();
    app.navigate(it.href);
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');

  input.addEventListener('input', () => { sel = -1; render(); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) render(); if (flat.length) { sel = (sel + 1) % flat.length; paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) { sel = (sel - 1 + flat.length) % flat.length; paint(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && sel >= 0) activate(sel); else goFull(); }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); hide(); } }
  });
  panel.addEventListener('mousemove', (e) => {
    const r = e.target.closest('.cmdk__item'); if (!r) return;
    const i = Number(r.dataset.idx); if (i !== sel) { sel = i; paint(); }
  });
  // mousedown (not click) so it lands before the input's blur hides the panel.
  panel.addEventListener('mousedown', (e) => {
    const r = e.target.closest('.cmdk__item'); if (!r) return;
    e.preventDefault();
    activate(Number(r.dataset.idx));
  });
  // Clicking away blurs the input; a short delay lets a result mousedown win.
  input.addEventListener('blur', () => setTimeout(hide, 120));
}
