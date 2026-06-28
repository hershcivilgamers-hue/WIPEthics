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
- **This backend is separate from your existing Firebase system.** You're now on
  the Cloudflare path; the two aren't meant to run together.
