// Unit tests for project repositories (v0.24.0, modules/repos): source parsing, connect and sync through a mocked
// GitHub (API, zipball redirect to codeload), the snapshot's ignore rules and caps, disconnect, the chat model's
// read_repo_file / search_repo tools and Developer mode's context for a pasted stack trace. No database, no network.
process.env.APP_SECRET = 'test-secret-for-repos-0123456789-abcdefghij';
const test = require('node:test');
const assert = require('node:assert/strict');
const repos = require('../../src/modules/repos');
const projects = require('../../src/modules/projects');
const developer = require('../../src/modules/developer');
const context = require('../../src/modules/chat/context');
const { makeZip } = require('../helpers/zip');

const ada = { id: 1, role: 'user' };
const TOKEN = 'ghp_SecretToken0123456789abcdef';
const SHA1 = 'a'.repeat(40), SHA2 = 'b'.repeat(40);
const publicLookup = async () => [{ address: '140.82.112.3', family: 4 }];

const REPO = {
  'shop-abc123/package.json': '{ "name": "shop", "main": "src/server.js" }',
  'shop-abc123/.gitignore': '# local\nlogs/\n*.secret\n!keep.secret\n/tmp-notes.md\n',
  'shop-abc123/src/server.js': 'const orders = require("./routes/orders");\napp.use(orders);\n',
  'shop-abc123/src/routes/orders.js': Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n')
    + '\nfunction createOrder(req) { return req.body.items.map(total); }\n',
  'shop-abc123/src/lib/total.js': 'exports.total = (x) => x.price * x.qty;\n',
  'shop-abc123/logs/today.log': 'GET /orders 500',
  'shop-abc123/api.secret': 'k', 'shop-abc123/keep.secret': 'kept',
  'shop-abc123/tmp-notes.md': 'notes', 'shop-abc123/docs/tmp-notes.md': 'nested notes stay',
  'shop-abc123/node_modules/express/index.js': 'module.exports = 1;',
  'shop-abc123/dist/app.js': 'built', 'shop-abc123/package-lock.json': '{}',
  'shop-abc123/.env': 'PAYSTACK_SECRET_KEY=sk_live_xxx', 'shop-abc123/public/logo.png': Buffer.from([0x89, 0, 1]),
};

// A fake GitHub: records every request (URL and headers); the zipball redirects to codeload like the real one.
function github({ sha = () => SHA1, zip = makeZip(REPO), status = 200 } = {}) {
  const calls = [];
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type':
    'application/json' } });
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const u = String(url);
    if (status !== 200 && u.startsWith('https://api.github.com')) return json({ message: 'Bad credentials' }, status);
    if (/\/repos\/ada\/shop$/.test(u)) return json({ default_branch: 'main', private: true });
    if (/\/branches\/main$/.test(u)) return json({ name: 'main', commit: { sha: sha() } });
    if (/\/branches\?/.test(u)) return json([{ name: 'main' }, { name: 'dev' }]);
    if (/\/zipball\//.test(u)) return new Response(null, { status: 302, headers: { location:
      'https://codeload.github.com/ada/shop/legacy.zip/' + sha() + '?token=short' } });
    if (u.startsWith('https://codeload.github.com/')) return new Response(zip, { status: 200 });
    return json({ message: 'Not Found' }, 404);
  };
  return { fetch, calls };
}

async function setup(gh = github(), cfg = {}) {
  const pstore = projects.memoryStore();
  const proj = projects.create({ store: pstore, bill: { mode: () => 'off', billable: () => false,
    planFor: async () => null } });
  const { project } = await proj.add(ada, { name: 'Shop' });
  const rstore = repos.memoryStore({ projects: pstore._s.projects });
  const engine = repos.create({ store: rstore, net: { fetch: gh.fetch, lookup: publicLookup }, cfg: { enabled: true,
    archiveMaxMb: 5, maxFiles: 3000, maxTextMb: 2, fileMaxKb: 200, timeoutMs: 5000, gitBin: 'git', ...cfg } });
  return { proj, engine, rstore, pid: project.id, gh };
}

