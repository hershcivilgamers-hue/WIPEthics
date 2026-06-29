# CAIRO.AIC — Automated Identity & Clearance

A personnel-management system for the SCP Foundation's **MTF Omega-1** and the
**Ethics Committee**, with a **Site Command** administration tier above both.
It models clearance levels, dual-organisation rosters, a permission hierarchy,
redaction-aware personnel files, standing directives, an audit log, soft-delete
recovery, and self-registration with command approval.

It is a **static web application** — plain HTML, CSS and JavaScript modules,
with no build step and nothing to install. It runs the same way locally and on
GitHub Pages.

---

## How the project is organised

Everything is split into small, single-purpose files. Nothing is crammed into
one HTML file.

```
cairo-aic/
├── index.html              The page shell. Loads the styles and boots the app.
├── README.md               This file.
│
├── styles/                 The look, split by concern.
│   ├── tokens.css          Colour system, fonts, spacing — the design tokens.
│   ├── base.css            Reset and base typography.
│   ├── layout.css          The shell: banners, sidebar, topbar, sign-in screen.
│   ├── components.css      Cards, tables, buttons, badges, modals, toasts.
│   ├── dossier.css         Personnel file, timeline, redaction, directives, log.
│   ├── surveillance.css    Subject registry, threat tags, the access-denied panel.
│   └── tribunals.css       Case docket, case file, ruling block, checkbox lists.
│
└── js/                     The behaviour, one concept per file.
    ├── config.js           Per-deployment settings (system name, version, keys).
    ├── constants.js        The domain rules: clearances, organisations, ranks.
    ├── storage.js          Saving and loading (localStorage + memory fallback).
    ├── crypto.js           Password hashing (PBKDF2 via Web Crypto).
    ├── seed.js             The initial personnel, directives, subjects and cases.
    ├── migrations.js       Forward-only, idempotent backfills for new features.
    ├── state.js            Who is currently signed in.
    ├── permissions.js      The access engine: who can do and see what.
    ├── audit.js            Logging of significant actions.
    ├── router.js           Navigation structure and access guards.
    ├── ui.js               Shared helpers: modals, toasts, dates, redaction.
    ├── export.js           Formal, print-ready tribunal document generation.
    ├── app.js              The entry point: boots, builds the shell, routes.
    └── views/              One file per screen.
        ├── login.js        Sign-in and access-request.
        ├── overview.js     Dashboard + the "Requires You" queue.
        ├── search.js       Organisation-wide, access-bound record search.
        ├── personnel.js    Roster list and the personnel dossier.
        ├── surveillance.js Subject registry (POIs / Targets) and subject files.
        ├── compartments.js Need-To-Know compartments: roster and read-in control.
        ├── operations.js   Operational activity logging + the readiness board.
        ├── recruitment.js  Omega-1 scouting pipeline (scouting/greenlit/tryout).
        ├── tribunals.js    Ethics case docket and the court-style case file.
        ├── directives.js   Standing-orders board and the directive memo view.
        ├── activity.js     The audit feed.
        └── admin.js        Approvals, clearance management, recycle bin, system.
```

If you want to change something, the file name tells you where to look. Want to
rename a rank or add a clearance level? `constants.js`. Want to adjust who can
delete a record? `permissions.js`. Want to change a colour? `tokens.css`.

---

## Running it

Because the code uses native JavaScript modules, the browser must load it over
**http/https**, not by double-clicking the file (`file://` is blocked by the
browser for modules).

**The easy way — GitHub Pages (how the live system is hosted):**

1. Put these files in a GitHub repository.
2. Repository **Settings → Pages → Deploy from a branch**, choose your branch
   and the root folder, and save.
3. Open the URL GitHub gives you. Done.

**To preview on your own computer**, run a tiny local server from this folder:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

---

## Demonstration logins

The system seeds itself with personnel the first time it loads. Five accounts
are provided to show how the system looks at different clearance levels — they
appear as tappable chips on the sign-in screen.

| Operator ID | Passphrase     | Tier                                    |
|-------------|----------------|-----------------------------------------|
| `director`  | `Thaumiel-5`   | CL5 · Command — full access             |
| `vanguard`  | `LeftHand-4`   | CL4·S · Omega-1 — task-force command    |
| `warrant`   | `Warrant-4`    | CL4·J · Omega-1 — junior command (Lieutenant) |
| `advocate`  | `Conscience-4` | CL4·J · Ethics — junior member          |
| `bailiff`   | `Operative-3`  | CL3 · Omega-1 — operative (sees redaction) |

