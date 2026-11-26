// Uploaded files on disk (outside every web root): <UPLOAD_DIR>/<user id>/<attachment id>.
// The database keeps the metadata and extracted text; the bytes stay here.
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const store = require('./store');
const developer = require('../developer');

const IMAGE_MAX_FOR_MODEL = 8 * 1048576;

function fullPath(rel) {
  const root = path.resolve(config.chat.uploadDir);
  const p = path.resolve(root, rel);
  if (!p.startsWith(root + path.sep)) throw Object.assign(new Error('bad path'), { status: 400, code: 'bad_path' });
  return p;
}

async function save(userId, id, data) {
  const rel = path.join(String(userId), id);
  const p = fullPath(rel);
  await fs.promises.mkdir(path.dirname(p), { recursive: true, mode: 0o750 });
  await fs.promises.writeFile(p, data, { mode: 0o640 });
  return rel;
}

async function remove(rows) {
  for (const r of rows) await fs.promises.unlink(fullPath(r.path)).catch(() => {});
}

// Deletes attachment rows (and their files) matching a WHERE clause scoped to the user.
async function deleteWhere(userId, where = '1=1', params = []) {
  const rows = await db.query(`SELECT id, path FROM chat_attachments WHERE user_id = ? AND ${where}`, [userId,
    ...params]);
  if (!rows.length) return 0;
  await db.query(`DELETE FROM chat_attachments WHERE user_id = ? AND id IN (${rows.map(() => '?').join(',')})`,
    [userId, ...rows.map(r => r.id)]);
  await remove(rows);
  return rows.length;
}

async function dataUrl(row) {
  if (row.size > IMAGE_MAX_FOR_MODEL) {
    throw Object.assign(new Error(`“${row.name}” is too large for image reading. Use an image under 8 MB.`),
      { status: 422, code: 'invalid' });
  }
  const buf = await fs.promises.readFile(fullPath(row.path));
  return `data:${row.mime};base64,${buf.toString('base64')}`;
}

// Model-ready file descriptions for messages: { name, kind, text, note, pages, duration, size, dataUrl?, project? }
// (project: the stored snapshot of a .zip archive, read by Developer mode).
async function forModel(userId, attachmentLists, latestIndex) {
  const ids = [...new Set(attachmentLists.flat().map(a => a && a.id).filter(Boolean))];
  const rows = ids.length ? await db.query(`SELECT * FROM chat_attachments WHERE user_id = ? AND id IN (${ids.map(() =>
    '?').join(',')})`, [userId, ...ids]) : [];
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const out = [];
  for (let i = 0; i < attachmentLists.length; i++) {
    const files = [];
    for (const a of attachmentLists[i] || []) {
      const r = byId[a.id];
      if (!r) { files.push({ name: a.name, kind: a.kind, text: '', note: 'This file was deleted.' }); continue; }
      const meta = store.json(r.meta) || {};
      const f = { name: r.name, kind: r.kind, text: r.text || '', note: meta.note, pages: meta.pages,
        duration: meta.duration, size: r.size };
      if (meta.format === 'zip') { f.project = developer.parseSnapshot(r.text) || undefined; f.text = ''; }
      if (i === latestIndex && r.kind === 'image') f.dataUrl = await dataUrl(r);
      files.push(f);
    }
    out.push(files);
  }
  return out;
}

// 0.38.0: the user's own uploaded images by id (a Workspace chat message's photos), in the order given.
async function ownedImages(userId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!list.length) return [];
  const rows = await db.query(`SELECT * FROM chat_attachments WHERE user_id = ? AND kind = 'image' AND id IN (${list
    .map(() => '?').join(',')})`, [userId, ...list]);
  return list.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
}

// 0.17.0 (D15): a file Colon made (a generated image), stored like an upload and attached to an assistant message.
// -> the chat_attachments row
async function addGenerated(userId, conv, { id, name, mime, kind = 'image', data, meta = {} }) {
  const rel = await save(userId, id, data);
  try {
    await db.query(('INSERT INTO chat_attachments (id, user_id, project_id, conversation_id, name, mime, size, kind, '
      + 'path, text, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3))'), [id, userId,
      conv.project_id || null, conv.id, String(name).slice(0, 190), mime, data.length, kind, rel, null,
      JSON.stringify(meta)]);
  } catch (e) { await remove([{ path: rel }]); throw e; }
  return db.one('SELECT * FROM chat_attachments WHERE id = ?', [id]);
}
// 0.17.1: with conversationId, a fresh upload (sent with /image to be edited) also joins that conversation.
const linkToMessage = (userId, id, messageId, conversationId) => (conversationId ? db.query(
  'UPDATE chat_attachments SET message_id = ?, conversation_id = ? WHERE id = ? AND user_id = ?', [messageId,
    conversationId, id, userId]) : db.query('UPDATE chat_attachments SET message_id = ? WHERE id = ? AND user_id = ?',
  [messageId, id, userId]));

module.exports = { save, remove, deleteWhere, fullPath, forModel, dataUrl, addGenerated, linkToMessage,
  ownedImages };