test('providers.parse: owner/name, provider URLs, GitLab subgroups, Git URLs; bad input refused', () => {
  const p = repos.providers;
  assert.deepEqual(p.parse({ provider: 'github', url: 'https://github.com/Nifeluxtech/colon-ai/tree/main' }),
    { provider: 'github', owner: 'Nifeluxtech', name: 'colon-ai', url: 'https://github.com/Nifeluxtech/colon-ai' });
  assert.equal(p.parse({ provider: 'github', repo: 'ada/shop.git' }).name, 'shop');
  assert.equal(p.parse({ provider: 'gitlab', url: 'https://gitlab.com/grp/sub/app/-/tree/dev' }).owner, 'grp/sub');
  assert.equal(p.parse({ provider: 'bitbucket', repo: 'team/site' }).url, 'https://bitbucket.org/team/site');
  assert.equal(p.parse({ provider: 'git', url: 'https://git.sr.ht/~ada/shop' }).name, 'shop');
  for (const b of [{ provider: 'svn', repo: 'a/b' }, { provider: 'github', repo: 'just-one' },
    { provider: 'github', url: 'https://gitlab.com/a/b' }, { provider: 'github', repo: 'a/../b' },
    { provider: 'git', url: 'http://example.com/a.git' }, { provider: 'git', url: 'https://u:p@example.com/a.git' },
    { provider: 'git', url: 'ssh://git@example.com/a.git' }, { provider: 'git', url: 'https://example.com:8443/a' }]) {
    assert.throws(() => p.parse(b), (e) => e.status === 422, JSON.stringify(b));
  }
  for (const b of ['-upload-pack=x', 'a..b', 'main.lock', 'a b']) assert.throws(() => p.cleanBranch(b), /branch/);
  assert.equal(p.cleanBranch('feature/024-projects'), 'feature/024-projects');
  assert.throws(() => p.cleanToken('has space token'), (e) => e.field === 'token');
  assert.throws(() => p.cleanToken('ghp_x\r\nX-Evil: 1'), (e) => e.field === 'token');
});

test('connect GitHub: the token goes to api.github.com only; the archive is snapshotted with ignore rules',
  async () => {
  const { engine, rstore, pid, gh } = await setup();
  const out = await engine.connect(ada, pid, { provider: 'github', repo: 'ada/shop', token: TOKEN });
  assert.deepEqual([out.repo.provider, out.repo.owner, out.repo.name, out.repo.branch, out.repo.sha7,
    out.repo.has_token], ['github', 'ada', 'shop', 'main', 'aaaaaaa', true]);
  assert.ok(!JSON.stringify(out).includes(TOKEN));
  for (const c of gh.calls) {
    const auth = c.headers.Authorization || '';
    if (c.url.startsWith('https://api.github.com')) assert.equal(auth, `Bearer ${TOKEN}`, c.url);
    else assert.equal(auth, '', `no token sent to ${c.url}`);
  }
  // Stored encrypted, never in plain text.
  const row = rstore._s.projects[0];
  assert.ok(row.repo_token && !row.repo_token.includes(TOKEN));
  const snap = await engine.snapshotFor(ada.id, pid);
  const paths = snap.files.map((f) => f.p);
  for (const p of ['src/server.js', 'src/routes/orders.js', 'package.json', 'keep.secret', 'docs/tmp-notes.md']) {
    assert.ok(paths.includes(p), p);
  }
  for (const p of ['logs/today.log', 'api.secret', 'tmp-notes.md', 'node_modules/express/index.js', 'dist/app.js']) {
    assert.ok(!paths.includes(p), p);
  }
  const by = Object.fromEntries(snap.files.map((f) => [f.p, f]));
  assert.deepEqual([by['.env'].s, by['package-lock.json'].s, by['public/logo.png'].s], ['secret', 'lockfile',
    'binary']);
  assert.equal(by['.env'].t, undefined);
  assert.equal(snap.sha, SHA1);
  assert.ok(snap.ignored.count >= 5);
});

test('sync: an unchanged commit downloads nothing; a new commit replaces the stored copy', async () => {
  let sha = SHA1;
  const gh = github({ sha: () => sha });
  const { engine, rstore, pid } = await setup(gh);
  await engine.connect(ada, pid, { provider: 'github', repo: 'ada/shop', token: TOKEN });
  const first = rstore._s.projects[0].repo_attachment_id;
  const n = gh.calls.length;
  const same = await engine.sync(ada, pid);
  assert.equal(same.unchanged, true);
  assert.ok(!gh.calls.slice(n).some((c) => /zipball|codeload/.test(c.url)));
  sha = SHA2;
  const next = await engine.sync(ada, pid);
  assert.equal(next.repo.sha7, 'bbbbbbb');
  assert.notEqual(rstore._s.projects[0].repo_attachment_id, first);
  assert.deepEqual(rstore._s.files.map((f) => f.id), [rstore._s.projects[0].repo_attachment_id]);
  // the stored token is reused by sync
  assert.equal(gh.calls[gh.calls.length - 1].url.startsWith('https://codeload'), true);
  assert.ok(gh.calls.filter((c) => c.url.includes('api.github.com')).every((c) => c.headers.Authorization));
});

test('caps: an archive over REPO_ARCHIVE_MAX_MB is refused; the file cap lists the first files and counts the rest',
  async () => {
    const big = Buffer.alloc(2 * 1048576, 1);
    const { engine, pid } = await setup(github({ zip: makeZip({ 'r/big.txt': big }, { store: true }) }),
      { archiveMaxMb: 1 });
    await assert.rejects(engine.connect(ada, pid, { provider: 'github', repo: 'ada/shop' }),
      (e) => e.code === 'too_large' && e.status === 413);
    const many = {};
    for (let i = 0; i < 30; i++) many[`r/src/f${i}.js`] = `x${i}`;
    const s2 = await setup(github({ zip: makeZip(many) }), { maxFiles: 10 });
    await s2.engine.connect(ada, s2.pid, { provider: 'github', repo: 'ada/shop' });
    const snap = await s2.engine.snapshotFor(ada.id, s2.pid);
    assert.deepEqual([snap.files.length, snap.more], [10, 20]);
  });

