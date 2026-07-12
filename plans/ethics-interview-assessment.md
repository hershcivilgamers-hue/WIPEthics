# Plan — CAIRO-assisted Ethics Assistant interview assessment

## Goal

In the Ethics Assistant **interview** stage, let assigned interviewers type the
candidate's answers/notes per question, have the system produce an **advisory**
per-answer grade + overall "CAIRO recommends" verdict, and keep the **pass/fail
decision with CL5**. The recommendation is guidance, never the decision.

## Decisions (locked with the user)

1. **Who types responses:** a CL5 first **assigns interviewers** (Ethics cadre) to
   a candidate — like seating a tribunal panel. Assigned interviewers **and** CL5
   may then type responses. Assignment is CL5-only.
2. **The recommendation is saved on the record** (server-owned field, so a client
   can't forge a verdict), visible to Committee viewers and includable in the
   exported interviewer's script.
3. **Advisory only:** CAIRO never sets pass/fail. CL5's existing Pass/Fail buttons
   stay the final call.

## How this maps onto what already exists

- The Worker **already runs an LLM** for the CAIRO terminal
  (`worker/src/terminal.js`: Gemini when `GEMINI_API_KEY` is set, else Cloudflare
  Workers AI via `env.AI`). We reuse that provider selection for assessment — no
  new provider integration, no keys on the client.
- The interview UI + record already exist: `js/interview-bank.js`
  (`interviewSetFor`, `INTERVIEW_QUESTION_BANK`), the interview panel in
  `js/views/recruitment.js`, and the recruit gate in `worker/src/gate.js`
  (`authorizeRecruit`).
- "Assign interviewers" copies the tribunal **panel** pattern
  (`js/views/tribunals.js` `openPanel`, and the `votes`/`panelIds` integrity
  branch in `authorizeRecruit`/`authorizeCase`).
- "Server produces a verdict and writes it to the record" copies the
  **dedicated authorized endpoint** pattern (`worker/src/index.js`
  `resetPassphrase` + its `/api/users/:id/passphrase` route, and the client
  `api.resetPassphrase` + `openPassphrase` refetch-snapshot flow).
- A server-owned field that the generic sync path must never accept from the
  client copies how `salt`/`passwordHash` are frozen in
  `writeRecord` and listed in `SERVER_OWNED` (`worker/src/gate.js`).

> **Deploy reminder (both paths):** front-end changes (`js/`, `styles/`) ship via
> `git push` → GitHub Pages; Worker changes (`worker/src/**`) ship via
> `npx wrangler deploy` from `worker/`. Server mode is **live**
> (`config.js apiBaseUrl`), so client and Worker changes must land together — see
> the `deploy-topology` / `permissions-gate-split` project memories.

---

## Phase 0 — Allowed APIs & patterns (read these first; do NOT invent)

Everything below was read directly from this repo. Cite these when implementing.

### Record shape (recruit, Ethics interview)
`js/seed.js` `buildSeedRecruits` and `js/views/recruitment.js` `openCreate` define
the recruit record. Interview-relevant fields today:
`{ stage:'interview', interviewSeed:int, customQuestions:[{id,prompt,valid,weak,by,at}],
votes:{userId:'yes'|'no'}, tag, personnelFileId, version, ... }`.

**New fields this plan adds** (all default-empty; back-compatible):
- `interviewers: string[]` — userIds CL5 assigned. Default `[]`.
- `interviewResponses: { [questionId]: { text, by, at } }` — keyed by question id.
  Default `{}`.
- `interviewAssessment: { recommendation, summary, perQuestion:{[qid]:{grade,rationale}}, model, at, by } | null`
  — **server-owned**. Default `null`.

`questionId` = the stable id from `interviewSetFor(recruit)` items (bank ids like
`q_sapient_welfare`) or a custom question's `id`. Both carry `.id`, so responses
key uniformly. Re-rolling (`interviewSeed`) changes the drawn set; responses stay
keyed by id and orphaned ones are simply not shown.

### Interview draw / bank — `js/interview-bank.js`
- `INTERVIEW_BANK_DRAW = 5`.
- `INTERVIEW_QUESTION_BANK` — array of `{ id, category, prompt, valid, weak }`.
- `interviewSetFor(recruit)` — deterministic 5-item draw from `(recruit.id, interviewSeed)`.
- Module is **pure / dependency-free** — importable by both the client and the
  Worker (the Worker already imports `../../js/*`).

### LLM provider — `worker/src/terminal.js`
- `buildPersona(actor)`, `clampHistory`, `validateMessage`, `checkRate(userId)` — exported.
- `callGemini(env, system, history, text)` and `callWorkersAI(env, system, history, text)`
  — **currently module-private**; Phase 2 exports them.
- Provider selection logic (copy it): Gemini if `env.GEMINI_API_KEY`, else
  `env.AI` (Workers AI), else throw an `offline` error. See `askCairo`.
- `checkRate` returns `{ok}` / `{ok:false,error}` with an in-memory per-operator bucket.

### Dedicated authorized endpoint — `worker/src/index.js`
- `resetPassphrase(id, actor, request, repo, env)` — loads the record, checks
  authority, does the privileged server-only thing, `repo.update(...,version)`
  with a 409 on concurrent change, writes audit, returns `{ok, version}`.
- Its route: `handle()` matches `parts.length === 4 && parts[1] === 'users' &&
  parts[3] === 'passphrase' && method === 'POST'`. **Copy this route shape** for
  `POST /api/recruits/:id/assess`.
- `writeRecord` freezes server-owned fields from `cur` (users: `salt`,
  `passwordHash`, `mustChangePassphrase`) and strips redaction artifacts. **Copy
  this** to freeze `interviewAssessment` for recruits.
- `redactForActor(collection, actor, record, compMap)` — recruits fall through to
  `return record` (shipped whole), so new fields ride along automatically.

### Recruit gate — `worker/src/gate.js` `authorizeRecruit`
- Gated by `canParticipateRecruitment(actor, org)` (CL4+ with stake) at entry.
- Ethics branch: stage transitions are `isCL5`-only; then
  `if (cur.stage === 'interview' && !isCL5(actor)) return deny(...)` blocks all
  non-CL5 interview-stage edits; then per-field audit labels; vote-integrity via
  `changedOutside`. **This is the line Phase 1 loosens** — assigned interviewers
  may edit responses only.
- `SERVER_OWNED` set + `changedOutside(cur,next,allowed)` — the atomicity helper.
- Vote-integrity branch is the copy-template for "assigned-interviewer-only,
  responses-only, nothing-else-changed".

### Snapshot / visibility — `worker/src/redact.js`
`buildSnapshot`: `recruits: (db.recruits||[]).filter(!deleted && canViewRecruitment(actor,r))`
— recruits ship **whole** to the cadre + CL5. New fields are therefore visible to
Committee viewers (read-only for non-assigned). No redaction change needed.

### Client plumbing
- `js/api.js` `resetPassphrase(userId, passphrase)` — copy for `assessInterview(recruitId)`.
- `js/api.js` `serverMode()`, `request(method, path, body)`.
- `js/views/personnel.js` `openPassphrase` — after a dedicated-endpoint call,
  `applyServerSnapshot(await api.fetchSnapshot())` then `app.refresh()`. Copy this
  refetch pattern for the assess result.
- `js/views/recruitment.js` `mutate(app,id,version,patch,{action,detail})`,
  the `interviewPanel` IIFE (currently `isEthics && stage==='interview' && cl5`),
  the `dispatch` map, `exportInterviewScript`.
- `js/views/tribunals.js` `openPanel` — the checkbox seat-a-panel modal to copy
  for "Assign interviewers" (its member filter: `u.org==='ethics-committee' || u.org==='command'`, active only).

### Anti-patterns to avoid (all real risks here)
- ❌ Calling the model from the browser — API keys are Worker-only.
- ❌ Trusting a client-sent `interviewAssessment` — it must be server-owned.
- ❌ Assuming the model returns clean JSON — extract the first `{...}`, `JSON.parse`
  in try/catch, validate enums, keep a raw-text fallback.
- ❌ Adding a brand-new permission for responses — reuse
  `canParticipateRecruitment` + the interviewers list + the existing CL5 rule.
- ❌ Letting CAIRO set pass/fail — `passInterview`/`failInterview` stay CL5-only and manual.
- ❌ Shipping only the front-end — the gate + endpoint changes need `wrangler deploy`.

---

## Phase 1 — Data model, interviewer assignment, response capture

**Front-end + gate. No model calls yet.**

### 1a. Shared enums — `js/interview-bank.js`
Add (pure, so both client and Worker import them):
```js
export const INTERVIEW_GRADE = {
  strong:     { code:'strong',     label:'Strong',     tone:'ok'   },
  acceptable: { code:'acceptable', label:'Acceptable', tone:'warn' },
  weak:       { code:'weak',       label:'Weak',       tone:'bad'  },
};
export const INTERVIEW_RECOMMENDATION = {
  recommend:    { code:'recommend',    label:'Recommend',                 tone:'ok'   },
  reservations: { code:'reservations', label:'Recommend with reservations', tone:'warn' },
  decline:      { code:'decline',      label:'Do not recommend',          tone:'bad'  },
};
```

### 1b. Assign interviewers (CL5) — `js/views/recruitment.js`
- Copy `openPanel` from `js/views/tribunals.js` into a recruitment `openInterviewers(app, r)`:
  checkbox list of active `ethics-committee` + `command` users; save via `mutate`
  writing `rec.interviewers = ids`, action `SET_INTERVIEWERS`.
- Show it in the interview panel **for CL5 only**, plus a read-only "Interviewers"
  roster line (designation + codename) for everyone.

### 1c. Response capture — `js/views/recruitment.js` interview panel
- Broaden the panel gate so it renders when `isEthics && stage==='interview'` and
  the viewer is CL5 **or** an assigned interviewer (`(r.interviewers||[]).includes(actor.id)`)
  **or** any cadre (read-only).
- Per drawn question (`interviewSetFor(r)`) and per custom question, render a
  textarea seeded from `r.interviewResponses[q.id]?.text`. Editable iff
  `isCL5(actor) || (r.interviewers||[]).includes(actor.id)`; otherwise read-only.
- Save on blur / a "Save responses" button → `mutate(app, r.id, r.version, rec => {
  rec.interviewResponses = { ...(rec.interviewResponses||{}), [qid]: { text, by: actor.designation, at: nowISO } };
  }, { action:'EDIT_INTERVIEW_RESPONSE', detail:`Response recorded for ${r.ref}.` })`.
  (Follow the versioned `mutate` pattern already in the file; write responses in a
  single record write, not other fields.)

### 1d. Gate — `worker/src/gate.js` `authorizeRecruit` (Ethics interview stage)
Replace the blanket `if (cur.stage==='interview' && !isCL5(actor)) return deny(...)`
with field-aware rules (copy the vote-integrity/atomicity style):
- `interviewers` changed → **CL5 only** (`isCL5`), nothing else changed
  (`changedOutside(cur,next,['interviewers','version','updatedAt'])`), → `ok('SET_INTERVIEWERS', ...)`.
- `interviewResponses` changed → allowed if `isCL5(actor) || (cur.interviewers||[]).includes(actor.id)`;
  and `changedOutside(cur,next,['interviewResponses','version','updatedAt'])` must
  be false → `ok('EDIT_INTERVIEW_RESPONSE', ...)`.
- `interviewSeed` / `customQuestions` changed → **CL5 only** (unchanged).
- Any other interview-stage edit → **CL5 only** (preserve current behaviour).

### 1e. Freeze the server-owned field — `worker/src/index.js` `writeRecord`
Copy the users-credential freeze:
```js
if (collection === 'recruits' && cur) incoming.interviewAssessment = cur.interviewAssessment ?? null;
```
And add `interviewAssessment` to `SERVER_OWNED` in `gate.js` so it never registers
as a diff.

### Verification (Phase 1)
- `node --check` on all edited files.
- Grep: `grep -n interviewResponses js/views/recruitment.js worker/src/gate.js` shows
  writes gated as above.
- Manual (local or server): as CL5 assign an interviewer; as that interviewer type
  a response and save; as a non-assigned cadre member confirm the textareas are
  read-only. As a non-assigned member, a forged `interviewResponses` PUT must 403
  in server mode.

### Anti-pattern guards
- Responses write must be atomic (only `interviewResponses` changes) — mirror the
  vote-only branch.
- Do not let a non-assigned, non-CL5 actor write responses (gate + UI).

---

## Phase 2 — Server assessment endpoint (the model call)

**Worker + client api.js. Needs `wrangler deploy`.**

### 2a. Export the providers — `worker/src/terminal.js`
Add `export` to `callGemini` and `callWorkersAI` (signatures unchanged). Do **not**
rewrite `askCairo`.

### 2b. New module — `worker/src/interview-assess.js`
- `import { callGemini, callWorkersAI } from './terminal.js';`
- `import { interviewSetFor, INTERVIEW_QUESTION_BANK, INTERVIEW_GRADE, INTERVIEW_RECOMMENDATION } from '../../js/interview-bank.js';`
- `buildAssessmentSystem()` — an **assessor** persona (distinct from the CAIRO chat
  persona): "You are assessing an Ethics Committee Assistant candidate. For each
  scenario you are given the marking guidance (a strong vs weak answer) and the
  candidate's recorded answer. Grade each strong/acceptable/weak with a one-line
  rationale, then give an overall recommendation. Reply with ONLY a JSON object:
  `{ "perQuestion": [ { "id": "...", "grade": "strong|acceptable|weak", "rationale": "..." } ], "overall": { "recommendation": "recommend|reservations|decline", "summary": "..." } }`.
  No prose outside the JSON."
- `buildAssessmentUser(items, responses)` — one block per question: category,
  prompt, `valid`, `weak`, and the candidate's `responses[id]?.text || '(no answer recorded)'`.
- `callModel(env, system, user)` — copy `askCairo`'s selection: Gemini if
  `env.GEMINI_API_KEY` (`callGemini(env, system, [], user)`), else `env.AI`
  (`callWorkersAI(env, system, [], user)`), else `throw Object.assign(new Error('COGNITION CORE OFFLINE'), {offline:true})`.
- `extractJson(text)` — return the substring from first `{` to last `}`; `JSON.parse`
  in try/catch → `null` on failure.
- `normalizeAssessment(parsed, allowedIds)` (pure, exported, self-checkable):
  clamp `grade` to `INTERVIEW_GRADE` keys (default `acceptable`), `recommendation`
  to `INTERVIEW_RECOMMENDATION` keys (default `reservations`), coerce rationales to
  strings, keep only `perQuestion` entries whose `id ∈ allowedIds`, cap string
  lengths. Return `{ recommendation, summary, perQuestion:{[id]:{grade,rationale}} }`
  or `null` if unusable.
- `assessInterview(env, recruit)` — assemble items (`interviewSetFor(recruit)` +
  `recruit.customQuestions`), call `callModel`, `normalizeAssessment(extractJson(raw), ids)`;
  throw if null.

### 2c. Endpoint + route — `worker/src/index.js`
Copy the `resetPassphrase` route + handler:
```js
if (parts.length === 4 && parts[1] === 'recruits' && parts[3] === 'assess' && request.method === 'POST')
  return assessInterviewEndpoint(parts[2], actor, repo, env);
```
`assessInterviewEndpoint(id, actor, repo, env)`:
1. `const r = await repo.getById('recruits', id)`; 404 if missing/deleted.
2. `r.org === 'ethics-committee' && r.stage === 'interview'` else 409/400.
3. Authz: `isCL5(actor) || (r.interviewers||[]).includes(actor.id)`; also require
   `canParticipateRecruitment(actor,'ethics-committee')`; else 403.
4. `checkRate(actor.id)` → 429 with its message.
5. Require at least one non-empty response, else 400 "No responses to assess yet."
6. `const assessment = await assessInterview(env, r)` (catch `offline` → 503, other
   provider errors → 502 with an in-character message, mirroring the terminal route).
7. `const updated = { ...r, interviewAssessment: { ...assessment, model: providerLabel, at: nowISO, by: actor.designation }, updatedAt: nowISO, version: (r.version||1)+1 }`.
8. `repo.update('recruits', updated, r.version||1)`; 409 if `changed === 0`.
9. `repo.addAudit({ action:'ASSESS_INTERVIEW', detail:`CAIRO assessment recorded for ${r.ref}.` ... })`.
10. Return `{ ok:true, assessment: updated.interviewAssessment, version: updated.version }`.

### 2d. Client — `js/api.js`
```js
export function assessInterview(recruitId) {
  return request('POST', `/api/recruits/${encodeURIComponent(recruitId)}/assess`);
}
```

### Verification (Phase 2)
- `node --check worker/src/interview-assess.js worker/src/index.js worker/src/terminal.js js/api.js`.
- Node self-check (Phase 5) exercises `normalizeAssessment` + `extractJson`.
- After `wrangler deploy`, `curl -X POST .../api/recruits/<id>/assess -H "Authorization: Bearer <cl5-token>"`
  returns a normalized assessment; a non-assigned cadre token returns 403; a
  no-responses candidate returns 400.

### Anti-pattern guards
- `normalizeAssessment` must never trust model output: unknown grades →
  `acceptable`, unknown recommendation → `reservations`, unknown ids dropped.
- Provider errors surface as 502/503 with in-character text (copy the terminal
  route's error handling), never a 500 stack.
- The endpoint is the **only** writer of `interviewAssessment` (Phase 1e froze it
  everywhere else).

---

## Phase 3 — Interview panel UI: show the recommendation, keep the human call

**Front-end only. `git push`.**

`js/views/recruitment.js` (+ small CSS in `styles/operations.css` or `components.css`).

### 3a. "Ask CAIRO to assess" action
- Button in the interview panel, visible to CL5 **or** an assigned interviewer.
- `dispatch['iv-assess'] = () => assessInterview(app, r)` where the local wrapper:
  - if `!api.serverMode()` → toast "CAIRO assessment needs the server backend."
    (copy `terminal.js` local-mode guard);
  - else `await api.assessInterview(r.id)`; on success
    `applyServerSnapshot(await api.fetchSnapshot()); app.refresh();` (copy
    `openPassphrase`); toast; on error toast the message.

### 3b. Render the recommendation (advisory)
- Overall banner: `INTERVIEW_RECOMMENDATION[r.interviewAssessment.recommendation]`
  as a badge + `summary`, headed **"CAIRO recommendation — the interviewing Member
  decides."** Show `model` + `at` + `by` as provenance.
- Per question: a grade badge (`INTERVIEW_GRADE[...tone]`) + one-line rationale
  beside each question's response.
- If `interviewAssessment` is null: show "Not yet assessed."

### 3c. Keep pass/fail as-is
- `passInterview` / `failInterview` stay CL5-only and manual. Optionally place the
  CAIRO recommendation badge next to those buttons as a hint. **Never** auto-select.

### Verification (Phase 3)
- Manual e2e (server mode): assign interviewer → type responses → Ask CAIRO →
  banner + per-question grades appear → CL5 Pass/Fail still required and free to
  disagree.
- Confirm a non-server deployment shows the graceful message, not an error.

### Anti-pattern guards
- The recommendation is labelled advisory everywhere it appears.
- No code path lets the recommendation change `stage`, `archiveStatus`, or `tag`.

---

## Phase 4 (optional) — Include responses + CAIRO grades in the exported script

`js/export.js` `buildInterviewScriptHTML` (already the "interviewer's copy"):
- Under each scenario, print the recorded response (or "(no answer recorded)") and,
  if present, the CAIRO grade + rationale.
- Add an "Overall — CAIRO recommendation" block near the existing recommendation
  section, clearly marked advisory. Keep the `INTERVIEWER'S COPY — DO NOT DISCLOSE`
  banner.
- No new export function needed; extend the existing builder + `exportInterviewScript`.

### Verification
- Render check like `tools/`-style: build the HTML in Node with a stub DOM (see the
  render check used previously) and assert it contains the response text, a grade
  label, and still contains the interviewer's-copy warning.

---

## Phase 5 — Verification & anti-pattern sweep

1. **Self-check** `tools/check-interview-assess.mjs` (no framework, `assert`, mirror
   `tools/check-permissions.mjs`):
   - `normalizeAssessment` clamps unknown grade→`acceptable`, unknown
     recommendation→`reservations`, drops ids not in `allowedIds`, survives
     `extractJson` on prose-wrapped JSON, and returns `null` on garbage.
   - The endpoint authz predicate (extract it as a pure `canAssessInterview(actor, recruit)`
     = ethics + interview + (isCL5 || interviewers.includes)) returns true for CL5,
     true for an assigned interviewer, false for a non-assigned cadre member.
   - Run: `node tools/check-interview-assess.mjs` → prints OK.
2. **Gate self-check** still green: `node tools/check-permissions.mjs`.
3. **Parse checks:** `for f in worker/src/*.js js/views/recruitment.js js/api.js js/interview-bank.js js/export.js; do node --check "$f"; done`.
4. **Anti-pattern greps:**
   - No client model call: `grep -rn "GEMINI_API_KEY\|env.AI\|generativelanguage" js/` → **no hits**.
   - `interviewAssessment` only written server-side:
     `grep -rn "interviewAssessment" js/` shows only reads/renders, never a client
     write via `mutate`.
   - `interviewAssessment` frozen: present in `SERVER_OWNED` and in the
     `writeRecord` recruits freeze.
5. **Manual end-to-end** in server mode (the live path): full flow Phase 3 §Verification.
6. **Deploy:** `npx wrangler deploy` from `worker/` (Phases 1d/1e/2) **and** `git push`
   (all phases). Hard-refresh Ctrl+F5.

---

## Files touched (summary)

| File | Phase | Change |
|------|-------|--------|
| `js/interview-bank.js` | 1a | Grade + recommendation enums |
| `js/views/recruitment.js` | 1b,1c,3 | Assign-interviewers modal, response textareas, assess button, recommendation UI |
| `worker/src/gate.js` | 1d,1e | Field-aware interview-stage rules; `interviewAssessment` server-owned |
| `worker/src/index.js` | 1e,2c | Freeze `interviewAssessment` for recruits; `/api/recruits/:id/assess` route + handler |
| `worker/src/terminal.js` | 2a | Export `callGemini`/`callWorkersAI` |
| `worker/src/interview-assess.js` | 2b | New: prompt build, provider call, `extractJson`, `normalizeAssessment`, `assessInterview` |
| `js/api.js` | 2d | `assessInterview(recruitId)` |
| `js/export.js` | 4 (opt.) | Responses + grades in the interviewer's script |
| `styles/*.css` | 3 | Recommendation badges / layout |
| `tools/check-interview-assess.mjs` | 5 | New self-check |

## Open items / assumptions to confirm during execution
- **Responses visible to the whole cadre** (recruits ship whole). Acceptable per
  current behaviour; CL5-only response visibility would need new field-level
  recruit redaction (out of scope) — flag if the user wants it later.
- **Re-roll orphans responses** keyed by dropped question ids (kept, not shown).
  Consider a confirm dialog on re-roll noting the question set changes.
- **Model quality:** free-tier models (Workers AI llama-3.1-8b / Gemini flash) give
  serviceable but not authoritative grades — the advisory framing is doing real
  work here; keep it prominent.
