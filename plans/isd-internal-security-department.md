# Internal Security Department (ISD) — implementation plan

The Ethics Committee's covert internal-security arm: counter-intelligence against
leaks, traitors and double agents. In lore the ISD is a "foundation within the
Foundation" whose existence is treated as a myth, whose agents keep an *official*
post in another department as cover, and which follows a stringent multi-stage
investigative protocol. In CAIRO it is the **actionable hand of the Committee**:
ISD investigates; substantiated Code-of-Ethics infractions escalate to the Ethics
docket, where the Committee rules.

---

## Phase 0 — Discovery findings (the APIs this plan is allowed to use)

Gathered from the merged tree at `5c4cac0`. Cite these, do not invent APIs.

| Concern | Actual API / location |
|---|---|
| Org registry | `ORGS` — [js/constants.js:27](../js/constants.js) |
| Rank ladders | `RANKS`, `RANK_CLEARANCE` — [js/constants.js](../js/constants.js) |
| Org stake rule | `hasStakeIn(actor, org)` → `actor.org === org \|\| actor.org === 'command'` — [js/permissions.js](../js/permissions.js) |
| Cross-org person redaction | `accessLevel(actor, target)` → `full` / `partial` / `name-only` — [js/permissions.js](../js/permissions.js) |
| Snapshot build | `buildSnapshot(actor, db)` — [worker/src/redact.js:181](../worker/src/redact.js); **users line 191 ships every user** |
| Per-user redaction | `redactUser(actor, user)` — field allow-list, strips `salt`/`passwordHash` |
| Write authorisers | `AUTHORIZERS` map — [worker/src/gate.js](../worker/src/gate.js) |
| Synced collections | `WRITABLE` + `SNAPSHOT` — [worker/src/index.js:24-25](../worker/src/index.js) |
| Nav groups + guards | `NAV`, `GUARDS`, `TOP_LEVEL`, `featureBlocked` — [js/router.js](../js/router.js) |
| Org roster view | `personnelView.renderList(view, app, '<org>')` — [js/app.js:300-302](../js/app.js) |
| Escalation target | `cases` collection + `authorizeCase` (Ethics docket) |
| Test convention | 12 × `tools/check-*.mjs`, plain `node:assert`, no framework |

**New-collection checklist** (13 touchpoints, proven by `engagement` and `evidence`):
`schema.sql` → `repo.js COLUMNS` → `index.js WRITABLE`+`SNAPSHOT` → `gate.js` authoriser + `AUTHORIZERS` → `redact.js buildSnapshot` → `storage.js` (emptyDb, applyServerSnapshot, accessors) → `router.js` (nav/guard/TOP_LEVEL/featureBlocked) → `app.js` dispatch → `config.js` flag → `views/activity.js` audit tones → view → `tools/check-*.mjs` → migration + deploy.

> ⚠️ **Migrate before deploy.** `SNAPSHOT` makes `/api/data` query every table. Create the D1 table *first* (`wrangler d1 execute cairo-aic --remote --file ./schema.sql`), then `wrangler deploy`, or `/api/data` 500s for everyone.

---

## Design decisions (the four forks, resolved)

### (c) Cover identity — **ISD membership is an orthogonal caveat, not a fourth `org`** ✅

The decisive fork. Two candidates:

- **C1 (rejected):** `user.org = 'isd'` + `coverOrg`. Redaction would have to *rewrite* `org`
  on the way out. The client sends the redacted record back on the next write, the
  gate diffs it, sees `org` changed, and denies — the classic `[[permissions-gate-split]]`
  trap. It also evicts agents from their cover department's roster, breaking
  engagement/activity/recruitment scoping.
- **C2 (chosen):** `user.org` **stays the cover post** (their genuine official position —
  what everyone, honestly, sees). ISD identity rides in a separate field:

  ```js
  user.isd = { rank: 'Inspector', clearance: 'CL4-J', joinedAt, standing: 'active' }
  ```

  `hasStakeIn` is extended so ISD membership grants an `isd` stake. Nothing else
  about org scoping changes.

This mirrors an existing precedent in the codebase: **Need-To-Know compartments are
already "an access caveat orthogonal to the clearance ladder."** ISD is the same
shape. It is also the most lore-accurate reading — the agent really does hold their
official post; ISD is the hidden layer beneath it.

ISD still *presents* as an organisation (an `ORGS` entry for name/motto/tone, its own
rank ladder, its own nav group and roster) — it simply doesn't displace `user.org`.

### (b) Covert visibility — strip, don't filter

- `redactUser` treats `isd` like `salt`: **omitted entirely** unless the viewer is ISD or CL5.
  A non-ISD operator's snapshot is byte-identical to one where ISD does not exist.
