// Image generation adapter (0.17.0, Blueprint D15): Google AI Studio's native generateContent with image output, the
// same key and base URL as every Gemini call (GEMINI_API_KEY / GEMINI_BASE_URL, or the key saved in Admin › Models).
// The model is IMAGE_MODEL (empty = the feature is off). No model name is built in: image-capable ids change, so the
// operator picks one their key can use, and a model Google refuses fails gracefully with code image_unavailable.
//   generate({ prompt, model, provider: { baseUrl, apiKey }, images?, signal, fetch }) -> { mime, data: Buffer, text,
//     model }
// 0.17.1: images = up to EDIT_MAX source images [{ mime, data: Buffer }] for an edit. They go to the model as
// inlineData parts before the instruction, so the same image model changes them instead of drawing from nothing.
// Errors (all with .code): image_off (no model), image_unavailable (no key, unknown model, provider down),
// image_blocked (the provider refused the prompt or returned no image), AbortError (cancelled / timed out).
const MAX_BYTES = 8 * 1048576;
const MIMES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EDIT_MAX = 3;                     // source images per edit
const EDIT_BYTES = 7 * 1048576;         // per source image (inline request bodies stay well under Google's 20 MB)

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, status: code === 'image_blocked'
  ? 422 : 503, ...extra });

/** The Google AI Studio provider entry: from the live routing config when given, else the environment. */
function providerFrom(routing, env = process.env) {
  const p = routing && routing.providers ? (routing.providers() || {}).gemini : null;
  if (p && p.apiKey) return { baseUrl: p.baseUrl, apiKey: p.apiKey };
  return { baseUrl: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: env.GEMINI_API_KEY || '' };
}

/** The generateContent request: the source images (an edit) first, then the instruction. */
function body(prompt, images = []) {
  const parts = (images || []).map((im) => ({ inlineData: { mimeType: im.mime, data: Buffer.isBuffer(im.data)
    ? im.data.toString('base64') : String(im.data) } }));
  parts.push({ text: String(prompt) });
  return { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
}

/** The first inline image in a generateContent answer (+ any text that came with it). */
function parse(json) {
  const cands = (json && json.candidates) || [];
  let text = '';
  for (const c of cands) {
    for (const p of (c.content && c.content.parts) || []) {
      const inline = p.inlineData || p.inline_data;
      if (inline && inline.data && MIMES[String(inline.mimeType || inline.mime_type || '').toLowerCase()]) {
        const mime = String(inline.mimeType || inline.mime_type).toLowerCase();
        const data = Buffer.from(String(inline.data), 'base64');
        if (!data.length) continue;
        if (data.length > MAX_BYTES) throw fail('image_blocked', 'The image came back too large to keep.');
        return { mime, data, text: (text + (p.text || '')).trim() };
      }
      if (typeof p.text === 'string' && !p.thought) text += p.text;
    }
  }
  const blocked = json && json.promptFeedback && json.promptFeedback.blockReason;
  const reason = blocked || (cands[0] && cands[0].finishReason) || '';
  throw fail('image_blocked', /SAFETY|PROHIBITED|BLOCK|IMAGE_SAFETY/i.test(reason)
    ? 'That image can’t be made. Try describing something else.'
    : 'No image came back for that description. Try rewording it.', { reason: String(reason).slice(0, 40), text });
}

async function generate({ prompt, model, provider, images = [], signal, fetch: f = globalThis.fetch }) {
  const id = String(model || '').trim();
  if (!id) throw fail('image_off', 'Image generation isn’t switched on.');
  if (images.length > EDIT_MAX) throw Object.assign(new Error(`Edit up to ${EDIT_MAX} images at a time.`),
    { status: 422, code: 'invalid', field: 'attachment_ids' });
  for (const im of images) {
    if (!MIMES[im.mime] || !im.data || !im.data.length || im.data.length > EDIT_BYTES) {
      throw Object.assign(new Error('Only PNG, JPEG or WebP images under 7 MB can be edited.'), { status: 422,
        code: 'invalid', field: 'attachment_ids' });
    }
  }
  if (!provider || !provider.apiKey) throw fail('image_unavailable', 'Image generation isn’t available right now.');
  if (!/^[A-Za-z0-9._\-/]+$/.test(id)) throw fail('image_unavailable', 'Image generation isn’t available right now.');
  const url = `${String(provider.baseUrl).replace(/\/+$/, '')}/models/${encodeURIComponent(id)
    .replace(/%2F/g, '/')}:generateContent`;
  let res;
  try {
    res = await f(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json',
      'x-goog-api-key': provider.apiKey }, body: JSON.stringify(body(prompt, images)) });
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
    throw fail('image_unavailable', 'Image generation isn’t available right now.', { cause: e.message });
  }
  const raw = await res.text().catch(() => '');
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = String((json && json.error && json.error.message) || raw || '').slice(0, 200);
    // 404 / "not found" / "not supported": the configured model is wrong or not image-capable for this key.
    const wrongModel = res.status === 404 || /not found|not supported|does not support|response modalit/i.test(msg);
    throw fail(res.status === 400 && /safety|blocked/i.test(msg) ? 'image_blocked' : 'image_unavailable',
      res.status === 400 && /safety|blocked/i.test(msg) ? 'That image can’t be made. Try describing something else.'
        : 'Image generation isn’t available right now.', { http: res.status, wrongModel, detail: msg });
  }
  return { ...parse(json), model: id };
}

module.exports = { generate, parse, providerFrom, body, MIMES, MAX_BYTES, EDIT_MAX, EDIT_BYTES };
