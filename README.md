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
│   └── dossier.css         Personnel file, timeline, redaction, directives, log.
│
└── js/                     The behaviour, one concept per file.
    ├── config.js           Per-deployment settings (system name, version, keys).
    ├── constants.js        The domain rules: clearances, organisations, ranks.
    ├── storage.js          Saving and loading (localStorage + memory fallback).
    ├── crypto.js           Password hashing (PBKDF2 via Web Crypto).
    ├── seed.js             The initial personnel and directives.
    ├── state.js            Who is currently signed in.
    ├── permissions.js      The access engine: who can do and see what.
    ├── audit.js            Logging of significant actions.
    ├── router.js           Navigation structure and access guards.
    ├── ui.js               Shared helpers: modals, toasts, dates, redaction.
    ├── app.js              The entry point: boots, builds the shell, routes.
    └── views/              One file per screen.
        ├── login.js        Sign-in and access-request.
        ├── overview.js     Dashboard + the "Requires You" queue.
        ├── personnel.js    Roster list and the personnel dossier.
        ├── directives.js   Standing-orders board.
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

The system seeds itself with personnel the first time it loads. Four accounts
are provided to show how the system looks at different clearance levels — they
appear as tappable chips on the sign-in screen.

| Operator ID | Passphrase     | Tier                                    |
|-------------|----------------|-----------------------------------------|
| `director`  | `Thaumiel-5`   | CL5 · Command — full access             |
| `vanguard`  | `LeftHand-4`   | CL4·S · Omega-1 — task-force command    |
| `advocate`  | `Conscience-4` | CL4·J · Ethics — junior member          |
| `bailiff`   | `Operative-3`  | CL3 · Omega-1 — operative (sees redaction) |

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
