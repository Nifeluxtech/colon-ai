// Workspace chat photos (0.38.0): the user sends a screenshot, a design or a photo with a message and Colon builds
// from it. The photos are ordinary chat uploads (POST /uploads, chat_attachments); a message keeps a short list of
// them (colon_workspace_messages.images) and the build gives the model the newest message's photos.
//   claim(u, ids)            -> [{ id, name, type, size, kind }] the user's own images (up to MAX), or a 422
//   content(u, images, text) -> the model message content: text, or [text part, image parts...]
//   parse(v)                 -> the list from a database value
const MAX = 3;
const err = (message) => Object.assign(new Error(message), { status: 422, code: 'invalid' });
const chat = () => require('../chat');

function parse(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

function create(deps = {}) {
  const owned = deps.ownedImages || ((uid, ids) => chat().files.ownedImages(uid, ids));
  const dataUrl = deps.dataUrl || ((row) => chat().files.dataUrl(row));
  async function claim(u, ids) {
    const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    if (!list.length) return [];
    if (list.length > MAX) throw err(`Send up to ${MAX} photos at a time.`);
    const rows = await owned(u.id, list);
    if (rows.length !== list.length) throw err('One of your photos is no longer available. Add it again.');
    return rows.map((r) => ({ id: r.id, name: r.name, type: r.mime, size: Number(r.size) || 0, kind: 'image' }));
  }
  async function content(u, images, text) {
    if (!images || !images.length) return text;
    const rows = await owned(u.id, images.map((x) => x.id));
    const parts = [];
    for (const r of rows) parts.push({ type: 'image_url', image_url: { url: await dataUrl(r) } });
    if (!parts.length) return text;
    const note = `(${parts.length} photo${parts.length > 1 ? 's' : ''} attached: use ${parts.length > 1 ? 'them'
      : 'it'} as the reference for this request.)`;
    return [{ type: 'text', text: `${text}\n\n${note}` }, ...parts];
  }
  return { claim, content };
}

module.exports = { create, parse, MAX };
