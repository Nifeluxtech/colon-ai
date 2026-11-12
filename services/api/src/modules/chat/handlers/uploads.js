// Chat: uploads and guest file extraction (handlers for src/http/routes/chat/uploads.js).
// Phase 3: chat uploads (images, PDF, documents, text, voice notes). The real file signature is
// checked server-side, text is extracted once at upload time, and files are stored outside web roots.
const fs = require('fs');
const db = require('../../../db');
const config = require('../../../config');
const store = require('../store');
const files = require('../files');
const extract = require('../../extract');
const { SECURITY_HEADERS } = require('../../../shared/security-headers');
const { readMultipartFile } = require('../../../shared/multipart');

const MAX_UPLOAD = 20 * 1048576;

// POST /uploads
const postUploads = async (req) => {
  const { file, fields } = await readMultipartFile(req, { max: MAX_UPLOAD });
  const s = extract.validate(file.data, file.name, { fromRecorder: fields.recorder === '1' || /^audio\//.test(
    file.type) });
  const used = await db.one('SELECT COALESCE(SUM(size),0) AS bytes FROM chat_attachments WHERE user_id = ?',
    [req.user.id]);
  if (Number(used.bytes) + file.data.length > config.chat.uploadQuotaMb * 1048576) {
    throw Object.assign(new Error(
      `Your file storage is full (${config.chat.uploadQuotaMb} MB). Clear uploaded files in Settings → Data.`),
      { status: 413, code: 'quota' });
  }
  const { text, meta } = extract.extract(file.data, s);
  if (s.kind === 'audio' && fields.duration) meta.duration = Math.max(0, Math.min(3600, Math.round(Number(
    fields.duration) || 0))) || undefined;
  const id = store.newId();
  const rel = await files.save(req.user.id, id, file.data);
  await db.query(
    ('INSERT INTO chat_attachments (id, user_id, name, mime, size, kind, path, text, meta, created_at) VALUES '
      + '(?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(3))'),
    [id, req.user.id, file.name, s.mime, file.data.length, s.kind, rel, text || null, JSON.stringify(meta)]
  );
  const row = await db.one('SELECT * FROM chat_attachments WHERE id = ?', [id]);
  return [201, { attachment: store.attachmentOut(row) }];
};

// GET /uploads/:id/file
const getUploadsByIdFile = async (req, res) => {
  const row = await db.one('SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?', [String(req.params.id),
    req.user.id]);
  if (!row) throw store.notFound('This file is no longer available.');
  const p = files.fullPath(row.path);
  const stat = await fs.promises.stat(p).catch(() => null);
  if (!stat) throw store.notFound('This file is no longer available.');
  const inline = row.kind === 'image' || row.kind === 'pdf' || row.kind === 'audio';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': row.kind === 'text' ? 'text/plain; charset=utf-8' : row.mime,
    'Content-Length': stat.size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
    'Cache-Control': 'private, max-age=3600',
  });
  await new Promise((resolve) => { const s = fs.createReadStream(p); s.on('error', () => { res.end(); resolve(); });
    s.on('end', resolve); s.pipe(res); });
};

// DELETE /uploads/:id
const deleteUploadsById = async (req) => {
  await files.deleteWhere(req.user.id, 'id = ?', [String(req.params.id)]);
  return [200, { ok: true }];
};

// DELETE /uploads
const deleteUploads = async (req) => {
  const n = await files.deleteWhere(req.user.id);
  return [200, { ok: true, deleted: n }];
};

// Guests: read a file's text for one question without storing anything (images need an account).
// POST /chat/guest/extract
const postChatGuestExtract = async (req) => {
  const { file } = await readMultipartFile(req, { max: MAX_UPLOAD });
  const s = extract.validate(file.data, file.name, { fromRecorder: false });
  if (s.kind === 'image') throw Object.assign(new Error('Log in to ask Colon about images.'), { status: 422,
    code: 'login_required' });
  const { text, meta } = extract.extract(file.data, s);
  return [200, { attachment: { id: `g-${store.newId()}`, name: file.name, type: s.mime, size: file.data.length,
    kind: s.kind, text: text.slice(0, 24000), pages: meta.pages, words: meta.words, note: meta.note,
    truncated: text.length > 24000 || meta.truncated || undefined } }];
};

module.exports = { postUploads, getUploadsByIdFile, deleteUploadsById, deleteUploads, postChatGuestExtract };
