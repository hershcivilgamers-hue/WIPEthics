# Deploying the CAIRO.AIC backend (Cloudflare Worker + D1)

This turns the app from "data lives in each browser" into "data lives in one
shared, server-enforced database." You'll create a database (D1), load the demo
data, and deploy the API (a Worker). Wiring the app itself to this API is the
next step — this runbook gets the backend live and testable on its own.

You do **not** need to be a programmer to follow this, but it does involve a few
terminal commands. If you have a technical colleague, this is a good 30 minutes
to borrow them.

---

## What you'll need

- A **Cloudflare account** (the free plan is fine). You already have one, since
  the AI terminal runs on a Cloudflare Worker.
- **Node.js** installed on your computer (https://nodejs.org — the "LTS"
  download). This gives you the `npm` and `npx` commands used below.
- This `worker/` folder open in a terminal.

Everything below is run from inside the `worker/` folder.

> **Important:** keep this `worker/` folder where it is, inside the project. The
> API reuses the app's permission rules directly from the `js/` folder one level
> up (`../js`), which is exactly what guarantees the server enforces the same
> rules as the app. If you move the folder out on its own, the deploy will fail
> to find that shared code.

---

## Step 1 — Sign in to Cloudflare from your terminal

```
npx wrangler login
```

This opens your browser and asks you to authorise. `wrangler` is Cloudflare's
official command-line tool; `npx` runs it without a separate install.

## Step 2 — Create the database

```
npx wrangler d1 create cairo-aic
```

When it finishes it prints a block that includes a **`database_id`** — a long
string of letters and numbers. Copy it.

## Step 3 — Fill in two values in `wrangler.toml`

Open `wrangler.toml` in any text editor and:

1. Paste your `database_id` into the line `database_id = "PASTE_DATABASE_ID_HERE"`.
2. Set `ALLOWED_ORIGIN` to the web address your app is served from — for example
   `"https://yourname.github.io"` or your Google Site address. (You can leave it
   as `"*"` for now and tighten it once the app is wired up.)

Save the file.

## Step 4 — Create the tables

```
npx wrangler d1 execute cairo-aic --remote --file=./schema.sql
```

This builds the empty tables in your live database. (`--remote` means the real
database, not a local test copy.)

## Step 5 — Load the demo data

```
npx wrangler d1 execute cairo-aic --remote --file=./seed.sql
```

This loads the same demo personnel, directives, surveillance subjects, cases and
promotion requirements you already know — including the demo logins, with their
passwords, so you can sign in immediately.

## Step 6 — Deploy the API

```
npx wrangler deploy
```

When it finishes it prints your Worker's address, something like
`https://cairo-aic-api.<your-subdomain>.workers.dev`. **Save that address** —
it's the URL the app will talk to.

---

## Step 7 — Check it actually works

You can confirm the backend is live before touching the app. Replace
`YOUR_WORKER_URL` with the address from Step 6.

**Sign in** (this returns a token):

```
curl -X POST https://YOUR_WORKER_URL/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"director","password":"Thaumiel-5"}'
```

You'll get back `{"token":"…","user":{…}}`. Copy the token.

**Load the data the way a CL5 operator would see it** (paste your token):

