// Chat data access: conversations, messages, attachments and settings, always scoped to the owner.
const crypto = require('crypto');
const db = require('../../db');

const MODES = ['general', 'study', 'developer', 'research'];
const newId = () => crypto.randomBytes(12).toString('base64url');   // 16 chars, not guessable
const json = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;                 // MySQL JSON columns arrive parsed
  try { return JSON.parse(v); } catch { return null; }  // MariaDB stores JSON as text
};
const notFound = (what = 'This conversation no longer exists.') => Object.assign(new Error(what), { status: 404,
  code: 'not_found' });

function titleFrom(text) {
  const s = String(text || '').replace(/[`*_#>\[\]()]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return 'New chat';
  const words = s.split(' ').slice(0, 7).join(' ');
  const t = words.length > 60 ? words.slice(0, 60).replace(/\s+\S*$/, '') : words;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const previewFrom = (md) => String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>|$\\]/g,
  '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 120);

function convOut(c) {
  return {
    id: c.id, title: c.title, mode: c.mode, model: c.model, pinned: Boolean(c.pinned), archived: Boolean(c.archived),
    preview: c.preview || '', shared: Boolean(c.share_token), created_at: c.created_at, updated_at: c.updated_at,
    browser_mode: c.browser_mode === 'ai' || c.browser_mode === 'shared' ? c.browser_mode : null,
  };
}

// A reply still "streaming" long after it started belongs to a worker that was recycled mid-answer.
const STALE_MS = 4 * 60 * 1000;
function msgOut(m) {
  let status = m.status, error = json(m.error);
  if (status === 'streaming' && Date.now() - new Date(m.created_at).getTime() > STALE_MS) {
    status = 'error'; error = { code: 'interrupted', message: 'This reply was interrupted. Try regenerating it.' };
  }
  const out = {
    id: m.id, role: m.role, content: m.content, attachments: json(m.attachments) || [], sources: json(m.sources) || [],
    feedback: m.fb_rating ? { rating: m.fb_rating, reason: m.fb_reason || null, comment: m.fb_comment || null } : null,
    status, model: m.model, mode: m.mode, version: m.version, created_at: m.created_at,
  };
  if (m.origin) out.origin = m.origin;
  const web = json(m.web_search);
  if (web) out.web = { ok: Boolean(web.ok), provider: web.provider || null };
  if (error) out.error = error;
  if (m.completed_at) out.completed_at = m.completed_at;
  return out;
}

async function getConv(userId, id) {
  const c = await db.one('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?', [String(id), userId]);
  if (!c) throw notFound();
  return c;
}

async function listConvs(userId, { q = '', archived = '0' } = {}) {
  const where = ['c.user_id = ?'];
  const params = [userId];
  if (archived !== 'all') { where.push('c.archived = ?'); params.push(archived === '1' || archived === 'true' ? 1 : 0);
    }
  if (q) {
    const like = `%${String(q).slice(0, 100).replace(/[\\%_]/g, (x) => '\\' + x)}%`;
    where.push((
      '(c.title LIKE ? OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.role <> '
      + '\'event\' AND m.content LIKE ?))'));
    params.push(like, like);
  }
  const rows = await db.query(`SELECT c.* FROM chat_conversations c WHERE ${where.join(
    ' AND ')} ORDER BY c.updated_at DESC LIMIT 500`, params);
  return rows.map(convOut);
}

async function createConv(userId, { mode, model }) {
  const id = newId();
  await db.query(
    ('INSERT INTO chat_conversations (id, user_id, title, mode, model, created_at, updated_at) VALUES (?,?,?,?,?, '
      + 'UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))'),
    [id, userId, 'New chat', MODES.includes(mode) ? mode : 'general', model ? String(model).slice(0, 64) : null]
  );
  return getConv(userId, id);
}

async function messages(convId) {
  const rows = await db.query(
    `SELECT m.*, f.rating AS fb_rating, f.reason AS fb_reason, f.comment AS fb_comment
       FROM chat_messages m LEFT JOIN chat_feedback f ON f.message_id = m.id
      WHERE m.conversation_id = ? ORDER BY m.seq`, [convId]);
  return rows.map(msgOut);
}

async function insertMessage(conv, m) {
  const id = newId();
  await db.query(
    `INSERT INTO chat_messages (id, conversation_id, user_id, role, content, attachments, sources, status, error,
      mode, model, origin, version, created_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3),
       ${m.status && m.status !== 'streaming' ? 'UTC_TIMESTAMP(3)' : 'NULL'})`,
    [id, conv.id, conv.user_id, m.role, m.content || '', m.attachments ? JSON.stringify(m.attachments) : null,
      m.sources ? JSON.stringify(m.sources) : null,
      m.status || 'complete', m.error ? JSON.stringify(m.error) : null, m.mode || conv.mode, m.model || conv.model,
        m.origin || null, m.version || 1]
  );
  return getMessage(conv.id, id);
}

async function getMessage(convId, id) {
  const m = await db.one(
    `SELECT m.*, f.rating AS fb_rating, f.reason AS fb_reason, f.comment AS fb_comment
       FROM chat_messages m LEFT JOIN chat_feedback f ON f.message_id = m.id WHERE m.id = ?
         AND m.conversation_id = ?`, [String(id), convId]);
  return m ? msgOut(m) : null;
}

async function touch(conv, { preview, title } = {}) {
  const sets = ['updated_at = UTC_TIMESTAMP(3)'];
  const params = [];
  if (preview !== undefined) { sets.push('preview = ?'); params.push(previewFrom(preview)); }
  if (title) { sets.push('title = ?'); params.push(String(title).slice(0, 120)); }
  params.push(conv.id);
  await db.query(`UPDATE chat_conversations SET ${sets.join(', ')} WHERE id = ?`, params);
}

// Attachments the user uploaded and owns; marks them as belonging to this message.
async function claimAttachments(userId, ids, conv, messageId) {
  const list = (Array.isArray(ids) ? ids : []).map(String).slice(0, 6);
  if (!list.length) return [];
  if (list.length > 5) throw Object.assign(new Error('You can attach up to 5 files per message.'), { status: 422,
    code: 'invalid', field: 'attachment_ids' });
  const rows = await db.query(`SELECT * FROM chat_attachments WHERE user_id = ? AND id IN (${list.map(() => '?').join(
    ',')})`, [userId, ...list]);
  if (rows.length !== list.length) throw Object.assign(new Error(
    'One of your files is no longer available. Remove it and attach it again.'), { status: 422, code: 'invalid',
    field: 'attachment_ids' });
  if (messageId) await db.query(
    (`UPDATE chat_attachments SET conversation_id = ?, message_id = ? WHERE user_id = ` + `? AND id IN (${list.map((
    ) => '?').join(',')})`), [conv.id, messageId, userId, ...list]);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  return list.map(id => byId[id]);
}

function attachmentOut(a) {
  const meta = json(a.meta) || {};
  return { id: a.id, name: a.name, type: a.mime, size: a.size, kind: a.kind, width: meta.width, height: meta.height,
    duration: meta.duration, pages: meta.pages, words: meta.words, note: meta.note };
}

module.exports = {
  MODES, newId, json, notFound, titleFrom, previewFrom, convOut, msgOut,
  getConv, listConvs, createConv, messages, insertMessage, getMessage, touch, claimAttachments, attachmentOut,
};