test('disconnect deletes the token and the stored copy; a refused token is reported without the token', async () => {
  const { engine, rstore, pid } = await setup();
  await engine.connect(ada, pid, { provider: 'github', repo: 'ada/shop', token: TOKEN });
  await engine.disconnect(ada, pid);
  assert.deepEqual([rstore._s.projects[0].repo_token, rstore._s.projects[0].repo_provider, rstore._s.files.length],
    [null, null, 0]);
  assert.equal((await engine.status(ada, pid)).repo, null);
  const bad = await setup(github({ status: 401 }));
  await assert.rejects(bad.engine.connect(ada, bad.pid, { provider: 'github', repo: 'ada/shop', token: TOKEN }),
    (e) => e.code === 'repo_auth' && !e.message.includes(TOKEN));
});

test('branches and the token\'s repositories come from the provider API', async () => {
  const { engine, pid } = await setup();
  const b = await engine.branches(ada, pid, { provider: 'github', repo: 'ada/shop', token: TOKEN });
  assert.deepEqual([b.branches, b.default_branch, b.private], [['main', 'dev'], 'main', true]);
  await assert.rejects(engine.repos(ada, pid, { provider: 'github' }), (e) => e.field === 'token');
});

test('read_repo_file and search_repo read the stored copy; secret files are never returned', async () => {
  const snap = developer.parseSnapshot(developer.fromZip(makeZip(REPO), 'shop').text);
  const r = repos.tools.readFile(snap, { path: 'orders.js', start_line: 60 });
  assert.equal(r.path, 'src/routes/orders.js');
  assert.ok(r.text.startsWith('60| // line 60') && r.text.includes('createOrder'));
  assert.match(repos.tools.readFile(snap, { path: '.env' }).error, /secrets/);
  assert.ok(repos.tools.readFile(snap, { path: 'nope.js' }).error);
  const s = repos.tools.search(snap, { query: 'createOrder' });
  assert.deepEqual(s.matches.map((m) => [m.path, m.line]), [['src/routes/orders.js', 61]]);
  assert.ok(repos.tools.search(snap, { query: 'x' }).error);
});

test('Developer context for a pasted stack trace: the traced file first, around its line, then related files',
  () => {
    const files = {};
    for (let i = 0; i < 80; i++) files[`app/src/feature${i}/index.js`] = `module.exports = ${i};\n`.repeat(40);
    files['app/src/routes/orders.js'] = Array.from({ length: 2000 }, (_, i) => `const line${i + 1} = ${i};`)
      .join('\n');
    files['app/src/lib/total.js'] = 'exports.computeTotal = (items) => items.reduce((a, b) => a + b.price, 0);\n';
    files['app/package.json'] = '{ "name": "app" }';
    const snap = developer.parseSnapshot(developer.fromZip(makeZip(files), 'app').text);
    const message = 'Orders crash, why?\nTypeError: Cannot read properties of undefined (reading \'price\')\n'
      + '    at computeTotal (/home/ada/work/app/src/lib/total.js:1:62)\n'
      + '    at createOrder (/home/ada/work/app/src/routes/orders.js:1500:11)\n'
      + '    at node:internal/process/task_queues:95:5';
    const built = context.forMode([{ role: 'user', content: message, files: [] }], { mode: 'developer', message,
      projectFiles: [{ name: 'app', project: snap }], repo: { owner: 'ada', name: 'app', branch: 'main',
        sha7: 'abc1234' }, tools: true });
    const block = built.project.block;
    const at = (p) => block.indexOf(`path: ${p}`);
    assert.ok(at('src/lib/total.js') > -1 && at('src/routes/orders.js') > -1);
    assert.ok(at('src/lib/total.js') < at('src/routes/orders.js'), 'trace order kept');
    assert.ok(at('src/routes/orders.js') < at('package.json') || at('package.json') === -1);
    assert.match(block, / 1500\| const line1500 = 1499;/);
    assert.match(block, /around line 1500/);
    assert.match(block, /Project repository ada\/app \(branch main, commit abc1234\)/);
    assert.match(block, /read_repo_file/);
    assert.ok(block.indexOf('File tree:') < at('src/lib/total.js'), 'the file tree comes first');
  });

test('gitignore rules: anchors, folders, negation, ** and classes', () => {
  const ig = developer.gitignore.compile('/build\nlogs/\n*.log\n!keep.log\ndocs/**/draft-*.md\n[Tt]emp*\n');
  for (const p of ['build/x.js', 'a/logs/x.txt', 'x.log', 'a/b/c.log', 'docs/a/b/draft-1.md', 'Temp1/x', 'temp.txt']) {
    assert.equal(ig(p), true, p);
  }
  for (const p of ['src/build/x.js', 'keep.log', 'logs.txt', 'docs/final.md', 'src/app.js']) {
    assert.equal(ig(p), false, p);
  }
  assert.equal(developer.gitignore.compile('# only comments\n\n'), null);
});