Clearance is independent of organisation: an operator at any clearance can serve
in any organisation. `warrant` and `advocate` are both CL4·J in different
organisations, and a junior CL4 operator cannot manage their organisation —
that requires CL4·S or above.

Sign in as `director` to see everything; sign in as `bailiff` and open an Ethics
dossier to see the redaction bars in action.

---

## How the rules work

**Clearance tiers** (lowest to highest): CL3 → CL4·Junior → CL4·Senior → CL5.

**Managing records** (edit, strike, leave, and the direct rank/clearance
override) requires **CL4·Senior or above** *and* a stake in that organisation —
meaning the same organisation, or Command, which spans both. The step-by-step
promotion path below is more permissive (CL4·Junior officers can promote their
juniors); the override is the CL5/senior shortcut.

**Clearance changes and registration approvals are CL5-only.** Nobody can raise
their own clearance, strike themselves, or delete their own record.

**Rank ladders.** Each organisation has its own ladder, listed most-senior first.

- **Omega-1** (10 ranks): Commander, Major *(CL4·Senior)* · Captain, Lieutenant
  *(CL4·Junior)* · Command Sergeant, Sergeant, Corporal, Lance Corporal,
  Specialist, Private *(CL3)*.
- **Ethics Committee** (3 ranks): Chairman, Member *(CL5)* · Assistant
  *(CL4·Junior)*.
- **Command**: Director, Liaison.

A rank carries a clearance tier, and **promotion or demotion realigns the
operator's clearance to the new rank's tier** automatically.

**Promotion & demotion.** Distinct from the CL5 clearance override:

- **CL5** may promote or demote anyone, one step at a time.
- Otherwise the actor must be **CL4 or above and hold a rank in the same
  organisation**, and may only move someone to a rank that stays **at least one
  step below their own** — so a Lieutenant can promote a Sergeant to Command
  Sergeant, but not a Command Sergeant to Lieutenant (that would make them
  peers). Only CL5 can promote *into* Lieutenant and above.

**Promotion requirements.** Each rank transition has a checklist (CL5 edits these
under Administration → Promotion Reqs). An operator's file shows the checklist
for their **next** rank with progress; anyone who can promote them can tick items
off. Promoting or demotion **resets the checklist**, because the next-rank
transition — and therefore its requirements — changes.

**Redaction.** When you open a dossier, how much you see depends on your
clearance relative to that operator:

- **Full** — your own file, anyone you outrank in your chain, or any file if
  you're CL5.
- **Partial** — CL4 viewing across organisations: identity and service record
  are visible; disciplinary record, leave reason and command notes are redacted.
- **Name-only** — CL3 viewing across organisations: identity confirmation only.

**Surveillance** works differently from personnel files, on purpose. Each subject
(a Person of Interest or an Acquisition Target) carries a *sensitivity* — the
minimum clearance needed to see it. This is a **hard gate, not a redaction**:
below the required clearance you cannot open the record at all, and that is
enforced even if you paste the direct link, not just by hiding the menu entry.
Sealed records still appear in the registry as a row so you know something exists,
but reveal nothing — no reference, alias, organisation or threat. The demo seeds
subjects across every tier so this is visible: sign in as `bailiff` (CL3) and try
to open the Command-sealed target, then as `director` (CL5) and open the same one.
Managing a subject follows the same rule as managing personnel (CL4·Senior with a
stake), and you can never classify a subject at a sensitivity above your own.

**Case Docket (tribunals)** is the Ethics Committee's register of proceedings —
containment reviews, inquiries and full tribunals. Like surveillance, each case
carries a sensitivity that acts as a **hard gate** on the case file, enforced on
the direct link. Cases cross-reference the rest of the system: a respondent and a
panel drawn from personnel, and cited surveillance subjects. **Cross-references
never widen access** — a cited subject you are not cleared for shows as a sealed
record (in the app and in any export), and editing citations preserves links you
cannot see. Two thresholds separate doing from deciding: **running** a case
(opening it, docket entries, summons, seating a panel, status) needs Ethics
CL4·Senior or Command, while **entering a binding ruling** is **CL5 only** — the
Chairman or Command. Viewing the docket is open to any operator cleared for the
case's sensitivity, so an operative can read a case that concerns them.

