// Image editing (0.17.1): the user's own images go to the image model as inlineData parts before the instruction.
// The adapter's request body, the source checks (owner, conversation, type, size, still on disk), the edit metered
// exactly like a new image (reserve, settle, refund), and the chat model's generate_image handing the image ids to
// the app. Everything in memory: no database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
const billing = require('../../src/modules/billing');
const toolsMod = require('../../src/modules/tools');
const registryLib = require('../../src/modules/tools/registry');
const { registerAll } = require('../../src/modules/tools/catalogue');
const media = require('../../src/modules/media');
const image = require('../../src/modules/media/image');
const browserTools = require('../../src/modules/chat/browser-tools');

const quiet = { info() {}, warn() {}, error() {} };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000030806000000', 'hex');
const JPG = Buffer.from('ffd8ffe000104a464946', 'hex');
const provider = { baseUrl: 'https://ai.example/v1beta', apiKey: 'k' };
const user = { id: 5, role: 'user' };
const conv = { id: 'c1', user_id: 5 };
const reply = (status, body) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const imageBody = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png',
  data: PNG.toString('base64') } }] } }] };

const ROWS = [
  { id: 'up1', user_id: 5, conversation_id: 'c1', message_id: 'm1', kind: 'image', mime: 'image/png', size: 30,
    name: 'me.png', path: '5/up1', meta: '{}' },
  { id: 'gen1', user_id: 5, conversation_id: 'c1', message_id: 'a1', kind: 'image', mime: 'image/jpeg', size: 10,
    name: 'bus.jpg', path: '5/gen1', meta: '{"generated":true}' },
  { id: 'fresh', user_id: 5, conversation_id: null, message_id: null, kind: 'image', mime: 'image/webp', size: 10,
    name: 'new.webp', path: '5/fresh', meta: '{}' },
  { id: 'other', user_id: 6, conversation_id: 'c1', message_id: 'm9', kind: 'image', mime: 'image/png', size: 30,
    name: 'theirs.png', path: '6/other', meta: '{}' },
  { id: 'elsewhere', user_id: 5, conversation_id: 'c2', message_id: 'm7', kind: 'image', mime: 'image/png', size: 30,
    name: 'old.png', path: '5/elsewhere', meta: '{}' },
  { id: 'gif', user_id: 5, conversation_id: 'c1', message_id: 'm1', kind: 'image', mime: 'image/gif', size: 30,
    name: 'a.gif', path: '5/gif', meta: '{}' },
  { id: 'doc', user_id: 5, conversation_id: 'c1', message_id: 'm1', kind: 'pdf', mime: 'application/pdf', size: 30,
    name: 'cv.pdf', path: '5/doc', meta: '{}' },
  { id: 'huge', user_id: 5, conversation_id: 'c1', message_id: 'm1', kind: 'image', mime: 'image/png',
    size: 8 * 1048576, name: 'huge.png', path: '5/huge', meta: '{}' },
  { id: 'gone', user_id: 5, conversation_id: 'c1', message_id: 'm1', kind: 'image', mime: 'image/png', size: 30,
    name: 'gone.png', path: '5/gone', meta: '{}' },
];
// The query mirrors the real one: WHERE user_id = ? AND id IN (...)
const query = async (sql, [uid, ...ids]) => ROWS.filter((r) => r.user_id === uid && ids.includes(r.id));
const read = async (r) => {
  if (r.id === 'gone') throw new Error('ENOENT');
  return r.mime === 'image/jpeg' ? JPG : PNG;
};
const src = (ids, c = conv) => media.sources(5, c, ids, { query, read });
const invalid = (re) => (e) => e.status === 422 && e.code === 'invalid' && e.field === 'attachment_ids'
  && (!re || re.test(e.message));

