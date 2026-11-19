// 0.17.1: Cloudflare Workers AI as the free text-to-image provider. The adapter against a mocked fetch (base64 JSON,
// raw image bytes, the daily limit as HTTP 429 and as error 3036, a refused prompt), the provider order (Cloudflare
// first, Gemini fallback, edits Gemini only), and produce() through the real tool router and credit engine: the 429
// falls back to Gemini, or is refunded with the "resets 00:00 UTC" message; an edit without IMAGE_MODEL is refunded.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
const billing = require('../../src/modules/billing');
const toolsMod = require('../../src/modules/tools');
const registryLib = require('../../src/modules/tools/registry');
const { registerAll } = require('../../src/modules/tools/catalogue');
const media = require('../../src/modules/media');
const cf = require('../../src/modules/media/cloudflare');
const route = require('../../src/modules/media/route');

const quiet = { info() {}, warn() {}, error() {} };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000030806000000', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const user = { id: 5, role: 'user' };
const CF = { accountId: 'abc123', token: 'cf-token', model: '@cf/black-forest-labs/flux-1-schnell' };
const gProvider = { baseUrl: 'https://ai.example/v1beta', apiKey: 'k' };

const res = (status, body, type = 'application/json') => ({ ok: status < 400, status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
const cfOk = { success: true, result: { image: JPG.toString('base64') }, errors: [] };
const geminiOk = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png',
  data: PNG.toString('base64') } }] } }] };
const LIMIT_3036 = { success: false, result: null, errors: [{ code: 3036, message: 'Account limited: you have used '
  + 'up your daily free allocation of 10,000 neurons' }] };

/** One fetch for both providers: answers by host. */
function fetchBy(cfAnswer, gAnswer) {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init });
    return url.startsWith(cf.BASE) ? cfAnswer() : gAnswer(); };
  f.seen = seen;
  return f;
}
const gen = (o) => cf.generate({ prompt: 'a red danfo bus', ...CF, ...o });

test('adapter: posts { prompt, steps } with the Bearer token and decodes result.image', async () => {
  const f = fetchBy(() => res(200, cfOk));
  const r = await gen({ fetch: f });
  assert.equal(f.seen[0].url, 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/'
    + '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(f.seen[0].init.headers.Authorization, 'Bearer cf-token');
  assert.deepEqual(JSON.parse(f.seen[0].init.body), { prompt: 'a red danfo bus', steps: 4 });
  assert.deepEqual([r.mime, r.data.equals(JPG), r.model], ['image/jpeg', true, CF.model]);
  await gen({ fetch: f, steps: 20 });
  assert.equal(JSON.parse(f.seen[1].init.body).steps, 8);   // at most 8
});

test('adapter: a binary image/png answer works too; junk bytes are not an image', async () => {
  const r = await gen({ fetch: async () => res(200, PNG, 'image/png') });
  assert.deepEqual([r.mime, r.data.equals(PNG)], ['image/png', true]);
  await assert.rejects(gen({ fetch: async () => res(200, Buffer.from('not an image'), 'image/png') }),
    (e) => e.code === 'image_unavailable');
  await assert.rejects(gen({ fetch: async () => res(200, { success: true, result: {} }) }),
    (e) => e.code === 'image_unavailable');
});

test('adapter: the daily free limit (HTTP 429 or error 3036) is image_daily_limit; other failures are graceful',
  async () => {
    const limit = (e) => e.code === 'image_daily_limit' && e.status === 429 && /resets at 00:00 UTC/.test(e.message);
    await assert.rejects(gen({ fetch: async () => res(429, { errors: [] }) }), limit);
    await assert.rejects(gen({ fetch: async () => res(400, LIMIT_3036) }), limit);
    await assert.rejects(gen({ fetch: async () => res(200, LIMIT_3036) }), limit);
    await assert.rejects(gen({ fetch: async () => res(400, { success: false, errors: [{ code: 3030,
      message: 'NSFW content detected' }] }) }), (e) => e.code === 'image_blocked' && e.status === 422);
    await assert.rejects(gen({ fetch: async () => res(500, 'oops') }), (e) => e.code === 'image_unavailable');
    await assert.rejects(gen({ fetch: async () => { throw new Error('ECONNRESET'); } }),
      (e) => e.code === 'image_unavailable');
    await assert.rejects(gen({ token: '' }), (e) => e.code === 'image_unavailable');
    await assert.rejects(gen({ accountId: '../x' }), (e) => e.code === 'image_unavailable');
  });

test('provider order: Cloudflare first when its keys are set, Gemini the fallback, edits Gemini only', () => {
  const both = { imageProvider: '', imageModel: 'img-x', cf: CF };
  assert.deepEqual(route.order(both), ['cloudflare', 'gemini']);
  assert.deepEqual(route.order(both, { edit: true }), ['gemini']);
  assert.deepEqual(route.order({ ...both, imageProvider: 'gemini' }), ['gemini', 'cloudflare']);
  assert.deepEqual(route.order({ ...both, cf: { ...CF, token: '' } }), ['gemini']);
  assert.deepEqual(route.order({ ...both, imageModel: '' }), ['cloudflare']);
  assert.deepEqual(route.order({ ...both, imageModel: '' }, { edit: true }), []);
  assert.deepEqual(route.order({ imageProvider: 'cloudflare', imageModel: '', cf: { model: CF.model } }), []);
  assert.deepEqual(route.status(both), { provider: 'cloudflare', fallback: 'gemini', edits: 'gemini',
    cloudflare_model: CF.model, gemini_model: 'img-x' });
  assert.deepEqual([route.status({ imageModel: '', cf: {} }).provider, route.status({ imageModel: '', cf: {} })
    .edits], ['off', 'off']);
});

function setup() {
  const store = billing.memoryStore({ plans: [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1,
    sort: 0 }], entitlements: [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 },
    { plan_code: 'free', feature: 'image_credits', enabled: 1, limit_value: 9 }] });
  const engine = billing.create({ store, cfg: { mode: 'enforce', credits: { chat: 1, research: 3, saga: 2 } },
    cacheMs: 0 });
  return { router: toolsMod.create({ registry: registerAll(registryLib.create()), engine, mode: 'enforce',
    logger: quiet }), s: store._s };
}
async function withMedia(m, fn) {
  const old = { ...config.media };
  Object.assign(config.media, { imageProvider: '', imageModel: '', cf: { model: CF.model } }, m);
  try { return await fn(); } finally { Object.assign(config.media, old); }
}
const save = async (img) => ({ attachment: { id: 'x', provider: img.provider, mime: img.mime } });
const make = (router, id, fetch, extra = {}) => media.produce({ router, user, prompt: 'a red danfo bus', id,
  provider: gProvider, fetch, save, ...extra });

