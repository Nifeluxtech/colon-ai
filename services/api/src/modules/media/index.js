// Media module (0.17.0, Production Blueprint D15): image generation in chat, metered with the plan's image credits.
// Every image goes through the tool registry (modules/tools: generate_image), so the plan's image_credits must be on
// and not used up, BILLING_CREDITS_IMAGE Colon credits are reserved, and the call times out after IMAGE_TIMEOUT_MS.
// The reservation is settled once the image is saved, and refunded in full when the provider fails, refuses the
// prompt, times out or the file cannot be saved. Images are stored like uploads (UPLOAD_DIR, chat_attachments) and
// attached to an assistant message (origin 'image'), so the app shows them like any attachment.
//   produce({ user, prompt, id, save, provider?, generate?, router? }) -> { result: { attachment, ... }, reserved }
//   handlers.postConversationsByIdImages   POST /conversations/:id/images { prompt, message_id? }
const config = require('../../config');
const log = require('../../shared/logger');
const image = require('./image');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** One image through the registry. save(img) stores it and returns { attachment }; it runs inside the call, so a
 *  save failure refunds too. */
async function produce(o) {
  const router = o.router || require('../tools');
  const gen = o.generate || image.generate;
  return router.invoke('generate_image', { prompt: o.prompt }, {
    user: o.user, requestId: `image:${o.id}`,
    run: async (a, ctx) => {
      const provider = o.provider || image.providerFrom(await require('../ai').dynamic.load().catch(() => null));
      const img = await gen({ prompt: a.prompt, model: config.media.imageModel, provider, signal: ctx.signal,
        fetch: o.fetch });
      if (ctx.signal && ctx.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const saved = await o.save(img);
      return { ...saved, provider: 'gemini', model: img.model };
    },
  });
}

const fileName = (prompt, mime) => `${String(prompt).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
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

// POST /conversations/:id/images { prompt, message_id? }
// message_id: the user's message that asked for it (the chat model called generate_image); else the prompt becomes a
// new user message. -> 201 { user_message, message, conversation }; a failed image is an assistant message with an
// error (refunded), so the thread keeps what happened.
async function postConversationsByIdImages(req) {
  const chat = require('../chat');
  const safety = require('../safety');
  const v = require('../../shared/validate');
  const conv = await chat.store.getConv(req.user.id, req.params.id);
  const prompt = String((req.body && req.body.prompt) || '').replace(/\s+/g, ' ').trim();
  if (prompt.length < 3) v.fail('prompt', 'Describe the image first.');
  if (prompt.length > 2000) v.fail('prompt', 'Keep the description under 2,000 characters.');
  let userMsg;
  if (req.body.message_id) {
    userMsg = await chat.store.getMessage(conv.id, String(req.body.message_id));
    if (!userMsg || userMsg.role !== 'user') throw chat.store.notFound('This message no longer exists.');
  } else {
    userMsg = await chat.store.insertMessage(conv, { role: 'user', content: prompt, origin: 'image' });
    await chat.store.touch(conv, { preview: prompt, title: conv.title === 'New chat' ? chat.store.titleFrom(prompt)
      : null });
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
    made = await produce({ user: req.user, prompt, id, save: async (img) => {
      const row = await chat.files.addGenerated(req.user.id, conv, { id, name: fileName(prompt, img.mime),
        mime: img.mime, data: img.data, meta: { generated: true, model: img.model, prompt: prompt.slice(0, 300),
          ...require('../extract').imageSize(img.data, img.mime) } });
      return { attachment: chat.store.attachmentOut(row), text: img.text || '' };
    } });
  } catch (e) {
    if (e.code === 'invalid') throw e;
    if (!['quota', 'plan', 'image_blocked', 'tool_off'].includes(e.code)) {
      log.warn('image_failed', { code: e.code, http: e.http, wrongModel: e.wrongModel,
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

module.exports = { produce, failure, fileName, image, enabled: () => Boolean(config.media.imageModel),
  handlers: { postConversationsByIdImages } };
