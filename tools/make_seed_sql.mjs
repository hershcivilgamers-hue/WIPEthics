// Generate worker/seed.sql from the app's own seed, so D1 starts with identical
// demo data (and the same PBKDF2 password hashes, so the demo logins work).
import { ensureSeeded } from '../js/seed.js';
import { loadDb } from '../js/storage.js';
import { writeFileSync } from 'node:fs';

await ensureSeeded();
const db = loadDb();
const esc = (v) => String(v).replace(/'/g, "''");
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${esc(v)}'`);

const COLS = {
  users:      ['id','username','org','deleted','version','updated_at','data'],
  directives: ['id','org','deleted','version','updated_at','data'],
  subjects:   ['id','org','deleted','version','updated_at','data'],
  cases:      ['id','deleted','version','updated_at','data'],
  compartments: ['id','org','deleted','version','updated_at','data'],
  activity:   ['id','org','deleted','version','updated_at','data'],
  recruits:   ['id','org','deleted','version','updated_at','data'],
  operations: ['id','org','deleted','version','updated_at','data'],
  intel: ['id','org','deleted','version','updated_at','data'],
  trainings: ['id','org','deleted','version','updated_at','data'],
  promo_reqs: ['id','org','data'],
  settings:   ['id','org','data'],
};
const val = (col, r) => {
  switch (col) {
    case 'id': return lit(r.id);
    case 'username': return lit(r.username);
    case 'org': return lit(r.org ?? null);
    case 'deleted': return r.deleted ? '1' : '0';
    case 'version': return String(r.version ?? 1);
    case 'updated_at': return lit(r.updatedAt ?? null);
    case 'data': return lit(JSON.stringify(r));
    default: return 'NULL';
  }
};
const source = { users: db.users, directives: db.directives, subjects: db.subjects, cases: db.cases, compartments: db.compartments, activity: db.activity, recruits: db.recruits, operations: db.operations, intel: db.intel, trainings: db.trainings, promo_reqs: db.promoReqs, settings: db.settings };

let out = `-- CAIRO.AIC seed data (generated from the app seed). Apply AFTER schema.sql:\n`;
out += `--   wrangler d1 execute cairo-aic --remote --file=./seed.sql\n\n`;
for (const [table, rows] of Object.entries(source)) {
  const cols = COLS[table];
  out += `-- ${table} (${(rows||[]).length})\n`;
  for (const r of (rows || [])) {
    out += `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => val(c, r)).join(', ')});\n`;
  }
  out += `\n`;
}
out += `INSERT OR REPLACE INTO meta (key, value) VALUES ('seededAt', '${new Date().toISOString()}');\n`;
writeFileSync(new URL('../worker/seed.sql', import.meta.url), out);
console.log('seed.sql written:', { users: db.users.length, directives: db.directives.length, subjects: db.subjects.length, cases: db.cases.length, compartments: db.compartments.length, activity: db.activity.length, recruits: db.recruits.length, operations: db.operations.length, intel: db.intel.length, trainings: db.trainings.length, promo_reqs: db.promoReqs.length, settings: db.settings.length });
