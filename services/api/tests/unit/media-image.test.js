// Image generation (0.17.0, Blueprint D15: modules/media). The Gemini adapter against a mocked fetch (an image back,
// a refused prompt, a model Google does not know), and produce() through the real tool catalogue and credit engine
// (in memory): feature off, image credits reserved then settled, refunded on any failure, the monthly count enforced.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
const billing = require('../../src/modules/billing');
const toolsMod = require('../../src/modules/tools');
const registryLib = require('../../src/modules/tools/registry');
const { registerAll } = require('../../src/modules/tools/catalogue');
const media = require('../../src/modules/media');
const image = require('../../src/modules/media/image');

const quiet = { info() {}, warn() {}, error() {} };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000030806000000', 'hex');
const PLANS = [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1, sort: 0 }];
const ENTS = [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 },
  { plan_code: 'free', feature: 'image_credits', enabled: 1, limit_value: 2 }];
const user = { id: 5, role: 'user' };
const provider = { baseUrl: 'https://ai.example/v1beta', apiKey: 'k' };

const reply = (status, body) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const imageBody = { candidates: [{ content: { parts: [{ text: 'Here it is.' },
  { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] };

function setup(mode = 'enforce') {
  const store = billing.memoryStore({ plans: PLANS, entitlements: ENTS });
  const engine = billing.create({ store, cfg: { mode, credits: { chat: 1, research: 3, saga: 2 } }, cacheMs: 0 });
  const router = toolsMod.create({ registry: registerAll(registryLib.create()), engine, mode, logger: quiet });
  return { router, s: store._s };
}
async function withImageConfig(model, fn) {
  const old = { ...config.media }, credits = config.billing.credits.image;
  config.media.imageModel = model; config.billing.credits.image = 2;
  try { return await fn(); } finally { Object.assign(config.media, old); config.billing.credits.image = credits; }
}

test('adapter: posts generateContent with image output and returns the first inline image', async () => {
  let seen = null;
  const fetch = async (url, init) => { seen = { url, init }; return reply(200, imageBody)(); };
  const r = await image.generate({ prompt: 'a red bus in Lagos', model: 'img-model-x', provider, fetch });
  assert.equal(seen.url, 'https://ai.example/v1beta/models/img-model-x:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'k');
  assert.deepEqual(JSON.parse(seen.init.body).generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.deepEqual([r.mime, r.data.equals(PNG), r.text, r.model], ['image/png', true, 'Here it is.', 'img-model-x']);
});

test('adapter: fails gracefully (no model, no key, unknown model, refused prompt, no image)', async () => {
  await assert.rejects(image.generate({ prompt: 'x', model: '', provider }), (e) => e.code === 'image_off');
  await assert.rejects(image.generate({ prompt: 'x', model: 'm', provider: { baseUrl: 'u', apiKey: '' } }),
    (e) => e.code === 'image_unavailable');
  await assert.rejects(image.generate({ prompt: 'x', model: 'gone-model', provider, fetch: reply(404,
    { error: { message: 'models/gone-model is not found for API version v1beta' } }) }),
  (e) => e.code === 'image_unavailable' && e.wrongModel === true && e.status === 503);
  await assert.rejects(image.generate({ prompt: 'x', model: 'm', provider, fetch: reply(200,
    { promptFeedback: { blockReason: 'SAFETY' } }) }), (e) => e.code === 'image_blocked' && e.status === 422);
  await assert.rejects(image.generate({ prompt: 'x', model: 'm', provider, fetch: reply(200,
    { candidates: [{ content: { parts: [{ text: 'I cannot draw.' }] }, finishReason: 'STOP' }] }) }),
  (e) => e.code === 'image_blocked');
  await assert.rejects(image.generate({ prompt: 'x', model: 'bad model!', provider }),
    (e) => e.code === 'image_unavailable');
  const down = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(image.generate({ prompt: 'x', model: 'm', provider, fetch: down }),
    (e) => e.code === 'image_unavailable');
});

test('feature off: IMAGE_MODEL empty means tool_off, nothing reserved, and no declaration for the model', async () => {
  const { router, s } = setup();
  await withImageConfig('', async () => {
    await assert.rejects(media.produce({ router, user, prompt: 'a cat', id: 'a1', provider, save: async () => ({}) }),
      (e) => e.code === 'tool_off');
    assert.equal(s.usage.size, 0);
    assert.ok(!toolsMod.declarations().some((d) => d.name === 'generate_image'));
    assert.equal(media.failure({ code: 'tool_off' }).message, 'Image generation isn’t switched on.');
  });
  await withImageConfig('img-model-x', async () => {
    assert.ok(toolsMod.declarations().some((d) => d.name === 'generate_image'));
  });
});

test('reserve then settle: one image credit and BILLING_CREDITS_IMAGE; the saved file comes back', async () => {
  const { router, s } = setup();
  await withImageConfig('img-model-x', async () => {
    const saved = [];
    const r = await media.produce({ router, user, prompt: 'a red bus', id: 'img1', provider,
      fetch: reply(200, imageBody), save: async (img) => { saved.push(img); return { attachment: { id: 'img1' } }; } });
    assert.deepEqual([r.reserved, r.result.attachment.id, saved[0].mime], [2, 'img1', 'image/png']);
    const u = s.usage.get('image:img1');
    assert.deepEqual([u.feature, u.status, u.credits_reserved], ['image_credits', 'settled', 2]);
    assert.equal(s.wallets.get('5').balance, 98);
  });
});

test('refund: provider failure, a refused prompt and a failed save each give the credit back', async () => {
  const { router, s } = setup();
  await withImageConfig('img-model-x', async () => {
    const save = async () => ({ attachment: {} });
    await assert.rejects(media.produce({ router, user, prompt: 'picture 1', id: 'f1', provider, save,
      fetch: reply(500, { error: { message: 'internal' } }) }), (e) => e.code === 'image_unavailable');
    await assert.rejects(media.produce({ router, user, prompt: 'picture 2', id: 'f2', provider, save,
      fetch: reply(200, { promptFeedback: { blockReason: 'SAFETY' } }) }), (e) => e.code === 'image_blocked');
    await assert.rejects(media.produce({ router, user, prompt: 'picture 3', id: 'f3', provider,
      fetch: reply(200, imageBody),
      save: async () => { throw new Error('disk full'); } }), /disk full/);
    for (const id of ['image:f1', 'image:f2', 'image:f3']) assert.equal(s.usage.get(id).status, 'refunded', id);
    assert.equal(s.wallets.get('5').balance, 100);
    assert.equal(media.failure({ code: 'tool_timeout' }).code, 'image_unavailable');
  });
});

test('the monthly image count: refunded images do not count; the plan limit is enforced', async () => {
  const { router } = setup('enforce');
  await withImageConfig('img-model-x', async () => {
    const ok = { provider, fetch: reply(200, imageBody), save: async () => ({ attachment: {} }) };
    await assert.rejects(media.produce({ router, user, prompt: 'image 1', id: 'q0', provider,
      fetch: reply(503, {}), save: ok.save }));
    await media.produce({ router, user, prompt: 'image 2', id: 'q1', ...ok });
    await media.produce({ router, user, prompt: 'image 3', id: 'q2', ...ok });
    await assert.rejects(media.produce({ router, user, prompt: 'image 4', id: 'q3', ...ok }),
      (e) => e.code === 'quota' && /2 images/.test(e.message));
  });
});
