// Unit tests for Workspace step 2 (v0.26.0): parsing the model's file blocks, SEARCH/REPLACE edits, applying a
// reply as one version, and the chat itself with a fake model. In-memory store; no database and no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../../src/modules/workspace');
const edits = require('../../src/modules/workspace/edits');
const prompt = require('../../src/modules/workspace/prompt');
const { createChat } = require('../../src/modules/workspace/chat');

const ME = { id: 1 }, OTHER = { id: 2 };

test('parse: note, FILE (fences dropped), EDIT blocks and DELETE', () => {
  const r = edits.parse([
    'Built a home page and styles.', '', '=== FILE: index.html', '```html', '<h1>Hi</h1>', '```', '=== END',
    '=== EDIT: style.css', '<<<<<<< SEARCH', 'body { color: red; }', '=======', 'body { color: blue; }',
    '>>>>>>> REPLACE', '=== END', '=== DELETE: old.html'].join('\n'));
  assert.equal(r.note, 'Built a home page and styles.');
  assert.deepEqual(r.ops, [
    { op: 'write', path: 'index.html', content: '<h1>Hi</h1>\n' },
    { op: 'edit', path: 'style.css', blocks: [{ search: 'body { color: red; }', replace: 'body { color: blue; }' }] },
    { op: 'delete', path: 'old.html' }]);
  assert.deepEqual(edits.parse('Just an answer.').ops, []);
});

test('applyEdit: exact, whitespace-tolerant, and a miss throws edit_failed', () => {
  assert.equal(edits.applyEdit('a\nb\nc\n', [{ search: 'b', replace: 'B' }]), 'a\nB\nc\n');
  assert.equal(edits.applyEdit('  <p>x</p>\n', [{ search: '<p>x</p>', replace: '<p>y</p>' }]), '  <p>y</p>\n');
  assert.equal(edits.applyEdit('x {\n    a: 1;\n}\n', [{ search: 'x {\n  a: 1;\n}', replace: 'x { a: 2; }' }]),
    'x { a: 2; }\n');
  assert.throws(() => edits.applyEdit('abc', [{ search: 'zzz', replace: '' }]), (e) => e.code === 'edit_failed');
});

test('applyOps: one version for the whole reply, Undo-able, and a bad op changes nothing', async () => {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Shop', template: 'blank' });
  const out = await e.applyOps(ME, w.id, [{ op: 'write', path: 'pages/about.html', content: '<p>About</p>' },
    { op: 'edit', path: 'style.css', blocks: [{ search: '', replace: '.x{}' }] }, { op: 'delete', path: 'script.js' }],
  'Chat: add about');
  assert.equal(out.before, 1);
  assert.equal(out.version, 2);
  assert.deepEqual(out.changes, [{ op: 'created', path: 'pages/about.html' }, { op: 'edited', path: 'style.css' },
    { op: 'deleted', path: 'script.js' }]);
  assert.deepEqual((await e.get(ME, w.id)).files.map((f) => f.path), ['index.html', 'pages/about.html', 'style.css']);
  await assert.rejects(e.applyOps(ME, w.id, [{ op: 'write', path: 'ok.html', content: 'x' },
    { op: 'write', path: 'evil.php', content: 'x' }]), (x) => x.status === 422);
  await assert.rejects(e.applyOps(ME, w.id, [{ op: 'edit', path: 'index.html', blocks: [{ search: 'nope',
    replace: '' }] }]), (x) => x.code === 'edit_failed');
  assert.equal((await e.get(ME, w.id)).workspace.version, 2);
  await e.restore(ME, w.id, out.before);
  assert.ok((await e.get(ME, w.id)).files.some((f) => f.path === 'script.js'));
});

test('prompt: rules, file tree and contents within the budget', () => {
  const ctx = prompt.context({ title: 'Cafe', message: 'edit about.html', files: [
    { path: 'index.html', size: 5, text: true, content: '<h1/>' }, { path: 'logo.png', size: 9, text: false },
    { path: 'about.html', size: 6, text: true, content: '<p/>' }] });
  assert.match(ctx, /=== FILE: path\/name\.ext/);
  assert.match(ctx, /- logo\.png \(9 bytes, binary\)/);
  assert.match(ctx, /--- index\.html ---\n<h1\/>/);
  assert.match(ctx, /--- about\.html ---/);
});

test('chat: a reply edits the files, is saved with its versions, and failures change nothing', async () => {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  let seen = null, reply = 'Made it blue.\n=== EDIT: style.css\n<<<<<<< SEARCH\n\n=======\nh1{color:blue}\n'
    + '>>>>>>> REPLACE\n=== END';
  const chat = createChat({ engine: e, deps: { generate: async (o) => { seen = o; return { text: reply }; } } });
  await chat.send(ME, w.id, { message: 'make the title blue' }, { wait: true });
  assert.equal(seen.mode, 'developer');
  assert.match(seen.context, /Cafe/);
  assert.deepEqual(seen.messages, [{ role: 'user', content: 'make the title blue' }]);
  let h = await chat.history(ME, w.id);
  assert.equal(h.working, false);
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[1].content, 'Made it blue.');
  assert.deepEqual(h.messages[1].changes, [{ op: 'edited', path: 'style.css' }]);
  assert.deepEqual([h.messages[1].version_before, h.messages[1].version_after], [1, 2]);
  // v0.27.2: the steps Colon took, saved live on the user's message and copied to the reply
  const labels = h.messages[1].steps.map((x) => x.label);
  assert.deepEqual(labels, ['Reading your site’s files', 'Thinking and writing the code', 'Checking the changes',
    'Edited style.css', 'Saved version 2']);
  assert.ok(h.messages[1].steps.every((x) => x.state === 'done'));
  assert.equal(h.messages[0].steps.length, 3);
  assert.ok(h.now);
  reply = '=== EDIT: style.css\n<<<<<<< SEARCH\nnot there\n=======\nx\n>>>>>>> REPLACE\n=== END';
  await chat.send(ME, w.id, { message: 'again' }, { wait: true });
  h = await chat.history(ME, w.id);
  assert.equal(h.messages[3].error, true);
  assert.equal(h.messages[3].steps.pop().state, 'fail');
  assert.equal(h.version, 2);
  await assert.rejects(chat.send(ME, w.id, { message: '  ' }), (x) => x.status === 422);
  await assert.rejects(chat.history(OTHER, w.id), (x) => x.status === 404);
});

