# Redesign session — queued prompts

Two feature requests for the site-wide redesign initiative (see memory
`redesign-initiative`), captured as `/make-plan`-ready prompts. Not yet
implemented.

---

## 1. De-brand CAIRO.AIC below CL5

````
/make-plan Hide the system's true name (CAIRO.AIC) from anyone below CL5, in the app
and in every exportable document. Sub-CL5 personnel should only ever see it
referred to generically, e.g. "user management system".

Precedent to follow: the Omega-1 masquerade in js/constants.js —
`omegaTruthVisible` flag + `setOmegaBranding(truth)` set at render time, a
getter-based swap (`ORGS['omega-1'].name`), and `deBrandOmega(text)` for
free-text rewrites. Mirror that shape for the system identity rather than
inventing a new mechanism. Gate on `isCL5(actor)` (js/permissions.js), same
helper redact.js already uses server-side.

Known call sites (audit for others):
- js/config.js — `CONFIG.systemName` ('CAIRO.AIC') is a static string; needs
  to become clearance-aware (or callers need to route through a de-brand
  function) since it's read from ~6 places incl. js/app.js (sidebar, topbar,
  boot loader), js/views/login.js, js/views/overview.js.
- index.html / manifest.webmanifest — RESOLVED, default-generic + live upgrade:
  <title>, the apple-mobile-web-app-title meta, the noscript banner
  (index.html), and manifest.webmanifest's `name`/`short_name` all currently
  read 'CAIRO.AIC' and are baked into the static shell, served before any
  actor is known — including at the login screen itself, to a viewer who
  hasn't proven they're CL5 yet. Defaulting them to the truth would leak the
  real name to literally everyone (glancing at a tab, a bookmark, a PWA
  install), which defeats the whole point of this prompt. So:
    - Change the static shell to the generic cover name by default (title,
      both meta tags, noscript text, manifest name/short_name).
    - Once an actor is loaded and confirmed CL5, patch `document.title` live
      via JS (app.js already re-renders topbar/sidebar per-actor on login —
      add one line there) to reveal the true name for the rest of that
      session.
    - manifest.webmanifest and apple-mobile-web-app-title are only read at
      PWA-install time and can't be personalized (static file, no actor
      context) — leave them generic permanently. A CL5 user's home-screen
      icon will read the cover name too; treat that as in-universe realistic
      (even command doesn't advertise the real designation on a device
      screen) rather than a gap to close. Revisit only if this is judged
      unacceptable later — would need server-rendering the manifest, a much
      bigger lift for a cosmetic edge case.
    - noscript has no path to actor context (no JS = no auth), so it stays
      generic unconditionally — not a decision, a hard constraint.
- js/views/terminal.js — boot lines and persona strings ('CAIRO.AIC ·
  COGNITION INTERFACE v4.7', 'LOADING PERSONA MATRIX [CAIRO]') are heavy
  flavor text; consider whether the terminal persona's own name is in scope
  or only the system/product identity.
- ~15 view files' `<div class="eyebrow">CAIRO ...</div>` headers (docket,
  directives, dashboard, notifications, trainings, activity, intel,
  deployments, compartments, messages, evidence, surveillance,
  investigations, isd-induction, operations, search, orgchart, engagement,
  recruitment).
- js/export.js — every `buildXHTML(record, actor)` already receives `actor`,
  so gate there: the signature line ('SIGNED ELECTRONICALLY — CAIRO.AIC
  RECORDS'), and the `CAIRO/${code}/...` control-number prefix (2 call
  sites). This is the "exportable documents" half of the ask — a sub-CL5
  operator's export must not leak the real name even though the file
  persists outside the app.
- js/tutorial.js ('Welcome to CAIRO.AIC') and js/glossary.js.

Out of scope unless confirmed: worker-side strings (log messages, wrangler
config, D1 storage keys) — those aren't operator-facing.

Deliverable: a `deBrandSystem()`-style helper (or systemName getter) in
constants.js/config.js, wired at each call site above; a
tools/check-*.mjs regression test mirroring tools/check-debrand.mjs.
````

## 2. General configurable redaction for exports/document generation

