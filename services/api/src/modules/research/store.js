// Deep research persistence (0.17.0, migration 0017): colon_research_runs and the assistant message a run writes its
// progress and report to. sqlStore(db) talks to MySQL; memoryStore() is the same interface in memory for tests.
// advance() and finish() are guarded updates: advance only moves a live run whose hop still matches (a duplicate or
// late job changes nothing), finish only ends a live run once (so its credits are settled or refunded exactly once).
const LIVE = ['queued', 'running'];
const parse = (v) => { if (v == null || v === '') return {}; if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return {}; } };
const norm = (r) => (r ? { ...r, steps: Number(r.steps) || 0, hop: Number(r.hop) || 0, user_id: Number(r.user_id),
  state: parse(r.state) } : null);

function sqlStore(db = require('../../db')) {
  return {
    async insert(r) {
      await db.query(`INSERT INTO colon_research_runs (id, user_id, conversation_id, message_id, question, language,
        status, stage, steps, hop, state, request_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?)`,
      [r.id, r.user_id, r.conversation_id, r.message_id, r.question, r.language || 'en', r.status || 'queued',
        r.stage || 'plan', JSON.stringify(r.state || {}), r.request_id || null, r.now, r.now]);
    },
    get: async (id) => norm(await db.one('SELECT * FROM colon_research_runs WHERE id = ?', [String(id)])),
    owned: async (userId, id) => norm(await db.one('SELECT * FROM colon_research_runs WHERE id = ? AND user_id = ?',
      [String(id), userId])),
    async forConversation(userId, convId, limit = 20) {
      const rows = await db.query(`SELECT * FROM colon_research_runs WHERE user_id = ? AND conversation_id = ?
        ORDER BY created_at DESC LIMIT ?`, [userId, String(convId), limit]);
      return rows.map(norm);
    },
    async advance(id, hop, f) {
      const r = await db.query(`UPDATE colon_research_runs SET status = ?, stage = ?, steps = steps + ?, state = ?,
        hop = hop + 1, updated_at = ? WHERE id = ? AND hop = ? AND status IN (?)`, [f.status, f.stage, f.steps || 0,
        JSON.stringify(f.state || {}), f.now, id, hop, LIVE]);
      return Number(r.affectedRows) === 1;
    },
    async finish(id, f) {
      const r = await db.query(`UPDATE colon_research_runs SET status = ?, stage = ?, error = ?,
        steps = COALESCE(?, steps), updated_at = ?, finished_at = ? WHERE id = ? AND status IN (?)`,
      [f.status, f.stage || 'done', f.error ? String(f.error).slice(0, 300) : null, f.steps == null ? null : f.steps,
        f.now, f.now, id, LIVE]);
      return Number(r.affectedRows) === 1;
    },
    async stuck(before, limit = 50) {
      const rows = await db.query(`SELECT * FROM colon_research_runs WHERE status IN (?) AND updated_at < ?
        ORDER BY updated_at LIMIT ?`, [LIVE, before, limit]);
      return rows.map(norm);
    },
    async setMessage(id, m) {
      await db.query(`UPDATE chat_messages SET content = ?, status = ?, error = ?, completed_at = UTC_TIMESTAMP(3)
        WHERE id = ?`, [m.content || '', m.status || 'complete', m.error ? JSON.stringify(m.error) : null, id]);
      if (m.sources || m.web) {
        await db.query('UPDATE chat_messages SET sources = ?, web_search = ? WHERE id = ?', [JSON.stringify(m.sources
          || []), m.web ? JSON.stringify(m.web) : null, id]).catch(() => {});
      }
    },
  };
}

function memoryStore() {
  const t = { runs: new Map(), messages: new Map() };
  const copy = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);
  return {
    tables: t,
    async insert(r) {
      if (t.runs.has(r.id)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      t.runs.set(r.id, { status: 'queued', stage: 'plan', language: 'en', ...r, steps: 0, hop: 0, state: r.state || {},
        error: null, created_at: r.now, updated_at: r.now, finished_at: null });
    },
    get: async (id) => copy(t.runs.get(String(id))),
    owned: async (userId, id) => { const r = t.runs.get(String(id));
      return r && Number(r.user_id) === Number(userId) ? copy(r) : null; },
    async forConversation(userId, convId) {
      return [...t.runs.values()].filter((r) => Number(r.user_id) === Number(userId) && r.conversation_id === convId)
        .reverse().map(copy);
    },
    async advance(id, hop, f) {
      const r = t.runs.get(id);
      if (!r || r.hop !== hop || !LIVE.includes(r.status)) return false;
      Object.assign(r, { status: f.status, stage: f.stage, steps: r.steps + (f.steps || 0), state: copy(f.state || {}),
        hop: r.hop + 1, updated_at: f.now });
      return true;
    },
    async finish(id, f) {
      const r = t.runs.get(id);
      if (!r || !LIVE.includes(r.status)) return false;
      Object.assign(r, { status: f.status, stage: f.stage || 'done', error: f.error || null, updated_at: f.now,
        finished_at: f.now, steps: f.steps == null ? r.steps : f.steps });
      return true;
    },
    async stuck(before) {
      return [...t.runs.values()].filter((r) => LIVE.includes(r.status) && r.updated_at < before).map(copy);
    },
    async setMessage(id, m) { t.messages.set(id, { ...(t.messages.get(id) || {}), ...m }); },
  };
}

module.exports = { sqlStore, memoryStore, LIVE };
