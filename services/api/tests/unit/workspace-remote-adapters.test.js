// Unit tests for v0.31.0's database adapters without a server-side filter language (PocketBase, Appwrite, Firebase)
// and the outbound-call guard (remote/http.js). Fake HTTP; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pocketbase } = require('../../src/modules/workspace/remote/pocketbase');
const { appwrite } = require('../../src/modules/workspace/remote/appwrite');
const { firebase, toFields, fromFields } = require('../../src/modules/workspace/remote/firebase');
const { createHttp } = require('../../src/modules/workspace/remote/http');

function fake(routes) {
  const log = [];
  return { log, async call(url, o = {}) {
    const method = o.method || 'GET';
    log.push({ method, url: String(url), o });
    const r = routes.find(([m, re]) => m === method && re.test(String(url)));
    const a = r ? (typeof r[2] === 'function' ? r[2](o) : r[2]) : { status: 404, data: { message: 'no' } };
    return { ok: (a.status || 200) < 400, status: a.status || 200, headers: new Headers(), data: a.data };
  } };
}

test('pocketbase: falls back to the older admin login, filters rows and updates only the matches', async () => {
  const http = fake([['POST', /_superusers\/auth/, { status: 404, data: {} }],
    ['POST', /admins\/auth/, { data: { token: 'T' } }],
    ['GET', /records\?/, { data: { items: [{ id: 'a', status: 'new' }, { id: 'b', status: 'done' }] } }],
    ['PATCH', /records\/a$/, { data: {} }]]);
  const pb = pocketbase({ config: { url: 'https://pb.example.com' }, secret: { email: 'a@b.co', password: 'pw1234' } },
    http);
  assert.deepEqual((await pb.rows('orders', { where: { status: 'new' } })).rows, [{ id: 'a', status: 'new' }]);
  assert.equal((await pb.update('orders', { status: 'new' }, { status: 'done' })).updated, 1);
  assert.equal(http.log.filter((x) => x.method === 'PATCH').length, 1);
  assert.equal(http.log.at(-1).o.headers.authorization, 'T');
  await assert.rejects(pb.rows('bad name!'), { status: 422 });
});

test('appwrite: picks the first database and turns documents into plain rows', async () => {
  const http = fake([['GET', /\/databases$/, { data: { databases: [{ $id: 'db1' }] } }],
    ['GET', /collections\?/, { data: { collections: [{ $id: 'c1', name: 'orders',
      attributes: [{ key: 'total' }] }] } }],
    ['GET', /documents\?/, { data: { documents: [{ $id: 'd1', $createdAt: 'x', total: 5 }] } }]]);
  const aw = appwrite({ config: { endpoint: 'https://cloud.appwrite.io/v1', projectId: 'p' }, secret: { apiKey: 'k' } },
    http);
  assert.deepEqual(await aw.tables(), [{ name: 'orders', id: 'c1', rows: null, columns: ['id', 'total'] }]);
  assert.deepEqual((await aw.rows('orders')).rows, [{ id: 'd1', total: 5 }]);
  assert.equal(http.log[0].o.headers['x-appwrite-key'], 'k');
});

test('firebase: signs an RS256 JWT for the service account and maps Firestore values both ways', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { project_id: 'proj', client_email: 'x@proj.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  let assertion = '';
  const http = fake([['POST', /oauth2/, (o) => { assertion = /assertion=([^&]+)/.exec(o.body)[1];
    return { data: { access_token: 'AT', expires_in: 3600 } }; }],
  ['GET', /documents\/orders\?/, { data: { documents: [{ name: 'p/orders/o1', fields: toFields({ n: 2, ok: true,
    tags: ['a'], who: { name: 'Ada' } }) }] } }]]);
  const fb = firebase({ secret: { serviceAccount: JSON.stringify(sa) } }, http);
  const r = await fb.rows('orders');
  assert.deepEqual(r.rows, [{ id: 'o1', n: 2, ok: true, tags: ['a'], who: { name: 'Ada' } }]);
  const [h, c, s] = assertion.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, sa.client_email);
  assert.equal(http.log.at(-1).o.headers.authorization, 'Bearer AT');
  assert.deepEqual(fromFields(toFields({ x: 1.5, y: null })), { x: 1.5, y: null });
});

test('http: https only, no private addresses (even through DNS), no redirects', async () => {
  const seen = [];
  const http = createHttp({ lookup: async (h) => [{ address: h === 'inside.example.com' ? '10.0.0.5'
    : '93.184.216.34' }], fetchImpl: async (u, o) => { seen.push(o.redirect); return new Response('{"a":1}',
    { headers: { 'content-type': 'application/json' } }); } });
  await assert.rejects(http.call('http://api.example.com/x'), { code: 'bad_url' });
  await assert.rejects(http.call('https://127.0.0.1/x'), { code: 'bad_host' });
  await assert.rejects(http.call('https://inside.example.com/x'), { code: 'bad_host' });
  await assert.rejects(http.call('https://localhost/x'), { code: 'bad_host' });
  const r = await http.call('https://api.example.com/x');
  assert.deepEqual(r.data, { a: 1 });
  assert.deepEqual(seen, ['error']);
});
