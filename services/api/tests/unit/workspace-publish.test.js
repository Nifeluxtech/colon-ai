// Unit tests for Workspace publishing (modules/workspace/publish.js; v0.30.0 /<username>/<site>/ links): name
// rules, per-user names, writing a site to a temp root, badge and .htaccess, legacy redirects, unpublish and delete.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('../../src/modules/workspace');
const { withBadge } = require('../../src/modules/workspace/publish');

const ME = { id: 1 }, OTHER = { id: 2 };
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colon-pub-'));
  fs.mkdirSync(path.join(root, 'cgi-bin'));
  fs.writeFileSync(path.join(root, 'index.html'), 'main site');
  return { root, e: ws.create({ store: ws.memoryStore(), publishRoot: root }) };
}
const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');

test('usernames: format, reserved names, existing folders and other users are refused', async () => {
  const { root, e } = setup();
  for (const bad of ['ab', '-dash', 'dash-', 'a--b', 'x'.repeat(31), 'a_b', 'chat', 'api', 'cgi-bin', 'index.html']) {
    assert.equal((await e.checkUsername(ME, bad)).ok, false, bad);
  }
  assert.equal((await e.username(ME)).name, null);
  assert.deepEqual(await e.setUsername(ME, 'Ada'), { name: 'ada' });
  assert.equal((await e.checkUsername(OTHER, 'ada')).ok, false);
  await assert.rejects(e.setUsername(OTHER, 'ada'), (x) => x.status === 422);
  fs.rmSync(root, { recursive: true, force: true });
});

test('site names are per user: two users can both have "shop"', async () => {
  const { root, e } = setup();
  const { workspace: a } = await e.add(ME, { title: 'A', template: 'portfolio' });
  const { workspace: b } = await e.add(OTHER, { title: 'B', template: 'portfolio' });
  await assert.rejects(e.publish(ME, a.id, { name: 'shop' }), (x) => x.code === 'no_username');
  await e.setUsername(ME, 'ada');
  await e.setUsername(OTHER, 'bola');
  for (const bad of ['ab', 'a--b', 'a_b']) assert.equal((await e.checkName(ME, a.id, bad)).ok, false, bad);
  assert.equal((await e.checkName(ME, a.id, 'shop')).url, 'https://apparatus.name.ng/ada/shop/');
  const out = await e.publish(ME, a.id, { name: 'shop' });
  assert.equal(out.url, 'https://apparatus.name.ng/ada/shop/');
  assert.equal((await e.publish(OTHER, b.id, { name: 'shop' })).url, 'https://apparatus.name.ng/bola/shop/');
  assert.equal((await e.get(ME, a.id)).workspace.published.url, 'https://apparatus.name.ng/ada/shop/');
  const { workspace: a2 } = await e.add(ME, { title: 'A2', template: 'blank' });
  assert.equal((await e.checkName(ME, a2.id, 'shop')).ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('publish writes files, badge, .htaccess and markers; rename, username change, unpublish', async () => {
  const { root, e } = setup();
  await e.setUsername(ME, 'ada');
  const { workspace: w } = await e.add(ME, { title: 'Site', template: 'portfolio' });
  await e.publish(ME, w.id, { name: 'ada-site' });
  assert.match(read(root, 'ada/ada-site/index.html'), /Made with Colon[\s\S]*ada%2Fada-site/);
  assert.match(read(root, 'ada/ada-site/.htaccess'), /php_flag engine off/);
  assert.equal(read(root, 'ada/ada-site/.colon-site').trim(), w.id);
  assert.equal(read(root, 'ada/.colon-user').trim(), '1');
  assert.equal(fs.readdirSync(path.join(root, 'ada')).filter((n) => n.startsWith('.colon-t')).length, 0);
  await e.publish(ME, w.id, { name: 'ada-two' });
  assert.equal(fs.existsSync(path.join(root, 'ada/ada-site')), false);
  await e.setUsername(ME, 'adaeze');
  assert.ok(fs.existsSync(path.join(root, 'adaeze/ada-two/index.html')));
  assert.equal((await e.get(ME, w.id)).workspace.published.url, 'https://apparatus.name.ng/adaeze/ada-two/');
  await e.unpublish(ME, w.id);
  assert.equal(fs.existsSync(path.join(root, 'adaeze/ada-two')), false);
  assert.equal((await e.get(ME, w.id)).workspace.published, null);
  assert.equal(read(root, 'index.html'), 'main site');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a pre-v0.30.0 site at /<name>/ becomes a redirect on republish; delete removes everything', async () => {
  const { root, e } = setup();
  const { workspace: w } = await e.add(ME, { title: 'Old', template: 'portfolio' });
  fs.mkdirSync(path.join(root, 'tyyy'));
  fs.writeFileSync(path.join(root, 'tyyy/.colon-site'), w.id + '\n');
  fs.writeFileSync(path.join(root, 'tyyy/index.html'), 'old');
  await e.store.update(ME.id, w.id, { slug: 'tyyy', published_version: 1, published_at: new Date() });
  assert.equal((await e.get(ME, w.id)).workspace.published.url, 'https://apparatus.name.ng/tyyy/');
  await e.setUsername(ME, 'ada');
  await e.publish(ME, w.id, {});
  assert.match(read(root, 'tyyy/.htaccess'), /RewriteRule \^\(\.\*\)\$ \/ada\/tyyy\/\$1 \[R=301,L\]/);
  assert.ok(fs.existsSync(path.join(root, 'ada/tyyy/index.html')));
  await e.remove(ME, w.id);
  assert.equal(fs.existsSync(path.join(root, 'tyyy')), false);
  assert.equal(fs.existsSync(path.join(root, 'ada/tyyy')), false);
  const { workspace: b } = await e.add(ME, { title: 'Bare', template: 'blank' });
  await e.deleteFile(ME, b.id, 'index.html').catch(() => {});
  if (!(await e.get(ME, b.id)).files.some((f) => f.path === 'index.html')) {
    await assert.rejects(e.publish(ME, b.id, { name: 'bare-site' }), (x) => x.code === 'no_index');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('badge goes before </body>, or at the end when there is none', () => {
  assert.match(withBadge('<body><p>x</p></body></html>', 'a-b'), /Made with Colon[\s\S]*<\/div>\n<\/body>/);
  assert.match(withBadge('<p>x</p>', 'a-b'), /^<p>x<\/p>\n<div/);
});
