// =============================================================================
// export.js — Formal document generation.
//
// Renders records as self-contained, print-ready documents modelled on real
// paperwork: a tribunal case as a court-style judgment (caption, parties,
// numbered paragraphs, signature block), a directive as a memorandum, and
// personnel / surveillance files as official records. Shared chrome (frameDoc)
// supplies the page, classification marking, typography and print rules.
//
// Every document reflects ONLY what the exporting operator is cleared to see:
//   • a cited subject above the reader's clearance is shown as a sealed record;
//   • a personnel file honours the same redaction as the on-screen dossier;
//   • a directive body above the reader's clearance is withheld, not leaked.
// Export can never become a disclosure side-channel.
// =============================================================================

import { getUser, getSubject } from './storage.js';
import { CONFIG } from './config.js';
import { orgLogo } from './logos.js';
import {
  OPERATION_KIND, OPERATION_STATUS, OPERATION_RESULT, OP_LOG_TYPE,
  INTEL_SOURCE_TYPE, INTEL_STATUS, INTEL_RELIABILITY, INTEL_CREDIBILITY,
} from './constants.js';
import { canViewSubject, accessLevel, canReadDirective } from './permissions.js';
import { logAction } from './audit.js';
import {
  CASE_KIND, CASE_STATUS, RULING_FINDING, CLEARANCES, ORGS, STATUSES,
  SUBJECT_CLASS, THREAT_LEVELS, SUBJECT_STATUS, STRIKE_LIMIT, strikeActive, activeStrikeCount,
  CASE_VOTE, tallyCaseVotes, caseTakesVote,
} from './constants.js';
import { esc, toast } from './ui.js';
import { interviewSetFor, INTERVIEW_GRADE, INTERVIEW_RECOMMENDATION } from './interview-bank.js';

// --- Helpers ----------------------------------------------------------------
function longDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'long' })} ${d.getFullYear()}`;
}
function longDateTime(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  const t = d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${longDate(iso)} at ${t}`;
}
function personRef(id, fallback) {
  const u = getUser(id);
  if (!u) return esc(fallback || '\u2014');
  return `${esc(u.designation)} \u201c${esc(u.codename)}\u201d`;
}
// Split free text into justified paragraphs.
function paras(text) {
  const parts = String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '<p class="muted">\u2014</p>';
  return parts.map((p) => `<p>${esc(p)}</p>`).join('');
}

const REDACTED = '<span class="redacted">[ REDACTED ]</span>';
const clrLabel = (code) => CLEARANCES[code]?.label || code;
// SCP-style classification marking. Leads with the clearance level and its
// classic secrecy tier (as real markings lead with the classification), then the
// document class, then a dissemination caveat that escalates with the level.
const CLEARANCE_MARK = {
  'CL3':   { tier: 'LEVEL 3 \u00b7 SECRET',     caveat: 'RESTRICTED DISSEMINATION' },
  'CL4-J': { tier: 'LEVEL 4 \u00b7 TOP SECRET', caveat: 'FOUNDATION EYES ONLY' },
  'CL4-S': { tier: 'LEVEL 4 \u00b7 TOP SECRET', caveat: 'FOUNDATION EYES ONLY' },
  'CL5':   { tier: 'LEVEL 5 \u00b7 THAUMIEL',   caveat: 'FOUNDATION COMMAND' },
};
const DOC_CLASS = {
  Personnel: 'PERSONNEL DOSSIER',
  'Ethics Committee': 'ETHICS COMMITTEE PROCEEDING',
  Surveillance: 'ANOMALY SURVEILLANCE FILE',
  Intelligence: 'INTELLIGENCE PRODUCT',
  Operations: 'OPERATIONAL ORDER',
  Directive: 'STANDING DIRECTIVE',
  Document: 'OFFICIAL RECORD',
};
const banner = (code, category) => {
  const m = CLEARANCE_MARK[code] || { tier: clrLabel(code).toUpperCase(), caveat: 'RESTRICTED' };
  const cls = DOC_CLASS[category] || String(category).toUpperCase();
  return `${m.tier} // ${cls} // ${m.caveat}`;
};

// Classification band colour by level, per the Document System design language:
// L2 teal, L3 slate, L4 registry gold, L5 oxblood. Derived from the marking
// text so every builder gets it automatically; unlevelled records stay unbanded.
function classBand(classification) {
  if (/\bLEVEL 5\b/.test(classification)) return 'classbar--l5';
  if (/\bLEVEL 4\b/.test(classification)) return 'classbar--l4';
  if (/\bLEVEL 3\b/.test(classification)) return 'classbar--l3';
  if (/\bLEVEL 2\b/.test(classification)) return 'classbar--l2';
  return '';
}

function authorityBody(orgKey) {
  if (orgKey === 'ethics-committee') return 'Ethics Committee';
  if (orgKey === 'omega-1') return 'Mobile Task Force Omega-1';
  if (orgKey === 'command') return 'Site Command';
  return 'Office of Record';
}

// The original CAIRO sigil, inked small for a letterhead.
const SEAL = `
  <svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="32" cy="32" r="6" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="2" fill="none">
      <path d="M32 6 L32 20"/><path d="M53 44 L40 36"/><path d="M11 44 L24 36"/>
      <path d="M32 6 A26 26 0 0 1 53 44" opacity=".5"/>
      <path d="M53 44 A26 26 0 0 1 11 44" opacity=".5"/>
      <path d="M11 44 A26 26 0 0 1 32 6" opacity=".5"/>
    </g>
  </svg>`;

// ---------------------------------------------------------------------------
// ORGANISATION SEALS — original emblems drawn for this application (no wiki
// art is reproduced, so no third-party licence attaches to them). Engraved
// line-work in the document ink, inline SVG so exports stay single-file and
// print cleanly.
//   • Omega-1 — a heater shield bearing Ω above a balance, crossed batons
//     behind: the Committee's enforcement arm. Ribbon: LAW'S LEFT HAND.
//   • Ethics Committee — the balance beneath an open eye, framed in laurel:
//     oversight and conscience. Ribbon: IN CONSCIENCE BOUND.
// Site Command keeps the Foundation's plain mark above.
// ---------------------------------------------------------------------------
const SEAL_PAPER = '#ffffff';

function sealSvg({ id, top, topSize, banner, motif }) {
  return `
  <svg viewBox="0 0 120 120" width="86" height="86" aria-hidden="true">
    <defs><path id="arc-${id}" d="M 12,60 A 48,48 0 0 1 108,60"/></defs>
    <circle cx="60" cy="60" r="57" fill="${SEAL_PAPER}" stroke="currentColor" stroke-width="2.6"/>
    <circle cx="60" cy="60" r="43.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <text font-family="Georgia, 'Times New Roman', serif" font-size="${topSize}" letter-spacing="1.4" fill="currentColor">
      <textPath href="#arc-${id}" startOffset="50%" text-anchor="middle">\u2726 ${top} \u2726</textPath>
    </text>
    ${motif}
    <path d="M 22,83 L 98,83 L 103,88.5 L 98,94 L 22,94 L 17,88.5 Z" fill="${SEAL_PAPER}" stroke="currentColor" stroke-width="1.4"/>
    <text x="60" y="91.6" font-family="Georgia, 'Times New Roman', serif" font-size="6.2" letter-spacing="1" text-anchor="middle" fill="currentColor">${banner}</text>
  </svg>`;
}

const OMEGA_MOTIF = `
    <g stroke="currentColor" fill="none" stroke-linecap="round">
      <path d="M 33,80 L 87,26" stroke-width="4"/>
      <path d="M 33,26 L 87,80" stroke-width="4"/>
      <circle cx="33" cy="80" r="3" fill="currentColor" stroke="none"/>
      <circle cx="87" cy="80" r="3" fill="currentColor" stroke="none"/>
      <circle cx="33" cy="26" r="3" fill="currentColor" stroke="none"/>
      <circle cx="87" cy="26" r="3" fill="currentColor" stroke="none"/>
    </g>
    <path d="M 60,22 C 71,22 80,25 80,25 L 80,52 C 80,66 71,74 60,79 C 49,74 40,66 40,52 L 40,25 C 40,25 49,22 60,22 Z"
          fill="${SEAL_PAPER}" stroke="currentColor" stroke-width="2.4"/>
    <text x="60" y="53" font-family="Georgia, 'Times New Roman', serif" font-weight="bold" font-size="30" text-anchor="middle" fill="currentColor">\u03a9</text>
    <g stroke="currentColor" stroke-width="1.7" fill="none">
      <path d="M 60,56 L 60,62"/>
      <path d="M 47,62 L 73,62"/>
      <path d="M 47,62 L 43,69 M 47,62 L 51,69"/>
      <path d="M 41,69 Q 47,73.5 53,69"/>
      <path d="M 73,62 L 69,69 M 73,62 L 77,69"/>
      <path d="M 67,69 Q 73,73.5 79,69"/>
      <circle cx="60" cy="62" r="1.5" fill="currentColor" stroke="none"/>
    </g>`;

const ETHICS_MOTIF = `
    <g stroke="currentColor" fill="none" stroke-width="2">
      <path d="M 45,33 Q 60,23.5 75,33 Q 60,42.5 45,33 Z"/>
      <circle cx="60" cy="33" r="4.4" fill="currentColor" stroke="none"/>
      <path d="M 60,45 L 60,72" stroke-width="2.4"/>
      <path d="M 52,74 L 68,74" stroke-width="2.4"/>
      <path d="M 33,50 L 87,50" stroke-width="2.4"/>
      <path d="M 56,50 L 60,44 L 64,50 Z" fill="currentColor" stroke="none"/>
      <circle cx="33" cy="50" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="87" cy="50" r="1.8" fill="currentColor" stroke="none"/>
      <path d="M 33,50 L 27,62 M 33,50 L 39,62"/>
      <path d="M 25,62 Q 33,68.5 41,62"/>
      <path d="M 87,50 L 81,62 M 87,50 L 93,62"/>
      <path d="M 79,62 Q 87,68.5 95,62"/>
    </g>
    <g fill="currentColor" stroke="none">
      <ellipse cx="30" cy="71" rx="3.4" ry="1.5" transform="rotate(-62 30 71)"/>
      <ellipse cx="26.5" cy="62" rx="3.4" ry="1.5" transform="rotate(-78 26.5 62)"/>
      <ellipse cx="25.5" cy="52.5" rx="3.4" ry="1.5" transform="rotate(-94 25.5 52.5)"/>
      <ellipse cx="27.5" cy="43" rx="3.4" ry="1.5" transform="rotate(-112 27.5 43)"/>
      <ellipse cx="90" cy="71" rx="3.4" ry="1.5" transform="rotate(62 90 71)"/>
      <ellipse cx="93.5" cy="62" rx="3.4" ry="1.5" transform="rotate(78 93.5 62)"/>
      <ellipse cx="94.5" cy="52.5" rx="3.4" ry="1.5" transform="rotate(94 94.5 52.5)"/>
      <ellipse cx="92.5" cy="43" rx="3.4" ry="1.5" transform="rotate(112 92.5 43)"/>
    </g>
    <g stroke="currentColor" stroke-width="1.6" fill="none">
      <path d="M 32,76 Q 22,58 30,40"/>
      <path d="M 88,76 Q 98,58 90,40"/>
    </g>`;


export function orgSeal(orgKey) {
  const logo = orgLogo(orgKey);
  if (logo) return `<img src="${logo}" alt="" width="64" height="64" style="display:block;object-fit:contain;" />`;
  return SEAL;
}

// The formal authority line for a letterhead. Omega-1 carries its epithet in
// the canonical style; the Committee and Command stand on their names.
function authorityLine(orgKey) {
  if (orgKey === 'omega-1') return `MOBILE TASK FORCE OMEGA-1 \u00b7 \u201c${(ORGS['omega-1'].motto || '').toUpperCase()}\u201d`;
  if (orgKey === 'ethics-committee') return 'THE ETHICS COMMITTEE';
  if (orgKey === 'command') return 'SITE COMMAND';
  return 'OFFICE OF RECORD';
}

