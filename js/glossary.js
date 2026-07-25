// =============================================================================
// glossary.js — the Field Guide.
//
// CAIRO is deliberately jargon-dense (clearance tiers, Need-To-Know, org
// codenames). The one-time tour walks a new operator through the app; this is
// the always-available reference for the vocabulary itself, reachable from the
// "?" in the top bar. Content is tier-aware — it never explains anything the
// viewer isn't cleared to know (the covert Internal Security note appears only
// for those who already know the unit's true colours).
// =============================================================================

import { CLEARANCES, CLEARANCE_ORDER, ORGS } from './constants.js';
import { knowsOmegaTruth, isCL5, isAdmin } from './permissions.js';
import { esc, clearanceBadge, orgTag, openModal } from './ui.js';

const term = (t, d) => `<div class="gloss__row"><div class="gloss__term">${t}</div><div class="gloss__def">${d}</div></div>`;
const toneChip = (tone, label) => `<span class="badge badge--${tone}">${esc(label)}</span>`;

export function openGlossary(app) {
  const actor = app.user;

  const clearances = CLEARANCE_ORDER.map((c) => {
    const m = CLEARANCES[c];
    return term(`${clearanceBadge(c)}`, `<strong>${esc(m.name)}</strong> — ${esc(m.blurb)}`);
  }).join('');

  // Organisations, in whatever branding this viewer sees (the ORGS getters are
  // already set for their tier, so a junior reads "Internal Enforcement" here).
  const orgs = ['omega-1', 'ethics-committee', 'command'].map((o) => {
    const org = ORGS[o];
    return term(orgTag(o), `<strong>${esc(org.name)}</strong> — ${esc(org.motto)}`);
  }).join('')
    // The covert note: only for those cleared to know (CL4-S+ / Ethics).
    + (knowsOmegaTruth(actor)
      ? term(orgTag('isd'), 'The <strong>Internal Security Department</strong> is a public-facing department. <strong>MTF Omega-1</strong> is the covert unit whose personnel masquerade as Internal Security in the field — an operator’s ISD identity and rank derive from their Omega-1 posting. That an operative is Omega-1, and not ordinary Internal Security, is visible only to the Department and Command.')
      : '');

  const staffNote = isAdmin(actor)
    ? term('<span class="badge badge--warn">Administrator</span>', 'You hold a moderation grant: you can see any record and remove or restore any post, but not Command’s other authority.')
    : '';

  const body = `
    <div class="gloss">
      <div class="gloss__head">Clearance</div>
      ${clearances}
      ${term('<span class="badge badge--warn">◈ NTK</span>', '<strong>Need-To-Know</strong> — a compartment (codeword) layered on top of clearance. Even at the right clearance, a record inside a compartment is sealed unless you are read into it.')}

      <div class="gloss__head">Organisations</div>
      ${orgs}

      <div class="gloss__head">Badges</div>
      ${term(toneChip('ok', 'Active'), 'In good standing / complete / counted.')}
      ${term(toneChip('warn', 'Attention'), 'Needs review, pending, or approaching a limit.')}
      ${term(toneChip('bad', 'Critical'), 'Blocked, at a limit, sealed above you, or refused.')}
      ${term(toneChip('info', 'Info'), 'Neutral status or an informational marker.')}
      ${term(toneChip('muted', 'Inactive'), 'Dormant, lifted, rescinded or withdrawn.')}
      ${staffNote}

      <p class="gloss__foot">Run the guided tour from the <strong>?</strong>-adjacent Tour control for a walkthrough of the interface itself.</p>
    </div>`;

  openModal({
    title: 'Field Guide',
    wide: true,
    body,
    actions: [{ label: 'Close', tone: 'primary', onClick: (c) => c() }],
  });
}
