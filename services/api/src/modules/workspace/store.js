// Workspace persistence (v0.25.0, Workspace step 1). Every statement is scoped to the owner (user_id = ?), either
// directly or through a workspace id the engine has already checked. sqlStore() talks to MySQL; memoryStore() is
// the same interface in memory, for tests. Versions hold every file base64-encoded as JSON { path: [mime, b64] }.
// The db module is loaded on first use, so tests (memoryStore) run without the mysql2 driver.

const WS = 'id, user_id, title, template, version, slug, published_version, published_at, created_at, updated_at';
const COUNTS = `(SELECT COUNT(*) FROM colon_workspace_files f WHERE f.workspace_id = w.id) AS files,
  (SELECT COALESCE(SUM(f.size), 0) FROM colon_workspace_files f WHERE f.workspace_id = w.id) AS bytes`;

function sqlStore(q) {
  q = q || require('../../db');
  return {
    list: (userId) => q.query(`SELECT ${WS}, ${COUNTS} FROM colon_workspaces w WHERE w.user_id = ?
      ORDER BY w.updated_at DESC LIMIT 200`, [userId]),
    get: (userId, id) => q.one(`SELECT ${WS}, ${COUNTS} FROM colon_workspaces w WHERE w.id = ? AND w.user_id = ?`,
      [String(id), userId]),
    async count(userId) {
      const r = await q.one('SELECT COUNT(*) AS n FROM colon_workspaces WHERE user_id = ?', [userId]);
      return Number(r && r.n) || 0;
    },
    insert: (w) => q.query(`INSERT INTO colon_workspaces (id, user_id, title, template, version, created_at,
      updated_at) VALUES (?,?,?,?,0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [w.id, w.user_id, w.title, w.template]),
    async update(userId, id, fields) {
      const sets = [], params = [];
      for (const k of ['title', 'version']) {
        if (fields[k] !== undefined) { sets.push(`${k} = ?`); params.push(fields[k]); }
      }
      const r = await q.query(`UPDATE colon_workspaces SET ${sets.concat('updated_at = UTC_TIMESTAMP(3)').join(', ')}
        WHERE id = ? AND user_id = ?`, [...params, String(id), userId]);
      return r.affectedRows > 0;
    },
    async remove(userId, id) {
      const r = await q.query('DELETE FROM colon_workspaces WHERE id = ? AND user_id = ?', [String(id), userId]);
      return r.affectedRows > 0;
    },
    files: (wsId) => q.query(`SELECT path, mime, size, updated_at FROM colon_workspace_files WHERE workspace_id = ?
      ORDER BY path`, [wsId]),
    file: (wsId, p) => q.one(`SELECT path, mime, size, content, updated_at FROM colon_workspace_files
      WHERE workspace_id = ? AND path = ?`, [wsId, p]),
    allFiles: (wsId) => q.query(`SELECT path, mime, size, content FROM colon_workspace_files WHERE workspace_id = ?
      ORDER BY path`, [wsId]),
    putFile: (wsId, f) => q.query(`INSERT INTO colon_workspace_files (workspace_id, path, mime, size, content,
      updated_at) VALUES (?,?,?,?,?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE mime = VALUES(mime),
      size = VALUES(size), content = VALUES(content), updated_at = VALUES(updated_at)`,
    [wsId, f.path, f.mime, f.content.length, f.content]),
    async deleteFile(wsId, p) {
      const r = await q.query('DELETE FROM colon_workspace_files WHERE workspace_id = ? AND path = ?', [wsId, p]);
      return r.affectedRows > 0;
    },
    clearFiles: (wsId) => q.query('DELETE FROM colon_workspace_files WHERE workspace_id = ?', [wsId]),
    async addVersion(wsId, n, note, files, keep) {
      await q.query(`INSERT INTO colon_workspace_versions (workspace_id, n, note, files, created_at)
        VALUES (?,?,?,?, UTC_TIMESTAMP(3))`, [wsId, n, note, files]);
      await q.query('DELETE FROM colon_workspace_versions WHERE workspace_id = ? AND n <= ?', [wsId, n - keep]);
    },
    versions: (wsId) => q.query(`SELECT n, note, created_at FROM colon_workspace_versions WHERE workspace_id = ?
      ORDER BY n DESC`, [wsId]),
    version: (wsId, n) => q.one(`SELECT n, note, files, created_at FROM colon_workspace_versions
      WHERE workspace_id = ? AND n = ?`, [wsId, Number(n)]),
    // v0.26.0 (step 2): the Workspace chat.
    messages: (wsId, limit) => q.query(`SELECT * FROM (SELECT id, role, content, changes, version_before,
      version_after, error, created_at FROM colon_workspace_messages WHERE workspace_id = ? ORDER BY id DESC
      LIMIT ${Math.max(1, Math.min(200, Number(limit) || 50))}) t ORDER BY id`, [wsId]),
    async addMessage(wsId, m) {
      const r = await q.query(`INSERT INTO colon_workspace_messages (workspace_id, role, content, changes,
        version_before, version_after, error, created_at) VALUES (?,?,?,?,?,?,?, UTC_TIMESTAMP(3))`, [wsId, m.role,
        m.content, m.changes ? JSON.stringify(m.changes) : null, m.version_before ?? null, m.version_after ?? null,
        m.error ? 1 : 0]);
      return r.insertId;
    },
  };
}

// In-memory twin for tests.
function memoryStore() {
  const s = { ws: [], files: [], versions: [], messages: [] };
  const find = (userId, id) => s.ws.find((w) => w.id === String(id) && w.user_id === userId);
  const filesOf = (wsId) => s.files.filter((f) => f.workspace_id === wsId).sort((a, b) => (a.path < b.path ? -1 : 1));
  const withCounts = (w) => ({ ...w, files: filesOf(w.id).length, bytes: filesOf(w.id).reduce((n, f) => n + f.size,
    0) });
  const now = () => new Date();
  return {
    _s: s,
    async list(userId) { return s.ws.filter((w) => w.user_id === userId).map(withCounts); },
    async get(userId, id) { const w = find(userId, id); return w ? withCounts(w) : null; },
    async count(userId) { return s.ws.filter((w) => w.user_id === userId).length; },
    async insert(w) { s.ws.push({ ...w, version: 0, slug: null, published_version: null, published_at: null,
      created_at: now(), updated_at: now() }); },
    async update(userId, id, fields) {
      const w = find(userId, id);
      if (!w) return false;
      for (const k of ['title', 'version']) if (fields[k] !== undefined) w[k] = fields[k];
      w.updated_at = now();
      return true;
    },
    async remove(userId, id) {
      const w = find(userId, id);
      if (!w) return false;
      s.ws = s.ws.filter((x) => x !== w);
      s.files = s.files.filter((f) => f.workspace_id !== w.id);
      s.versions = s.versions.filter((v) => v.workspace_id !== w.id);
      s.messages = s.messages.filter((m) => m.workspace_id !== w.id);
      return true;
    },
    async files(wsId) { return filesOf(wsId).map(({ path, mime, size, updated_at }) => ({ path, mime, size,
      updated_at })); },
    async file(wsId, p) { return filesOf(wsId).find((f) => f.path === p) || null; },
    async allFiles(wsId) { return filesOf(wsId); },
    async putFile(wsId, f) {
      s.files = s.files.filter((x) => !(x.workspace_id === wsId && x.path === f.path));
      s.files.push({ workspace_id: wsId, path: f.path, mime: f.mime, size: f.content.length, content: f.content,
        updated_at: now() });
    },
    async deleteFile(wsId, p) {
      const before = s.files.length;
      s.files = s.files.filter((x) => !(x.workspace_id === wsId && x.path === p));
      return s.files.length < before;
    },
    async clearFiles(wsId) { s.files = s.files.filter((x) => x.workspace_id !== wsId); },
    async addVersion(wsId, n, note, files, keep) {
      s.versions.push({ workspace_id: wsId, n, note, files, created_at: now() });
      s.versions = s.versions.filter((v) => v.workspace_id !== wsId || v.n > n - keep);
    },
    async versions(wsId) { return s.versions.filter((v) => v.workspace_id === wsId).sort((a, b) => b.n - a.n)
      .map(({ n, note, created_at }) => ({ n, note, created_at })); },
    async version(wsId, n) { return s.versions.find((v) => v.workspace_id === wsId && v.n === Number(n)) || null; },
    async messages(wsId, limit) { return s.messages.filter((m) => m.workspace_id === wsId).slice(-(limit || 50)); },
    async addMessage(wsId, m) {
      const id = s.messages.length + 1;
      s.messages.push({ id, workspace_id: wsId, role: m.role, content: m.content, changes: m.changes
        ? JSON.stringify(m.changes) : null, version_before: m.version_before ?? null, version_after: m.version_after
        ?? null, error: m.error ? 1 : 0, created_at: now() });
      return id;
    },
  };
}

module.exports = { sqlStore, memoryStore };