````
/make-plan Generalize document redaction beyond the fields it's hardcoded to today.
Currently js/export.js has a single black-bar mechanism — `const REDACTED =
'<span class="redacted">[ REDACTED ]</span>'` (js/export.js:60) styled by
`.redacted` (js/export.js:366, background/color both #1a1e21 — a literal
black bar) — applied to a fixed handful of fields in
buildPersonnelDocumentHTML (legal name, operator ID, leave reason, strike/
note detail), switched by the `full` access-level flag.

Scrap the earlier "blanket cosmetic black-bar over every date" idea — dead
end, hurts usability, not clearance-driven. Replace with: a general-purpose
redaction capability usable across ANY field in ANY generated/exported
document (dates included), driven by the same clearance model already
gating `full`/`partial`/`level` in these export builders (mirrors the
'full'/'partial'/'name-only' access levels in worker/src/redact.js).

Shape:
- Lift `REDACTED`/`.redacted` out of the personnel-file-specific code into a
  shared helper, e.g. `redactField(value, allowed)` — returns the real value
  if `allowed`, the black-bar span otherwise. One-liner, no new abstraction
  beyond what's already there.
- "Configurable" means: which fields redact is a per-document-type decision
  made at the call site (each buildXHTML already knows its own field list
  and already computes an access/level flag from `actor`) — NOT a new
  generic rules engine. Extend existing per-builder field lists to include
  dates and whatever else that document type currently exposes unconditionally
  but shouldn't below some clearance floor.
- Applies at generation time, using the exporting/viewing `actor` every
  buildXHTML already receives — no new plumbing.
- Audit each of the ~15 buildXHTML functions in js/export.js for fields
  currently shipped unconditionally (dates, refs, etc.) that should instead
  route through the shared redact helper for sub-threshold viewers, per
  document type. Confirm with the user which fields/thresholds per document
  before wiring — don't guess a redaction policy for every doc type.
````

---

## 3. External review triage (2026-07-29)

A colleague reviewed the repo via another AI assistant. Checked every claim
against the actual code before adding anything here — several are wrong or
outdated (the reviewer read file names/structure, not always the file
contents or which code path is actually live). Verdicts below; only the
confirmed gaps get `/make-plan` blocks.

### ALREADY HANDLED — no action, reference this section if it resurfaces

**"Make the D1 backend mandatory, not optional" (marked CRITICAL by the
colleague).** Wrong for this deployment: `js/config.js:31` sets
`apiBaseUrl` to the live Worker
(`https://cairo-aic-api.hershcivilgamers.workers.dev`), and
`js/storage.js` (`isServerMode()`) means the moment `apiBaseUrl` is set,
localStorage is never read or written — `loadDb()` starts from an empty
shell and is filled by `applyServerSnapshot()` from the Worker, every
mutation pushes over the network (`afterWrite`/`afterDelete`), `saveDb()`
is a no-op. localStorage is standalone/offline-only, entered by explicitly
nulling `apiBaseUrl` — not a silent fallback the live deployment can drop
into. See [[deploy-topology]] ("Server mode is LIVE"). Nothing to fix
unless someone actually flips `apiBaseUrl` back to null for a real
deployment.

**"Role-based UI hardening — permissions.js is client-side only, a
determined user can bypass it in the console" (marked HIGH IMPACT).**
Wrong. `worker/src/gate.js` is a ~1300-line server-side authorizer:
every write loads the stored record, diffs it against the incoming one,
infers the operation, and re-runs the same permission function the client
ran (`canEditPersonnel`, `canSetClearance`, `canIssueStrike`, `canPromote`,
etc. — all imported server-side from `js/permissions.js`) — a browser-console
edit that skips the client check still gets 403'd by the Worker, because
the Worker never trusts a verb the client sends, only the before/after
diff. `worker/src/redact.js` additionally means over-clearance data is
never *sent* to the browser in the first place, not just hidden by CSS/JS.
See [[permissions-gate-split]]. This is already the strongest part of the
codebase, not a gap.

**"No mention of mobile layout in the CSS files."** Wrong — the colleague
apparently didn't open the CSS. 47 media-query rules across 5 files
(`styles/layout.css:9`, `components.css:28`, `operations.css:4`,
`dossier.css:3`, `surveillance.css:3`). `styles/layout.css:343-351` is a
labeled, deliberate pattern ("REC-01"): the sidebar collapses to a drawer
with a nav toggle + backdrop at `<= 900px`, `.auth` reflows at 820px, grids
in `components.css`/`operations.css`/`dossier.css` collapse to one column
at 560–860px. Nothing to fix.

