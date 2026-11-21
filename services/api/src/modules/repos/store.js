// Repository persistence (v0.24.0): the repo_* columns of colon_projects (migration 0018) and the stored snapshot,
// a chat_attachments row in the project kept like a project .zip (meta.format 'zip', meta.source 'repo'; the bytes
// on disk through the chat module's files, outside every web root). Every statement is scoped to the owner.
// sqlStore() talks to MySQL; memoryStore() is the same interface in memory, for tests.
const db = require('../../db');

const COLS = ['repo_provider', 'repo_owner', 'repo_name', 'repo_url', 'repo_branch', 'repo_sha', 'repo_synced_at',
  'repo_files', 'repo_attachment_id', 'repo_token'];
const chatFiles = () => require('../chat').files;   // lazy: the chat module loads projects and tools

function sqlStore(q = db) {
  return {
    get: (userId, pid) => q.one(`SELECT id, user_id, name, ${COLS.join(', ')} FROM colon_projects
      WHERE id = ? AND user_id = ?`, [String(pid), userId]),
    async set(userId, pid, fields) {
      const keys = Object.keys(fields).filter((k) => COLS.includes(k));
      if (!keys.length) return true;
      const r = await q.query(`UPDATE colon_projects SET ${keys.map((k) => `${k} = ?`).join(', ')},
        updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ?`, [...keys.map((k) => fields[k]), String(pid),
        userId]);
      return r.affectedRows > 0;
    },
    clear: (userId, pid) => q.query(`UPDATE colon_projects SET ${COLS.map((k) => `${k} = NULL`).join(', ')},
      updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ?`, [String(pid), userId]),
    // -> the new attachment id
    async saveSnapshot(userId, pid, { id, name, text, meta }) {
      const data = Buffer.from(text, 'utf8');
      const rel = await chatFiles().save(userId, id, data);
      try {
        await q.query(('INSERT INTO chat_attachments (id, user_id, project_id, name, mime, size, kind, path, text, '
          + 'meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3))'), [id, userId, String(pid),
          String(name).slice(0, 190), 'application/json', data.length, 'doc', rel, text, JSON.stringify(meta)]);
      } catch (e) { await chatFiles().remove([{ path: rel }]); throw e; }
      return id;
    },
    removeSnapshot: (userId, id) => (id ? chatFiles().deleteWhere(userId, 'id = ?', [String(id)]) : 0),
    async snapshot(userId, pid) {
      const r = await q.one(`SELECT a.text FROM colon_projects p JOIN chat_attachments a
        ON a.id = p.repo_attachment_id AND a.user_id = p.user_id WHERE p.id = ? AND p.user_id = ?`,
      [String(pid), userId]);
      return r ? r.text : null;
    },
  };
}

// In-memory twin for tests. seed: { projects: [] (may be projects.memoryStore()._s.projects), files: [] }
function memoryStore(seed = {}) {
  const s = { projects: seed.projects || [], files: seed.files || [] };
  const find = (userId, pid) => s.projects.find((p) => p.id === String(pid) && p.user_id === userId);
  return {
    _s: s,
    async get(userId, pid) { return find(userId, pid) || null; },
    async set(userId, pid, fields) {
      const p = find(userId, pid);
      if (!p) return false;
      for (const k of Object.keys(fields)) if (COLS.includes(k)) p[k] = fields[k];
      return true;
    },
    async clear(userId, pid) { const p = find(userId, pid); if (p) for (const k of COLS) p[k] = null; },
    async saveSnapshot(userId, pid, { id, name, text, meta }) {
      s.files.push({ id, user_id: userId, project_id: String(pid), name, text, meta, kind: 'doc' });
      return id;
    },
    async removeSnapshot(userId, id) {
      const before = s.files.length;
      s.files = s.files.filter((f) => !(f.id === id && f.user_id === userId));
      return before - s.files.length;
    },
    async snapshot(userId, pid) {
      const p = find(userId, pid);
      const f = p && s.files.find((x) => x.id === p.repo_attachment_id && x.user_id === userId);
      return f ? f.text : null;
    },
  };
}

module.exports = { sqlStore, memoryStore, COLS };