test('adapter: the source images go first as inlineData parts, then the instruction', async () => {
  const b = image.body('make the sky orange', [{ mime: 'image/png', data: PNG }, { mime: 'image/jpeg', data: JPG }]);
  const parts = b.contents[0].parts;
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } });
  assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/jpeg', data: JPG.toString('base64') } });
  assert.deepEqual(parts[2], { text: 'make the sky orange' });
  assert.deepEqual(image.body('a cat').contents[0].parts, [{ text: 'a cat' }]);   // a new image: text only
  let sent = null;
  const r = await image.generate({ prompt: 'brighter', model: 'img-model-x', provider,
    images: [{ mime: 'image/png', data: PNG }], fetch: async (u, init) => { sent = JSON.parse(init.body);
      return reply(200, imageBody)(); } });
  assert.equal(sent.contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.equal(sent.contents[0].parts[1].text, 'brighter');
  assert.equal(r.mime, 'image/png');
});

test('adapter refuses more than 3 sources, or a source of the wrong type or size, without calling', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return reply(200, imageBody)(); };
  const one = { mime: 'image/png', data: PNG };
  await assert.rejects(image.generate({ prompt: 'x y z', model: 'm', provider, fetch, images: [one, one, one, one] }),
    invalid(/up to 3/));
  await assert.rejects(image.generate({ prompt: 'x y z', model: 'm', provider, fetch,
    images: [{ mime: 'image/gif', data: PNG }] }), invalid(/PNG, JPEG or WebP/));
  await assert.rejects(image.generate({ prompt: 'x y z', model: 'm', provider, fetch,
    images: [{ mime: 'image/png', data: Buffer.alloc(image.EDIT_BYTES + 1) }] }), invalid(/under 7 MB/));
  assert.equal(calls, 0);
});

test('sources: the user’s own images in this chat, an image Colon made here, and a fresh upload', async () => {
  const s = await src(['up1', 'gen1', 'fresh']);
  assert.deepEqual(s.map((x) => [x.id, x.mime, x.fresh]), [['up1', 'image/png', false], ['gen1', 'image/jpeg', false],
    ['fresh', 'image/webp', true]]);
  assert.ok(s[1].data.equals(JPG));
  assert.deepEqual(await src(undefined), []);
  assert.deepEqual(await src([]), []);
  assert.deepEqual((await src(['up1', 'up1'])).map((x) => x.id), ['up1']);   // de-duplicated
});

test('sources: someone else’s image, another chat’s, a missing id or a deleted file is unavailable', async () => {
  for (const id of ['other', 'elsewhere', 'nope', 'gone']) {
    await assert.rejects(src([id]), invalid(/no longer available in this chat/), id);
  }
  await assert.rejects(src(['up1'], { id: 'c2', user_id: 5 }), invalid(/no longer available/));
});

test('sources: non-images, GIFs, too-large files, too many and malformed ids are refused with clear errors',
  async () => {
    await assert.rejects(src(['doc']), invalid(/“cv\.pdf” can’t be edited\. Use a PNG, JPEG or WebP image\./));
    await assert.rejects(src(['gif']), invalid(/PNG, JPEG or WebP/));
    await assert.rejects(src(['huge']), invalid(/too large to edit\. Use an image under 7 MB/));
    await assert.rejects(src(['up1', 'gen1', 'fresh', 'gif']), invalid(/up to 3/));
    await assert.rejects(src('up1'), invalid(/list/));
    await assert.rejects(src(['../etc/passwd']), invalid(/not valid/));
  });

function setup() {
  const store = billing.memoryStore({ plans: [{ code: 'free', name: 'Free', price_minor: 0, currency: 'NGN', active: 1,
    sort: 0 }], entitlements: [{ plan_code: 'free', feature: 'ai_credits', enabled: 1, limit_value: 100 },
    { plan_code: 'free', feature: 'image_credits', enabled: 1, limit_value: 5 }] });
  const engine = billing.create({ store, cfg: { mode: 'enforce', credits: { chat: 1, research: 3, saga: 2 } },
    cacheMs: 0 });
  return { router: toolsMod.create({ registry: registerAll(registryLib.create()), engine, mode: 'enforce',
    logger: quiet }), s: store._s };
}
async function withImageConfig(fn) {
  const old = config.media.imageModel, credits = config.billing.credits.image;
  config.media.imageModel = 'img-model-x'; config.billing.credits.image = 2;
  try { return await fn(); } finally { config.media.imageModel = old; config.billing.credits.image = credits; }
}

