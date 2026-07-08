// =============================================================================
// tutorial.js — First-sign-in guided tour.
//
// On an operator's first sign-in (per browser) they are OFFERED a short tour:
// a spotlight walkthrough of the sidebar, one step per area. Because the
// sidebar is already filtered by clearance, feature flags and route guards,
// the tour automatically covers exactly what THIS operator can access — a CL3
// operative gets a short tour, a CL5 sees the administrative tooling too.
//
// The offer is opt-out: "Don't show again" (or completing/skipping the tour)
// records a flag in localStorage keyed by operator id, so it never nags. It
// can be re-run at any time from the Tour button in the top bar.
// =============================================================================

import { ORGS, CLEARANCES } from './constants.js';
import { esc, openModal } from './ui.js';

// --- Persistence (per browser, per operator) ---------------------------------
const KEY_PREFIX = 'cairo.tour.';
export const tourKey = (userId) => `${KEY_PREFIX}${userId}`;
export function tourState(userId) {
  try { return localStorage.getItem(tourKey(userId)); } catch (_) { return null; }
}
export function setTourState(userId, state) {
  try { localStorage.setItem(tourKey(userId), state); } catch (_) { /* private mode */ }
}

// --- Step definitions ---------------------------------------------------------
// One entry per sidebar destination. Only entries whose link actually exists in
// the rendered sidebar become steps. `minor` entries are shed first if a highly
// cleared operator's tour would run too long.
const STEP_DEFS = [
  { hash: '#/overview',           title: 'Command Overview',    body: 'The live summary: roster strength, operators at the strike limit, open matters and recent activity across the site.' },
  { hash: '#/notifications',      title: 'For Your Attention',  body: 'Summonses, orders awaiting your acknowledgement, and anything else addressed to you lands here.' },
  { hash: '#/search',             title: 'Search',              body: 'Find any record you are cleared to see \u2014 personnel, subjects, cases, orders.', minor: true },
  { hash: '#/surveillance',       title: 'Surveillance',        body: 'Persons of Interest and Targets. Closing a POI records an outcome; a Target is a termination authorisation and requires Ethics Committee sign-off.' },
  { hash: '#/compartments',       title: 'Need-To-Know',        body: 'Sealed compartments. Even high clearance does not open these \u2014 you must be read in by name.' },
  { hash: '#/operations',         title: 'Readiness',           body: 'Activity requirements and duty status for tracked personnel, with strike flags. Log your hours from here or the Situation Board.' },
  { hash: '#/trainings',          title: 'Trainings',           body: 'The training registry: courses, completions and currency.', minor: true },
  { hash: '#/directives',         title: 'Standing Orders',     body: 'Formal directives by department, with acknowledgement tracking and document export.' },
  { hash: '#/activity',           title: 'Activity Log',        body: 'The site-wide audit trail. What you can see of it follows your clearance.', minor: true },
  { hash: '#/blacklist',          title: 'Blacklist',           body: 'The cross-department barred/hostile register. External department sheets stay hidden until you search a SteamID.' },
  { hash: '#/dashboard',          title: 'Situation Board',     body: 'At-a-glance status tiles and quick actions.', minor: true },
  { hash: '#/omega-1',            title: 'MTF \u03a9-1 Personnel',   body: 'Omega-1 personnel files: ranks, clearances, strikes, medals, tags and service history.' },
  { hash: '#/omega-1/recruitment', title: '\u03a9-1 Recruitment',    body: 'Applications to the Task Force, with panel voting.', minor: true },
  { hash: '#/deployments',        title: 'Deployment Log',      body: 'Operations and after-action records.', minor: true },
  { hash: '#/intel',              title: 'Intelligence',        body: 'Sources and field reports.', minor: true },
  { hash: '#/docket',             title: 'Docket Board',        body: 'Open matters across the site at a glance.', minor: true },
  { hash: '#/ethics',             title: 'Ethics Personnel',    body: 'Ethics Committee personnel files.' },
  { hash: '#/tribunals',          title: 'Case Docket',         body: 'Inquiries, reviews and tribunals. Deliberative matters carry a Record of the Vote; determinations export as formal documents.' },
  { hash: '#/ethics/recruitment', title: 'Assistant Applications', body: 'Applications to the Ethics Committee \u2014 intake is at Assistant.', minor: true },
  { hash: '#/command',            title: 'Site Command',        body: 'Command personnel files.', minor: true },
  { hash: '#/admin',              title: 'Administration',      body: 'Registrations (with bulk approval), personnel tags, the medals catalogue, activity requirements and the recycle bin.' },
];

const MAX_NAV_STEPS = 12;

// Build the step list for an operator. `has(hash)` reports whether that link is
// present in their sidebar; injected for testability.
export function buildSteps(user, has) {
  let nav = STEP_DEFS.filter((d) => has(d.hash));
  if (nav.length > MAX_NAV_STEPS) nav = nav.filter((d) => !d.minor);
  if (nav.length > MAX_NAV_STEPS) nav = nav.slice(0, MAX_NAV_STEPS);
  const orgName = (ORGS[user?.org] || {}).name || 'the Foundation';
  const clr = (CLEARANCES[user?.clearance] || {}).label || user?.clearance || '';
  return [
    {
      target: null,
      title: 'Welcome to CAIRO.AIC',
      body: `You are signed in as <strong>${esc(user?.designation || '')} \u00b7 ${esc(user?.codename || '')}</strong> \u2014 ${esc(clr)}, ${esc(orgName)}. This short tour points out the areas your clearance opens. Use Next to continue, or Skip at any time.`,
      html: true,
    },
    ...nav.map((d) => ({ target: `.sidebar a[href="${d.hash}"]`, title: d.title, body: d.body })),
    {
      target: null,
      title: 'You\u2019re set',
      body: 'Most records export as formal documents from their own page, and actions are recorded to the audit trail. You can re-run this tour any time from the Tour button in the top bar.',
    },
  ];
}

