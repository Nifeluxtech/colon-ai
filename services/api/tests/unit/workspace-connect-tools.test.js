// Unit tests for v0.31.0: folders (move/delete as one version, .gitkeep), server access for connections (encrypted,
// never returned), the database adapters and guard, GitHub / Bitbucket commits, and the chat's tool blocks and
// loop. In-memory stores and a fake HTTP layer; no database and no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../../src/modules/workspace');
const { createData } = require('../../src/modules/workspace/data');
const { dataMemoryStore } = require('../../src/modules/workspace/data-store');
const connect = require('../../src/modules/workspace/connect');
const { createRemote, isRead, guard } = require('../../src/modules/workspace/remote');
const { createGit } = require('../../src/modules/workspace/git');
const { createTools, extract } = require('../../src/modules/workspace/tools');
const { createChat } = require('../../src/modules/workspace/chat');
const { match } = require('../../src/modules/workspace/remote/common');

const ME = { id: 1 }, OTHER = { id: 2 };
const box = { encrypt: (s) => `enc:${Buffer.from(s).toString('base64')}`,
  decrypt: (s) => Buffer.from(String(s).slice(4), 'base64').toString() };
// a fake http.call: routes [method, url-regex, answer(o, url)] and a log of every call
function fakeHttp(routes) {
  const log = [];
  return { log, async call(url, o = {}) {
    const method = o.method || 'GET';
    log.push({ method, url: String(url), o });
    const r = routes.find(([m, re]) => m === method && re.test(String(url)));
    if (!r) return { ok: false, status: 404, headers: new Headers(), data: { message: 'nope' } };
    const a = typeof r[2] === 'function' ? r[2](o, String(url)) : r[2];
    return { ok: (a.status || 200) < 400, status: a.status || 200, headers: new Headers(a.headers || {}),
      data: a.data };
  } };
}
async function setup() {
  const store = ws.memoryStore();
  const engine = ws.create({ store });
  const { workspace: w } = await engine.add(ME, { title: 'Shop', template: 'blank' });
  const ds = dataMemoryStore(store);
  const data = createData({ engine, store: ds, box });
  return { engine, w, ds, data };
}

test('folders: .gitkeep keeps an empty folder; move and delete are one version each', async () => {
  const { engine, w } = await setup();
  await engine.writeFile(ME, w.id, { path: 'img/.gitkeep', content: '' });
  await engine.writeFile(ME, w.id, { path: 'js/lib/a.js', content: 'export const a = 1;' });
  await engine.writeFile(ME, w.id, { path: 'js/app.js', content: 'import "./lib/a.js";' });
  const v = (await engine.get(ME, w.id)).workspace.version;
  const r = await engine.moveFolder(ME, w.id, { from: 'js', to: 'src/js' });
  assert.equal(r.moved, 2);
  assert.equal(r.version, v + 1);
  const paths = (await engine.get(ME, w.id)).files.map((f) => f.path);
  assert.ok(paths.includes('src/js/lib/a.js') && paths.includes('src/js/app.js') && !paths.includes('js/app.js'));
  await assert.rejects(engine.moveFolder(ME, w.id, { from: 'src', to: 'src/inner' }), { status: 422 });
  await assert.rejects(engine.moveFolder(ME, w.id, { from: 'nothing', to: 'x' }), { status: 404 });
  await assert.rejects(engine.moveFolder(OTHER, w.id, { from: 'src', to: 'x' }), { status: 404 });
  const d = await engine.deleteFolder(ME, w.id, 'src');
  assert.equal(d.deleted, 2);
  assert.ok((await engine.get(ME, w.id)).files.some((f) => f.path === 'img/.gitkeep'));
  await assert.rejects(engine.writeFile(ME, w.id, { path: '.gitkeep', content: '' }), { status: 422 });
});

