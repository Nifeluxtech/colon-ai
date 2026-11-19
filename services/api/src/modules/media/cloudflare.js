// Cloudflare Workers AI text-to-image (0.17.1): POST /accounts/{id}/ai/run/{model} with { prompt, steps }, Bearer
// token. The default model, @cf/black-forest-labs/flux-1-schnell, answers JSON { result: { image: <base64> } }; a
// model that answers with the image bytes (Content-Type image/png or image/jpeg) works too. Text-to-image only: edits
// go to Gemini (route.js). Free within Cloudflare's daily allocation (10,000 neurons, resets 00:00 UTC); when it is
// used up Cloudflare answers HTTP 429 or error 3036, which becomes code image_daily_limit.
//   generate({ prompt, model, accountId, token, steps?, signal, fetch }) -> { mime, data: Buffer, text: '', model }
// Errors (with .code): image_unavailable (not configured, provider down, bad answer), image_daily_limit,
// image_blocked (the prompt was refused), AbortError (cancelled / timed out).
const { MAX_BYTES } = require('./image');

const BASE = 'https://api.cloudflare.com/client/v4';
const STEPS = 4, MAX_STEPS = 8, MAX_PROMPT = 2048;
const LIMIT_MSG = 'Today’s free image limit is reached. It resets at 00:00 UTC.';

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, provider: 'cloudflare',
  status: code === 'image_blocked' ? 422 : code === 'image_daily_limit' ? 429 : 503, ...extra });

/** The image type from its first bytes (PNG, JPEG or WebP), else ''. */
function sniff(b) {
  if (!b || b.length < 4) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

const steps = (n) => Math.min(MAX_STEPS, Math.max(1, Math.round(Number(n) || STEPS)));
const isLimit = (status, errors) => status === 429 || (errors || []).some((e) => Number(e && e.code) === 3036);

function image(data) {
  const mime = sniff(data);
  if (!mime) throw fail('image_unavailable', 'No image came back. Try again.');
  if (data.length > MAX_BYTES) throw fail('image_blocked', 'The image came back too large to keep.');
  return mime;
}

async function generate({ prompt, model, accountId, token, steps: n, signal, fetch: f = globalThis.fetch }) {
  const id = String(model || '').trim();
  if (!accountId || !token || !/^@?[A-Za-z0-9._\-/]+$/.test(id) || !/^[A-Za-z0-9]+$/.test(String(accountId))) {
    throw fail('image_unavailable', 'Image generation isn’t available right now.');
  }
  const url = `${BASE}/accounts/${accountId}/ai/run/${id}`;
  let res;
  try {
    res = await f(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt: String(prompt).slice(0, MAX_PROMPT),
      steps: steps(n) }) });
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
    throw fail('image_unavailable', 'Image generation isn’t available right now.', { cause: e.message });
  }
  const type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  if (res.ok && /^image\/(png|jpeg)/.test(type)) {
    const data = Buffer.from(await res.arrayBuffer());
    return { mime: image(data), data, text: '', model: id };
  }
  const raw = await res.text().catch(() => '');
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  const errors = (json && json.errors) || [];
  const detail = String(errors.map((e) => `${e.code}: ${e.message}`).join('; ') || raw || '').slice(0, 200);
  if (isLimit(res.status, errors)) throw fail('image_daily_limit', LIMIT_MSG, { http: res.status, detail });
  if (!res.ok || (json && json.success === false)) {
    const blocked = /nsfw|safety|flagged|not allowed/i.test(detail);
    throw fail(blocked ? 'image_blocked' : 'image_unavailable', blocked ? 'That image can’t be made. Try '
      + 'describing something else.' : 'Image generation isn’t available right now.', { http: res.status, detail });
  }
  const b64 = json && json.result && json.result.image;
  if (!b64 || typeof b64 !== 'string') throw fail('image_unavailable', 'No image came back. Try again.');
  const data = Buffer.from(b64, 'base64');
  return { mime: image(data), data, text: '', model: id };
}

module.exports = { generate, sniff, steps, BASE, STEPS, MAX_STEPS, LIMIT_MSG };