**Need-To-Know compartments** add a second, *independent* axis of access on top
of the clearance ladder. A compartment is a named caveat (a codeword such as
IRONWOOD); a subject, case or directive may be filed into one. To see a
compartmented record you must clear its clearance level **and** be *read into*
the compartment — the two gates stack, neither substitutes for the other. This is
deliberately orthogonal: a CL3 operative read into a compartment can read its
material, while a higher-cleared operator who is not read in cannot. The demo
shows exactly this — sign in as `bailiff` (CL3, read into IRONWOOD) and open the
Omega-1 field-conduct directive, then as `warrant` (CL4·Junior, **not** read in)
and watch the same directive's body come back withheld behind the caveat despite
the higher clearance. **CL5 is a universal read override**, consistent with the
rest of the system. Compartmented subjects and cases are **hard-gated** — if you
are not read in they are absent from your registry entirely, not merely masked.
Administering a compartment — opening it, sealing it, and reading operators in or
out — follows the standard management rule for the owning organisation
(CL4·Senior with a stake, or Command). A read-in must meet the compartment's
**clearance floor**, a **sealed** compartment takes no new read-ins (existing ones
keep access), and roster changes are atomic. In server mode the Worker re-derives
every operator's read-in status on read and re-authorises each change on write,
so the roster is never something the browser can assert for itself.

**Readiness** (operational activity logging) is a unit board showing every
operator's readiness state — Current, Overdue or Activity Breach — **derived**
from how recently they last logged activity, never set as a field, so it can't be
faked. Logging is self-service: an operator records their own check-ins
regardless of clearance, while setting a duty posture (On Operation, Stood Down,
On Leave) or logging on another operator's behalf needs the org-management right.
The board is visible within an operator's own organisation, to Command and to
CL5; a banner flags anyone in breach. The demo seeds operators across all three
states so the board is immediately legible.

**Recruitment** is Omega-1's scouting pipeline, run by the unit's **CL4 cadre**
(any CL4 with a stake, not only the senior managers). A candidate moves through
three stages: **Scouting** — any CL4 opens a scouting target (name, SteamID,
department, rank) and the thread is reviewed, with a deny closing it; **Greenlit**
— a CL4 yes/no vote, where a majority of Yes advances the candidate; and
**Tryout** — on approval the approver is prompted to open the operator's
personnel file, after which the candidate is archived as approved (a deny archives
it as denied at any stage). The server enforces the parts that matter: a ballot
write may only change the actor's own vote, stage transitions follow the pipeline,
and a candidate cannot leave Greenlit without a genuine majority. The demo seeds a
candidate in each live stage plus an archived one.

**Search** (the box in the top bar, or *Search* in the sidebar) runs one query
across personnel, surveillance subjects, tribunal cases and directives — and it
is bound by exactly the same access rules as everything else, so it can never
surface something you could not already reach. Personnel are matched only on
their always-visible identity (designation, codename, organisation, rank), never
on redactable fields; subjects and cases above your clearance are excluded from
the search entirely, with an honest count of how many were held back; and a
directive is matched on its body only when you are cleared to read that body —
otherwise only on its open reference and subject. Opening any result routes to
its detail view, where the gate is enforced again.
formal, print-ready document — letterhead and seal, classification banners,
numbered sections and, where appropriate, signature lines. A directive exports as
a formal **memorandum** (From / To / Subject header, the directive body, an
issuing-authority signature). The letterhead adapts to the issuing body (Ethics
Committee, MTF Omega-1 or Site Command). Each document opens in a new tab; use
your browser's Print / Save as PDF. Crucially, a document shows only what the
exporting operator is cleared to see: a sealed citation stays sealed, a personnel
file reproduces the **same redaction as the on-screen dossier**, and a directive
whose body is above the reader's clearance exports with the body **withheld**
rather than leaked. Every export is written to the audit log.

---

## A note on security

Passwords are hashed with PBKDF2 and never stored in plain text. However,
because the system currently runs **entirely in the browser**, the login screen
is not a hard security boundary — a determined person with developer tools could
bypass it. This is the same limitation the live CAIRO system carries, and the
same recommendation applies: before using this for anything genuinely sensitive,
move authentication behind a server (for example the Cloudflare Worker). The
hashing format here is written so that move is straightforward.

Data is stored locally in the browser. The **Administration → System** screen
can export the full dataset as JSON or reset everything to the seeded state.
