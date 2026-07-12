# 01 — Evidence

## Visual (1 live screenshot @ localhost:8377/1-invite.html; remainder INFERRED from source)

- **[SCREENSHOT] Letterhead wraps.** "THE ETHICS COMMITTEE" breaks across two lines and the
  office line wraps ("OFFICE OF THE ETHICS / COMMITTEE"). Cause: `.lh__stack` centred between a
  56px seal and a 56px spacer, title 15pt letterspaced — no `white-space` guard (export.js `.lh__*` CSS).
- **[SCREENSHOT] Control block opens the page.** The `.ctrl` table (Control Nº / Date / Copy /
  Originator) renders ABOVE the letterhead — the document leads with bureaucratic metadata before
  identifying its issuer (frameDoc order: classbar → ctrl → inner(letterhead…), export.js frameDoc).
- **[SCREENSHOT] Classification caveat wraps.** "FOUNDATION GENERAL · ETHICS COMMITTEE · FOR THE
  NAMED CANDIDATE" runs to two lines in the top band.
- **[INFERRED] Two competing title systems.** `.doc-title` (13pt, ls .1em) vs `.memo-title`
  (13.5pt, ls .28em) — same role, two treatments (export.js CSS).
- **[INFERRED] Interviewer aesthetic leaks into the candidate feedback sheet.** `buildFeedbackSheetHTML`
  reuses `IV_STYLE` `.iv-q`: 1px #999 boxes with a 3px #7a1010 (blood-red) left bar per question —
  the security/interviewer accent on a candidate-facing letter.
- **[INFERRED] Letters are forms, not letters.** Invitation / appointment / feedback all open with a
  `memo-h` data TABLE (candidate/ref/date) and end at `signBlock` with no salutation or valediction;
  body begins "To <name>," as a paragraph (buildInterviewInviteHTML, buildFeedbackSheetHTML).
- **[INFERRED] Good bones:** crest watermark at .05 opacity; `//SIGNED ELECTRONICALLY//` notation;
  A4 @page with page-break-inside guards; print-color-adjust on all bands; distribution + handling
  block; classification repeated top/bottom (export.js CSS + frameDoc).

## Structural
- One shared chrome (`frameDoc`) serves all 14 builders — a single system. 2 interactive elements,
  both screen-only (Print/Close), hidden in print.
- Repeated-pattern divergence: three near-duplicate candidate tables (script/invite/feedback) with
  different rows; letters vs instruments undifferentiated.

## Copy & honesty
- "INTERVIEWER'S COPY — DO NOT DISCLOSE TO CANDIDATE" present on the script; candidate feedback
  sheet verifiably excludes grades/criteria/verdict (leak render-check, this session). No inflation,
  no dark patterns. Salutation "To Aldous, R.," reads abrupt; no closing line before the signature.

## Weight & friction
- Self-contained single file, 80–91KB (dominated by the base64 committee seal); zero network
  requests after load, zero JS beyond print/close, zero animation. (Sizes from render checks.)

## Accessibility (print artefact — skimmed)
- `lang="en"`, seal `alt=""`; headings are styled divs, not h1–h3 (minor for a print sheet).