test('server access: encrypted, never returned, kept when left empty; git needs a token', async () => {
  const { w, ds, data } = await setup();
  const out = await data.putConnection(ME, w.id, 'supabase', { url: 'https://abcdefghijkl.supabase.co',
    anonKey: 'sb_publishable_abcdefghij', server: { serviceKey: 'sb_secret_abcdefghijklmnop' } });
  assert.equal(out.server, true);
  const o = await data.overview(ME, w.id);
  assert.equal(o.connections[0].server, true);
  assert.equal(JSON.stringify(o).includes('sb_secret_abcdefghijklmnop'), false);
  assert.ok(o.providers.find((p) => p.id === 'github' && p.kind === 'git'));
  await data.putConnection(ME, w.id, 'supabase', { url: 'https://abcdefghijkl.supabase.co',
    anonKey: 'sb_publishable_abcdefghij', server: {} });
  const c = await data.credentials(ME, w.id, 'supabase');
  assert.equal(c.secret.serviceKey, 'sb_secret_abcdefghijklmnop');
  assert.equal(ds._s.conns[0].secret_enc.includes('sb_secret_'), false);
  await assert.rejects(data.putConnection(ME, w.id, 'github', { repo: 'me/site' }), { status: 422, field: 'token' });
  await assert.rejects(data.putConnection(ME, w.id, 'github', { repo: 'not a repo',
    server: { token: 'ghp_12345678' } }), { status: 422, field: 'repo' });
  await data.putConnection(ME, w.id, 'github', { repo: 'me/site', branch: 'main', server: { token: 'ghp_12345678' } });
  await assert.rejects(data.credentials(OTHER, w.id, 'github'), { status: 404 });
  assert.throws(() => connect.cleanServer('firebase', { serviceAccount: '{"a":"' + 'x'.repeat(60) + '"}' }),
    { status: 422 });
});

test('remote: supabase rows and counts, filters, SQL needs a token, and the destructive guard', async () => {
  const { w, data } = await setup();
  await data.putConnection(ME, w.id, 'supabase', { url: 'https://abcdefghijkl.supabase.co',
    anonKey: 'sb_publishable_abcdefghij', server: { serviceKey: 'sb_secret_abcdefghijklmnop' } });
  const http = fakeHttp([
    ['GET', /rest\/v1\/$/, { data: { definitions: { orders: { properties: { id: {}, total: {} } } } } }],
    ['HEAD', /orders\?/, { headers: { 'content-range': '0-0/128' } }],
    ['GET', /rest\/v1\/orders\?/, { data: [{ id: 1, total: 5 }] }],
    ['POST', /rest\/v1\/orders$/, (o) => ({ status: 201, data: JSON.parse(o.body || JSON.stringify(o.json)) })],
    ['DELETE', /rest\/v1\/orders\?/, { data: [{ id: 1 }] }]]);
  const remote = createRemote({ data, http });
  const t = await remote.tables(ME, w.id, 'supabase');
  assert.deepEqual(t, { tables: [{ name: 'orders', columns: ['id', 'total'], rows: 128 }] });
  await remote.run(ME, w.id, 'supabase', { op: 'select', table: 'orders', where: { total: { gt: 2 } }, limit: 5 });
  assert.match(http.log.at(-1).url, /total=gt\.2/);
  assert.equal(http.log.at(-1).o.headers.apikey, 'sb_secret_abcdefghijklmnop');
  const ins = await remote.run(ME, w.id, 'supabase', { op: 'insert', table: 'orders', rows: [{ total: 9 }] });
  assert.equal(ins.inserted, 1);
  await assert.rejects(remote.run(ME, w.id, 'supabase', { op: 'delete', table: 'orders' }), { code: 'destructive' });
  assert.equal((await remote.run(ME, w.id, 'supabase', { op: 'delete', table: 'orders' },
    { allowDestructive: true })).deleted, 1);
  await assert.rejects(remote.run(ME, w.id, 'supabase', { op: 'sql', sql: 'create table x (id int)' }),
    { code: 'no_sql' });
  await assert.rejects(remote.run(ME, w.id, 'supabase', { op: 'select', table: 'orders; drop' }), { status: 422 });
  assert.throws(() => guard({ op: 'sql', sql: 'DROP TABLE orders' }, false), { code: 'destructive' });
  assert.throws(() => guard({ op: 'sql', sql: 'delete from orders;' }, false), { code: 'destructive' });
  guard({ op: 'sql', sql: 'delete from orders where id = 3' }, false);
  assert.equal(isRead({ op: 'sql', sql: 'select 1' }), true);
  assert.equal(isRead({ op: 'sql', sql: 'select 1; drop table x' }), false);
  assert.equal(match({ a: 3, s: 'Jollof rice' }, { a: { gte: 3 }, s: { like: 'jollof%' } }), true);
});

