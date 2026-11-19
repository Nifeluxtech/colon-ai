// 0.17.0 (Blueprint D14): the chat model's function calls go through the tool registry. The declarations it gets
// come from the registry (generate_image only while IMAGE_MODEL is set), each call is counted by the router, a call
// the registry refuses becomes a short line in the chat (never a crash), and generate_image hands the prompt to the
// app (POST /conversations/:id/images charges it there, once). The model is scripted; no database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
const tools = require('../../src/modules/tools');
const browserTools = require('../../src/modules/chat/browser-tools');

console.log = () => {};
const u = { id: 'u1', role: 'user', content: 'x', created_at: new Date().toISOString() };
function model(...replies) {
  const seen = [];
  const fn = async (o) => {
    seen.push(o);
    const r = replies.shift() || { text: 'ok' };
    if (r.text && o.onDelta) o.onDelta(r.text);
    return { text: r.text || '', calls: (r.calls || []).map((c) => ({ ...c, part: { functionCall: c } })),
      providerId: 'gemini', model: 'm', attempts: [{ ok: true }] };
  };
  fn.seen = seen;
  return fn;
}
const run = (reply, extra = {}) => browserTools.turn({ mode: 'general', language: 'en', messages: [{ role: 'user',
  content: 'x' }], routing: {}, timeouts: {}, onDelta: () => {} }, { state: null, userMsg: u, messages: [u],
  toolStream: reply, user: { id: 7, role: 'user' }, generate: async () => ({ text: 'chain' }), ...extra });
async function withImage(model, fn) {
  const old = config.media.imageModel;
  config.media.imageModel = model;
  try { return await fn(); } finally { config.media.imageModel = old; }
}

test('declarations come from the registry; generate_image only while image generation is on', async () => {
  assert.deepEqual(browserTools.DECLS.map((d) => d.name), ['browse', 'read_page', 'stop_browsing']);
  await withImage('', async () => {
    const m = model({ text: 'hi' });
    await run(m);
    assert.ok(!m.seen[0].tools.some((d) => d.name === 'generate_image'));
  });
  await withImage('img-model-x', async () => {
    const m = model({ text: 'hi' });
    await run(m);
    assert.ok(m.seen[0].tools.some((d) => d.name === 'generate_image'));
    assert.match(m.seen[0].messages[0].content, /generate_image when the user asks/);
  });
});

test('browse, read_page and stop_browsing run through the router (counted), with the same results as before',
  async () => {
    const before = (tools.stats().browse || { calls: 0 }).calls;
    const b = await run(model({ calls: [{ name: 'browse', args: { task: 'open github.com', item: '2' } }] }));
    assert.equal(b.action.event, 'browse');
    assert.equal(b.drop, true);
    assert.equal(tools.stats().browse.calls, before + 1);
    const r = await run(model({ calls: [{ name: 'read_page', args: {} }] }, { text: 'The page is empty.' }));
    assert.equal(r.text, 'The page is empty.');
    assert.ok(tools.stats().read_page.calls >= 1);
    const s = await run(model({ calls: [{ name: 'stop_browsing', args: {} }] }));
    assert.deepEqual([s.action.data.op, s.text], ['close', 'Closed this chat’s browser.']);
  });

test('generate_image: the prompt goes to the app; a bad call becomes a line in the chat', async () => {
  await withImage('img-model-x', async () => {
    const ok = await run(model({ calls: [{ name: 'generate_image', args: { prompt: 'a red danfo bus at sunset' } }] }));
    assert.deepEqual(ok.action, { event: 'image', data: { prompt: 'a red danfo bus at sunset', message_id: 'u1' } });
    assert.equal(ok.drop, true);
    const bad = await run(model({ text: 'Sure.', calls: [{ name: 'generate_image', args: { prompt: 'x' } }] }));
    assert.equal(bad.action, undefined);
    assert.match(bad.text, /^Sure\.\n\nprompt is too short\.$/);
  });
});
