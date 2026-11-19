// Media module (0.17.0, Production Blueprint D15): image generation in chat, metered with the plan's image credits.
// Every image goes through the tool registry (modules/tools: generate_image), so the plan's image_credits must be on
// and not used up, BILLING_CREDITS_IMAGE Colon credits are reserved, and the call times out after IMAGE_TIMEOUT_MS.
// The reservation is settled once the image is saved, and refunded in full when the provider fails, refuses the
// prompt, times out or the file cannot be saved. Images are stored like uploads (UPLOAD_DIR, chat_attachments) and
// attached to an assistant message (origin 'image'), so the app shows them like any attachment.
//   produce({ user, prompt, id, save, images?, provider?, generate?, router? }) -> { result: { attachment, ... },
//     reserved }
//   sources(userId, conv, ids, { query?, read? }) -> [{ id, mime, data, row, fresh }]   (0.17.1: images to edit)
//   handlers.postConversationsByIdImages   POST /conversations/:id/images { prompt, message_id?, attachment_ids? }
// 0.17.1 (image editing): attachment_ids names up to 3 of the user's own images (PNG, JPEG or WebP, under 7 MB each)
// from this conversation (an upload, or an image Colon made here), or fresh uploads not yet sent anywhere. They go to
// the image model with the instruction; the edit costs exactly what a new image does (same reserve/settle/refund).
const config = require('../../config');
const log = require('../../shared/logger');
const image = require('./image');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const bad = (message) => Object.assign(new Error(message), { status: 422, code: 'invalid', field: 'attachment_ids' });

/** attachment_ids from a request body -> a clean, de-duplicated list ([] when absent). */
function sourceIds(raw) {
  if (raw == null || raw === '') return [];
  if (!Array.isArray(raw)) throw bad('attachment_ids must be a list of image ids.');
  const ids = [...new Set(raw.map((x) => String(x == null ? '' : x).trim()).filter(Boolean))];
  if (ids.some((x) => x.length > 64 || !/^[A-Za-z0-9_-]+$/.test(x))) throw bad('One of the images is not valid.');
  if (ids.length > image.EDIT_MAX) throw bad(`Edit up to ${image.EDIT_MAX} images at a time.`);
  return ids;
}

/** The images to edit, checked: the user's own, in this conversation (or a fresh upload not yet in any chat), an
 *  image of an editable type and size, and still on disk. A row of someone else's reads as missing (no leak). */
async function sources(userId, conv, ids, o = {}) {
  const list = sourceIds(ids);
  if (!list.length) return [];
  const query = o.query || ((sql, p) => require('../../db').query(sql, p));
  const read = o.read || ((row) => require('fs').promises.readFile(require('../chat').files.fullPath(row.path)));
  const rows = await query(`SELECT * FROM chat_attachments WHERE user_id = ? AND id IN (${list.map(() => '?')
    .join(',')})`, [userId, ...list]);
  const byId = Object.fromEntries((rows || []).filter((r) => String(r.user_id) === String(userId)).map((r) => [r.id,
    r]));
  const out = [];
  for (const id of list) {
    const r = byId[id];
    const fresh = Boolean(r) && !r.conversation_id && !r.message_id;
    if (!r || (!fresh && r.conversation_id !== conv.id)) {
      throw bad('That image is no longer available in this chat. Attach it again.');
    }
    const mime = String(r.mime || '').toLowerCase();
    if (r.kind !== 'image' || !EXT[mime]) throw bad(`“${r.name}” can’t be edited. Use a PNG, JPEG or WebP image.`);
    if (Number(r.size) > image.EDIT_BYTES) throw bad(`“${r.name}” is too large to edit. Use an image under 7 MB.`);
    const data = await Promise.resolve().then(() => read(r)).catch(() => null);
    if (!data || !data.length) throw bad('That image is no longer available in this chat. Attach it again.');
    if (data.length > image.EDIT_BYTES) throw bad(`“${r.name}” is too large to edit. Use an image under 7 MB.`);
    out.push({ id, mime, data, row: r, fresh });
  }
  return out;
}

/** One image through the registry. save(img) stores it and returns { attachment }; it runs inside the call, so a
 *  save failure refunds too. */
async function produce(o) {
  const router = o.router || require('../tools');
  const gen = o.generate || image.generate;
  const images = (o.images || []).map((im) => ({ mime: im.mime, data: im.data }));
  return router.invoke('generate_image', { prompt: o.prompt, ...(images.length ? { edit: true } : {}) }, {
    user: o.user, requestId: `image:${o.id}`,
    run: async (a, ctx) => {
      const provider = o.provider || image.providerFrom(await require('../ai').dynamic.load().catch(() => null));
      const img = await gen({ prompt: a.prompt, model: config.media.imageModel, provider, images, signal: ctx.signal,
        fetch: o.fetch });
      if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const saved = await o.save(img);
      return { ...saved, provider: 'gemini', model: img.model };
    },
  });
}

