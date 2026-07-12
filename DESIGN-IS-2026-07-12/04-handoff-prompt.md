# 04 — Handoff

````
/make-plan Refine the CAIRO.AIC export documents (js/export.js) based on a Dieter Rams audit (total 24/30).

Verdict paragraph (quoted from 03-verdict.md):
> Total 24/30 with no principle at 0 — the shared-frame system is sound; the failures are execution
> details concentrated in the letterhead, the candidate-facing letters, and one leaked internal
> accent, so refine in place rather than redesign.

Keep (already strong, do NOT touch in this pass):
- Principle #2 (useful) scored 3 — one-click print-ready, redaction-aware exports. Regression check: exportX functions still open/download; leak render-check passes.
- Principle #4 (understandable) scored 3 — every doc self-identifies. Regression check: title + banner present on each build.
- Principle #6 (honest) scored 3 — candidate sheet excludes grades/criteria/verdict. Regression check: rerun the feedback-sheet leak assertions.
- Principle #7 (long-lasting) scored 3 — serif/rules/seal conventions. Regression check: no trend styling introduced.
- Principle #9 (env) scored 3 — self-contained ~85KB. Regression check: no external assets added.

Fix in priority order (verbatim from 03-verdict.md):
1. #3 Aesthetic: rebuild letterhead() (non-wrapping name, larger seal, office·site line, double rule) and move the control block to the records footer. Evidence: screenshot wrap + frameDoc order.
2. #3: merge .doc-title/.memo-title into one title treatment.
3. #3/#6: de-red the candidate feedback sheet (quiet ruled sections; #7a1010 reserved for warnings/interviewer script).
4. #8: letter geometry (date right, addressee block, salutation, valediction) for invitation, appointment, feedback; drop their form tables.
5. #8: non-wrapping classification band; shorter candidate-letter marking 'FOUNDATION GENERAL · FOR THE NAMED CANDIDATE'.

Out of scope: Omega-1/Command documents beyond shared-chrome inheritance; ID card; medal certificate; app UI.

Deliverables: per-fix target lines in js/export.js; consolidated CSS changes in the shared CSS const; regression checklist above.

Anti-patterns: no new abstractions; don't restyle 3-scoring areas; no structural redesign; keep documents self-contained.
````
