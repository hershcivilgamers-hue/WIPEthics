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
  directives: ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  subjects:   ['id', 'org', 'deleted', 'version', 'updated_at', 'data'],
  cases:      ['id', 'deleted', 'version', 'updated_at', 'data'],
  promo_reqs: ['id', 'org', 'data'],
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
    async update(collection, record, expectedVersion) {
      const cols = COLUMNS[collection].filter((c) => c !== 'id');
      const setClause = cols.map((c) => `${c} = ?`).join(', ');
      const values = cols.map((c) => rowValue(c, record));
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
    async pruneSessions(nowIso) {
      await DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso).run();
    },

    // --- audit ---
    async addAudit(entry) {
      await DB.prepare('INSERT INTO audit (id, ts, actor, action, detail) VALUES (?, ?, ?, ?, ?)')
        .bind(entry.id, entry.ts, entry.actor, entry.action, entry.detail).run();
    },
  };
}