const fileName = (prompt, mime, edited) => `${edited ? 'edited-' : ''}${String(prompt)
  .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  .slice(0, 40).toLowerCase() || 'image'}.${EXT[mime] || 'png'}`;

// What the chat shows when an image could not be made (the reply's error card).
function failure(e) {
  if (e.code === 'quota' || e.code === 'plan' || e.code === 'tool_off' || e.code === 'image_blocked'
    || e.code === 'login_required') return { code: e.code === 'image_blocked' ? 'image_blocked' : e.code,
    message: e.code === 'tool_off' ? 'Image generation isn’t switched on.' : e.message };
  if (e.code === 'tool_timeout') return { code: 'image_unavailable', message: 'The image took too long. '
    + 'Your image credit was given back. Try again.' };
  return { code: 'image_unavailable', message: 'Image generation isn’t available right now. Your image credit was '
    + 'given back.' };
}

// POST /conversations/:id/images { prompt, message_id?, attachment_ids? }
// message_id: the user's message that asked for it (the chat model called generate_image); else the prompt becomes a
// new user message (carrying the images being edited). attachment_ids (0.17.1): the images to edit (sources()).
// -> 201 { user_message, message, conversation }; a failed image is an assistant message with an
// error (refunded), so the thread keeps what happened.
async function postConversationsByIdImages(req, _res, o = {}) {
  const chat = require('../chat');
  const safety = require('../safety');
  const v = require('../../shared/validate');
  const conv = await chat.store.getConv(req.user.id, req.params.id);
  const prompt = String((req.body && req.body.prompt) || '').replace(/\s+/g, ' ').trim();
  if (prompt.length < 3) v.fail('prompt', 'Describe the image first.');
  if (prompt.length > 2000) v.fail('prompt', 'Keep the description under 2,000 characters.');
  // 0.17.1: checked before anything is saved or reserved, so a wrong image costs nothing.
  const srcs = await sources(req.user.id, conv, req.body.attachment_ids, o);
  let userMsg;
  if (req.body.message_id) {
    userMsg = await chat.store.getMessage(conv.id, String(req.body.message_id));
    if (!userMsg || userMsg.role !== 'user') throw chat.store.notFound('This message no longer exists.');
  } else {
    userMsg = await chat.store.insertMessage(conv, { role: 'user', content: prompt, origin: 'image',
      ...(srcs.length ? { attachments: srcs.map((s) => chat.store.attachmentOut(s.row)) } : {}) });
    await chat.store.touch(conv, { preview: prompt, title: conv.title === 'New chat' ? chat.store.titleFrom(prompt)
      : null });
  }
  // A fresh upload (sent with /image) now belongs to this chat and the message that carries it.
  for (const s of srcs.filter((x) => x.fresh)) {
    await chat.files.linkToMessage(req.user.id, s.id, userMsg.id, conv.id).catch(() => {});
  }
  const reply = async (m) => {
    const message = await chat.store.insertMessage(conv, { role: 'assistant', origin: 'image', ...m });
    await chat.store.touch(conv, { preview: m.content || 'Image' });
    return [201, { user_message: userMsg, message, conversation: chat.store.convOut(await chat.store.getConv(
      req.user.id, conv.id)) }];
  };
  const verdict = await safety.checkInput({ route: 'chat.image', mode: conv.mode, language: req.user.language || 'en',
    text: prompt, req });
  if (verdict.action === 'refuse') return reply({ content: verdict.refusal, status: 'complete' });
  const id = chat.store.newId();
  let made;
  try {
    made = await (o.produce || produce)({ user: req.user, prompt, id, images: srcs, save: async (img) => {
      const row = await chat.files.addGenerated(req.user.id, conv, { id, name: fileName(prompt, img.mime,
        srcs.length > 0), mime: img.mime, data: img.data, meta: { generated: true, model: img.model,
        prompt: prompt.slice(0, 300), ...(srcs.length ? { edited_from: srcs.map((s) => s.id) } : {}),
        ...require('../extract').imageSize(img.data, img.mime) } });
      return { attachment: chat.store.attachmentOut(row), text: img.text || '' };
    } });
  } catch (e) {
    if (e.code === 'invalid') throw e;
    if (!['quota', 'plan', 'image_blocked', 'tool_off'].includes(e.code)) {
      log.warn('image_failed', { code: e.code, http: e.http, wrongModel: e.wrongModel, edit: srcs.length || undefined,
        detail: e.detail ? String(e.detail).slice(0, 160) : undefined });
    }
    return reply({ content: '', status: 'error', error: failure(e) });
  }
  const r = made.result;
  const out = await reply({ content: r.text ? r.text.slice(0, 2000) : '', status: 'complete',
    attachments: [r.attachment], model: conv.model });
  await chat.files.linkToMessage(req.user.id, id, out[1].message.id).catch(() => {});
  return out;
}

module.exports = { produce, failure, fileName, sources, sourceIds, image,
  enabled: () => Boolean(config.media.imageModel),
  handlers: { postConversationsByIdImages } };