// --- Offer on first sign-in ----------------------------------------------------
let offeredThisSession = false;

export function maybeOfferTutorial(app) {
  const user = app.user;
  if (!user || offeredThisSession) return;
  if (tourState(user.id)) return; // completed or opted out previously
  offeredThisSession = true;
  // Let the shell paint before putting a dialog over it.
  window.setTimeout(() => offerTour(app), 500);
}

function offerTour(app) {
  const user = app.user;
  if (!user) return;
  openModal({
    title: 'First time here?',
    body: `<p class="modal__message">Take a two-minute tour of the areas your clearance opens \u2014 where the files live and what each board is for.</p>
           <p class="field__hint">You can re-run it later from the <strong>Tour</strong> button in the top bar.</p>`,
    actions: [
      { label: 'Don\u2019t show again', tone: 'ghost', onClick: (c) => { setTourState(user.id, 'dismissed'); c(); } },
      { label: 'Not now', tone: 'ghost', onClick: (c) => c() },
      { label: 'Start tour', tone: 'primary', onClick: (c) => { c(); startTutorial(app); } },
    ],
  });
}

// --- The tour itself ------------------------------------------------------------
export function startTutorial(app) {
  const user = app.user;
  if (!user) return;
  const has = (hash) => !!document.querySelector(`.sidebar a[href="${hash}"]`);
  const steps = buildSteps(user, has);
  runTour(steps, () => setTourState(user.id, 'done'));
}

function runTour(steps, onEnd) {
  // Overlay scaffolding. The spotlight's huge box-shadow provides the dimming;
  // the backdrop just absorbs clicks so the page beneath is inert.
  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  const spot = document.createElement('div');
  spot.className = 'tour-spotlight';
  const card = document.createElement('div');
  card.className = 'tour-card';
  document.body.appendChild(backdrop);
  document.body.appendChild(spot);
  document.body.appendChild(card);

  let i = 0;
  let ended = false;

  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', onKey);
    backdrop.remove(); spot.remove(); card.remove();
    if (onEnd) onEnd();
  };

  const currentTarget = () => {
    const sel = steps[i].target;
    if (!sel) return null;
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? el : null;
  };

  const positionAround = (el) => {
    const pad = 6;
    const r = el.getBoundingClientRect();
    spot.style.left = `${r.left - pad}px`;
    spot.style.top = `${r.top - pad}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${r.height + pad * 2}px`;
    // Card: prefer beside the target (right), else below, clamped to viewport.
    const cw = Math.min(360, window.innerWidth - 24);
    card.style.maxWidth = `${cw}px`;
    const ch = card.offsetHeight || 180;
    let left = r.right + 16;
    let top = r.top;
    if (left + cw > window.innerWidth - 12) { left = Math.max(12, Math.min(r.left, window.innerWidth - cw - 12)); top = r.bottom + 12; }
    if (top + ch > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ch - 12);
    card.style.left = `${left}px`;
    card.style.top = `${Math.max(12, top)}px`;
    card.style.transform = 'none';
  };

  const positionCentered = () => {
    spot.style.left = '50%'; spot.style.top = '38%';
    spot.style.width = '0px'; spot.style.height = '0px';
    card.style.left = '50%'; card.style.top = '42%';
    card.style.transform = 'translate(-50%, -50%)';
    card.style.maxWidth = `${Math.min(400, window.innerWidth - 24)}px`;
  };

  const reposition = () => {
    const el = currentTarget();
    if (el) positionAround(el); else positionCentered();
  };

  const show = () => {
    const step = steps[i];
    const el = currentTarget();
    const last = i === steps.length - 1;
    card.innerHTML = `
      <div class="tour-card__count mono">${i + 1} / ${steps.length}</div>
      <div class="tour-card__title">${esc(step.title)}</div>
      <div class="tour-card__body">${step.html ? step.body : esc(step.body)}</div>
      <div class="tour-card__actions">
        <button class="btn btn--ghost btn--sm" data-tour="skip">Skip tour</button>
        <span class="tour-card__spacer"></span>
        ${i > 0 ? '<button class="btn btn--sm" data-tour="back">Back</button>' : ''}
        <button class="btn btn--primary btn--sm" data-tour="next">${last ? 'Finish' : 'Next'}</button>
      </div>`;
    card.querySelector('[data-tour="skip"]').addEventListener('click', end);
    const back = card.querySelector('[data-tour="back"]');
    if (back) back.addEventListener('click', () => { i -= 1; show(); });
    card.querySelector('[data-tour="next"]').addEventListener('click', () => {
      if (last) { end(); return; }
      i += 1; show();
    });
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    reposition();
    // Measure-once-more after paint so the card height is accounted for.
    window.requestAnimationFrame ? requestAnimationFrame(reposition) : reposition();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight') { if (i < steps.length - 1) { i += 1; show(); } else end(); }
    else if (e.key === 'ArrowLeft' && i > 0) { i -= 1; show(); }
  };

  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  document.addEventListener('keydown', onKey);
  show();
}
