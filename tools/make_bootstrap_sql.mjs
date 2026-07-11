// =============================================================================
// tools/make_bootstrap_sql.mjs — generate a ONE-ACCOUNT bootstrap seed.
//
// For a genuinely empty go-live: this writes worker/bootstrap.sql containing a
// single Command / CL5 account and nothing else — no demo personnel, cases,
// sources or sample data. It exists only so you can sign in once and build the
// real roster by hand. The passphrase is PBKDF2-hashed exactly as the app does,
// so it is a real credential, never stored in plaintext.
//
// Usage (from the project root):
//   node tools/make_bootstrap_sql.mjs <operator-id> <passphrase> ["Codename"]
// Example:
//   node tools/make_bootstrap_sql.mjs CMD-1 "a-long-passphrase-you-choose" "OVERSEER"
//
// Then, from worker/:
//   npx wrangler d1 execute cairo-aic --remote --file=./bootstrap.sql
// =============================================================================
import { makeCredential } from '../js/crypto.js';
import { writeFileSync } from 'node:fs';

const [, , username, passphrase, codenameArg] = process.argv;
if (!username || !passphrase) {
  console.error('Usage: node tools/make_bootstrap_sql.mjs <operator-id> <passphrase> ["Codename"]');
  process.exit(1);
}
if (passphrase.length < 8) {
  console.error('Choose a passphrase of at least 8 characters.');
  process.exit(1);
}
const codename = codenameArg || 'OVERSEER';

const now = new Date().toISOString();
const { salt, hash } = await makeCredential(passphrase);

const user = {
  id: `usr-bootstrap-${Date.now().toString(36)}`,
  designation: username,
  codename,
  realName: '[REDACTED]',
  org: 'command',
  rank: 'Site Command',
  clearance: 'CL5',
  status: 'active',
  username,
  salt,
  passwordHash: hash,
  accountStatus: 'active',
  requestedOrg: null,
  awards: [], strikes: [], promoChecks: [], leave: null, notes: [], events: [],
  trainings: [], tags: [],
  // The passphrase was typed into a shell and sits in this file until deleted —
  // so the system forces you to set a fresh one at first sign-in.
  mustChangePassphrase: true,
  createdAt: now, updatedAt: now, version: 1, deleted: false, deletedAt: null,
};

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `-- bootstrap.sql — single Command/CL5 account for an otherwise empty database.
-- Generated ${now}. Sign in, change this passphrase, then build your roster.
INSERT OR REPLACE INTO users (id, username, org, deleted, version, updated_at, data) VALUES (${lit(user.id)}, ${lit(user.username)}, 'command', 0, 1, ${lit(now)}, ${lit(JSON.stringify(user))});
INSERT OR REPLACE INTO meta (key, value) VALUES ('bootstrappedAt', ${lit(now)});
`;

writeFileSync(new URL('../worker/bootstrap.sql', import.meta.url), sql);
console.log(`bootstrap.sql written: 1 account — ${username} (Command / CL5, codename ${codename}).`);
console.log('Deploy from worker/:  npx wrangler d1 execute cairo-aic --remote --file=./bootstrap.sql');
