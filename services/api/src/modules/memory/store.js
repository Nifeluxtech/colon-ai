// Memory persistence (v0.15.0, Blueprint B9). Every statement is scoped to the owner (WHERE user_id = ?), so one
// user can never read, change or delete another user's memories, projects or chats through this module.
// sqlStore() talks to MySQL; memoryStore() is the same interface in memory, for tests.
const db = require('../../db');

const COLS = 'id, user_id, project_id, conversation_id, scope, content, source, created_at, updated_at';

function sqlStore(q = db) {
  return {
    async list(userId, { projectId } = {}) {
      const where = projectId ? ' AND project_id = ?' : '';
      return q.query(`SELECT ${COLS} FROM colon_memories WHERE user_id = ?${where} ORDER BY updated_at DESC LIMIT 500`,
        projectId ? [userId, projectId] : [userId]);
    },
    get: (userId, id) => q.one(`SELECT ${COLS} FROM colon_memories WHERE id = ? AND user_id = ?`, [id, userId]),
    async insert(m) {
      const r = await q.query(`INSERT INTO colon_memories (user_id, project_id, conversation_id, scope, content, source,
        created_at, updated_at) VALUES (?,?,?,?,?,?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [m.user_id, m.project_id || null, m.conversation_id || null, m.scope, m.content, m.source]);
      return r.insertId;
    },
    async update(userId, id, { content }) {
      const r = await q.query('UPDATE colon_memories SET content = ?, updated_at = UTC_TIMESTAMP(3) '
        + 'WHERE id = ? AND user_id = ?', [content, id, userId]);
      return r.affectedRows > 0;
    },
    async remove(userId, id) {
      const r = await q.query('DELETE FROM colon_memories WHERE id = ? AND user_id = ?', [id, userId]);
      return r.affectedRows > 0;
    },
    async removeAll(userId) {
      const r = await q.query('DELETE FROM colon_memories WHERE user_id = ?', [userId]);
      return r.affectedRows || 0;
    },
    async count(userId) {
      const r = await q.one('SELECT COUNT(*) AS n FROM colon_memories WHERE user_id = ?', [userId]);
      return Number(r && r.n) || 0;
    },
    // Memories that may apply to one reply: the user's own, this project's, this chat's.
    candidates(userId, { projectId = null, conversationId = null } = {}) {
      return q.query(`SELECT ${COLS} FROM colon_memories WHERE user_id = ? AND (scope = 'user'
        OR (scope = 'project' AND project_id = ?) OR (scope = 'task' AND conversation_id = ?))
        ORDER BY updated_at DESC LIMIT 300`, [userId, projectId || '', conversationId || '']);
    },
    async consent(userId) {
      const r = await q.one('SELECT enabled, changed_at FROM colon_memory_consent WHERE user_id = ?', [userId]);
      return r ? { enabled: Boolean(Number(r.enabled)), changed_at: r.changed_at } : null;
    },
    setConsent: (userId, enabled) => q.query(`INSERT INTO colon_memory_consent (user_id, enabled, changed_at)
      VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), changed_at = UTC_TIMESTAMP(3)`,
    [userId, enabled ? 1 : 0]),
    async ownsProject(userId, id) {
      return Boolean(await q.one('SELECT 1 AS x FROM colon_projects WHERE id = ? AND user_id = ?',
        [String(id), userId]));
    },
    async conversationProject(userId, id) {
      const r = await q.one('SELECT project_id FROM chat_conversations WHERE id = ? AND user_id = ?', [String(id),
        userId]);
      return r ? { project_id: r.project_id || null } : null;
    },
  };
}

// In-memory twin for tests. seed: { projects: [{id, user_id}], conversations: [{id, user_id, project_id}] }
function memoryStore(seed = {}) {
  const s = { memories: [], consent: new Map(), projects: seed.projects || [], conversations: seed.conversations || [],
    seq: 0, clock: seed.clock || (() => new Date()) };
  const mine = (userId) => s.memories.filter((m) => m.user_id === userId);
  const byNew = (a, b) => new Date(b.updated_at) - new Date(a.updated_at);
  return {
    _s: s,
    async list(userId, { projectId } = {}) {
      return mine(userId).filter((m) => !projectId || m.project_id === projectId).sort(byNew);
    },
    async get(userId, id) { return mine(userId).find((m) => String(m.id) === String(id)) || null; },
    async insert(m) {
      const now = s.clock();
      const row = { project_id: null, conversation_id: null, ...m, id: ++s.seq, created_at: now, updated_at: now };
      s.memories.push(row);
      return row.id;
    },
    async update(userId, id, { content }) {
      const m = mine(userId).find((x) => String(x.id) === String(id));
      if (!m) return false;
      Object.assign(m, { content, updated_at: s.clock() });
      return true;
    },
    async remove(userId, id) {
      const before = s.memories.length;
      s.memories = s.memories.filter((m) => !(m.user_id === userId && String(m.id) === String(id)));
      return s.memories.length < before;
    },
    async removeAll(userId) {
      const before = s.memories.length;
      s.memories = s.memories.filter((m) => m.user_id !== userId);
      return before - s.memories.length;
    },
    async count(userId) { return mine(userId).length; },
    async candidates(userId, { projectId = null, conversationId = null } = {}) {
      return mine(userId).filter((m) => m.scope === 'user' || (m.scope === 'project' && projectId
        && m.project_id === projectId)
        || (m.scope === 'task' && conversationId && m.conversation_id === conversationId))
        .sort(byNew);
    },
    async consent(userId) {
      return s.consent.has(userId) ? { enabled: s.consent.get(userId), changed_at: null } : null;
    },
    async setConsent(userId, enabled) { s.consent.set(userId, Boolean(enabled)); },
    async ownsProject(userId, id) { return s.projects.some((p) => p.id === id && p.user_id === userId); },
    async conversationProject(userId, id) {
      const c = s.conversations.find((x) => x.id === id && x.user_id === userId);
      return c ? { project_id: c.project_id || null } : null;
    },
  };
}

module.exports = { sqlStore, memoryStore };