test('git: GitHub commit is one tree + commit + ref update, with deletions remembered', async () => {
  const { engine, w, data } = await setup();
  await data.putConnection(ME, w.id, 'github', { repo: 'me/site', branch: 'main', folder: 'web',
    server: { token: 'ghp_12345678' } });
  const http = fakeHttp([
    ['GET', /repos\/me\/site$/, { data: { default_branch: 'main' } }],
    ['GET', /git\/ref\/heads\/main$/, { data: { object: { sha: 'p1' } } }],
    ['GET', /git\/commits\/p1$/, { data: { tree: { sha: 't0' } } }],
    ['POST', /git\/trees$/, { status: 201, data: { sha: 't1' } }],
    ['POST', /git\/commits$/, { status: 201, data: { sha: 'c1abcdef' } }],
    ['PATCH', /git\/refs\/heads\/main$/, { data: {} }]]);
  const git = createGit({ engine, data, http });
  const r = await git.commit(ME, w.id, 'github', { message: 'First push' });
  assert.equal(r.sha, 'c1abcdef');
  const tree = http.log.find((x) => /git\/trees$/.test(x.url)).o.json;
  assert.equal(tree.base_tree, 't0');
  assert.ok(tree.tree.every((e) => e.path.startsWith('web/')));
  assert.equal(http.log[0].o.headers.authorization, 'Bearer ghp_12345678');
  await engine.deleteFile(ME, w.id, 'script.js');
  await git.commit(ME, w.id, 'github', { message: 'Second' });
  const tree2 = http.log.filter((x) => /git\/trees$/.test(x.url)).at(-1).o.json.tree;
  assert.ok(tree2.some((e) => e.path === 'web/script.js' && e.sha === null));
  const o = await data.overview(ME, w.id);
  assert.equal(o.connections.find((c) => c.provider === 'github').state.last.message, 'Second');
  await assert.rejects(git.commit(ME, w.id, 'github', { branch: '-x' }), { status: 422 });
});

test('git: Bitbucket commit is one multipart POST; merging a branch opens and merges a pull request', async () => {
  const { engine, w, data } = await setup();
  await data.putConnection(ME, w.id, 'bitbucket', { repo: 'team/site', branch: 'main',
    server: { email: 'me@example.com', token: 'ATATT12345678' } });
  const http = fakeHttp([
    ['POST', /\/src$/, { status: 201, data: '' }],
    ['GET', /refs\/branches\/main$/, { data: { target: { hash: 'b1' } } }],
    ['POST', /pullrequests$/, { status: 201, data: { id: 4 } }],
    ['POST', /pullrequests\/4\/merge$/, { data: { state: 'MERGED', merge_commit: { hash: 'm1' } } }]]);
  const git = createGit({ engine, data, http });
  const r = await git.commit(ME, w.id, 'bitbucket', { message: 'Push' });
  assert.equal(r.sha, 'b1');
  const post = http.log.find((x) => /\/src$/.test(x.url));
  assert.ok(post.o.form instanceof FormData);
  assert.match(post.o.headers.authorization, /^Basic /);
  const m = await git.merge(ME, w.id, 'bitbucket', { head: 'colon-x', base: 'main' });
  assert.deepEqual([m.merged, m.number], [true, 4]);
});

test('tools: blocks are parsed; a read-only reply loops once; writes and commit run after the files', async () => {
  const { engine, w, data } = await setup();
  await data.putConnection(ME, w.id, 'supabase', { url: 'https://abcdefghijkl.supabase.co',
    anonKey: 'sb_publishable_abcdefghij', server: { serviceKey: 'sb_secret_abcdefghijklmnop' } });
  const ran = [];
  const remote = { providers: ['supabase'], schema: async () => ({ canSql: false, text: 'orders(id, total)' }),
    run: async (u, id, p, op, o) => { ran.push([op.op, o.allowDestructive]); return op.op === 'select'
      ? { rows: [{ id: 1, total: 5 }] } : { inserted: 1 }; } };
  const git = { providers: [], commit: async () => ({}) };
  const tools = createTools({ remote, git });
  const replies = ['Let me look.\n=== DB: supabase\n{"op":"select","table":"orders"}\n=== END',
    'Added a product page and one order.\n=== FILE: shop.html\n<h1>Shop</h1>\n=== END\n'
      + '=== DB: supabase\n{"op":"insert","table":"orders","rows":[{"total":7}]}\n=== END'];
  const seen = [];
  const chat = createChat({ engine, deps: { generate: async (o) => { seen.push(o); return { text: replies.shift() }; },
    dataInfo: (u, id) => data.overview(u, id), tools: (u, id, text, info) => tools.prepare(u, id, text, info) } });
  await chat.send(ME, w.id, { message: 'add an order and a shop page' }, { wait: true });
  assert.equal(seen.length, 2);
  assert.match(seen[0].context, /orders\(id, total\)/);
  assert.match(seen[1].messages.at(-1).content, /Results:/);
  assert.deepEqual(ran, [['select', false], ['insert', false]]);
  const h = await chat.history(ME, w.id);
  const last = h.messages.at(-1);
  assert.match(last.content, /added 1 row/);
  assert.doesNotMatch(last.content, /=== DB/);
  assert.deepEqual(last.changes, [{ op: 'created', path: 'shop.html' }]);
  const x = extract('=== MERGE: github colon-x -> main');
  assert.deepEqual([x.calls[0].head, x.calls[0].base], ['colon-x', 'main']);
});