```
curl https://YOUR_WORKER_URL/api/data \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

You'll get the full dataset. Now try the same with a CL3 account
(`bailiff` / `Operative-3`) and you'll see the difference the server enforces:
fewer subjects and cases, redacted names, withheld directive bodies, and no
audit log. That difference is the whole point — it's enforced on Cloudflare's
servers, not in the browser.

---

## What you now have

- A live **D1 database** holding the data, with point-in-time recovery (you can
  roll back up to 30 days from the Cloudflare dashboard if something goes wrong).
- A live **API Worker** that authenticates every request and applies the exact
  same permission rules the app uses — so even someone poking at the API
  directly only gets what their clearance allows.

## What's next

The app still reads and writes its own browser copy. The next piece I'll build
is the **app-side change**: on sign-in it authenticates against this Worker and
loads the data from it, and every change is saved back through it. At that point
the browser is just a window onto the shared, enforced database. When you're
ready, point me at your Worker URL (from Step 6) and I'll wire it in.

---

## Going live — a checklist

Before opening the system to real members:

1. **Lock CORS to your site.** In `wrangler.toml`, set `ALLOWED_ORIGIN` from `"*"`
   to your site's address — e.g. `"https://yourname.github.io"`. You may list
   several comma-separated (a github.io address and a custom domain, say); the
   Worker echoes whichever one matches the request. Then `npx wrangler deploy`.
2. **Apply the latest schema.** If you deployed an earlier version, re-run
   `npx wrangler d1 execute cairo-aic --remote --file="./schema.sql"`. It only
   adds what's missing (the new sign-in throttle table) and is safe to repeat.
3. **Sort out the first administrator.** The seed includes a Command CL5
   account. On a real deployment, sign in as it once and immediately **change its
   passphrase** from the topbar (or create your own admin via Personnel → New
   personnel and disable the seeded one). Never leave a demo passphrase live.
4. **Bring in your roster.** Each real person becomes a single record that is
   both their login and their personnel file. They can self-request access (you
   approve and assign rank/clearance), you can create the record directly with an
   initial passphrase, or they can come through Recruitment — where the inductor
   can set an initial passphrase at the moment they pass.
5. **Passphrases are self-service.** Anyone can change their own from the topbar;
   a manager can reset an operator's from their file (never one above their own
   clearance); every reset and change is written to the audit log.
6. **Tune the knobs if you like.** `SESSION_TTL_HOURS` controls how long a login
   lasts; `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MIN` / `LOGIN_LOCK_MIN` control the
   failed-sign-in lockout. The defaults (6 failures in 15 minutes → 15-minute
   lock) are sensible for a community.

After any change to the Worker or the permission rules, redeploy with
`npx wrangler deploy`; after any change to the site, push it to GitHub Pages.

---

## Backups

Your live data lives in the D1 database, and Cloudflare will dump the whole
thing to a plain SQL file with one command (run from `worker/`):

```
npx wrangler d1 export cairo-aic --remote --output="backup-2026-07-02.sql"
```

Make this a habit: **weekly**, and **always immediately before** running any
`schema.sql` or `seed.sql` command against the remote database. Keep the files
somewhere safe; restoring is the reverse —
`npx wrangler d1 execute cairo-aic --remote --file="backup-2026-07-02.sql"`.

One thing that is *not* a backup: the JSON export on **Administration →
System**. In server mode that file contains only what the signed-in operator is
cleared to see — records above their clearance, outside their stake, or in
compartments they aren't read into were never sent to the browser at all, and
password hashes are never included. It's fine as a personal reference copy;
the `wrangler d1 export` above is the real thing.

---

## Notes & troubleshooting

- **CORS errors in the browser** (once wired): make sure `ALLOWED_ORIGIN` in
  `wrangler.toml` exactly matches your site's address, then run
  `npx wrangler deploy` again.
- **Cost**: this app is tiny relative to D1's free allowances; you're very
  unlikely to pay anything.
- **Sessions**: logins are stored in the database and expire after the hours set
  by `SESSION_TTL_HOURS` (default 12). If you later want faster session lookups,
  Cloudflare KV is the usual upgrade, but it isn't needed to run this.
- **Re-running**: `schema.sql` is safe to re-run (it uses `IF NOT EXISTS`).
  Don't re-run `seed.sql` on a database that already has data, or you'll get
  duplicate-key errors — it's meant for a fresh database.
- **Adding a feature (e.g. Need-To-Know compartments).** When a new feature ships
  it usually adds a new table and gate/redaction logic. To take it live:
  1. `npx wrangler d1 execute cairo-aic --remote --file=./schema.sql` — safe to
     re-run; it only creates the new tables (recently: `compartments`,
     `activity`, `recruits`) and skips the ones that already exist.
  2. `npx wrangler deploy` — pushes the new Worker code (gate + redaction).
  That's it; the feature now works against your existing data. Note the **demo
  compartments and the pre-tagged demo records only appear on a freshly seeded
  database** — on your existing database the feature starts empty, and you create
  compartments through the app's *Need-To-Know* screen. (Don't hand-run the
  compartment `INSERT`s from a fresh `seed.sql`: their member IDs point at a fresh
  seed's users, not yours.)
- **This backend is separate from your existing Firebase system.** You're now on
  the Cloudflare path; the two aren't meant to run together.
