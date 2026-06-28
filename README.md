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

**Managing records** (edit, rank, strike, leave) requires **CL4·Senior or
above** *and* a stake in that organisation — meaning the same organisation, or
Command, which spans both.

**Clearance changes and registration approvals are CL5-only.** Nobody can raise
their own clearance, strike themselves, or delete their own record.

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
