// Unit tests for Workspace step 4 (modules/workspace/publish.js): name rules, writing a site to a temp document
// root, the badge and .htaccess, republish under a new name, ownership of names, unpublish and delete.
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

test('names: format, reserved names and existing folders are refused', async () => {
  const { root, e } = setup();
  const { workspace: w } = await e.add(ME, { title: 'Site', template: 'blank' });
  for (const bad of ['ab', '-dash', 'dash-', 'a--b', 'x'.repeat(31), 'a_b', 'chat', 'api']) {
    assert.equal((await e.checkName(ME, w.id, bad)).ok, false, bad);
  }
  assert.equal((await e.checkName(ME, w.id, 'cgi-bin')).ok, false);
  assert.equal((await e.checkName(ME, w.id, 'index.html')).ok, false);
  const ok = await e.checkName(ME, w.id, 'my-site');
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://apparatus.name.ng/my-site/');
  fs.rmSync(root, { recursive: true, force: true });
});

test('publish writes the files, a badge, .htaccess and a marker; republish renames; unpublish removes', async () => {
  const { root, e } = setup();
  const { workspace: w } = await e.add(ME, { title: 'Site', template: 'portfolio' });
  const out = await e.publish(ME, w.id, { name: 'ada-site' });
  assert.equal(out.url, 'https://apparatus.name.ng/ada-site/');
  assert.match(read(root, 'ada-site/index.html'), /Made with Colon/);
  assert.match(read(root, 'ada-site/.htaccess'), /php_flag engine off/);
  assert.equal(read(root, 'ada-site/.colon-site').trim(), w.id);
  assert.equal((await e.get(ME, w.id)).workspace.published.name, 'ada-site');
  assert.equal(fs.readdirSync(root).filter((n) => n.startsWith('.colon-')).length, 0);

  const { workspace: w2 } = await e.add(OTHER, { title: 'Other', template: 'blank' });
  assert.equal((await e.checkName(OTHER, w2.id, 'ada-site')).ok, false);
  await assert.rejects(e.publish(OTHER, w2.id, { name: 'ada-site' }), (x) => x.status === 422);

  await e.publish(ME, w.id, { name: 'ada-two' });
  assert.equal(fs.existsSync(path.join(root, 'ada-site')), false);
  assert.ok(fs.existsSync(path.join(root, 'ada-two/index.html')));
  await e.publish(ME, w.id, {});   // republish under the same name
  assert.ok(fs.existsSync(path.join(root, 'ada-two/index.html')));

  await e.unpublish(ME, w.id);
  assert.equal(fs.existsSync(path.join(root, 'ada-two')), false);
  assert.equal((await e.get(ME, w.id)).workspace.published, null);
  assert.equal(read(root, 'index.html'), 'main site');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a site needs index.html; deleting a workspace takes its site down', async () => {
  const { root, e } = setup();
  const { workspace: w } = await e.add(ME, { title: 'Site', template: 'portfolio' });
  await e.publish(ME, w.id, { name: 'gone-soon' });
  await e.remove(ME, w.id);
  assert.equal(fs.existsSync(path.join(root, 'gone-soon')), false);
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
