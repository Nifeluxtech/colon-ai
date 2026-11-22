// Unit tests for Workspace step 1 (modules/workspace): path and type rules, templates, file CRUD with versions,
// restore, limits and ownership. In-memory store; no database and no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../../src/modules/workspace');
const paths = require('../../src/modules/workspace/paths');

const ME = { id: 1 }, OTHER = { id: 2 };
const engine = () => ws.create({ store: ws.memoryStore() });

test('paths: clean paths pass, traversal, hidden files and server-side types are refused', () => {
  assert.equal(paths.cleanPath('/css//site.css'), 'css/site.css');
  assert.equal(paths.cleanPath('./img/logo.PNG'), 'img/logo.PNG');
  assert.equal(paths.cleanPath('a\\b.js'), 'a/b.js');
  for (const bad of ['', '../x.html', 'a/../b.html', '.htaccess', 'x.php', 'cgi.cgi', 'run.sh', 'noext',
    'a b.html', 'a/b/c/d/e/f/g.html', 'x'.repeat(201) + '.html']) {
    assert.throws(() => paths.cleanPath(bad), (e) => e.status === 422, bad);
  }
  assert.deepEqual(paths.typeOf('a.svg'), { mime: 'image/svg+xml', text: true });
  assert.deepEqual(paths.typeOf('a.woff2'), { mime: 'font/woff2', text: false });
});

test('create from a template: title is filled in and escaped, version 1 is saved', async () => {
  const e = engine();
  const out = await e.add(ME, { title: 'Ada <Studio>', template: 'portfolio' });
  assert.equal(out.workspace.template, 'portfolio');
  assert.equal(out.workspace.version, 1);
  assert.deepEqual(out.files.map((f) => f.path), ['index.html', 'script.js', 'style.css']);
  const html = await e.readFile(ME, out.workspace.id, 'index.html');
  assert.equal(html.encoding, 'utf8');
  assert.match(html.content, /<title>Ada &lt;Studio&gt;<\/title>/);
  assert.ok(!html.content.includes('{{TITLE}}'));
  const unknown = await e.add(ME, { title: 'X', template: 'nope' });
  assert.equal(unknown.workspace.template, 'blank');
  await assert.rejects(e.add(ME, { title: '  ' }), (x) => x.status === 422);
});

test('files: add, edit, rename, delete each make a version; images round-trip as base64', async () => {
  const e = engine();
  const id = (await e.add(ME, { title: 'Shop' })).workspace.id;
  const a = await e.writeFile(ME, id, { path: 'about.html', content: '<h1>About</h1>' });
  assert.equal(a.version, 2);
  assert.equal(a.file.type, 'text/html');
  const b = await e.writeFile(ME, id, { path: 'about.html', content: '<h1>About us</h1>', note: 'Better heading' });
  assert.equal(b.version, 3);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  await e.writeFile(ME, id, { path: 'img/logo.png', content: png, encoding: 'base64' });
  const img = await e.readFile(ME, id, 'img/logo.png');
  assert.equal(img.encoding, 'base64');
  assert.equal(img.content, png);
  await assert.rejects(e.writeFile(ME, id, { path: 'img/x.png', content: 'abc' }), (x) => x.field === 'encoding');
  const m = await e.moveFile(ME, id, { from: 'about.html', to: 'pages/about.html' });
  assert.equal(m.version, 5);
  await assert.rejects(e.moveFile(ME, id, { from: 'index.html', to: 'style.css' }), (x) => x.status === 409);
  await assert.rejects(e.moveFile(ME, id, { from: 'img/logo.png', to: 'logo.html' }), (x) => x.status === 422);
  assert.equal((await e.deleteFile(ME, id, 'script.js')).version, 6);
  await assert.rejects(e.deleteFile(ME, id, 'script.js'), (x) => x.status === 404);
  const v = await e.versions(ME, id);
  assert.equal(v.current, 6);
  assert.deepEqual(v.versions.map((x) => x.n), [6, 5, 4, 3, 2, 1]);
  assert.equal(v.versions[3].note, 'Better heading');
});

test('restore brings back an older version as a new version', async () => {
  const e = engine();
  const id = (await e.add(ME, { title: 'Blog' })).workspace.id;
  await e.writeFile(ME, id, { path: 'index.html', content: 'changed' });
  await e.deleteFile(ME, id, 'style.css');
  const r = await e.restore(ME, id, 1);
  assert.equal(r.version, 4);
  assert.deepEqual(r.files.map((f) => f.path), ['index.html', 'script.js', 'style.css']);
  assert.match((await e.readFile(ME, id, 'index.html')).content, /<h1>Blog<\/h1>/);
  await assert.rejects(e.restore(ME, id, 99), (x) => x.status === 404);
  const b = await e.bundle(ME, id);
  assert.equal(b.files.length, 3);
  assert.ok(b.files.every((f) => typeof f.content === 'string'));
});

test('limits: text file size, file count, workspace count; only the newest 20 versions are kept', async () => {
  const e = engine();
  const id = (await e.add(ME, { title: 'Big' })).workspace.id;
  await assert.rejects(e.writeFile(ME, id, { path: 'big.txt', content: 'x'.repeat(paths.LIMITS.textBytes + 1) }),
    (x) => x.status === 413);
  for (let i = 0; i < 25; i++) await e.writeFile(ME, id, { path: 'n.txt', content: String(i) });
  const v = await e.versions(ME, id);
  assert.equal(v.versions.length, 20);
  assert.equal(v.versions[19].n, v.current - 19);
  const e2 = engine();
  for (let i = 0; i < paths.LIMITS.workspaces; i++) await e2.add(ME, { title: 'W' + i });
  await assert.rejects(e2.add(ME, { title: 'One more' }), (x) => x.status === 402 && x.code === 'quota');
  const id2 = (await e2.list(ME)).workspaces[0].id;
  const s = e2.store._s;
  for (let i = 0; i < paths.LIMITS.files - 3; i++) s.files.push({ workspace_id: id2, path: `f${i}.txt`, size: 1,
    content: Buffer.from('x'), mime: 'text/plain' });
  await assert.rejects(e2.writeFile(ME, id2, { path: 'last.txt', content: 'x' }), (x) => x.code === 'too_many_files');
});

test('ownership: another user gets 404 everywhere; signed-out gets 401', async () => {
  const e = engine();
  const id = (await e.add(ME, { title: 'Mine' })).workspace.id;
  for (const call of [() => e.get(OTHER, id), () => e.readFile(OTHER, id, 'index.html'), () => e.bundle(OTHER, id),
    () => e.writeFile(OTHER, id, { path: 'a.html', content: 'x' }), () => e.deleteFile(OTHER, id, 'index.html'),
    () => e.edit(OTHER, id, { title: 'x' }), () => e.remove(OTHER, id), () => e.restore(OTHER, id, 1)]) {
    await assert.rejects(call(), (x) => x.status === 404);
  }
  await assert.rejects(e.list(null), (x) => x.status === 401);
  assert.equal((await e.list(OTHER)).workspaces.length, 0);
  assert.equal((await e.edit(ME, id, { title: 'Renamed' })).title, 'Renamed');
  assert.ok(await e.remove(ME, id));
  assert.equal((await e.list(ME)).workspaces.length, 0);
});