test('an edit is metered like a new image: reserved, settled once saved, refunded when it fails', async () => {
  const { router, s } = setup();
  await withImageConfig(async () => {
    const images = await src(['up1']);
    let parts = null;
    const fetchOk = async (u, init) => { parts = JSON.parse(init.body).contents[0].parts; return reply(200,
      imageBody)(); };
    const r = await media.produce({ router, user, prompt: 'make it night', id: 'e1', provider, images, fetch: fetchOk,
      save: async () => ({ attachment: { id: 'e1' } }) });
    assert.equal(r.result.attachment.id, 'e1');
    assert.deepEqual(parts.map((p) => Object.keys(p)[0]), ['inlineData', 'text']);
    const u = s.usage.get('image:e1');
    assert.deepEqual([u.feature, u.status, u.credits_reserved], ['image_credits', 'settled', 2]);
    assert.equal(s.wallets.get('5').balance, 98);
    await assert.rejects(media.produce({ router, user, prompt: 'make it day', id: 'e2', provider, images,
      fetch: reply(500, { error: { message: 'internal' } }), save: async () => ({}) }),
    (e) => e.code === 'image_unavailable');
    await assert.rejects(media.produce({ router, user, prompt: 'make it rain', id: 'e3', provider, images,
      fetch: reply(200, { promptFeedback: { blockReason: 'SAFETY' } }), save: async () => ({}) }),
    (e) => e.code === 'image_blocked');
    for (const id of ['image:e2', 'image:e3']) assert.equal(s.usage.get(id).status, 'refunded', id);
    assert.equal(s.wallets.get('5').balance, 98);
  });
  assert.equal(media.fileName('Make it night!', 'image/png', true), 'edited-make-it-night.png');
  assert.equal(media.fileName('a cat', 'image/jpeg'), 'a-cat.jpg');
});

test('chat model: an edit call carries the images to change (latest message first, else the last in the chat)',
  () => {
    const img = (id, type = 'image/png') => ({ id, kind: 'image', type });
    const msgs = [{ id: 'u0', role: 'user', attachments: [img('up0')] },
      { id: 'a0', role: 'assistant', attachments: [img('gen0'), img('gen1', 'image/jpeg')] },
      { id: 'u1', role: 'user', attachments: [] }, { id: 'u2', role: 'user', attachments: [img('later')] }];
    assert.deepEqual(browserTools.editSources(msgs[2], msgs, true), ['gen1']);   // the last image before it
    assert.deepEqual(browserTools.editSources(msgs[2], msgs, false), []);        // a new image
    const own = { id: 'u3', attachments: [img('a'), img('b', 'image/gif'), { id: 'c', kind: 'pdf' }, img('d'),
      img('e'), img('f')] };
    assert.deepEqual(browserTools.editSources(own, msgs, false), ['a', 'd', 'e']);   // editable ones, max 3
    assert.deepEqual(browserTools.editSources({ id: 'x', attachments: [] }, [], true), []);
  });

test('chat model: generate_image with edit sends attachment_ids in the image event', async () => {
  const old = config.media.imageModel;
  config.media.imageModel = 'img-model-x';
  try {
    const u = { id: 'u1', role: 'user', content: 'make it blue', attachments: [{ id: 'up1', kind: 'image',
      type: 'image/png' }] };
    const stream = async () => ({ text: '', calls: [{ name: 'generate_image', args: { prompt: 'make the car blue',
      edit: true }, part: {} }], providerId: 'gemini', model: 'm', attempts: [] });
    const r = await browserTools.turn({ mode: 'general', language: 'en', messages: [{ role: 'user',
      content: 'make it blue' }], routing: {}, timeouts: {}, onDelta: () => {} }, { state: null, userMsg: u,
      messages: [u], toolStream: stream, user: { id: 5, role: 'user' }, generate: async () => ({ text: '' }) });
    assert.deepEqual(r.action, { event: 'image', data: { prompt: 'make the car blue', message_id: 'u1',
      attachment_ids: ['up1'], edit: true } });
    const decl = toolsMod.declarations(['generate_image'])[0];
    assert.equal(decl.parameters.properties.edit.type, 'boolean');
  } finally { config.media.imageModel = old; }
});
