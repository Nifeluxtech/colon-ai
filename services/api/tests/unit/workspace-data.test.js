// Unit tests for Workspace step 5 (modules/workspace/data.js): secrets never come back, tables follow their
// read/add rules, records are limited, the proxy adds the key only for the key's own public host, and the prompt
// tells the model how to use the data and how to ask for what's missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../../src/modules/workspace');
const { createData, privateIp } = require('../../src/modules/workspace/data');
const { dataMemoryStore } = require('../../src/modules/workspace/data-store');
const { sdk } = require('../../src/modules/workspace/sdk');
const prompt = require('../../src/modules/workspace/prompt');

const ME = { id: 1 }, OTHER = { id: 2 };
const box = { encrypt: (s) => `enc:${Buffer.from(s).toString('base64')}`,
  decrypt: (s) => Buffer.from(String(s).slice(4), 'base64').toString() };
async function setup(extra = {}) {
  const store = ws.memoryStore();
  const engine = ws.create({ store });
  const { workspace: w } = await engine.add(ME, { title: 'Shop', template: 'blank' });
  const ds = dataMemoryStore(store);
  const d = createData({ engine, store: ds, box, lookup: async () => [{ address: '93.184.216.34' }], ...extra });
  return { d, w, ds, engine };
}

test('secrets: saved encrypted, listed by name only, other users get 404', async () => {
  const { d, w, ds } = await setup();
  await d.putSecret(ME, w.id, 'WEATHER_KEY', { value: 'sk-123', host: 'https://api.weather.test/v1', as: 'query:key' });
  const o = await d.overview(ME, w.id);
  assert.deepEqual(o.secrets.map((s) => [s.name, s.host, s.as]), [['WEATHER_KEY', 'api.weather.test', 'query:key']]);
  assert.equal(JSON.stringify(o).includes('sk-123'), false);
  assert.notEqual(ds._s.secrets[0].value_enc, 'sk-123');
  await assert.rejects(d.overview(OTHER, w.id), { status: 404 });
  await assert.rejects(d.putSecret(ME, w.id, 'lower', { value: 'x' }), { status: 422 });
  await assert.rejects(d.putSecret(ME, w.id, 'NEW_KEY', {}), { status: 422 });
  await assert.rejects(d.putSecret(ME, w.id, 'IP_KEY', { value: 'x', host: '10.0.0.1' }), { status: 422 });
  await d.putSecret(ME, w.id, 'WEATHER_KEY', { as: 'bearer' });   // keeps the value and host
  assert.equal(box.decrypt(ds._s.secrets[0].value_enc), 'sk-123');
  assert.equal(ds._s.secrets[0].host, 'api.weather.test');
  await d.deleteSecret(ME, w.id, 'WEATHER_KEY');
  assert.equal((await d.overview(ME, w.id)).secrets.length, 0);
});

test('tables: visitors read and add only where the rules allow', async () => {
  const { d, w } = await setup();
  await d.putCollection(ME, w.id, 'orders', { read: 'owner', add: 'public' });
  await d.putCollection(ME, w.id, 'posts', { read: 'public', add: 'owner' });
  const { id } = await d.publicAdd(w.id, 'orders', { data: { name: 'Ada', qty: 2 } });
  assert.ok(id);
  await assert.rejects(d.publicList(w.id, 'orders', {}), { status: 403 });
  await assert.rejects(d.publicAdd(w.id, 'posts', { data: { t: 1 } }), { status: 403 });
  await d.addRecord(ME, w.id, 'posts', { data: { title: 'Hello' } });
  const pub = await d.publicList(w.id, 'posts', { limit: 5 });
  assert.equal(pub.records[0].data.title, 'Hello');
  const mine = await d.records(ME, w.id, 'orders', {});
  assert.equal(mine.records[0].data.name, 'Ada');
  await assert.rejects(d.publicAdd(w.id, 'orders', { data: [1, 2] }), { status: 422 });
  await assert.rejects(d.publicAdd(w.id, 'orders', { data: { big: 'x'.repeat(9000) } }), { status: 413 });
  await assert.rejects(d.publicAdd('nope', 'orders', { data: {} }), { status: 404 });
  await assert.rejects(d.publicAdd(w.id, 'missing', { data: {} }), { status: 404 });
  await d.deleteRecord(ME, w.id, 'orders', mine.records[0].id);
  assert.equal((await d.records(ME, w.id, 'orders', {})).records.length, 0);
  await d.deleteCollection(ME, w.id, 'posts');
  assert.deepEqual((await d.overview(ME, w.id)).collections.map((c) => c.name), ['orders']);
});

test('call: adds the key for its own host and masks it in the answer', async () => {
  let seen = null;
  const fetchImpl = async (url, o) => { seen = { url: String(url), o };
    return new Response(JSON.stringify({ echo: o.headers.authorization }), { status: 200,
      headers: { 'content-type': 'application/json' } }); };
  const { d, w } = await setup({ fetchImpl });
  await d.putSecret(ME, w.id, 'API_TOKEN', { value: 'tok-9', host: 'api.example.com', as: 'bearer' });
  const out = await d.call(w.id, 'API_TOKEN', { path: '/v1/items', query: { q: 'shoes' } });
  assert.equal(seen.url, 'https://api.example.com/v1/items?q=shoes');
  assert.equal(seen.o.headers.authorization, 'Bearer tok-9');
  assert.equal(seen.o.redirect, 'error');
  assert.deepEqual(out, { status: 200, ok: true, data: { echo: 'Bearer ••••' } });
  await assert.rejects(d.call(w.id, 'API_TOKEN', { path: '//evil.test/x' }), { status: 422 });
  await assert.rejects(d.call(w.id, 'API_TOKEN', { path: '@evil.test/x' }), { status: 422 });
  await assert.rejects(d.call(w.id, 'NOPE', { path: '/' }), { status: 404 });
});

test('call: refuses hosts that resolve to private addresses', async () => {
  const { d, w } = await setup({ lookup: async () => [{ address: '127.0.0.1' }], fetchImpl: async () => {
    throw new Error('must not fetch'); } });
  await d.putSecret(ME, w.id, 'K1', { value: 'v', host: 'sneaky.example.com' });
  await assert.rejects(d.call(w.id, 'K1', { path: '/' }), { code: 'bad_host' });
  for (const ip of ['10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(privateIp(ip), true, ip);
  }
  assert.equal(privateIp('8.8.8.8'), false);
});

test('deleting the workspace hides its data; the sdk and prompt carry the key', async () => {
  const { d, w, engine } = await setup();
  await d.putCollection(ME, w.id, 'orders', { add: 'public' });
  const js = sdk(w.id);
  assert.match(js, /window\.Colon=/);
  assert.ok(js.includes(JSON.stringify(w.id)));
  const ctx = prompt.context({ files: [], data: { ...(await d.overview(ME, w.id)), api: 'https://api.x' } });
  assert.ok(ctx.includes(`https://api.x/sites/${w.id}/colon.js`));
  assert.match(ctx, /=== NEEDS: table/);
  assert.match(ctx, /- orders \(visitors can read: no, visitors can add: yes/);
  await engine.remove(ME, w.id);
  await assert.rejects(d.publicAdd(w.id, 'orders', { data: {} }), { status: 404 });
});