function defaultDistribution(orgKey) {
  if (orgKey === 'omega-1') return 'All Mobile Task Force Omega-1 personnel cleared to the marked level.';
  if (orgKey === 'ethics-committee') return 'Members and designated staff of the Ethics Committee.';
  if (orgKey === 'command') return 'Site Command staff.';
  return 'Named recipients only.';
}

// Signature block with the records-system electronic notation. `name` may carry
// markup (personRef); callers escape plain strings themselves.
function signBlock({ name, role, dated }) {
  return `<div class="sign">
      <div class="sign__line"></div>
      <div class="sign__name">${name}</div>
      <div class="sign__role">${esc(role)}</div>
      <div class="sig-e">//SIGNED ELECTRONICALLY \u2014 CAIRO.AIC RECORDS//</div>
      ${dated ? `<div class="sign__date">${esc(dated)}</div>` : ''}
    </div>`;
}

// The letterhead proper: seal, issuing authority and office over a heavy rule.
// The thin `<hr class="rule">` every builder places immediately after completes
// the classic thick-over-thin double rule of institutional stationery.
function letterhead(orgKey, office) {
  return `<div class="lh">
    <div class="lh__seal">${orgSeal(orgKey)}</div>
    <div class="lh__stack">
      <div class="lh__org">SCP Foundation</div>
      <div class="lh__body">${authorityLine(orgKey)}</div>
      <div class="lh__office">${esc(office)} · ${esc(CONFIG.facility)}</div>
    </div>
    <div class="lh__spacer"></div>
  </div>`;
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #2a2d30; }
  body { font-family: 'IBM Plex Serif', Georgia, 'Times New Roman', serif; color: #1a1e21; font-size: 12pt; line-height: 1.6; }

  .controls { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #12161a; box-shadow: 0 1px 8px rgba(0,0,0,.5); }
  .controls button { font-family: 'IBM Plex Sans', Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 600; padding: 8px 18px; border: 1px solid #c8a24b; background: #c8a24b; color: #0a0c0d; border-radius: 3px; cursor: pointer; transition: background .16s, transform .1s; }
  .controls button:hover { background: #d8b45e; }
  .controls button:active { transform: translateY(1px); }
  .controls .ghost { background: transparent; color: #b9b7ac; border-color: #3b4247; }
  .controls .ghost:hover { background: transparent; color: #e8e4d9; border-color: #c8a24b; }

  .sheet { background: #fbfaf6; max-width: 830px; margin: 26px auto; box-shadow: 0 30px 70px -40px #000; }
  .pad { padding: 48px 66px 40px; position: relative; }
  .pad > *:not(.wm) { position: relative; z-index: 1; }

  /* Crest watermark behind the record — ~5% ink */
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; opacity: .05; z-index: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wm img { width: 430px; max-width: 68%; }

  /* Classification banners — colour-coded by level; first thing a reader sees.
     L2 teal · L3 slate · L4 registry gold · L5 oxblood. */
  .classbar { text-align: center; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600; letter-spacing: .16em; font-size: 8.5pt; color: #1a1e21; text-transform: uppercase; padding: 5px 0; border: 1px solid #d8d2c4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .classbar--top { margin-bottom: 16px; }
  .classbar--bottom { margin-top: 22px; }
  .classbar--l2 { background: #e3eaec; color: #2f5560; border-color: #c4d2d6; }
  .classbar--l3 { background: #3a3f43; color: #fbfaf6; border-color: #3a3f43; }
  .classbar--l4 { background: #8a6d2b; color: #fbfaf6; border-color: #8a6d2b; }
  .classbar--l5 { background: #7a2b2b; color: #fbfaf6; border-color: #7a2b2b; }
  .classbar--expunged { background: #1a1e21; color: #c96a6a; border-color: #1a1e21; }

  /* Letterhead — thick rule here + the builder's thin hr = double rule */
  .lh { display: flex; align-items: center; gap: 16px; color: #1a1e21; margin-top: 6px; border-bottom: 2.5px solid #1a1e21; padding-bottom: 12px; }
  .lh__seal { flex: 0 0 64px; }
  .lh__spacer { flex: 0 0 64px; }
  .lh__stack { flex: 1; text-align: center; min-width: 0; }
  .lh__org { font-family: 'IBM Plex Serif', Georgia, serif; font-weight: 700; font-size: 10pt; letter-spacing: .30em; text-transform: uppercase; color: #1a1e21; white-space: nowrap; }
  .lh__body { font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 15pt; letter-spacing: .10em; text-transform: uppercase; font-weight: 700; margin-top: 4px; white-space: nowrap; color: #8a6d2b; }
  .lh__office { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: #5a5f63; margin-top: 5px; white-space: nowrap; }

  hr.rule { border: none; border-top: 1px solid #1a1e21; margin: 12px 0; }
  hr.rule--bold { border: none; border-top: 2.5px solid #1a1e21; margin: 5px 0; }
  /* The thin half of the letterhead's double rule sits close under the thick. */
  .lh + hr.rule { margin: 3px 0 16px; }

  p { margin: 0 0 11px; text-align: justify; color: #2a2e31; }
  .muted { color: #7a7f83; font-style: italic; }

  /* Court caption (record of proceedings) */
  .court { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; font-size: 13pt; margin-top: 6px; }
  .matter { text-align: center; font-style: italic; margin: 10px auto 0; max-width: 86%; font-size: 11.5pt; color: #2a2e31; }
  .caseno { text-align: center; margin-top: 6px; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 10.5pt; letter-spacing: .04em; }
  .parties { margin: 18px auto 6px; max-width: 78%; }
  .party { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; gap: 16px; }
  .party .pname { font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
  .party .role { font-style: italic; color: #5a5f63; white-space: nowrap; }
  .vs { text-align: center; font-style: italic; margin: 4px 0; color: #5a5f63; }
  /* Document title — Serif, title-case. Section heads (jhead/so) stay Sans. */
  .doc-title, .memo-title { text-align: center; font-family: 'IBM Plex Serif', Georgia, serif; font-weight: 700; letter-spacing: -.005em; font-size: 20pt; padding: 10px 0 4px; }
  .panel-line { text-align: center; font-size: 10.5pt; color: #5a5f63; margin-bottom: 4px; }

  /* Numbered record paragraphs */
  .judgment { counter-reset: para; margin-top: 12px; }
  .jhead { font-family: 'IBM Plex Sans', Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; font-size: 10.5pt; color: #3a3f43; margin: 20px 0 8px; }
  .para { counter-increment: para; position: relative; padding-left: 2.7em; margin-bottom: 10px; text-align: justify; color: #2a2e31; }
  .para::before { content: counter(para) "."; position: absolute; left: 0; top: 0; font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; color: #8a6d2b; }
  .reclist { list-style: none; padding: 0 0 0 2.7em; margin: 0 0 11px; }
  .reclist li { padding: 2px 0; }
  .reclist .ref { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600; color: #8a6d2b; }

  .so { font-family: 'IBM Plex Sans', Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; color: #3a3f43; margin: 20px 0 14px; }
  .plainlist { margin: 0 0 11px; padding-left: 22px; color: #2a2e31; }
  .plainlist li { padding: 2px 0; }
  .docquote { margin: 12px 0 14px; padding: 2px 16px; border-left: 3px solid #8a6d2b; font-style: italic; color: #2a2e31; }
  .docquote__att { text-align: right; font-style: normal; font-size: 10.5pt; color: #5a5f63; margin-top: 4px; }
  .votebox { border-collapse: collapse; margin: 2px auto 12px; }
  .votebox th { font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; border-bottom: 2px solid #1a1e21; padding: 3px 18px; color: #5a5f63; }
  .votebox td { border: 1px solid #d8d2c4; padding: 6px 18px; text-align: center; font-size: 14pt; font-weight: 700; }
  .votemembers { border-collapse: collapse; width: 86%; margin: 0 auto 12px; }
  .votemembers td { border-bottom: 1px solid #e0d9c9; padding: 4px 8px; font-size: 10.5pt; }
  .votemembers .vm-pos { text-align: right; color: #5a5f63; }

  /* Signature — italic serif name over an ink rule + mono caption */
  .sign { margin-top: 10px; }
  .sign__line { width: 280px; border-bottom: 1px solid #1a1e21; height: 30px; }
  .sign__name { font-style: italic; font-size: 15pt; font-weight: 500; margin-top: 4px; color: #2a2e31; }
  .sign__role, .sign__date { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 8.5pt; letter-spacing: .04em; text-transform: uppercase; color: #5a5f63; }
  .sig-e { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 7.5pt; letter-spacing: .04em; color: #7a7f83; margin-top: 3px; }
  .attest { font-style: italic; max-width: 470px; margin: 4px 0 12px; font-size: 10.5pt; color: #2a2e31; }

  /* Memorandum */
  .memo-h { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
  .memo-h td { padding: 3px 0; vertical-align: top; font-size: 11.5pt; }
  .memo-h .ml { width: 150px; font-family: 'IBM Plex Sans', Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; font-size: 9pt; padding-top: 5px; color: #5a5f63; }
  .memo-body { margin-top: 6px; }
  .signoff { margin-top: 24px; }
  .signoff .sn { font-style: italic; font-size: 14pt; }
  .signoff .sr { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: #5a5f63; }

  /* Official record (personnel / surveillance) */
  .doc-sub { text-align: center; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 9pt; letter-spacing: .1em; text-transform: uppercase; color: #5a5f63; margin-top: 4px; }
  .fieldgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 36px; margin: 16px 0 6px; }
  .field { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px solid #e0d9c9; font-size: 11pt; }
  .field .fl { color: #5a5f63; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em; padding-top: 3px; font-family: 'IBM Plex Sans', Arial, sans-serif; }
  .field .fv { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 500; text-align: right; color: #1a1e21; }

  .log { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .log td { padding: 6px 8px; border-bottom: 1px solid #e0d9c9; vertical-align: top; font-size: 11pt; }
  .log .ld { width: 130px; color: #5a5f63; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; font-family: 'IBM Plex Mono', 'Courier New', monospace; }
  .log .lby { font-size: 9.5pt; color: #7a7f83; font-style: italic; margin-top: 2px; }

  /* Markings */
  .notice { border: 1px solid #d8d2c4; border-left: 3px solid #7a2b2b; color: #2a2e31; background: #fbfaf6; padding: 12px 16px; margin: 16px 0; font-family: 'IBM Plex Serif', Georgia, serif; font-size: 10.5pt; letter-spacing: .01em; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .notice .hl, .notice strong { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #7a2b2b; }
  .notice--soft { border-left-color: #8a8f93; }
  .notice--soft .hl, .notice--soft strong { color: #5a5f63; }
  .withheld { text-align: center; border: 1px dashed #7a2b2b; color: #7a2b2b; padding: 16px; margin: 16px 0; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 10.5pt; letter-spacing: .08em; }
  .redacted { font-family: 'IBM Plex Mono', 'Courier New', monospace; background: #1a1e21; color: #1a1e21; padding: 0 4px; border-radius: 1px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sealed { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 10pt; letter-spacing: .05em; color: #7a2b2b; }

  /* Formal correspondence (candidate-facing letters) */
  .letter-date { text-align: right; margin: 2px 0 20px; font-size: 11.5pt; }
  .letter-addr { margin: 0 0 20px; line-height: 1.55; font-size: 11.5pt; }
  .letter-addr .la-name { font-weight: 700; }
  .letter-addr .la-ref { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 10pt; color: #5a5f63; }
  .letter-salut { margin: 0 0 12px; }
  .letter-vale { margin: 26px 0 4px; }
  /* An emphatic determination line, ruled top and bottom. */
  .determination { text-align: center; font-family: 'IBM Plex Sans', Arial, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: .11em; font-size: 12.5pt; margin: 20px auto; padding: 12px 0; border-top: 1.5px solid #1a1e21; border-bottom: 1.5px solid #1a1e21; }
  /* The Committee's creed — a ruled seal motto, set at the foot. */
  .creed { text-align: center; margin: 24px auto 2px; padding: 9px 0; border-top: 1.5px solid #8a6d2b; border-bottom: 1.5px solid #8a6d2b; color: #8a6d2b; text-transform: uppercase; font-weight: 700; letter-spacing: .16em; font-size: 9.5pt; }

  /* Candidate feedback sections — quiet rules, no security accents */
  .fb-q { padding: 12px 0; border-bottom: 1px solid #e0d9c9; page-break-inside: avoid; }
  .fb-q:last-of-type { border-bottom: none; }
  .fb-qhead { font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #5a5f63; margin-bottom: 5px; }
  .fb-qhead .fb-n { font-weight: 700; color: #1a1e21; margin-right: 8px; }
  .fb-prompt { margin: 0 0 8px; }
  .fb-label { font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #5a5f63; margin: 6px 0 3px; }
  .fb-answer { background: #f0ece1; border: 1px solid #e0d9c9; padding: 7px 10px; font-size: 11pt; white-space: pre-wrap; }
  .fb-feedback { margin-top: 7px; font-size: 11pt; }
  .fb-feedback .fb-k { font-weight: 700; }

  /* Distribution & handling + records footer */
  .handling { margin-top: 24px; border-top: 1px solid #1a1e21; padding-top: 9px; font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 8.5pt; color: #3a3f43; line-height: 1.5; }
  .handling > div { margin: 3px 0; }
  .handling .hl { font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding-right: 4px; color: #7a2b2b; }
  .foot { margin-top: 10px; padding-top: 7px; border-top: 1px solid #d8d2c4; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 8pt; color: #5a5f63; text-transform: uppercase; letter-spacing: .04em; }
  .foot__c { text-align: center; letter-spacing: .06em; flex: 1; }
  .foot--meta { border-top: none; margin-top: 14px; padding-top: 0; color: #7a7f83; }
  .foot--meta + .foot { margin-top: 4px; }

  @page { size: A4; margin: 13mm 15mm; }
  @media print {
    html, body { background: #fff; }
    .controls { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; }
    .pad { padding: 0; }
    .para, .log tr, .sign, .field { page-break-inside: avoid; }
    .jhead, .memo-title, .doc-title { page-break-after: avoid; }
    /* Candidate letters onto one A4: densified type/spacing and the records-only
       boilerplate (handling paragraph, control-number meta row) dropped. Scoped to
       .pad--letter, measured to ~25px headroom on the longest (the invitation);
       records and the interviewer's script are untouched. */
    .pad--letter .handling, .pad--letter .foot--meta { display: none; }
    .pad--letter .memo-body { font-size: 10pt; line-height: 1.3; }
    .pad--letter .memo-body p { margin-bottom: 4px; }
    .pad--letter .lh { padding-bottom: 6px; }
    .pad--letter .lh + hr.rule { margin: 2px 0 6px; }
    .pad--letter .doc-title { padding: 3px 0; font-size: 13pt; }
    .pad--letter .doc-sub { margin-top: 1px; }
    .pad--letter .letter-date { margin: 2px 0 7px; }
    .pad--letter .letter-addr { margin: 0 0 7px; line-height: 1.35; }
    .pad--letter .letter-salut { margin: 0 0 4px; }
    .pad--letter .letter-vale { margin: 9px 0 2px; }
    .pad--letter .determination { margin: 8px auto; padding: 5px 0; font-size: 11pt; }
    .pad--letter .judgment { margin-top: 4px; }
    .pad--letter .judgment .para { margin-bottom: 2px; }
    .pad--letter .fb-q { padding: 7px 0; }
    .pad--letter .sign { margin-top: 1px; }
    .pad--letter .sign__line { height: 15px; }
    .pad--letter .sig-e { font-size: 7pt; }
    .pad--letter .creed { margin: 9px auto 4px; padding: 4px 0; font-size: 9pt; }
    .pad--letter .foot { margin-top: 5px; }
  }
`;

function frameDoc({ title, classification, inner, footerRef, actor, org = null, distribution = null, letter = false }) {
  const now = new Date().toISOString();
  const code = org === 'omega-1' ? 'O1' : org === 'ethics-committee' ? 'EC' : org === 'command' ? 'CMD' : 'GEN';
  const controlNo = `CAIRO/${code}/${footerRef}`;
  const logo = org ? orgLogo(org) : null;
  const wm = logo ? `<div class="wm" aria-hidden="true"><img src="${logo}" alt="" /></div>` : '';
  const dist = distribution || defaultDistribution(org);
  const band = classBand(classification);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(footerRef)} \u2014 ${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap" rel="stylesheet" />
<style>${CSS}</style>
</head>
<body>
  <div class="controls">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button class="ghost" onclick="window.close()">Close</button>
  </div>
  <div class="sheet"><div class="pad${letter ? ' pad--letter' : ''}">
    ${wm}
    <div class="classbar classbar--top ${band}">${esc(classification)}</div>
    ${inner}
    <div class="handling">
      <div><span class="hl">Distribution:</span> ${esc(dist)}</div>
      <div><span class="hl">Handling:</span> This record contains information affecting the security of the Foundation. Store and transmit by approved channels only; reproduction requires the originator\u2019s written consent. Unauthorised disclosure is a matter for the Ethics Committee.</div>
    </div>
    <div class="foot foot--meta"><div>Issued ${longDate(now)}</div><div class="foot__c">Copy 01 of 01</div><div>Originator ${esc(actor?.designation || 'SYSTEM')}</div></div>
    <div class="foot"><div>${esc(controlNo)}</div><div class="foot__c">${esc(classification)}</div><div>Page 1 of 1</div></div>
    <div class="classbar classbar--bottom ${band}">${esc(classification)}</div>
  </div></div>
</body>
</html>`;
}

// ===========================================================================
// TRIBUNAL CASE — court-style judgment
// ===========================================================================
export function buildCaseDocumentHTML(record, actor) {
  const kind = CASE_KIND[record.kind]?.label || record.kind;
  const kindLower = (CASE_KIND[record.kind]?.label || record.kind).toLowerCase();
  const status = CASE_STATUS[record.status]?.label || record.status;
  const respondent = record.respondentId
    ? personRef(record.respondentId)
    : esc([
        (record.respondentName && record.respondentName !== '[UNNAMED]') ? record.respondentName : '',
        record.respondentDept || '',
      ].filter(Boolean).join(' \u2014 ') || 'an unnamed party');

  const panel = (record.panelIds || []);
  const panelLine = panel.length
    ? 'Before the Panel: ' + panel.map((pid, i) => `${personRef(pid)}${i === 0 ? ' (Presiding)' : ''}`).join('; ')
    : 'Before the Committee';

  // Numbered paragraphs, continuous across the whole judgment.
  const blocks = [];
  blocks.push('<div class="jhead">Introduction</div>');
  blocks.push(`<div class="para">This matter came before the Ethics Committee as a ${esc(kindLower)} in respect of ${esc(record.title)}.</div>`);
  if (record.summary) blocks.push(`<div class="para">${esc(record.summary)}</div>`);

  const summons = (record.summons || []);
  if (summons.length) {
    blocks.push('<div class="jhead">Summons</div>');
    summons.forEach((m) => {
      const who = m.targetId ? personRef(m.targetId, m.targetName) : esc([m.targetName || '', m.targetDept || ''].filter(Boolean).join(' \u2014 ') || 'a party');
      blocks.push(`<div class="para">${who} was summoned to appear before the Committee: ${esc(m.reason)}</div>`);
    });
  }

  const entries = [...(record.entries || [])].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (entries.length) {
    blocks.push('<div class="jhead">Record of Proceedings</div>');
    entries.forEach((e) => {
      blocks.push(`<div class="para">On ${longDate(e.ts)}, ${esc(e.text)} <span class="muted">(${esc(e.by)})</span></div>`);
    });
  }

  const links = (record.linkedSubjectIds || []).map((sid) => {
    const s = getSubject(sid);
    if (!s) return '<li class="muted">A linked record, no longer available.</li>';
    if (!canViewSubject(actor, s)) return `<li class="sealed">[SEALED RECORD \u2014 ${esc((clrLabel(s.clearance)).toUpperCase())}]</li>`;
    return `<li><span class="ref">${esc(s.ref)}</span> \u2014 \u201c${esc(s.alias)}\u201d (${esc(ORGS[s.org]?.short || s.org)})</li>`;
  });
  if (links.length) {
    blocks.push('<div class="jhead">Records Before the Committee</div>');
    blocks.push('<div class="para">The Committee had regard to the following records:</div>');
    blocks.push(`<ul class="reclist">${links.join('')}</ul>`);
  }

  blocks.push('<div class="jhead">Determination</div>');
  if (record.ruling) {
    const finding = RULING_FINDING[record.ruling.finding]?.label || record.ruling.finding;
    blocks.push(`<div class="para">Having considered the matter, the Committee determines that the complaint is <strong>${esc(finding)}</strong>.</div>`);
    if (record.ruling.rationale) blocks.push(`<div class="para">${esc(record.ruling.rationale)}</div>`);
    if (record.ruling.measures) {
      blocks.push('<div class="jhead">Measures</div>');
      blocks.push(`<div class="para">The following measures are directed: ${esc(record.ruling.measures)}</div>`);
    }
    const presiding = panel.length ? personRef(panel[0]) : esc(record.ruling.by);
    blocks.push('<div class="so">So determined.</div>');
    blocks.push(signBlock({ name: presiding, role: 'Presiding, for and on behalf of the Ethics Committee', dated: `Entered ${longDate(record.ruling.ts)}` }));
  } else {
    blocks.push('<div class="para">These proceedings remain ongoing. No determination has been entered as at the date of this record.</div>');
  }

  // Record of the Vote — for deliberative (non-tribunal) matters, mirroring the
  // panel poll shown in the app: the tally plus each seated member's position.
  if (caseTakesVote(record.kind)) {
    const votes = record.votes || {};
    const t = tallyCaseVotes(votes);
    blocks.push('<div class="jhead">Record of the Vote</div>');
    blocks.push(`<table class="votebox"><thead><tr>
      <th>In Favour</th><th>Opposed</th><th>Abstaining</th><th>Votes Cast</th>
    </tr></thead><tbody><tr>
      <td>${t.favour}</td><td>${t.oppose}</td><td>${t.abstain}</td><td>${t.cast}</td>
    </tr></tbody></table>`);
    const seated = record.panelIds || [];
    if (seated.length) {
      const rows = seated.map((pid) => {
        const pos = votes[pid];
        const label = pos ? (CASE_VOTE[pos]?.label || pos) : 'Not voted';
        return `<tr><td class="vm-name">${personRef(pid)}</td><td class="vm-pos">${esc(label)}</td></tr>`;
      }).join('');
      blocks.push(`<table class="votemembers"><tbody>${rows}</tbody></table>`);
    } else {
      blocks.push('<div class="para muted">No panel was seated to vote on this matter.</div>');
    }
    if (!record.ruling) {
      const outcome = t.cast === 0 ? 'No votes have yet been cast.'
        : (t.carried ? 'A majority of the votes cast are in favour.' : 'The matter has not carried on the votes cast.');
      blocks.push(`<div class="para">${esc(outcome)}</div>`);
    }
  }

  // Every issued record closes with a clerk's certification — present whether
  // the matter is determined or still open, as on a true court record.
  blocks.push('<div class="jhead">Certification</div>');
  blocks.push('<div class="attest">Certified a true record of the matter and of the Committee\u2019s determination thereupon, entered upon the records of the Ethics Committee by direction of the Office of Internal Oversight.</div>');
  blocks.push(signBlock({ name: esc(actor?.designation || 'CLERK OF RECORD'), role: 'Clerk of Record, Office of Internal Oversight', dated: `Issued ${longDate(new Date().toISOString())}` }));

  const inner = `
    ${letterhead('ethics-committee', 'Office of Tribunals')}
    <hr class="rule" />
    <div class="court">In the Ethics Committee of the SCP Foundation</div>
    <div class="matter">In the matter of a ${esc(kindLower)} concerning ${esc(record.title)}</div>
    <div class="caseno">Case No. ${esc(record.ref)}</div>
    <div class="parties">
      <div class="party"><span class="pname">The Ethics Committee</span><span class="role">Convening Authority</span></div>
      <div class="vs">\u2014 and \u2014</div>
      <div class="party"><span class="pname">${respondent}</span><span class="role">Respondent</span></div>
    </div>
    <hr class="rule--bold" />
    <div class="doc-title">Record of Proceedings and Determination</div>
    <hr class="rule--bold" />
    <div class="panel-line">${panelLine}</div>
    <div class="judgment">${blocks.join('\n')}</div>
  `;

  return frameDoc({
    title: 'Record of Proceedings',
    classification: banner(record.clearance, 'Ethics Committee'),
    inner,
    org: 'ethics-committee',
    distribution: 'Members of the Ethics Committee; Site Command (for information).',
    footerRef: record.ref,
    actor,
  });
}

// ===========================================================================
// SURVEILLANCE SUBJECT — official report
// ===========================================================================
export function buildSubjectDocumentHTML(subject, actor) {
  const kind = SUBJECT_CLASS[subject.kind]?.label || subject.kind;
  const status = SUBJECT_STATUS[subject.status]?.label || subject.status;
  const threat = THREAT_LEVELS[subject.threat]?.label || subject.threat;

  const fields = [
    ['Reference', esc(subject.ref)],
    ['Designation', `\u201c${esc(subject.alias)}\u201d`],
    ['Identity on File', esc(subject.realName || '[UNIDENTIFIED]')],
    ['Classification', esc(kind)],
    ['Organisation', esc(ORGS[subject.org]?.name || subject.org)],
    ['Threat Assessment', esc(threat)],
    ['Status', esc(status)],
    ['Sensitivity', esc(clrLabel(subject.clearance))],
    ['Last Known Location', esc(subject.lastKnownLocation || '\u2014')],
    ['Opened', `${longDate(subject.createdAt)} \u00b7 ${esc(subject.createdBy || 'SYSTEM')}`],
  ];

  const logs = [...(subject.logs || [])].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const logBody = logs.length
    ? `<table class="log"><tbody>${logs.map((l) => `
        <tr><td class="ld">${longDate(l.ts)}</td>
        <td>${esc(l.text)}<div class="lby">${esc(l.type)} \u2014 ${esc(l.by)}</div></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No surveillance entries were recorded.</p>';

  // Surveillance imagery — embedded as the same downscaled data-URLs the record
  // holds (visible iff the viewer can see the subject at all). Only genuine
  // image data-URLs are ever embedded.
  const stills = (subject.images || []).filter((im) => typeof im.dataUrl === 'string' && /^data:image\//.test(im.dataUrl));
  const imageryBody = stills.length ? `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 4px">
      ${stills.map((im, i) => `
        <figure style="margin:0;width:calc(50% - 5px);break-inside:avoid">
          <img src="${im.dataUrl}" alt="${esc(im.caption || `surveillance still ${i + 1}`)}" style="display:block;width:100%;border:1px solid #8a8074" />
          <figcaption style="font-size:9pt;color:#555;margin-top:3px">${esc(im.caption || `Still ${i + 1}`)}${im.by ? ` \u2014 ${esc(im.by)}` : ''}</figcaption>
        </figure>`).join('')}
    </div>` : '';

  const inner = `
    ${letterhead(subject.org, 'Surveillance Section')}
    <hr class="rule" />
    <div class="doc-title">Surveillance Report</div>
    <div class="doc-sub">${esc(kind)} \u2014 ${esc(status)}</div>
    <hr class="rule" />
    <div class="fieldgrid">${fields.map(([k, v]) => `<div class="field"><span class="fl">${esc(k)}</span><span class="fv">${v}</span></div>`).join('')}</div>
    <div class="jhead">1.&nbsp;&nbsp;Assessment</div>
    ${paras(subject.summary || 'No assessment was recorded.')}
    ${stills.length ? `<div class="jhead">2.&nbsp;&nbsp;Surveillance Imagery</div>${imageryBody}` : ''}
    <div class="jhead">${stills.length ? '3' : '2'}.&nbsp;&nbsp;Surveillance Log</div>
    ${logBody}
  `;

  return frameDoc({
    title: 'Surveillance Report',
    classification: banner(subject.clearance, 'Surveillance'),
    inner,
    org: subject.org,
    distribution: subject.kind === 'target' ? 'Originating section; the Ethics Committee; the assigned element only.' : 'Originating surveillance section.',
    footerRef: subject.ref,
    actor,
  });
}

// ===========================================================================
// SOURCE FILE — intelligence source dossier (handler's working copy)
// ===========================================================================
export function buildSourceFileHTML(src, actor) {
  const type = INTEL_SOURCE_TYPE[src.type]?.label || src.type;
  const status = INTEL_STATUS[src.status]?.label || src.status;
  const rel = INTEL_RELIABILITY[src.reliability]?.label || src.reliability || '\u2014';
  const handler = src.handler ? getUser(src.handler) : null;
  const targets = (src.linkedSubjectIds || []).map((id) => getSubject(id)).filter(Boolean);

  const fields = [
    ['Reference', esc(src.ref)],
    ['Cryptonym', `\u201c${esc(src.codename)}\u201d`],
    ['Source Type', esc(type)],
    ['Status', esc(status)],
    ['Reliability', esc(rel)],
    ['Handler', handler ? `${esc(handler.designation)} \u00b7 \u201c${esc(handler.codename)}\u201d` : '[UNASSIGNED]'],
    ['Sensitivity', esc(clrLabel(src.clearance))],
    ['Caveat', src.compartment ? esc(src.compartmentName || '[COMPARTMENTED]') : '\u2014'],
    ['Cover / Legend', esc(src.cover || '\u2014')],
    ['Reporting On', targets.length ? targets.map((s) => `${esc(s.ref)} \u201c${esc(s.alias)}\u201d`).join(' \u00b7 ') : '\u2014'],
    ['Opened', `${longDate(src.openedAt || src.createdAt)} \u00b7 ${esc(src.createdBy || 'SYSTEM')}`],
  ];
  if (src.closedAt) fields.push(['Stood Down', longDate(src.closedAt)]);

  const reports = [...(src.reports || [])].sort((a, b) => a.at - b.at);
  const logBody = reports.length
    ? `<table class="log"><tbody>${reports.map((r) => `
        <tr><td class="ld">${longDate(new Date(r.at).toISOString())}</td>
        <td>${esc(r.text)}<div class="lby">${esc(INTEL_CREDIBILITY[r.credibility]?.label || String(r.credibility))} \u2014 ${esc(r.by)}</div></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No reports have been filed.</p>';

  const inner = `
    ${letterhead('omega-1', 'Regimental Intelligence Cell')}
    <hr class="rule" />
    <div class="doc-title">Source File</div>
    <div class="doc-sub">${esc(type)} \u2014 ${esc(status)}</div>
    <hr class="rule" />
    <div class="fieldgrid">${fields.map(([k, v]) => `<div class="field"><span class="fl">${esc(k)}</span><span class="fv">${v}</span></div>`).join('')}</div>
    <div class="jhead">1.&nbsp;&nbsp;Tasking</div>
    ${paras(src.tasking || 'No tasking is on record.')}
    <div class="jhead">2.&nbsp;&nbsp;Reporting Log</div>
    <p class="muted">Each report carries its information-credibility grading on the standard scale.</p>
    ${logBody}
  `;

  return frameDoc({
    title: 'Source File',
    classification: `${banner(src.clearance, 'Intelligence')} // ORCON`,
    inner,
    org: 'omega-1',
    distribution: 'Regimental Intelligence Cell only. Source identity is not for further dissemination.',
    footerRef: src.ref,
    actor,
  });
}

// ===========================================================================
// AFTER-ACTION REPORT / OPERATION RECORD — the Deployment Log's paperwork
// ===========================================================================
export function buildAfterActionHTML(op, actor) {
  const closed = op.status === 'concluded' || op.status === 'aborted';
  const docName = closed ? 'After-Action Report' : 'Operation Record';
  const kind = OPERATION_KIND[op.kind]?.label || op.kind;
  const status = OPERATION_STATUS[op.status]?.label || op.status;
  const lead = op.lead ? getUser(op.lead) : null;
  const team = (op.participants || []).map((id) => getUser(id)).filter(Boolean);
  const targets = (op.linkedSubjectIds || []).map((id) => getSubject(id)).filter(Boolean);

  const fields = [
    ['Reference', esc(op.ref)],
    ['Operation', esc(op.name)],
    ['Type', esc(kind)],
    ['Status', esc(status)],
    ['Sensitivity', esc(clrLabel(op.clearance))],
    ['Caveat', op.compartment ? esc(op.compartmentName || '[COMPARTMENTED]') : '\u2014'],
    ['Commanding', lead ? `${esc(lead.designation)} \u00b7 \u201c${esc(lead.codename)}\u201d` : '\u2014'],
    ['Assigned Strength', String((op.participants || []).length + (op.lead ? 1 : 0))],
    ['Area of Operations', esc(op.location || '\u2014')],
    ['Opened', longDate(op.startedAt || op.createdAt)],
  ];
  if (op.concludedAt) fields.push(['Concluded', longDate(op.concludedAt)]);

  const roster = [lead, ...team].filter(Boolean);
  const rosterBody = roster.length
    ? `<table class="log"><tbody>${roster.map((u, i) => `
        <tr><td class="ld">${i === 0 && lead ? 'LEAD' : 'ASSIGNED'}</td>
        <td>${esc(u.designation)} \u00b7 \u201c${esc(u.codename)}\u201d<div class="lby">${esc(u.rank || '')}</div></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No personnel are recorded against this operation.</p>';

  const logs = [...(op.log || [])].sort((a, b) => a.at - b.at);
  const logBody = logs.length
    ? `<table class="log"><tbody>${logs.map((l) => `
        <tr><td class="ld">${longDate(new Date(l.at).toISOString())}</td>
        <td>${esc(l.text)}<div class="lby">${esc(OP_LOG_TYPE[l.type]?.label || l.type)} \u2014 ${esc(l.by)}</div></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">The operational log is empty.</p>';

  const outcome = op.outcome
    ? `<div class="jhead">4.&nbsp;&nbsp;Outcome</div>
       <div class="fieldgrid"><div class="field"><span class="fl">Result</span><span class="fv">${esc(OPERATION_RESULT[op.outcome.result]?.label || op.outcome.result)}</span></div>
       <div class="field"><span class="fl">Recorded</span><span class="fv">${longDate(op.outcome.at)} \u00b7 ${esc(op.outcome.by || '')}</span></div></div>
       ${paras(op.outcome.text || 'No closing assessment was recorded.')}`
    : (closed ? '<div class="jhead">4.&nbsp;&nbsp;Outcome</div><p class="muted">No outcome was recorded.</p>' : '');

  const inner = `
    ${letterhead('omega-1', 'Operations Section')}
    <hr class="rule" />
    <div class="doc-title">${docName}</div>
    <div class="doc-sub">${esc(kind)} \u2014 ${esc(status)}</div>
    <hr class="rule" />
    <div class="fieldgrid">${fields.map(([k, v]) => `<div class="field"><span class="fl">${esc(k)}</span><span class="fv">${v}</span></div>`).join('')}</div>
    <div class="jhead">1.&nbsp;&nbsp;Objective</div>
    ${paras(op.objective || 'No objective is on record.')}
    <div class="jhead">2.&nbsp;&nbsp;Personnel</div>
    ${rosterBody}
    ${targets.length ? `<div class="jhead">2a.&nbsp;&nbsp;Linked Subjects</div><p>${targets.map((s) => `${esc(s.ref)} \u201c${esc(s.alias)}\u201d`).join(' \u00b7 ')}</p>` : ''}
    <div class="jhead">3.&nbsp;&nbsp;Operational Log</div>
    ${logBody}
    ${outcome}
  `;

  return frameDoc({
    title: docName,
    classification: banner(op.clearance, 'Operations'),
    inner,
    org: 'omega-1',
    distribution: 'Operations Section; Site Command.',
    footerRef: op.ref,
    actor,
  });
}

// ===========================================================================
// PERSONNEL FILE — official record (redaction-aware)
// ===========================================================================
export function buildPersonnelDocumentHTML(user, actor) {
  const level = accessLevel(actor, user);
  const full = level === 'full';
  const nameOnly = level === 'name-only';
  const onLeave = !!user.leave;
  const strikeCount = activeStrikeCount(user.strikes);
  const noteCount = (user.notes || []).length;

  let notice = '';
  if (nameOnly) {
    notice = `<div class="notice"><strong>ACCESS RESTRICTED.</strong> Your clearance permits identity confirmation only. The service record for this operator is withheld.</div>`;
  } else if (level === 'partial') {
    notice = `<div class="notice notice--soft">PARTIAL ACCESS. Disciplinary record, leave details and command notes are restricted at your clearance and appear redacted below.</div>`;
  }

  const fields = [
    ['Designation', esc(user.designation)],
    ['Codename', `\u201c${esc(user.codename)}\u201d`],
    ['Legal Name', full ? esc(user.realName) : REDACTED],
    ['Operator ID', full ? esc(user.username) : REDACTED],
    ['Organisation', esc(ORGS[user.org]?.name || user.org)],
    ['Rank', esc(user.rank || '\u2014')],
    ['Clearance', esc(clrLabel(user.clearance))],
    ['Duty Status', esc(STATUSES[user.status]?.label || user.status)],
    ['Record Updated', longDate(user.updatedAt)],
  ];

  const sections = [];

  if (onLeave) {
    sections.push('<div class="jhead">Active Leave</div>');
    sections.push(`<div class="fieldgrid">
      <div class="field"><span class="fl">Type</span><span class="fv">${esc(user.leave.type)}</span></div>
      <div class="field"><span class="fl">From</span><span class="fv">${longDate(user.leave.from)}</span></div>
      <div class="field"><span class="fl">Until</span><span class="fv">${longDate(user.leave.to)}</span></div>
      <div class="field"><span class="fl">Reason</span><span class="fv">${full ? esc(user.leave.reason || '\u2014') : REDACTED}</span></div>
    </div>`);
  }

  if (strikeCount) {
    const atLimit = strikeCount >= STRIKE_LIMIT;
    sections.push(`<div class="jhead">Disciplinary Record${atLimit ? ' \u2014 At Limit' : ''}</div>`);
    if (full) {
      sections.push(`<table class="log"><tbody>${user.strikes.map((s) => {
        const active = strikeActive(s);
        const exp = s.expiresAt ? (new Date(s.expiresAt).getTime() > Date.now() ? ` \u00b7 expires ${longDate(s.expiresAt)}` : ` \u00b7 EXPIRED ${longDate(s.expiresAt)}`) : '';
        let mark = '';
        if (s.appeal && s.appeal.status === 'overturned') mark = ' \u2014 OVERTURNED ON APPEAL';
        else if (s.lifted) mark = ' \u2014 LIFTED';
        else if (!active) mark = ' \u2014 EXPIRED';
        else if (s.appeal && s.appeal.status === 'pending') mark = ' \u2014 UNDER APPEAL';
        else if (s.appeal && s.appeal.status === 'upheld') mark = ' \u2014 APPEAL UPHELD';
        const appealLine = s.appeal ? `<div class="lby">Appeal (${esc(s.appeal.status)}): \u201c${esc(s.appeal.text)}\u201d${s.appeal.resolvedBy ? ` \u2014 ruled by ${esc(s.appeal.resolvedBy)}` : ''}</div>` : '';
        const liftLine = s.lifted ? `<div class="lby">Lifted by ${esc(s.lifted.by)} on ${longDate(s.lifted.at)}${s.lifted.note ? ` \u2014 ${esc(s.lifted.note)}` : ''}</div>` : '';
        return `<tr><td class="ld">${longDate(s.date)}</td><td>${esc(s.reason)}<strong>${mark}</strong><div class="lby">Issued by ${esc(s.by)}${exp}</div>${appealLine}${liftLine}</td></tr>`;
      }).join('')}</tbody></table>`);
    } else {
      sections.push(`<p>${strikeCount} strike${strikeCount > 1 ? 's' : ''} on file. Detail ${REDACTED}</p>`);
    }
  }

  if (!nameOnly && (user.awards || []).length) {
    sections.push('<div class="jhead">Awards &amp; Commendations</div>');
    sections.push(`<table class="log"><tbody>${user.awards.map((a) => `
      <tr><td class="ld">${longDate(a.date)}</td><td>${esc(a.title)}${a.note ? `<div class="lby">${esc(a.note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`);
  }

  if (!nameOnly) {
    const events = [...(user.events || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    sections.push('<div class="jhead">Service Record</div>');
    sections.push(events.length
      ? `<table class="log"><tbody>${events.map((e) => `<tr><td class="ld">${longDate(e.date)}</td><td>${esc(e.text)}<div class="lby">${esc(e.type)}</div></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No recorded events.</p>');
  }

  if (full) {
    sections.push('<div class="jhead">Command Notes</div>');
    sections.push((user.notes || []).length
      ? `<table class="log"><tbody>${user.notes.map((n) => `<tr><td class="ld">${longDate(n.date)}</td><td>${esc(n.text)}<div class="lby">${esc(n.by)}</div></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No command notes.</p>');
  } else if (noteCount) {
    sections.push('<div class="jhead">Command Notes</div>');
    sections.push(`<p>${noteCount} note${noteCount > 1 ? 's' : ''} on file. ${REDACTED}</p>`);
  }

  const inner = `
    ${letterhead(user.org, 'Office of Personnel')}
    <hr class="rule" />
    <div class="doc-title">Personnel Service Record</div>
    <div class="doc-sub">${esc(ORGS[user.org]?.short || user.org)} \u2014 ${esc(STATUSES[user.status]?.label || user.status)}</div>
    <hr class="rule" />
    <div class="fieldgrid">${fields.map(([k, v]) => `<div class="field"><span class="fl">${esc(k)}</span><span class="fv">${v}</span></div>`).join('')}</div>
    ${notice}
    ${sections.join('\n') || '<p class="muted">No further record is available at your access level.</p>'}
  `;

  return frameDoc({
    title: 'Personnel Service Record',
    classification: banner(user.clearance, 'Personnel'),
    inner,
    org: user.org,
    distribution: 'Subject\u2019s chain of command; Office of Personnel.',
    footerRef: user.designation,
    actor,
  });
}

// ===========================================================================
// DIRECTIVE — memorandum (body gated by clearance)
// ===========================================================================
export function buildDirectiveDocumentHTML(directive, actor) {
  const status = directive.status === 'rescinded' ? 'Rescinded' : 'In Force';
  const canRead = canReadDirective(actor, directive);

  const bodyBlock = canRead
    ? `<div class="memo-body">${paras(directive.body)}</div>`
    : `<div class="notice"><strong>CONTENT WITHHELD.</strong> The body of this directive is restricted to ${esc(clrLabel(directive.clearance))} and above.</div>
       <div class="withheld">[ CONTENT WITHHELD \u2014 REQUIRES ${esc((clrLabel(directive.clearance)).toUpperCase())} ]</div>`;

  const inner = `
    ${letterhead(directive.org, 'Standing Orders')}
    <hr class="rule" />
    <div class="memo-title">Memorandum</div>
    <hr class="rule" />
    <table class="memo-h"><tbody>
      <tr><td class="ml">To</td><td>All ${esc(ORGS[directive.org]?.short || directive.org)} personnel cleared to ${esc(clrLabel(directive.clearance))}</td></tr>
      <tr><td class="ml">From</td><td>${esc(authorityBody(directive.org))}</td></tr>
      <tr><td class="ml">Date</td><td>${longDate(directive.createdAt)}</td></tr>
      <tr><td class="ml">Reference</td><td>${esc(directive.ref)}</td></tr>
      <tr><td class="ml">Subject</td><td>${esc(directive.title)}</td></tr>
      <tr><td class="ml">Classification</td><td>${esc(clrLabel(directive.clearance))} \u2014 Restricted</td></tr>
      <tr><td class="ml">Status</td><td>${status}</td></tr>
    </tbody></table>
    <hr class="rule" />
    ${bodyBlock}
    ${directive.status === 'rescinded' ? '<p class="muted">This directive has been rescinded and is no longer in force.</p>' : ''}
    <p class="muted" style="margin-top:20px">By order of ${esc(authorityBody(directive.org))}.</p>
    ${signBlock({ name: esc(directive.issuedBy || 'SYSTEM'), role: `Issuing authority, ${authorityBody(directive.org)}`, dated: `Issued ${longDate(directive.createdAt)}` })}
  `;

  return frameDoc({
    title: 'Memorandum',
    classification: banner(directive.clearance, 'Directive'),
    inner,
    org: directive.org,
    distribution: `All ${ORGS[directive.org]?.name || directive.org} personnel cleared to ${clrLabel(directive.clearance)}.`,
    footerRef: directive.ref,
    actor,
  });
}

// ===========================================================================
// ETHICS ASSISTANT — INTERVIEW ASSESSMENT SCRIPT
// The interviewer's working copy: candidate details, instructions to the
// Member, each drawn scenario with its assessment guidance, ruled response
// space and a Strong / Acceptable / Weak mark, then an overall recommendation
// block. Marked INTERVIEWER'S COPY — it carries the marking criteria and must
// not be shown to the candidate.
// ===========================================================================
const CHECK = '\u2610'; // ballot box (empty)

function ruledLines(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += '<div class="iv-line"></div>';
  return out;
}

const IV_STYLE = `<style>
  .iv-intro { margin: 12px 0 6px; }
  .iv-intro .iv-warn { font-weight: bold; color: #7a1010; }
  .iv-q { margin: 14px 0; padding: 10px 12px; border: 1px solid #999; border-left: 3px solid #7a1010; page-break-inside: avoid; }
  .iv-qhead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
  .iv-num { font-weight: bold; font-size: 13pt; }
  .iv-cat { font-variant: small-caps; letter-spacing: .04em; color: #555; font-size: 10pt; }
  .iv-tag { margin-left: auto; font-size: 8.5pt; font-variant: small-caps; letter-spacing: .04em; color: #7a1010; border: 1px solid #7a1010; padding: 0 6px; }
  .iv-prompt { margin: 4px 0 8px; }
  .iv-guide { background: #f1eee8; border: 1px solid #d8d1c4; padding: 6px 9px; font-size: 10.5pt; margin-bottom: 8px; }
  .iv-guide__row { display: flex; gap: 8px; margin: 3px 0; }
  .iv-guide__k { flex: 0 0 128px; font-weight: bold; }
  .iv-guide__row--weak .iv-guide__k { color: #7a1010; }
  .iv-k { font-variant: small-caps; letter-spacing: .04em; color: #555; font-size: 10pt; }
  .iv-recorded { background: #eef2ec; border: 1px solid #cdd8c8; padding: 6px 9px; font-size: 10.5pt; margin: 4px 0 6px; white-space: pre-wrap; }
  .iv-cairo { font-size: 10pt; color: #333; margin: 6px 0; }
  .iv-cairo--overall { margin: 8px 0; font-size: 11pt; }
  .iv-line { border-bottom: 1px solid #9a9284; height: 22px; }
  .iv-marks { margin-top: 8px; font-size: 11pt; font-family: 'Courier New', monospace; }
  .iv-marks span { margin-right: 18px; }
  .iv-rec { margin-top: 20px; padding: 10px 12px; border: 2px solid #333; page-break-inside: avoid; }
  .iv-rec__title { font-weight: bold; font-variant: small-caps; letter-spacing: .05em; margin-bottom: 6px; }
  .iv-rec__opts { font-family: 'Courier New', monospace; font-size: 11pt; margin-bottom: 8px; }
  .iv-rec__opts span { display: inline-block; margin-right: 20px; }
  .iv-sign { display: flex; gap: 28px; margin-top: 16px; }
  .iv-sign > div { flex: 1; }
  .iv-sign small { font-variant: small-caps; color: #555; }
</style>`;

export function buildInterviewScriptHTML(recruit, actor) {
  const member = recruit && recruit.track === 'member';
  const roleLabel = member ? 'Member' : 'Assistant';
  const bank = interviewSetFor(recruit).map((q) => ({ ...q, custom: false }));
  const custom = (recruit.customQuestions || []).map((q) => ({
    id: q.id, category: 'Committee-added', prompt: q.prompt,
    valid: q.valid || '', weak: q.weak || '', custom: true,
  }));
  const items = [...bank, ...custom];
  const responses = recruit.interviewResponses || {};
  const assessment = recruit.interviewAssessment || null;

  const rankSought = recruit.rank ? esc(recruit.rank) : '\u2014';
  const candTable = `<table class="memo-h"><tbody>
    <tr><td class="ml">Candidate</td><td>${esc(recruit.name || '\u2014')}</td></tr>
    <tr><td class="ml">SteamID</td><td>${esc(recruit.steamId || '\u2014')}</td></tr>
    <tr><td class="ml">Department</td><td>${esc(recruit.department || '\u2014')}</td></tr>
    <tr><td class="ml">Rank sought</td><td>${rankSought}</td></tr>
    <tr><td class="ml">Reference</td><td>${esc(recruit.ref || '\u2014')}</td></tr>
    <tr><td class="ml">Date</td><td>${longDate(new Date().toISOString())}</td></tr>
  </tbody></table>`;

  const questionsHtml = items.map((q, i) => {
    const stored = responses[q.id];
    const answer = stored && String(stored.text || '').trim();
    const g = assessment && assessment.perQuestion ? assessment.perQuestion[q.id] : null;
    const recorded = answer ? `<div class="iv-recorded">${esc(answer)}</div>` : '';
    const cairo = g
      ? `<div class="iv-cairo"><strong>CAIRO:</strong> ${esc((INTERVIEW_GRADE[g.grade] || {}).label || g.grade)}${g.rationale ? ` \u2014 ${esc(g.rationale)}` : ''}</div>`
      : '';
    return `
    <section class="iv-q">
      <div class="iv-qhead">
        <span class="iv-num">${i + 1}</span>
        <span class="iv-cat">${esc(q.category)}</span>
        ${q.custom ? '<span class="iv-tag">Committee-added</span>' : ''}
      </div>
      <div class="iv-prompt">${esc(q.prompt)}</div>
      <div class="iv-guide">
        <div class="iv-guide__row"><span class="iv-guide__k">A valid response</span><span>${esc(q.valid) || '\u2014'}</span></div>
        <div class="iv-guide__row iv-guide__row--weak"><span class="iv-guide__k">A weak response</span><span>${esc(q.weak) || '\u2014'}</span></div>
      </div>
      <div class="iv-k">Candidate response</div>
      ${recorded}
      ${ruledLines(answer ? 1 : 3)}
      ${cairo}
      <div class="iv-marks"><span>Assessment:</span><span>${CHECK} Strong</span><span>${CHECK} Acceptable</span><span>${CHECK} Weak</span></div>
    </section>`;
  }).join('');

  const cairoOverall = assessment
    ? `<div class="iv-cairo iv-cairo--overall"><strong>CAIRO recommendation:</strong> ${esc((INTERVIEW_RECOMMENDATION[assessment.recommendation] || {}).label || assessment.recommendation)}${assessment.summary ? ` \u2014 ${esc(assessment.summary)}` : ''} <em>(advisory \u2014 the Member decides)</em></div>`
    : '';

  const recBlock = `<section class="iv-rec">
    <div class="iv-rec__title">Overall Recommendation</div>
    ${cairoOverall}
    <div class="iv-rec__opts"><span>${CHECK} Recommend</span><span>${CHECK} Recommend with reservations</span><span>${CHECK} Do not recommend</span></div>
    <div class="iv-k">Summary of the Member's assessment</div>
    ${ruledLines(4)}
    <div class="iv-sign">
      <div>${ruledLines(1)}<small>Interviewing Member</small></div>
      <div>${ruledLines(1)}<small>Date</small></div>
    </div>
  </section>`;

  const inner = `
    ${letterhead('ethics-committee', 'Office of the Ethics Committee')}
    <hr class="rule" />
    <div class="memo-title">Interview Assessment \u2014 Ethics ${roleLabel}</div>
    <hr class="rule" />
    ${IV_STYLE}
    ${candTable}
    <hr class="rule" />
    <div class="iv-intro">
      <p><span class="iv-warn">INTERVIEWER\u2019S COPY \u2014 DO NOT DISCLOSE TO CANDIDATE.</span>
      This script carries the assessment guidance and is for the interviewing Member only.</p>
      <p>Read each scenario to the candidate and allow them to reason it through. There is no single correct answer;
      assess the quality of their reasoning against the guidance ${member
        ? '\u2014 a strong Member reasons at the level of the institution, weighing precedent, the Committee\u2019s authority and the people a ruling binds, not merely their own conscience.'
        : '\u2014 a strong Assistant is neither a blind rule-follower nor a naive idealist.'}
      Mark each response, then record an overall recommendation.</p>
    </div>
    ${questionsHtml}
    ${recBlock}
  `;

  return frameDoc({
    title: 'Interview Assessment',
    classification: 'INTERVIEWER\u2019S COPY \u2014 DO NOT DISCLOSE TO CANDIDATE',
    inner,
    org: 'ethics-committee',
    distribution: 'Interviewing Member only. Not to be shown to the candidate.',
    footerRef: recruit.ref || 'APPLICATION',
    actor,
  });
}

// ===========================================================================
// ETHICS ASSISTANT \u2014 CANDIDATE CORRESPONDENCE (invitation / appointment)
// The candidate-FACING counterpart to the interviewer's script. It carries NO
// marking criteria and no assessment guidance \u2014 only the formal notice. Two
// variants share the chrome: an invitation to interview (issued when an
// application is advanced to interview) and a notice of appointment (issued once
// the candidate has passed and been accepted).
// ===========================================================================
export function buildInterviewInviteHTML(recruit, actor, accepted = false) {
  const title = accepted ? 'Notice of Appointment' : 'Invitation to Interview';
  const member = recruit && recruit.track === 'member';
  const today = longDate(new Date().toISOString());

  const ref = esc(recruit.ref || '\u2014');
  const body = accepted
    ? `<p>Following your interview before the Committee, sitting in closed session, a determination has been reached upon your application for reassignment to this body (reference ${ref}).</p>
       <div class="determination">${member ? 'You are appointed as a Member of the Ethics Committee.' : 'You are appointed as an Assistant to the Ethics Committee.'}</div>
       <p>The appointment takes effect on issue of your personnel file and credentials, which the Committee will arrange. You are bound from that moment to the standards of conduct, confidentiality and activity the Committee requires of those who serve it, and to the discretion its work demands. You will weigh competing duties honestly, and you will carry what troubles you through the Committee\u2019s proper channels and no others.</p>
       <p>Understand what you have accepted. ${member ? 'You now sit upon the body that holds the departments to account, and you will be held to account more strictly than any of them.' : 'You do not now command the departments; you serve the body that holds them to account, and you will be held to account more strictly than they are.'} The Committee does not reward loyalty. It requires conscience.</p>`
    : `<p>The Ethics Committee acknowledges your request for reassignment to this body. Such a request is not made lightly. It requires a willingness to place oneself under a different kind of scrutiny \u2014 one that does not concern containment breaches or operational failure, but the far more uncomfortable question of whether the Foundation is justified in what it does.</p>
       <p>Your application has been reviewed by the Committee sitting in closed session. We have weighed your record of service, the circumstances of your request, and the character of your prior conduct. The following determination has been reached.</p>
       <div class="determination">Your application has been accepted for interview.</div>
       <p>The Committee finds that you demonstrate the temperament and discretion requisite for consideration as ${member ? 'a Member of' : 'an Assistant to'} the Ethics Committee. This is not a commendation. It is an invitation to be assessed further, and the interview will determine whether that initial judgement is borne out.</p>
       <p>You will be contacted in due course by a representative of the Committee to arrange the time and manner of your interview. Do not seek us out. The Committee keeps its own schedule, and its own terms. We are aware of your location and your movements; we will make contact when it is appropriate to do so.</p>
       <p>You will be asked to speak to the following:</p>
       <div class="judgment">
         <div class="para">your understanding of the Foundation\u2019s ethical framework, and of the Committee\u2019s place within it;</div>
         <div class="para">the circumstances that led you to seek this reassignment;</div>
         <div class="para">and any matter you believe the Committee ought to know.</div>
       </div>
       <p>You are not expected to rehearse answers. You are expected to be honest. You will not be asked to prove your competence \u2014 you will be asked to account for your conscience.</p>`;

  const inner = `
    ${letterhead('ethics-committee', 'Office of the Ethics Committee')}
    <hr class="rule" />
    <div class="doc-title">${esc(title)}</div>
    <hr class="rule" />
    <div class="letter-date">${today}</div>
    <div class="letter-addr">
      <div class="la-name">${esc(recruit.name || 'The Candidate')}</div>
      <div class="la-ref">Ref. ${ref}${recruit.steamId ? ` \u00b7 ${esc(recruit.steamId)}` : ''}</div>
    </div>
    <div class="memo-body">
      <p class="letter-salut">Dear ${esc(recruit.name || 'Candidate')},</p>
      ${body}
      <div class="letter-vale">By direction of the Ethics Committee,</div>
    </div>
    ${signBlock({ name: esc(actor?.designation || 'ETHICS COMMITTEE'), role: 'For and on behalf of the Ethics Committee', dated: `Issued ${today}` })}
    <div class="creed">\u25c6 The Ethics Committee does not answer to the departments it oversees \u25c6</div>
  `;

  return frameDoc({
    title,
    classification: 'FOUNDATION GENERAL \u00b7 FOR THE NAMED CANDIDATE',
    inner,
    org: 'ethics-committee',
    distribution: 'The named candidate.',
    footerRef: recruit.ref || 'APPLICATION',
    actor,
    letter: true,
  });
}

// ===========================================================================
// ETHICS ASSISTANT \u2014 CANDIDATE FEEDBACK SHEET
// The candidate-FACING development sheet built from CAIRO's assessment: each
// scenario with the candidate's recorded answer and a constructive feedback
// point, then overall strengths and points for improvement. Deliberately
// carries NO grades, NO marking criteria and NO recommendation \u2014 those are the
// Committee's channel (the interviewer's script); this sheet is for the
// candidate's growth.
// ===========================================================================
export function buildFeedbackSheetHTML(recruit, actor) {
  const member = recruit && recruit.track === 'member';
  const bank = interviewSetFor(recruit).map((q) => ({ ...q, custom: false }));
  const custom = (recruit.customQuestions || []).map((q) => ({
    id: q.id, category: 'Committee-added', prompt: q.prompt, custom: true,
  }));
  const items = [...bank, ...custom];
  const responses = recruit.interviewResponses || {};
  const assessment = recruit.interviewAssessment || null;
  const today = longDate(new Date().toISOString());

  const qBlocks = items.map((q, i) => {
    const stored = responses[q.id];
    const answer = stored && String(stored.text || '').trim();
    const fb = assessment && assessment.perQuestion && assessment.perQuestion[q.id]
      ? String(assessment.perQuestion[q.id].feedback || '').trim() : '';
    return `
    <section class="fb-q">
      <div class="fb-qhead"><span class="fb-n">${i + 1}</span>${esc(q.category)}</div>
      <div class="fb-prompt">${esc(q.prompt)}</div>
      <div class="fb-label">Your answer, as recorded</div>
      ${answer ? `<div class="fb-answer">${esc(answer)}</div>` : '<p class="muted">No answer was recorded for this scenario.</p>'}
      ${fb ? `<div class="fb-feedback"><span class="fb-k">Feedback \u2014</span> ${esc(fb)}</div>` : ''}
    </section>`;
  }).join('');

  const strengths = assessment && String(assessment.strengths || '').trim();
  const improvements = assessment && String(assessment.improvements || '').trim();
  const overallBlock = (strengths || improvements) ? `
    ${strengths ? `<div class="jhead">Strengths</div>${paras(strengths)}` : ''}
    ${improvements ? `<div class="jhead">Points for Improvement</div>${paras(improvements)}` : ''}`
    : '<div class="jhead">Overall</div><p class="muted">Overall feedback is pending assessment.</p>';

  const inner = `
    ${letterhead('ethics-committee', 'Office of the Ethics Committee')}
    <hr class="rule" />
    <div class="doc-title">Interview Feedback</div>
    <div class="doc-sub">${member ? 'Member of' : 'Assistant to'} the Ethics Committee \u2014 Candidate</div>
    <hr class="rule" />
    <div class="letter-date">${today}</div>
    <div class="letter-addr">
      <div class="la-name">${esc(recruit.name || 'The Candidate')}</div>
      <div class="la-ref">Ref. ${esc(recruit.ref || '\u2014')}</div>
    </div>
    <div class="memo-body">
      <p class="letter-salut">Dear ${esc(recruit.name || 'Candidate')},</p>
      <p>The Committee has considered the answers you gave at interview. The scenarios put to you carry no
      single correct response; what follows concerns the quality of the reasoning you brought to them, set
      down plainly and without flattery. Read it as it is meant \u2014 an account of where your judgement held
      and where it did not, recorded whatever the outcome of your application.</p>
    </div>
    ${qBlocks}
    ${overallBlock}
    <div class="letter-vale">By direction of the Ethics Committee,</div>
    ${signBlock({ name: esc(actor?.designation || 'ETHICS COMMITTEE'), role: 'For and on behalf of the Ethics Committee', dated: `Issued ${today}` })}
    <div class="creed">\u25c6 The Ethics Committee does not answer to the departments it oversees \u25c6</div>
  `;

  return frameDoc({
    title: 'Interview Feedback',
    classification: 'FOUNDATION GENERAL \u00b7 FOR THE NAMED CANDIDATE',
    inner,
    org: 'ethics-committee',
    distribution: 'The named candidate.',
    footerRef: recruit.ref || 'APPLICATION',
    actor,
    letter: true,
  });
}

// ===========================================================================
// ETHICS TRIBUNAL \u2014 SUMMONS TO APPEAR
// The formal instrument behind a docket summons entry: who is summoned, in what
// matter, on what grounds, over the issuing authority's signature.
// ===========================================================================
export function buildSummonsHTML(record, m, actor) {
  const kindLower = (CASE_KIND[record.kind]?.label || record.kind).toLowerCase();
  const addressee = m.targetId
    ? personRef(m.targetId, m.targetName)
    : esc([m.targetName || '', m.targetDept || ''].filter(Boolean).join(' \u2014 ') || 'the party named in the record');

  const inner = `
    ${letterhead('ethics-committee', 'Office of Tribunals')}
    <hr class="rule" />
    <div class="court">In the Ethics Committee of the SCP Foundation</div>
    <div class="matter">In the matter of a ${esc(kindLower)} concerning ${esc(record.title)}</div>
    <div class="caseno">Case No. ${esc(record.ref)}</div>
    <hr class="rule--bold" />
    <div class="doc-title">Summons to Appear</div>
    <hr class="rule--bold" />
    <table class="memo-h"><tbody>
      <tr><td class="ml">To</td><td>${addressee}</td></tr>
      <tr><td class="ml">Issued</td><td>${longDate(m.ts)}</td></tr>
      <tr><td class="ml">Issuing officer</td><td>${esc(m.by || '\u2014')}</td></tr>
    </tbody></table>
    <div class="memo-body">
      <p>You are hereby summoned to appear before the Ethics Committee of the SCP Foundation in the
      above-entitled matter, for the following reason:</p>
      ${paras(m.reason)}
      <p>You are to present yourself before the Committee at the sitting notified to you by the Office of
      Tribunals, and to bring with you any records or materials in your keeping that bear on the matter.
      You may address the Committee and be heard.</p>
      <p>Failure to appear without cause shown is itself a matter for the Committee and will be recorded
      upon the case.</p>
      <p>Given under the seal of the Ethics Committee at ${esc(CONFIG.facility)}, this ${longDate(m.ts)}.</p>
    </div>
    ${signBlock({ name: esc(m.by || 'ETHICS COMMITTEE'), role: 'By order of the Ethics Committee, Office of Tribunals', dated: `Issued ${longDate(m.ts)}` })}
  `;

  return frameDoc({
    title: 'Summons to Appear',
    classification: banner(record.clearance, 'Ethics Committee'),
    inner,
    org: 'ethics-committee',
    distribution: 'The summoned party; the case file; the Office of Tribunals.',
    footerRef: `${record.ref}-SUM`,
    actor,
  });
}

// ===========================================================================
// WEEKLY ENGAGEMENT SUMMARY — command roll-up sheet
// ===========================================================================
// `summary` is prepared by the engagement view (which owns the scoring), so this
// builder stays decoupled from the engagement model:
//   { weekLabel, totalMax, sections:[{key,label,max}], atRisk,
//     rows:[{designation,codename,rank,val:{key:score},total,req1,req2}] }
export function buildEngagementSummaryHTML(summary, actor) {
  const { weekLabel, sections, totalMax, rows, atRisk, org = 'omega-1', orgLabel = 'MTF Omega-1' } = summary;
  const th = 'border-bottom:1px solid #111;padding:4px 5px;font-size:9px;letter-spacing:.04em;text-transform:uppercase';
  const td = 'padding:4px 5px;border-bottom:1px solid #ccc;font-size:10px';
  const body = rows.length ? rows.map((r) => `
      <tr>
        <td style="${td};text-align:left">${esc(r.designation)} ${esc(r.codename || '')}<div style="font-size:8px;color:#555">${esc(r.rank || '')}</div></td>
        ${sections.map((s) => `<td style="${td};text-align:center">${r.val[s.key]}</td>`).join('')}
        <td style="${td};text-align:center;font-weight:700">${r.total}/${totalMax}</td>
        <td style="${td};text-align:center">${r.req1 ? '✓' : '✕'} ${r.req2 ? '✓' : '✕'}</td>
      </tr>`).join('') : `<tr><td style="${td}" colspan="${sections.length + 3}">No active operators.</td></tr>`;

  const inner = `
    ${letterhead(org === 'isd' ? 'isd' : 'omega-1', 'Command Section')}
    <hr class="rule" />
    <div class="doc-title">Weekly Engagement Summary</div>
    <div class="doc-sub">${esc(orgLabel)}</div>
    <div class="doc-sub">Review week: ${esc(weekLabel)}</div>
    <hr class="rule" />
    ${atRisk ? `<p class="muted"><strong>${esc(String(atRisk))}</strong> operator(s) below the weekly engagement requirement this week.</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin-top:6px">
      <thead><tr>
        <th style="${th};text-align:left">Operator</th>
        ${sections.map((s) => `<th style="${th};text-align:center">${esc(s.label)}</th>`).join('')}
        <th style="${th};text-align:center">Total</th>
        <th style="${th};text-align:center">Reqs</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="muted" style="margin-top:8px">Reqs: (1) one Scouting / Order / Evidence / PoI engagement this week; (2) one training hosted in the trailing three weeks. Derived sections are recomputed from the records at time of issue.</p>
  `;

  return frameDoc({
    title: 'Weekly Engagement Summary',
    classification: banner('CL4-S', 'Command'),
    inner,
    org: 'omega-1',
    distribution: org === 'isd' ? 'Internal Security Department.' : 'Omega-1 Command; Site Command.',
    footerRef: org === 'isd' ? 'ISD-ENG-SUMMARY' : 'O1-ENG-SUMMARY',
    actor,
  });
}

// ===========================================================================
// SIDE-EFFECTING EXPORT (new tab, or download if pop-ups blocked)
// ===========================================================================
function openDocument(html, downloadName) {
  let w = null;
  try { w = window.open('', '_blank'); } catch (_) { w = null; }
  if (w && w.document) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    toast('Document generated.', 'success');
  } else {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Document downloaded (pop-up was blocked).', 'success');
  }
}

export function exportCase(app, record) {
  logAction(app.user, 'EXPORT_CASE', `Generated tribunal record for ${record.ref}.`);
  openDocument(buildCaseDocumentHTML(record, app.user), `${record.ref}-record-of-proceedings.html`);
}
export function exportSubject(app, subject) {
  logAction(app.user, 'EXPORT_SUBJECT', `Generated surveillance record for ${subject.ref}.`);
  openDocument(buildSubjectDocumentHTML(subject, app.user), `${subject.ref}-surveillance-report.html`);
}
export function exportPersonnel(app, user) {
  logAction(app.user, 'EXPORT_PERSONNEL', `Generated personnel file for ${user.designation}.`);
  openDocument(buildPersonnelDocumentHTML(user, app.user), `${user.designation}-service-record.html`);
}
export function exportDirective(app, directive) {
  logAction(app.user, 'EXPORT_DIRECTIVE', `Generated memorandum for ${directive.ref}.`);
  openDocument(buildDirectiveDocumentHTML(directive, app.user), `${directive.ref}-memorandum.html`);
}
export function exportInterviewScript(app, recruit) {
  logAction(app.user, 'EXPORT_INTERVIEW', `Generated interview script for ${recruit.ref || 'application'}.`);
  openDocument(buildInterviewScriptHTML(recruit, app.user), `${recruit.ref || 'application'}-interview-script.html`);
}
export function exportInterviewInvite(app, recruit, accepted = false) {
  logAction(app.user, 'EXPORT_DOCUMENT', `Generated ${accepted ? 'appointment notice' : 'interview invitation'} for ${recruit.ref || 'application'}.`);
  openDocument(buildInterviewInviteHTML(recruit, app.user, accepted), `${recruit.ref || 'application'}-${accepted ? 'appointment' : 'interview-invitation'}.html`);
}
export function exportFeedbackSheet(app, recruit) {
  logAction(app.user, 'EXPORT_DOCUMENT', `Generated candidate feedback sheet for ${recruit.ref || 'application'}.`);
  openDocument(buildFeedbackSheetHTML(recruit, app.user), `${recruit.ref || 'application'}-interview-feedback.html`);
}
export function exportSummons(app, record, m) {
  logAction(app.user, 'EXPORT_SUMMONS', `Generated summons document in ${record.ref}.`);
  openDocument(buildSummonsHTML(record, m, app.user), `${record.ref}-summons.html`);
}
export function exportSourceFile(app, src) {
  logAction(app.user, 'EXPORT_INTEL', `Generated source file for ${src.ref}.`);
  openDocument(buildSourceFileHTML(src, app.user), `${src.ref}-source-file.html`);
}
export function exportEngagementSummary(app, summary) {
  logAction(app.user, 'EXPORT_ENGAGEMENT', `Generated Omega-1 engagement summary (${summary.weekLabel}).`);
  openDocument(buildEngagementSummaryHTML(summary, app.user), 'omega-1-engagement-summary.html');
}
export function exportAfterAction(app, op) {
  const closed = op.status === 'concluded' || op.status === 'aborted';
  logAction(app.user, 'EXPORT_OPERATION', `Generated ${closed ? 'after-action report' : 'operation record'} for ${op.ref}.`);
  openDocument(buildAfterActionHTML(op, app.user), `${op.ref}-${closed ? 'after-action' : 'operation-record'}.html`);
}

// =============================================================================
// FOUNDATION IDENTIFICATION CARD
// Printable credential, CR80 card stock (85.6 \u00d7 54 mm), front and back. The
// card carries the codename and designation only \u2014 legal identity never
// appears on a carry document. Clearance is shown as a coloured band.
// =============================================================================
const CLEARANCE_BAND = {
  'CL3': { color: '#4a5361', label: 'LEVEL 3 \u00b7 SECRET' },
  'CL4-J': { color: '#8a6d1a', label: 'LEVEL 4 \u00b7 TOP SECRET (J)' },
  'CL4-S': { color: '#7a4a12', label: 'LEVEL 4 \u00b7 TOP SECRET (S)' },
  'CL5': { color: '#7a1010', label: 'LEVEL 5 \u00b7 THAUMIEL' },
};

export function buildIdCardHTML(user) {
  const band = CLEARANCE_BAND[user.clearance] || { color: '#4a5361', label: user.clearance || 'UNGRADED' };
  const code = user.org === 'omega-1' ? 'O1' : user.org === 'ethics-committee' ? 'EC' : 'CMD';
  const controlNo = `CAIRO/${code}/ID-${user.designation}`;
  const issued = longDate(new Date().toISOString());
  const seal = orgSeal(user.org);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(user.designation)} \u2014 Foundation Identification</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #6b6b6b; font-family: Arial, Helvetica, sans-serif; }
  .controls { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #2b2b2b; }
  .controls button { font-size: 13px; padding: 7px 16px; border: 1px solid #555; background: #f4f4f2; cursor: pointer; border-radius: 3px; }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 26px 0 40px; }
  .side-label { color: #ccc; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
  .cardface {
    width: 340px; height: 214px; background: #fff; border-radius: 10px; position: relative; overflow: hidden;
    box-shadow: 0 3px 14px rgba(0,0,0,.45); color: #111;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cf__wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: .06; }
  .cf__wm img, .cf__wm svg { width: 150px; height: 150px; }
  .cf__head { display: flex; align-items: center; gap: 8px; padding: 9px 12px 5px; position: relative; }
  .cf__head img, .cf__head svg { width: 30px; height: 30px; }
  .cf__org { font-size: 12px; font-weight: 800; letter-spacing: .22em; }
  .cf__auth { font-size: 6.6px; letter-spacing: .14em; color: #444; margin-top: 1px; }
  .cf__body { display: flex; gap: 10px; padding: 3px 12px 0; position: relative; }
  .cf__photo { width: 78px; height: 96px; border: 1px dashed #999; display: flex; align-items: center; justify-content: center; font-size: 7px; color: #777; letter-spacing: .1em; text-align: center; flex: 0 0 auto; background: #f6f6f4; }
  .cf__id { flex: 1; min-width: 0; }
  .cf__desig { font-family: 'Courier New', monospace; font-weight: 700; font-size: 24px; letter-spacing: .04em; }
  .cf__code { font-size: 13px; font-weight: 700; text-transform: uppercase; margin-top: 1px; }
  .cf__rank { font-size: 9px; color: #333; margin-top: 3px; }
  .cf__kv { font-size: 7.2px; color: #555; margin-top: 6px; line-height: 1.5; }
  .cf__kv .mono { font-family: 'Courier New', monospace; color: #111; }
  .cf__band { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 12px; color: #fff; font-size: 8.5px; font-weight: 800; letter-spacing: .14em; display: flex; justify-content: space-between; }
  /* back */
  .cf__stripe { height: 34px; background: #161616; margin-top: 16px; }
  .cf__terms { padding: 10px 14px 0; font-size: 7px; color: #333; line-height: 1.55; text-align: justify; position: relative; }
  .cf__sig { margin: 10px 14px 0; border-bottom: 1px solid #111; height: 22px; position: relative; }
  .cf__sigl { padding: 2px 14px; font-size: 6.4px; color: #555; letter-spacing: .1em; }
  .cf__ctrl { position: absolute; bottom: 6px; right: 12px; font-family: 'Courier New', monospace; font-size: 7px; color: #444; }
  @page { size: A4; margin: 14mm; }
  @media print {
    html, body { background: #fff; }
    .controls { display: none; }
    .wrap { gap: 10mm; padding: 0; }
    .cardface { width: 85.6mm; height: 54mm; box-shadow: none; border: 1px solid #bbb; border-radius: 3mm; }
    .side-label { color: #666; }
  }
</style>
</head>
<body>
  <div class="controls"><button onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>
  <div class="wrap">
    <div class="side-label">Front</div>
    <div class="cardface">
      <div class="cf__wm">${seal}</div>
      <div class="cf__head">${seal}<div><div class="cf__org">SCP FOUNDATION</div><div class="cf__auth">${authorityLine(user.org)}</div></div></div>
      <div class="cf__body">
        <div class="cf__photo">AFFIX<br/>PHOTOGRAPH<br/>(35\u00d745)</div>
        <div class="cf__id">
          <div class="cf__desig">${esc(user.designation)}</div>
          <div class="cf__code">\u201c${esc(user.codename || '')}\u201d</div>
          <div class="cf__rank">${esc(user.rank || '')}</div>
          <div class="cf__kv">ISSUED <span class="mono">${esc(issued)}</span><br/>CONTROL <span class="mono">${esc(controlNo)}</span></div>
        </div>
      </div>
      <div class="cf__band" style="background:${band.color}"><span>${esc(band.label)}</span><span>SECURE \u00b7 CONTAIN \u00b7 PROTECT</span></div>
    </div>
    <div class="side-label">Back</div>
    <div class="cardface">
      <div class="cf__stripe"></div>
      <div class="cf__terms">This credential is the property of the SCP Foundation and must be surrendered on demand to any officer of Site Command or the Ethics Committee. It confers access strictly to the level marked and does not exempt the bearer from need-to-know controls. Loss or theft must be reported to the issuing office immediately. Unauthorised use, alteration or reproduction is a matter for the Ethics Committee.</div>
      <div class="cf__sig"></div>
      <div class="cf__sigl">BEARER\u2019S SIGNATURE</div>
      <div class="cf__ctrl">${esc(controlNo)}</div>
    </div>
  </div>
</body>
</html>`;
}

export function exportIdCard(app, user) {
  openDocument(buildIdCardHTML(user), `${user.designation}-id-card.html`);
  logAction(app.user, 'EXPORT_DOCUMENT', `Identification card issued for ${user.designation}.`);
}

// =============================================================================
// AWARD CITATION — a formal certificate for a conferred decoration, in the
// shared records framework. Unclassified by design: citations are presented.
// =============================================================================
export function buildMedalCertificateHTML(user, award, actor) {
  const inner = `
    ${letterhead(user.org, 'Office of Honours and Awards')}
    <hr class="rule" />
    <div class="doc-title">Award of the ${esc(award.title)}</div>
    <div class="judgment">
      <p style="text-align:center;margin-top:14px">By direction of ${esc(authorityBody(user.org))}${award.by ? `, upon the recommendation of <span class="mono">${esc(award.by)}</span>` : ''}, the decoration styled</p>
      <div class="court" style="margin:10px 0">${esc(award.title)}</div>
      <p style="text-align:center">is conferred upon</p>
      <div class="parties"><div class="party" style="justify-content:center;gap:10px"><span class="pname mono">${esc(user.designation)}</span><span class="pname">\u201c${esc(user.codename || '')}\u201d</span></div></div>
      <div class="jhead" style="text-align:center">Citation</div>
      <p class="attest" style="margin:0 auto 14px;text-align:center;max-width:520px">${esc(award.note || 'For service in keeping with the highest traditions of the Foundation.')}</p>
    </div>
    ${signBlock({ name: esc(award.by || 'COMMAND'), role: `For ${authorityBody(user.org)}`, dated: `Conferred ${longDate(award.date)}` })}`;
  return frameDoc({
    title: `Award of the ${award.title}`,
    classification: 'FOUNDATION GENERAL \u00b7 COMMENDATORY \u00b7 FOR PRESENTATION',
    inner,
    footerRef: `CIT-${(user.designation || '').replace(/\s+/g, '')}-${(award.id || '').slice(-4).toUpperCase()}`,
    actor,
    org: user.org,
    distribution: 'The recipient; the recipient\u2019s chain of command; Office of Personnel.',
  });
}

export function exportMedalCertificate(app, user, award) {
  openDocument(buildMedalCertificateHTML(user, award, app.user), `${user.designation}-citation.html`);
  logAction(app.user, 'EXPORT_DOCUMENT', `Award citation issued for ${user.designation} (${award.title}).`);
}

// =============================================================================
// CUSTOM DOCUMENTS — renders a user-composed block document through the shared
// records framework. Each block maps to house-style furniture; nothing here can
// render outside the established look.
// =============================================================================
function renderDocBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (b.type === 'heading') return `<div class="jhead">${esc(b.text || '')}</div>`;
    if (b.type === 'paragraph') return `<p>${esc(b.text || '').replace(/\n/g, '<br/>')}</p>`;
    if (b.type === 'clauses') {
      const items = (b.items || []).filter((x) => String(x).trim());
      return items.length ? `<div class="judgment">${items.map((x) => `<div class="para">${esc(x)}</div>`).join('')}</div>` : '';
    }
    if (b.type === 'list') {
      const items = (b.items || []).filter((x) => String(x).trim());
      return items.length ? `<ul class="plainlist">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    }
    if (b.type === 'fields') {
      const rows = (b.rows || []).filter((r) => (r.k || r.v));
      return rows.length ? `<table class="memo-h"><tbody>${rows.map((r) => `<tr><td class="ml">${esc(r.k || '')}</td><td>${esc(r.v || '')}</td></tr>`).join('')}</tbody></table>` : '';
    }
    if (b.type === 'log') {
      const rows = (b.entries || []).filter((r) => (r.date || r.text));
      return rows.length ? `<table class="log"><tbody>${rows.map((r) => `<tr><td class="ld">${esc(r.date || '—')}</td><td>${esc(r.text || '')}</td></tr>`).join('')}</tbody></table>` : '';
    }
    if (b.type === 'quote') {
      if (!String(b.text || '').trim()) return '';
      return `<blockquote class="docquote">${esc(b.text).replace(/\n/g, '<br/>')}${b.by ? `<div class="docquote__att">— ${esc(b.by)}</div>` : ''}</blockquote>`;
    }
    if (b.type === 'notice') {
      if (!String(b.text || '').trim()) return '';
      return `<div class="notice${b.tone === 'advisory' ? ' notice--soft' : ''}">${esc(b.text).replace(/\n/g, '<br/>')}</div>`;
    }
    if (b.type === 'withheld') {
      const reason = String(b.reason || '').trim() || 'BY ORDER OF SITE COMMAND';
      return `<div class="withheld">[ CONTENT WITHHELD — ${esc(reason.toUpperCase())} ]</div>`;
    }
    if (b.type === 'rule') return '<hr class="rule" />';
    if (b.type === 'signature') {
      return signBlock({ name: esc(b.name || ''), role: b.role || '', dated: b.dated || '' });
    }
    return '';
  }).join('\n');
}

export function buildCustomDocumentHTML(doc, actor) {
  const office = doc.office || 'Office of Record';
  const inner = `
    ${letterhead(doc.org, office)}
    <hr class="rule" />
    <div class="doc-title">${esc(doc.title || 'Untitled Document')}</div>
    ${doc.status === 'draft' ? '<div class="notice notice--soft">DRAFT \u2014 NOT YET ISSUED</div>' : ''}
    ${renderDocBlocks(doc.blocks)}`;
  return frameDoc({
    title: doc.title || 'Document',
    classification: banner(doc.classification, 'Document'),
    inner,
    footerRef: doc.ref || 'DOC',
    actor,
    org: doc.org,
    distribution: doc.distribution || null,
  });
}

export function exportCustomDocument(app, doc) {
  openDocument(buildCustomDocumentHTML(doc, app.user), `${(doc.ref || 'document')}.html`);
  logAction(app.user, 'EXPORT_DOCUMENT', `Exported ${doc.ref || 'a custom document'}.`);
}