### PARTIALLY RIGHT — real gap, but narrower than described

**"Proper authentication — PBKDF2 in the browser exposes auth logic;
move it behind the Worker" (marked HIGH IMPACT).** The colleague found a
real code path (`js/crypto.js`, `js/views/login.js:136,273`) but missed
that it's the STANDALONE-mode fallback only (`api.serverMode()` false
branch, `login.js:108`). In the live server mode, `/api/login`
(`worker/src/index.js:150`) does the real work: server-side
`verifyPassword` against the stored hash, IP+username throttling with
lockout (`throttleFail`/`throttleLockedUntil`), a server-issued session
token with TTL (`SESSION_TTL_HOURS`), and a server-side session table
that's pruned on login (`repo.pruneSessions`). `js/crypto.js` is imported
by the Worker too (`worker/src/index.js:15`) — it's one isomorphic hashing
module shared by both, not client-only logic. So "shift auth to the
Worker" is already done for the deployment that matters.

What IS real and narrower: the session token lives in `sessionStorage`
(`js/api.js:15-31`, key `cairo.aic.token`) and rides as an
`Authorization: Bearer` header — readable by any script if the app is ever
XSS'd, unlike an HttpOnly cookie. Note before building this: the front-end
(GitHub Pages) and the Worker API are different origins (see
[[deploy-topology]]), and `wrangler.toml` currently sets
`ALLOWED_ORIGIN="*"` — a cookie-based session needs `SameSite=None; Secure`
+ CORS `credentials: 'include'` + a locked-down `ALLOWED_ORIGIN` (that CORS
lock-down is already flagged as pre-public-launch work in the README,
independent of this). That's a real prerequisite, not just a Worker-side
tweak — weigh whether it's worth the cross-origin cookie complexity versus
the XSS exposure it closes, given nothing else in the app currently
reflects unescaped user input (everything renders through `esc()`).
Low-medium priority; not urgent unless an XSS hole turns up elsewhere.

**"No live updates between sessions — add WebSockets/Durable Objects"
(marked HIGH IMPACT).** Partly right: there's no live push. But it's not
silent staleness either — `js/sync.js` already polls every 30s
(`AUTO_REFRESH_MS`) and force-refreshes on tab focus/visibility-return
(`sync.js:153-159`), so two admins acting "simultaneously" is a narrower
window than the colleague implies, and the Worker's diff-based `gate.js`
means a stale write gets refused with a clear error rather than silently
clobbering data (optimistic-concurrency style, via `version`/`updatedAt`
checks throughout gate.js) — the "one admin acts on stale data and
silently wins" scenario the colleague describes can't actually happen.
The codebase already names the upgrade path itself:
`js/sync.js:94 — "ponytail: 30s polling, not live push — WebSockets/
Durable Objects if [throughput/staleness matters]"`. Confirmed gap, but
tracked debt rather than a surprise finding — worth scheduling, not
urgent.

**"Audit log export — tribunal cases would benefit from a printable audit
trail."** Half right. Tribunal case exports already have this:
`buildCaseDocumentHTML` (`js/export.js:479`) includes a "Record of
Proceedings" section (`record.entries`, chronological) and a "Record of
the Vote" table per case — a case already prints as a full audit trail of
itself. What's actually missing is exporting the SITE-WIDE audit feed
(`js/views/activity.js`, backed by `js/audit.js`) as a document — there's
filtering/search there but no `buildXHTML`/`exportX` pair for it in
`js/export.js`, unlike every other record type. Real gap, but it's "add
one more export builder," not "tribunals have no audit trail."

### CONFIRMED — genuinely absent, worth a prompt

````
/make-plan Add outbound notifications (email and/or a Discord webhook) for
"Requires You" approval items, so waiting on a pending action isn't purely
passive.

Currently `buildNotifications` (js/views/notifications.js) only surfaces
pending-approval items inside the app itself (leave/transfer/advancement
requests, strike appeals, evidence review, registration approvals) — an
operator only sees these by opening CAIRO. There is no outbound delivery
channel anywhere in the codebase (confirmed: no email/webhook/fetch-to-
external-service code exists today).

