// Which image provider makes an image (0.17.1). New images: the first provider (IMAGE_PROVIDER, or Cloudflare when
// CF_ACCOUNT_ID and CF_AI_TOKEN are set), then the other one as the fallback on any error except a refused prompt.
// Edits (source images): Gemini only (IMAGE_MODEL), since flux-1-schnell is text-to-image; without it the edit fails
// with image_edit_unavailable (the credit is refunded by the tool router).
//   order(media, { edit }) -> ['cloudflare', 'gemini'] | ['gemini'] | [] ...
//   status(media) -> { provider, fallback, edits }   (Admin › Tools)
//   run({ prompt, images, media, gemini, cloudflare, provider, signal, fetch })
//     -> { mime, data, text, model, provider }
const cf = require('./cloudflare');

const cfReady = (m) => Boolean(m && m.cf && m.cf.accountId && m.cf.token);
const geminiReady = (m) => Boolean(m && String(m.imageModel || '').trim());

function order(m, { edit = false } = {}) {
  if (edit) return geminiReady(m) ? ['gemini'] : [];
  const ready = { cloudflare: cfReady(m), gemini: geminiReady(m) };
  const first = m.imageProvider === 'gemini' || m.imageProvider === 'cloudflare' ? m.imageProvider
    : ready.cloudflare ? 'cloudflare' : 'gemini';
  return [first, first === 'cloudflare' ? 'gemini' : 'cloudflare'].filter((p) => ready[p]);
}

function status(m) {
  const o = order(m);
  return { provider: o[0] || 'off', fallback: o[1] || null, edits: order(m, { edit: true })[0] || 'off',
    cloudflare_model: cfReady(m) ? m.cf.model : null, gemini_model: geminiReady(m) ? m.imageModel : null };
}

const editOff = () => Object.assign(new Error('Editing images needs a paid image model, which isn’t set up yet '
  + '(an admin sets IMAGE_MODEL). Your image credit was given back.'), { code: 'image_edit_unavailable',
  status: 422 });

async function run(o) {
  const m = o.media, images = o.images || [];
  const list = order(m, { edit: images.length > 0 });
  if (!list.length) {
    if (images.length) throw editOff();
    throw Object.assign(new Error('Image generation isn’t switched on.'), { code: 'image_off', status: 503 });
  }
  const errors = [];
  for (const p of list) {
    try {
      const img = p === 'cloudflare'
        ? await (o.cloudflare || cf.generate)({ prompt: o.prompt, model: m.cf.model, accountId: m.cf.accountId,
          token: m.cf.token, signal: o.signal, fetch: o.fetch })
        : await o.gemini({ prompt: o.prompt, model: m.imageModel, provider: await o.provider(), images,
          signal: o.signal, fetch: o.fetch });
      return { ...img, provider: p };
    } catch (e) {
      if (e.name === 'AbortError' || (o.signal && o.signal.aborted)) throw e;
      errors.push(e);
      if (e.code === 'image_blocked' || e.code === 'invalid') break;   // a refused prompt is not retried elsewhere
      if (o.log) o.log.warn('image_provider_failed', { provider: p, code: e.code, http: e.http });
    }
  }
  const last = errors[errors.length - 1];
  if (last.code === 'image_blocked' || last.code === 'invalid') throw last;
  // The free daily allocation ran out and nothing else could make it: say so (the credit is refunded).
  const limit = errors.find((e) => e.code === 'image_daily_limit');
  throw limit || last;
}

module.exports = { order, status, run, cfReady, geminiReady };
