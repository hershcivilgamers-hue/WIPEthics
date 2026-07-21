// =============================================================================
// repo.js — D1 data access.
//
// Thin, explicit layer over the D1 binding. Each collection stores the full
// record in a `data` JSON column; a few promoted columns (id, org, deleted,
// version, updated_at, username) are derived here on write for filtering and
// optimistic concurrency. This is the only file that speaks SQL.
// =============================================================================

const COLUMNS = {
  users:      ['id', 'username', 'org', 'deleted', 'version', 'updated_at', 'data'],
  documents: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  directives: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  subjects:   ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  cases:      ['id', 'deleted', 'version', 'updated_at', 'data'],
  compartments: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  activity:   ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  operations: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  intel:      ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  blacklist:  ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  trainings:  ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  engagement: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  evidence:   ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  investigations: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  inductions: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  recruits:   ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  promo_reqs: ['id', 'org', 'data'],
  settings:   ['id', 'org', 'data'],
};

function rowValue(col, record) {
  switch (col) {
    case 'id': return record.id;
    case 'username': return record.username;
    case 'org': return record.org ?? null;
    case 'deleted': return record.deleted ? 1 : 0;
    case 'version': return record.version ?? 1;
    case 'updated_at': return record.updatedAt ?? null;
    case 'data': return JSON.stringify(record);
    default: return null;
  }
}

export function makeD1Repo(DB) {
  const parse = (row) => (row && row.data ? JSON.parse(row.data) : null);

  return {
    async getUserByUsername(username) {
      const row = await DB.prepare('SELECT data FROM users WHERE username = ?').bind(username).first();
      return parse(row);
    },

    async getById(collection, id) {
      if (!COLUMNS[collection]) return null;
      const row = await DB.prepare(`SELECT data FROM ${collection} WHERE id = ?`).bind(id).first();
      return parse(row);
    },

    async listAll(collection) {
      if (collection === 'audit') {
        const { results } = await DB.prepare('SELECT id, ts, actor, action, detail FROM audit ORDER BY ts DESC LIMIT 500').all();
        return results || [];
      }
      const { results } = await DB.prepare(`SELECT data FROM ${collection}`).all();
      return (results || []).map(parse);
    },

    async insert(collection, record) {
      const cols = COLUMNS[collection];
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map((c) => rowValue(c, record));
      await DB.prepare(`INSERT INTO ${collection} (${cols.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
      return record;
    },

    // Optimistic update: only succeeds if the stored version still matches.
    // Returns the number of rows changed (0 means a concurrent write won).
    // Collections whose schema has no `version` column (e.g. settings) update
    // by id alone — they are low-contention and can't use the version guard.
    async update(collection, record, expectedVersion) {
      const cols = COLUMNS[collection].filter((c) => c !== 'id');
      const setClause = cols.map((c) => `${c} = ?`).join(', ');
      const values = cols.map((c) => rowValue(c, record));
      if (!COLUMNS[collection].includes('version')) {
        const res = await DB.prepare(`UPDATE ${collection} SET ${setClause} WHERE id = ?`).bind(...values, record.id).run();
        return res?.meta?.changes ?? 0;
      }
      const sql = `UPDATE ${collection} SET ${setClause} WHERE id = ? AND version = ?`;
      const res = await DB.prepare(sql).bind(...values, record.id, expectedVersion).run();
      return res?.meta?.changes ?? 0;
    },

    async hardDelete(collection, id) {
      await DB.prepare(`DELETE FROM ${collection} WHERE id = ?`).bind(id).run();
    },

    // --- sessions ---
    async createSession(token, userId, createdAt, expiresAt) {
      await DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(token, userId, createdAt, expiresAt).run();
    },
    async getSession(token) {
      return DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').bind(token).first();
    },
    async deleteSession(token) {
      await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    },
    async deleteUserSessions(userId) {
      const r = await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
      return (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
    },
    async pruneSessions(nowIso) {
      await DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso).run();
    },

    // --- audit ---
    async addAudit(entry) {
      await DB.prepare('INSERT INTO audit (id, ts, actor, action, detail) VALUES (?, ?, ?, ?, ?)')
        .bind(entry.id, entry.ts, entry.actor, entry.action, entry.detail).run();
    },

    // --- failed sign-in throttle ---
    async getThrottle(key) {
      return DB.prepare('SELECT key, attempts, window_start, locked_until FROM auth_throttle WHERE key = ?').bind(key).first();
    },
    async setThrottle(key, attempts, windowStart, lockedUntil) {
      await DB.prepare(
        'INSERT INTO auth_throttle (key, attempts, window_start, locked_until) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start, locked_until = excluded.locked_until',
      ).bind(key, attempts, windowStart, lockedUntil || null).run();
    },
    async clearThrottle(key) {
      await DB.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(key).run();
    },
  };
}