test('routing: a new image comes from Cloudflare; Gemini is not called', async () => {
  const { router, s } = setup();
  await withMedia({ imageModel: 'img-x', cf: CF }, async () => {
    const f = fetchBy(() => res(200, cfOk), () => res(200, geminiOk));
    const r = await make(router, 'r1', f);
    assert.deepEqual([r.result.provider, r.result.attachment.mime], ['cloudflare', 'image/jpeg']);
    assert.equal(f.seen.length, 1);
    assert.equal(s.usage.get('image:r1').status, 'settled');
    assert.ok(toolsMod.enabled('generate_image'));
    assert.deepEqual(toolsMod.list().image.provider, 'cloudflare');   // GET /admin/tools
  });
});

test('429 fallback: the daily limit (or any Cloudflare error) falls back to Gemini, charged once', async () => {
  const { router, s } = setup();
  await withMedia({ imageModel: 'img-x', cf: CF }, async () => {
    for (const [id, answer] of [['l1', () => res(429, {})], ['l2', () => res(200, LIMIT_3036)],
      ['l3', () => res(503, 'down')]]) {
      const f = fetchBy(answer, () => res(200, geminiOk));
      const r = await make(router, id, f);
      assert.deepEqual([r.result.provider, f.seen.length], ['gemini', 2], id);
      assert.match(f.seen[1].url, /models\/img-x:generateContent$/);
      assert.equal(s.usage.get(`image:${id}`).status, 'settled');
    }
    // A prompt Cloudflare refused is not sent on to Gemini.
    const f = fetchBy(() => res(400, { success: false, errors: [{ code: 1, message: 'NSFW' }] }),
      () => res(200, geminiOk));
    await assert.rejects(make(router, 'l4', f), (e) => e.code === 'image_blocked');
    assert.equal(f.seen.length, 1);
    assert.equal(s.usage.get('image:l4').status, 'refunded');
  });
});

test('429 without Gemini: refunded, with "Today’s free image limit is reached. It resets at 00:00 UTC."',
  async () => {
    const { router, s } = setup();
    await withMedia({ imageModel: '', cf: CF }, async () => {
      await assert.rejects(make(router, 'n1', fetchBy(() => res(429, {}))), (e) => e.code === 'image_daily_limit');
      assert.equal(s.usage.get('image:n1').status, 'refunded');
      assert.equal(s.wallets.get('5').balance, 100);
      assert.match(media.failure({ code: 'image_daily_limit' }).message,
        /^Today’s free image limit is reached\. It resets at 00:00 UTC\. Your image credit was given back\.$/);
      // Gemini also failing after the limit still reports the limit (it is what the member can act on).
    });
    await withMedia({ imageModel: 'img-x', cf: CF }, async () => {
      await assert.rejects(make(router, 'n2', fetchBy(() => res(429, {}), () => res(500, {}))),
        (e) => e.code === 'image_daily_limit');
      assert.equal(s.usage.get('image:n2').status, 'refunded');
    });
  });

test('edits always use Gemini; without IMAGE_MODEL an edit is refused clearly and refunded', async () => {
  const { router, s } = setup();
  const images = [{ mime: 'image/png', data: PNG }];
  await withMedia({ imageModel: 'img-x', cf: CF }, async () => {
    const f = fetchBy(() => res(200, cfOk), () => res(200, geminiOk));
    const r = await make(router, 'e1', f, { images });
    assert.equal(r.result.provider, 'gemini');
    assert.equal(f.seen.length, 1);
    assert.match(f.seen[0].url, /generateContent$/);
  });
  await withMedia({ imageModel: '', cf: CF }, async () => {
    const f = fetchBy(() => res(200, cfOk));
    await assert.rejects(make(router, 'e2', f, { images }), (e) => e.code === 'image_edit_unavailable'
      && /needs a paid image model/.test(e.message));
    assert.equal(f.seen.length, 0);
    assert.equal(s.usage.get('image:e2').status, 'refunded');
    assert.match(media.failure({ code: 'image_edit_unavailable', message: 'Editing images needs a paid image '
      + 'model' }).message, /paid image model/);
  });
});