test('chat: mid-build questions get a quick answer, change requests queue and build next (v0.27.2)', async () => {
  const side = require('../../src/modules/workspace/side');
  assert.deepEqual(side.parse('QUEUE: Sure, after this build.'), { queue: true, text: 'Sure, after this build.' });
  assert.equal(side.parse('About halfway.').queue, false);
  assert.match(side.context({ title: 'Cafe', request: 'make a menu', queued: ['add a map'],
    steps: [{ label: 'Thinking and writing the code', state: 'run' }] }), /in progress[\s\S]*add a map/);
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  let release, gate = new Promise((r) => { release = r; });
  const builds = [];
  const generate = async (o) => {
    if (o.mode === 'general') return { text: /\?$/.test(o.taskText) ? 'Writing the code now.' : 'QUEUE: Will do.' };
    builds.push(o.taskText);
    if (builds.length === 1) await gate;
    return { text: `Done ${builds.length}.\n=== FILE: p${builds.length}.html\n<p>x</p>\n=== END` };
  };
  const chat = createChat({ engine: e, deps: { generate } });
  const first = chat.send(ME, w.id, { message: 'make a menu' }, { wait: true });
  await new Promise((r) => setImmediate(r));
  await chat.send(ME, w.id, { message: 'how far are you?' }, { wait: true });
  await chat.send(ME, w.id, { message: 'add a map' }, { wait: true });
  let h = await chat.history(ME, w.id);
  assert.equal(h.working, true);
  assert.deepEqual(h.messages.map((m) => [m.role, m.kind]).slice(1), [['user', 'side'], ['assistant', 'side'],
    ['user', 'queued'], ['assistant', 'side']]);
  assert.equal(h.messages[2].content, 'Writing the code now.');
  release();
  await first;
  h = await chat.history(ME, w.id);
  assert.deepEqual(builds, ['make a menu', 'add a map']);
  assert.equal(h.working, false);
  assert.ok(h.messages.filter((m) => m.role === 'user' && m.kind !== 'side').every((m) => m.kind === 'done'));
  assert.equal(h.messages[h.messages.length - 1].content, 'Done 2.');
});

test('repo: clone takes the site folder, learn keeps reference text, instructions reach the prompt', async () => {
  const repo = require('../../src/modules/workspace/repo');
  const providers = { parseGitUrl: (u) => ({ url: u, owner: 'a', name: 'b' }) };   // repos/index needs mysql2
  assert.equal(repo.source('Nifeluxtech/colon-ai', providers).url, 'https://github.com/Nifeluxtech/colon-ai');
  assert.equal(repo.source('https://github.com/a/b/tree/dev/x', providers).branch, 'dev/x');
  assert.throws(() => repo.source('nope', providers), (x) => x.status === 422);
  const ent = (name, text) => ({ name, size: Buffer.byteLength(text), read: () => Buffer.from(text) });
  const entries = [ent('README.md', '# Hi'), ent('package.json', '{}'), ent('public/index.html', '<h1>x</h1>'),
    ent('public/css/a.css', 'h1{}'), ent('public/.env', 'X=1'), ent('node_modules/x/index.js', 'x')];
  const site = repo.siteFiles(entries);
  assert.equal(site.root, 'public/');
  assert.deepEqual(site.files.map((f) => f.path).sort(), ['css/a.css', 'index.html']);
  const ref = repo.learnText(entries, 'a/b');
  assert.match(ref.text, /--- README\.md ---\n# Hi/);
  assert.doesNotMatch(ref.text, /X=1/);
  const zip = { entries };
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  const git = { clone: async () => ({ dir: '/x', cleanup: async () => {} }), walk: async () => zip.entries };
  const r = repo.createRepo({ engine: e, deps: { git, providers, download: {},
    cfg: { enabled: true, timeoutMs: 1000 } } });
  const out = await r.clone(ME, w.id, { url: 'https://gitlab.com/a/b.git' });
  assert.equal(out.cloned, 2);
  assert.deepEqual((await e.get(ME, w.id)).files.map((f) => f.path).sort(), ['css/a.css', 'index.html']);
  await r.learn(ME, w.id, { url: 'https://gitlab.com/a/b.git' });
  await e.edit(ME, w.id, { instructions: 'Use French.' });
  let seen = null;
  const chat = createChat({ engine: e, deps: { generate: async (o) => { seen = o; return { text: 'Ok.' }; } } });
  await chat.send(ME, w.id, { message: 'hi' }, { wait: true });
  assert.match(seen.context, /standing instructions[\s\S]*Use French\./);
  assert.match(seen.context, /Reference repository[\s\S]*README\.md/);
  const h = await chat.history(ME, w.id);
  assert.equal(h.instructions, 'Use French.');
  assert.equal(h.reference.url, 'https://gitlab.com/a/b.git');
  assert.equal(h.messages[1].changes.length > 0, true);
  await r.forget(ME, w.id);
  assert.equal((await chat.history(ME, w.id)).reference, null);
});
