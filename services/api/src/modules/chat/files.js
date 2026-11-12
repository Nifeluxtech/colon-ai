// Uploaded files on disk (outside every web root): <UPLOAD_DIR>/<user id>/<attachment id>.
// The database keeps the metadata and extracted text; the bytes stay here.
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const store = require('./store');

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

// Model-ready file descriptions for messages: { name, kind, text, note, pages, duration, dataUrl? }.
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
        duration: meta.duration };
      if (i === latestIndex && r.kind === 'image') f.dataUrl = await dataUrl(r);
      files.push(f);
    }
    out.push(files);
  }
  return out;
}

module.exports = { save, remove, deleteWhere, fullPath, forModel, dataUrl };