This needs a real integration, not a client-side trick — email/webhook
sends must originate from the Worker (secrets can't live in the browser
bundle). Load the `cloudflare-email-service` skill before implementing if
email is the chosen channel; a Discord webhook is a plain authenticated
POST from a Worker route instead. Ask the user which channel(s) before
building — this is infra + a secret to provision, not just UI.

Trigger point: whichever write in gate.js/index.js lands a record in a
'pending' state that `buildNotifications` already treats as "Requires You"
— reuse that same event list rather than re-deriving it.
````

## 4. Real-time sync via Durable Objects (2026-07-29 — planned, not built this pass)

Scoped out of the 2026-07-29 execution pass (mobile touch-target fix +
audit-log export shipped instead; see git history). User asked for this one
planned but not built yet.

````
/make-plan Replace js/sync.js's 30s polling (`AUTO_REFRESH_MS`, `autoRefreshTick`)
with live push via a Cloudflare Durable Object, so a change one operator makes
appears for everyone else without waiting for the next tick or a tab focus.

Current mechanism (js/sync.js:94-160): a `setInterval` every 30s while the tab
is visible, plus a forced tick on visibilitychange/focus — guarded so it never
fires while the operator is typing or has a modal open, and only re-renders
when the fetched snapshot actually differs from the last one
(`lastSnapshotJson`). This is genuinely fine for staleness (the Worker's
version/updatedAt-diffing in gate.js already refuses a stale write outright,
so nobody silently clobbers anyone) — the only thing missing is latency:
up to ~30s (or until the other tab regains focus) before a change is visible
elsewhere.

No Durable Object exists in this Worker today — `worker/wrangler.toml` has
only the `[[d1_databases]]` and `[ai]` bindings, no `[[durable_objects]]`.
This is a from-scratch addition, not a wire-up of something half-built.

Shape to evaluate (don't commit to one without checking current Cloudflare
DO docs/pricing for this account tier first — load the `durable-objects` and
`agents-sdk` skills before implementing):
- One Durable Object instance as a pub/sub hub the Worker's write path
  notifies after a successful `gate.js` authorization (not before — a
  rejected write must never broadcast).
- Clients hold a WebSocket (or Server-Sent Events, simpler, one-directional,
  no upgrade handshake needed since the client never pushes over it) opened
  after login, replacing `armAutoRefresh`'s interval with an event-driven
  `autoRefreshTick(true)` call.
- Redaction still has to happen per-viewer: the broadcast can't just relay
  the raw written record (a CL3 client would receive a CL5 payload over the
  wire even if the UI never renders it) — either the DO fans out a
  content-free "something changed, re-fetch" ping (simplest, keeps
  `redactUser`/`buildSnapshot`'s per-viewer filtering as the only place
  redaction logic lives — recommended default) or the Worker would need to
  redact per-connected-viewer before broadcasting (more real-time, much more
  complex, do NOT build this without confirming it's actually wanted — it
  duplicates buildSnapshot's redaction logic per socket).
- Fallback: if the DO/WebSocket connection drops, fall back to the existing
  30s poll rather than going silent — sync.js already has that code, don't
  delete it, degrade to it.

Ask the user to confirm the "just a ping, client re-fetches via the existing
REST snapshot" design before building anything that redacts per-socket —
that's the one design fork with real complexity on one side and it should be
a deliberate choice, not a default.
````

### LOW PRIORITY — content work, not a missing feature

**"Interview bank expansion — ethical dilemmas, containment breach
response, D-Class situations."** `js/interview-bank.js` already has 6
categories with multiple scenarios each: Anomaly Ethics, Use of Force /
D-Class, Authority & Dissent, Secrecy & Disclosure, Containment vs
Welfare, Personal Conduct — which already cover what the colleague named
(D-Class ↔ "Use of Force / D-Class", containment breach ↔ "Containment vs
Welfare", ethical dilemmas ↔ "Anomaly Ethics"/"Personal Conduct"). The
ask is really "author more scenarios within the existing categories," a
content task with no architecture behind it — fine to do opportunistically,
doesn't need a plan.
