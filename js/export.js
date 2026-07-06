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
import { interviewSetFor } from './interview-bank.js';

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
const banner = (code, category) => `${(clrLabel(code)).toUpperCase()} \u00b7 RESTRICTED \u00b7 ${category.toUpperCase()} \u00b7 EYES ONLY`;

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
const SEAL_PAPER = '#fffdf8';

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

const OMEGA_SEAL = sealSvg({ id: 'o1', top: 'MOBILE TASK FORCE \u03a9-1', topSize: 7.4, banner: 'LAW\u2019S LEFT HAND', motif: OMEGA_MOTIF });
const ETHICS_SEAL = sealSvg({ id: 'ec', top: 'ETHICS COMMITTEE', topSize: 8, banner: 'IN CONSCIENCE BOUND', motif: ETHICS_MOTIF });

export function orgSeal(orgKey) {
  const logo = orgLogo(orgKey);
  if (logo) return `<img src="${logo}" alt="" width="88" height="88" style="display:block;object-fit:contain;" />`;
  return SEAL;
}

function letterhead(orgKey, office) {
  return `<div class="lh">
    <div class="lh__seal">${orgSeal(orgKey)}</div>
    <div class="lh__org">SCP Foundation</div>
    <div class="lh__body">${esc(authorityBody(orgKey))}</div>
    <div class="lh__office">${esc(office)}</div>
  </div>`;
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #717171; }
  body { font-family: 'Times New Roman', Times, Georgia, serif; color: #1a1a1a; font-size: 12pt; line-height: 1.55; }

  .controls { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #2b2b2b; box-shadow: 0 1px 6px rgba(0,0,0,.4); }
  .controls button { font-family: Arial, Helvetica, sans-serif; font-size: 13px; padding: 7px 16px; border: 1px solid #555; background: #f2efe8; color: #1b1b1a; border-radius: 3px; cursor: pointer; }
  .controls button:hover { background: #fff; }
  .controls .ghost { background: transparent; color: #ddd; }

  .sheet { background: #fffdf8; max-width: 820px; margin: 22px auto; box-shadow: 0 2px 20px rgba(0,0,0,.45); }
  .pad { padding: 58px 74px 46px; }

  .classbar { text-align: center; font-family: Arial, Helvetica, sans-serif; font-weight: 700; letter-spacing: .2em; font-size: 9pt; color: #6e1414; text-transform: uppercase; padding: 6px 0; border-top: 1.5px solid #6e1414; border-bottom: 1.5px solid #6e1414; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .classbar--top { margin-bottom: 26px; }
  .classbar--bottom { margin-top: 30px; }

  /* Letterhead */
  .lh { text-align: center; color: #2a2622; }
  .lh__org { font-size: 10pt; letter-spacing: .4em; text-transform: uppercase; margin-top: 6px; color: #333; }
  .lh__body { font-size: 17pt; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; margin-top: 2px; }
  .lh__office { font-size: 9.5pt; letter-spacing: .3em; text-transform: uppercase; color: #555; margin-top: 4px; }

  hr.rule { border: none; border-top: 1px solid #1a1a1a; margin: 12px 0; }
  hr.rule--bold { border: none; border-top: 2.5px solid #1a1a1a; margin: 5px 0; }

  p { margin: 0 0 11px; text-align: justify; }
  .muted { color: #6a6a6a; font-style: italic; }

  /* Court caption (judgment) */
  .court { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; font-size: 13pt; margin-top: 8px; }
  .matter { text-align: center; font-style: italic; margin: 12px auto 0; max-width: 86%; font-size: 11.5pt; }
  .caseno { text-align: center; margin-top: 8px; font-size: 11pt; letter-spacing: .05em; }
  .parties { margin: 20px auto 6px; max-width: 78%; }
  .party { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; gap: 16px; }
  .party .pname { font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .party .role { font-style: italic; color: #333; white-space: nowrap; }
  .vs { text-align: center; font-style: italic; margin: 4px 0; color: #333; }
  .doc-title { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; font-size: 13pt; padding: 9px 0; }
  .panel-line { text-align: center; font-size: 10.5pt; color: #333; margin-bottom: 4px; }

  /* Numbered judgment paragraphs */
  .judgment { counter-reset: para; margin-top: 14px; }
  .jhead { font-weight: 700; text-transform: uppercase; letter-spacing: .07em; font-size: 11pt; margin: 22px 0 9px; }
  .para { counter-increment: para; position: relative; padding-left: 2.7em; margin-bottom: 11px; text-align: justify; }
  .para::before { content: counter(para) "."; position: absolute; left: 0; top: 0; font-variant-numeric: tabular-nums; }
  .reclist { list-style: none; padding: 0 0 0 2.7em; margin: 0 0 11px; }
  .reclist li { padding: 2px 0; }
  .reclist .ref { font-family: 'Courier New', monospace; font-weight: 700; }

  .so { font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin: 22px 0 16px; }
  .votebox { border-collapse: collapse; margin: 2px auto 12px; }
  .votebox th { background: #efe9d9; font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; border: 1px solid #b9b2a0; padding: 4px 18px; }
  .votebox td { border: 1px solid #b9b2a0; padding: 7px 18px; text-align: center; font-size: 15pt; font-weight: 700; }
  .votemembers { border-collapse: collapse; width: 86%; margin: 0 auto 12px; }
  .votemembers td { border-bottom: 1px solid #d8d2c2; padding: 4px 8px; font-size: 10.5pt; }
  .votemembers .vm-pos { text-align: right; color: #444; }
  .sign { margin-top: 8px; }
  .sign__line { width: 280px; border-bottom: 1px solid #1a1a1a; height: 30px; }
  .sign__name { font-weight: 700; margin-top: 4px; }
  .sign__role, .sign__date { font-size: 10pt; color: #444; }

  /* Memorandum */
  .memo-title { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: .34em; font-size: 14pt; padding: 6px 0; }
  .memo-h { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  .memo-h td { padding: 4px 0; vertical-align: top; font-size: 11.5pt; }
  .memo-h .ml { width: 150px; font-family: Arial, Helvetica, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; font-size: 9.5pt; padding-top: 6px; }
  .memo-body { margin-top: 6px; }
  .signoff { margin-top: 26px; }
  .signoff .sn { font-weight: 700; }
  .signoff .sr { font-size: 10pt; color: #444; }

  /* Official record (personnel / surveillance) */
  .doc-sub { text-align: center; font-size: 10.5pt; letter-spacing: .12em; text-transform: uppercase; color: #555; margin-top: 4px; }
  .fieldgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 36px; margin: 18px 0 6px; }
  .field { display: flex; justify-content: space-between; gap: 14px; padding: 6px 0; border-bottom: 1px solid #ddd6c6; font-size: 11pt; }
  .field .fl { color: #555; font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; padding-top: 2px; }
  .field .fv { font-weight: 600; text-align: right; }

  .log { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .log td { padding: 7px 8px; border-bottom: 1px solid #e4ddcd; vertical-align: top; font-size: 11pt; }
  .log .ld { width: 130px; color: #555; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .04em; }
  .log .lby { font-size: 9.5pt; color: #777; font-style: italic; margin-top: 2px; }

  /* Markings */
  .notice { border: 1px solid #6e1414; color: #6e1414; padding: 9px 12px; margin: 16px 0; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; letter-spacing: .02em; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .notice--soft { border-color: #c4bda9; color: #555; }
  .withheld { text-align: center; border: 1px dashed #6e1414; color: #6e1414; padding: 16px; margin: 16px 0; font-family: 'Courier New', monospace; font-size: 10.5pt; letter-spacing: .08em; }
  .redacted { font-family: 'Courier New', monospace; background: #161616; color: #161616; padding: 0 4px; border-radius: 1px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sealed { font-family: 'Courier New', monospace; font-size: 10pt; letter-spacing: .05em; color: #6e1414; }

  .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ddd6c6; display: flex; justify-content: space-between; align-items: center; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #555; letter-spacing: .03em; }
  .foot__c { text-align: center; text-transform: uppercase; letter-spacing: .1em; }

  @page { size: A4; margin: 18mm 16mm; }
  @media print {
    html, body { background: #fff; }
    .controls { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; }
    .pad { padding: 0; }
    .para, .log tr, .sign, .field { page-break-inside: avoid; }
    .jhead, .memo-title, .doc-title { page-break-after: avoid; }
  }
`;

function frameDoc({ title, classification, inner, footerRef, actor }) {
  const gen = `Generated ${longDateTime(new Date().toISOString())} by ${esc(actor?.designation || 'SYSTEM')}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(footerRef)} \u2014 ${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="controls">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button class="ghost" onclick="window.close()">Close</button>
  </div>
  <div class="sheet"><div class="pad">
    <div class="classbar classbar--top">${esc(classification)}</div>
    ${inner}
    <div class="foot">
      <div>${gen}</div>
      <div class="foot__c">Property of the SCP Foundation \u2014 unauthorised disclosure prohibited</div>
      <div>${esc(footerRef)}</div>
    </div>
    <div class="classbar classbar--bottom">${esc(classification)}</div>
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
    blocks.push(`<div class="sign">
      <div class="sign__line"></div>
      <div class="sign__name">${presiding}</div>
      <div class="sign__role">Presiding, for and on behalf of the Ethics Committee</div>
      <div class="sign__date">Entered ${longDate(record.ruling.ts)}</div>
    </div>`);
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
    classification: `${banner(src.clearance, 'Intelligence')} \u2014 EYES ONLY`,
    inner,
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
        const exp = s.expiresAt ? (active ? ` \u00b7 expires ${longDate(s.expiresAt)}` : ` \u00b7 EXPIRED ${longDate(s.expiresAt)}`) : '';
        return `<tr><td class="ld">${longDate(s.date)}</td><td>${esc(s.reason)}${active ? '' : ' (expired)'}<div class="lby">Issued by ${esc(s.by)}${exp}</div></td></tr>`;
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
    <div class="signoff">
      <div class="sn">${esc(directive.issuedBy || 'SYSTEM')}</div>
      <div class="sr">Issuing authority, ${esc(authorityBody(directive.org))}</div>
    </div>
  `;

  return frameDoc({
    title: 'Memorandum',
    classification: banner(directive.clearance, 'Directive'),
    inner,
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
  .iv-intro .iv-warn { font-weight: bold; color: #6e1414; }
  .iv-q { margin: 14px 0; padding: 10px 12px; border: 1px solid #b9b0a0; border-left: 3px solid #6e1414; page-break-inside: avoid; }
  .iv-qhead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
  .iv-num { font-weight: bold; font-size: 13pt; }
  .iv-cat { font-variant: small-caps; letter-spacing: .04em; color: #555; font-size: 10pt; }
  .iv-tag { margin-left: auto; font-size: 8.5pt; font-variant: small-caps; letter-spacing: .04em; color: #6e1414; border: 1px solid #6e1414; padding: 0 6px; }
  .iv-prompt { margin: 4px 0 8px; }
  .iv-guide { background: #f1eee8; border: 1px solid #d8d1c4; padding: 6px 9px; font-size: 10.5pt; margin-bottom: 8px; }
  .iv-guide__row { display: flex; gap: 8px; margin: 3px 0; }
  .iv-guide__k { flex: 0 0 128px; font-weight: bold; }
  .iv-guide__row--weak .iv-guide__k { color: #6e1414; }
  .iv-k { font-variant: small-caps; letter-spacing: .04em; color: #555; font-size: 10pt; }
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
  const bank = interviewSetFor(recruit).map((q) => ({ ...q, custom: false }));
  const custom = (recruit.customQuestions || []).map((q) => ({
    id: q.id, category: 'Committee-added', prompt: q.prompt,
    valid: q.valid || '', weak: q.weak || '', custom: true,
  }));
  const items = [...bank, ...custom];

  const rankSought = recruit.rank ? esc(recruit.rank) : '\u2014';
  const candTable = `<table class="memo-h"><tbody>
    <tr><td class="ml">Candidate</td><td>${esc(recruit.name || '\u2014')}</td></tr>
    <tr><td class="ml">SteamID</td><td>${esc(recruit.steamId || '\u2014')}</td></tr>
    <tr><td class="ml">Department</td><td>${esc(recruit.department || '\u2014')}</td></tr>
    <tr><td class="ml">Rank sought</td><td>${rankSought}</td></tr>
    <tr><td class="ml">Reference</td><td>${esc(recruit.ref || '\u2014')}</td></tr>
    <tr><td class="ml">Date</td><td>${longDate(new Date().toISOString())}</td></tr>
  </tbody></table>`;

  const questionsHtml = items.map((q, i) => `
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
      ${ruledLines(3)}
      <div class="iv-marks"><span>Assessment:</span><span>${CHECK} Strong</span><span>${CHECK} Acceptable</span><span>${CHECK} Weak</span></div>
    </section>`).join('');

  const recBlock = `<section class="iv-rec">
    <div class="iv-rec__title">Overall Recommendation</div>
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
    <div class="memo-title">Interview Assessment \u2014 Ethics Assistant</div>
    <hr class="rule" />
    ${IV_STYLE}
    ${candTable}
    <hr class="rule" />
    <div class="iv-intro">
      <p><span class="iv-warn">INTERVIEWER\u2019S COPY \u2014 DO NOT DISCLOSE TO CANDIDATE.</span>
      This script carries the assessment guidance and is for the interviewing Member only.</p>
      <p>Read each scenario to the candidate and allow them to reason it through. There is no single correct answer;
      assess the quality of their reasoning against the guidance \u2014 a strong Assistant is neither a blind rule-follower
      nor a naive idealist. Mark each response, then record an overall recommendation.</p>
    </div>
    ${questionsHtml}
    ${recBlock}
  `;

  return frameDoc({
    title: 'Interview Assessment',
    classification: 'INTERVIEWER\u2019S COPY \u2014 DO NOT DISCLOSE TO CANDIDATE',
    inner,
    footerRef: recruit.ref || 'APPLICATION',
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
export function exportSourceFile(app, src) {
  logAction(app.user, 'EXPORT_INTEL', `Generated source file for ${src.ref}.`);
  openDocument(buildSourceFileHTML(src, app.user), `${src.ref}-source-file.html`);
}
export function exportAfterAction(app, op) {
  const closed = op.status === 'concluded' || op.status === 'aborted';
  logAction(app.user, 'EXPORT_OPERATION', `Generated ${closed ? 'after-action report' : 'operation record'} for ${op.ref}.`);
  openDocument(buildAfterActionHTML(op, app.user), `${op.ref}-${closed ? 'after-action' : 'operation-record'}.html`);
}
