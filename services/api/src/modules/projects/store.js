// Projects persistence (v0.15.0, Blueprint B10). Every statement is scoped to the owner (user_id = ?).
// sqlStore() talks to MySQL; memoryStore() is the same interface in memory, for tests.
const db = require('../../db');

const COLS = ('p.id, p.user_id, p.name, p.instructions, p.archived_at, p.repo_provider, p.repo_owner, '
  + 'p.repo_name, p.repo_branch, p.repo_sha, p.repo_synced_at, p.repo_files, p.created_at, p.updated_at');
const COUNTS = `(SELECT COUNT(*) FROM chat_conversations c
    WHERE c.project_id = p.id AND c.user_id = p.user_id) AS chats,
  (SELECT COUNT(*) FROM chat_attachments a WHERE a.project_id = p.id AND a.user_id = p.user_id) AS files`;

function sqlStore(q = db) {
  return {
    list: (userId) => q.query(`SELECT ${COLS}, ${COUNTS} FROM colon_projects p WHERE p.user_id = ?
      ORDER BY p.updated_at DESC LIMIT 500`, [userId]),
    get: (userId, id) => q.one(`SELECT ${COLS}, ${COUNTS} FROM colon_projects p WHERE p.id = ? AND p.user_id = ?`,
      [String(id), userId]),
    async count(userId) {
      const r = await q.one('SELECT COUNT(*) AS n FROM colon_projects WHERE user_id = ?', [userId]);
      return Number(r && r.n) || 0;
    },
    insert: (p) => q.query(`INSERT INTO colon_projects (id, user_id, name, instructions, created_at, updated_at)
      VALUES (?,?,?,?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [p.id, p.user_id, p.name, p.instructions || null]),
    async update(userId, id, fields) {
      const sets = [], params = [];
      for (const k of ['name', 'instructions', 'archived_at']) {
        if (fields[k] !== undefined) { sets.push(`${k} = ?`); params.push(fields[k]); }
      }
      if (!sets.length) return true;
      const r = await q.query(`UPDATE colon_projects SET ${sets.join(', ')}, updated_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND user_id = ?`, [...params, String(id), userId]);
      return r.affectedRows > 0;
    },
    // Chats and files are kept and leave the project (ON DELETE SET NULL); its memories go with it (CASCADE).
    async remove(userId, id) {
      const r = await q.query('DELETE FROM colon_projects WHERE id = ? AND user_id = ?', [String(id), userId]);
      return r.affectedRows > 0;
    },
    chats: (userId, id) => q.query(`SELECT id, title, mode, pinned, archived, preview, created_at, updated_at
      FROM chat_conversations WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 500`,
    [userId, String(id)]),
    files: (userId, id, { text = false } = {}) => q.query(`SELECT id, name, mime, size, kind, meta, created_at
      ${text ? ', text' : ''} FROM chat_attachments WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC
      LIMIT 100`, [userId, String(id)]),
  };
}

// In-memory twin for tests. seed: { projects: [], conversations: [{id, user_id, project_id}], files: [] }
function memoryStore(seed = {}) {
  const s = { projects: seed.projects || [], conversations: seed.conversations || [], files: seed.files || [] };
  const withCounts = (p) => ({ ...p, chats: s.conversations.filter((c) => c.project_id === p.id
    && c.user_id === p.user_id).length, files: s.files.filter((f) => f.project_id === p.id
    && f.user_id === p.user_id).length });
  const find = (userId, id) => s.projects.find((p) => p.id === String(id) && p.user_id === userId);
  return {
    _s: s,
    async list(userId) { return s.projects.filter((p) => p.user_id === userId).map(withCounts); },
    async get(userId, id) { const p = find(userId, id); return p ? withCounts(p) : null; },
    async count(userId) { return s.projects.filter((p) => p.user_id === userId).length; },
    async insert(p) { const now = new Date(); s.projects.push({ ...p, created_at: now, updated_at: now }); },
    async update(userId, id, fields) {
      const p = find(userId, id);
      if (!p) return false;
      for (const k of ['name', 'instructions', 'archived_at']) if (fields[k] !== undefined) p[k] = fields[k];
      p.updated_at = new Date();
      return true;
    },
    async remove(userId, id) {
      const p = find(userId, id);
      if (!p) return false;
      s.projects = s.projects.filter((x) => x !== p);
      for (const c of s.conversations) if (c.project_id === p.id) c.project_id = null;
      for (const f of s.files) if (f.project_id === p.id) f.project_id = null;
      return true;
    },
    async chats(userId, id) { return s.conversations.filter((c) => c.user_id === userId && c.project_id === id); },
    async files(userId, id) { return s.files.filter((f) => f.user_id === userId && f.project_id === id); },
  };
}

module.exports = { sqlStore, memoryStore };