- Add `isd` to the gate's `SERVER_OWNED` set so its absence from a client payload never
  registers as a diff (otherwise an ordinary edit by a non-ISD manager would look like it
  blanked the field and get refused).
- ISD collections (investigations) are filtered **out of the snapshot entirely** for
  non-ISD viewers — the `engagement`/`evidence` filter pattern.

### (a) Scope — phased, not all at once

Phase 1–2 ship a working covert ISD org (roster, membership, cover identity) with **no
new collection**. Phase 3 adds Investigations only once the identity layer is proven.

### (d) Escalation — reuse the Ethics docket

A substantiated investigation opens/links an existing `cases` record rather than inventing
a parallel tribunal. Investigation carries `caseId`; the case gets a linked entry. ISD
hands the matter to the Committee — the Committee rules.

---

## Phase 1 — ISD as an organisation identity (no new collection)

**Implement**
1. `ORGS.isd` — copy the shape at [constants.js:27](../js/constants.js). Suggested: `name: 'Internal Security Department'`, `short: 'ISD'`, `motto: 'The Foundation Within'`, `tone: 'isd'`.
2. `RANKS.isd` ladder + matching `RANK_CLEARANCE.isd`. **Ladder is stored high→low** (a *lower* index is more senior — see `rankIndex`):

   ```js
   RANKS.isd = ['Director', 'Commissioner', 'Inspector', 'Investigator', 'Operative'];
   RANK_CLEARANCE.isd = {
     Director:     'CL4-S',
     Commissioner: 'CL4-S',
     Inspector:    'CL4-J',
     Investigator: 'CL3',
     Operative:    'CL3',
   };
   ```

   **The ladder tops out at CL4·S — there is no CL5 in the ISD.** Two consequences the
   later phases depend on:
   - `canManageOrg(actor, 'isd')` needs weight ≥ 5 (CL4·S) + stake, so it resolves
     exactly to **Commissioner and Director** — no extra rule needed.
   - ISD can never outrank the Committee. CL5 always overrides, which is precisely the
     "actionable hand" relationship: ISD investigates and refers; the Committee rules.
   - Paired ranks (Operative/Investigator both CL3; Commissioner/Director both CL4·S) are
     fine — the Ethics ladder already does this (Chairman/Member are both CL5) — and a
     promotion between two same-clearance ranks simply leaves `clearance` unchanged, which
     satisfies the gate's "rank change must align clearance to the new rank" rule.
   - `Director` also exists in the `command` ladder. No functional collision — `RANKS` is
     org-keyed and `rankIndex` is org-scoped — only display ambiguity, resolved by the
     `ISD-x` designation and the org label.

   **Two ladders per agent (a direct consequence of the cover-identity design).** Because
   `user.org`/`user.rank` remain the *cover* post, an agent carries two independent ranks:
   their public one (e.g. Omega-1 Sergeant) and `user.isd.rank` (e.g. Inspector). The
   existing promote/demote machinery — `rankUp`/`rankDown`/`canPromote` and the gate's
   one-step rank branch — operates **only on the cover ladder** and must be left alone.
   ISD rank changes travel through the `SET_ISD_MEMBERSHIP` branch instead, so an ISD
   promotion never touches `user.rank` and never trips the clearance-alignment rule.
   Corollary: an agent's *visible* clearance is their cover clearance; the ISD clearance in
   `user.isd.clearance` is what gates ISD material, and is only ever seen by ISD/CL5.
3. `permissions.js`: `isISD(actor)` helper; extend `hasStakeIn(actor, org)` so `org === 'isd'` is satisfied by `actor.isd?.standing === 'active'`.
4. `styles/tokens.css`: an `isd` tone (follow the existing `omega`/`ethics` tone tokens).

**Verify** — `node --check` on each file; `node tools/check-permissions.mjs`; assert `hasStakeIn({isd:{standing:'active'}}, 'isd') === true` and `hasStakeIn({org:'omega-1'}, 'isd') === false`.

**Guard** — do NOT set `user.org = 'isd'` anywhere. Do NOT add ISD to any existing org loop that would leak it into a public roster.

---

## Phase 2 — Covert redaction, membership writes, roster view

**Implement**
1. `redactUser` ([redact.js](../worker/src/redact.js)): include `isd` **only** when `isCL5(actor) || actor.isd?.standing === 'active'`; otherwise omit the key.
2. `gate.js`: add `'isd'` to `SERVER_OWNED`; add an atomic `authorizeUser` branch `SET_ISD_MEMBERSHIP` — copy the shape of the `evidenceReviewRequired` branch (single-field, `changedOutside` guarded). Induction/removal requires **CL5, or an ISD Commissioner/Director** — i.e. `isCL5(actor) || canManageOrg(actor, 'isd')`, which the Phase-1 stake rule already resolves correctly.
3. `router.js`: nav group `Internal Security` with guard `canSeeISD = (u) => isCL5(u) || isISD(u)`; add `isd` to `GUARDS`, `TOP_LEVEL`, `featureBlocked`; `config.js` flag `isd: true`.
4. `app.js`: `case 'isd': personnelView.renderList(view, app, 'isd')` — **but** `renderList` filters on `u.org`, so add an ISD mode that filters on `u.isd` instead. Keep the change inside `renderList`; do not fork the view.
5. `views/activity.js`: audit tone for `SET_ISD_MEMBERSHIP`.

**Verify** — new `tools/check-isd.mjs`: a non-ISD CL3/CL4 viewer's `redactUser` output has **no** `isd` key; an ISD viewer's does; CL5's does. Gate: ISD Overseer may set membership, an Omega CL4·S may not. Confirm the nav item is absent for non-ISD.

**Guard** — do NOT filter ISD members out of the users snapshot (that would make them vanish from their cover roster and expose them by absence). Strip the *field*, keep the person.

---

## Phase 3 — ISD Investigations (new synced collection)

**Implement** — full 13-touchpoint checklist above, collection `investigations`.

Record shape:
```js
{ id, ref: 'ISD-INV-0001', subjectUserId, openedBy, stage, clearance,
  summary, findings: [], entries: [{id, ts, by, type, text}],
  disposition: null | 'unsubstantiated' | 'substantiated' | 'referred',
  caseId: null, compartment: null,
  createdAt, updatedAt, version, deleted, deletedAt }
```

Multi-stage protocol (the lore's "stringently defined multi-stage" requirement) —
model on `RECRUIT_STAGE` ([constants.js](../js/constants.js)):
`referral → preliminary → active → adjudication → closed`, with the gate enforcing
valid transitions exactly as `authorizeRecruit` does.

`authorizeInvestigation` — authority mapped to the real ladder:

| Action | Requires |
|---|---|
| Read an investigation | active ISD, or CL5 |
| File a referral / add entries | **Investigator** (CL3) and above |
| Advance `preliminary → active` | **Inspector** (CL4·J) and above |
| Advance to `adjudication`, set disposition, close | **Commissioner / Director** (CL4·S) — i.e. `canManageOrg(actor,'isd')` |
| Refer to the Committee (Phase 4) | Commissioner / Director, or CL5 |

An **Operative** (CL3) may read and be assigned, but files nothing on their own authority —
matching the lore's "stringently defined multi-stage protocol" and the perfect-record entry
bar. Entries are append-only (copy the `authorizeOperation` log-only path).

`buildSnapshot`: `investigations: (db.investigations||[]).filter(i => !i.deleted && (isCL5(actor) || isISD(actor)))`.

**Verify** — `tools/check-isd-investigations.mjs`: stage-transition matrix, append-only
entries, non-ISD denied at every verb, snapshot empty for non-ISD.

**Guard** — do NOT deploy before the D1 migration. Do NOT let a client-supplied `ref` or
`disposition` bypass the gate; derive/validate server-side.

---

## Phase 4 — Escalation to the Ethics docket

**Implement** — on `disposition = 'substantiated'`, offer "Refer to the Committee": create
(or link) a `cases` record, set `investigation.caseId`, and append a case entry citing the
investigation ref. Reuse the evidence **cross-post** pattern in
[views/evidence.js](../js/views/evidence.js) — gate-checked client-side first
(`canManageTribunal`) so the write never 403s. Add a notification branch in
[views/notifications.js](../js/views/notifications.js) so the Committee sees referrals.

**Verify** — client check mirrors `authorizeCase` (assert both agree); referral appears in
the Committee's notifications; the case entry links back to the investigation ref.

**Guard** — do NOT create a parallel tribunal. Do NOT let ISD rule on the matter — ISD
refers, the Committee decides.

---

## Phase 5 — Verification & ship

1. Full syntax sweep (`node --check` across `js`, `worker/src`, `tools`).
2. All `tools/check-*.mjs` green (12 existing + 2 new).
3. Covert check: build a snapshot for a CL3, a CL4 Omega manager, and an Ethics CL5 — grep the JSON for `"isd"` and any `ISD-INV` ref. Only CL5/ISD may contain them.
4. Seed: add 2–3 ISD members whose `org` is their cover post, plus one sample investigation.
5. Ship: `wrangler d1 execute cairo-aic --remote --file ./schema.sql` **then** `wrangler deploy`; push front-end for Pages.

**Ship-blocking invariant:** a non-ISD operator's `/api/data` payload must be
indistinguishable from one in a world where the ISD does not exist.
