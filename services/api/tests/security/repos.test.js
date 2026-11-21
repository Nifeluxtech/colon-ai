// Security tests for project repositories (v0.24.0, modules/repos): another user's project or repository answers 404
// everywhere (connect, sync, status, branches, disconnect, the chat tools, the stored copy); the access token never
// appears in an answer, the model's context, a function response or a log line; Git URLs and redirects to private,
// loopback, link-local or metadata addresses are refused before anything is fetched or git runs; the repository
// tools go through the shared registry. DNS, fetch and git are mocked: no network.
process.env.APP_SECRET = 'test-secret-for-repos-0123456789-abcdefghij';
const test = require('node:test');
const assert = require('node:assert/strict');
const repos = require('../../src/modules/repos');
const projects = require('../../src/modules/projects');
const tools = require('../../src/modules/tools');
const browserTools = require('../../src/modules/chat/browser-tools');
const extra = require('../../src/modules/chat/extra-context');
const download = require('../../src/modules/repos/download');
const git = require('../../src/modules/repos/git');
const { makeZip } = require('../helpers/zip');

const ada = { id: 1, role: 'user' }, bayo = { id: 2, role: 'user' };
const TOKEN = 'glpat-VerySecretToken-0123456789';
const is404 = (e) => e.status === 404;
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const CFG = { enabled: true, archiveMaxMb: 5, maxFiles: 3000, maxTextMb: 2, fileMaxKb: 200, timeoutMs: 5000,
  gitBin: 'git' };

function gitlab() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const u = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (/projects\/ada%2Fshop$/.test(u)) return json({ default_branch: 'main', visibility: 'private' });
    if (/branches\/main$/.test(u)) return json({ commit: { id: 'c'.repeat(40) } });
    if (/archive\.zip/.test(u)) return new Response(makeZip({ 'shop/src/app.js': 'console.log(1)' }));
    return new Response('{}', { status: 404 });
  };
  return { fetch, calls };
}

async function setup(net = gitlab()) {
  const pstore = projects.memoryStore();
  const proj = projects.create({ store: pstore, bill: { mode: () => 'off', billable: () => false,
    planFor: async () => null } });
  const { project } = await proj.add(ada, { name: 'Ada only' });
  const rstore = repos.memoryStore({ projects: pstore._s.projects });
  const engine = repos.create({ store: rstore, cfg: CFG, net: { fetch: net.fetch, lookup: publicLookup } });
  return { proj, engine, rstore, pid: project.id, net };
}

// Everything written to the console while fn runs (the logger writes JSON lines there).
async function captureLogs(fn) {
  const lines = [], log = console.log, error = console.error;
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  try { await fn(); } catch (e) { lines.push(String(e.message)); } finally {
    console.log = log; console.error = error;
  }
  return lines.join('\n');
}

test('ownership: another user\'s project or repository answers 404 everywhere and stays untouched', async () => {
  const { engine, rstore, pid } = await setup();
  await engine.connect(ada, pid, { provider: 'gitlab', repo: 'ada/shop', token: TOKEN });
  const b = { provider: 'gitlab', repo: 'ada/shop' };
  await assert.rejects(engine.status(bayo, pid), is404);
  await assert.rejects(engine.connect(bayo, pid, b), is404);
  await assert.rejects(engine.sync(bayo, pid), is404);
  await assert.rejects(engine.branches(bayo, pid, b), is404);
  await assert.rejects(engine.repos(bayo, pid, { provider: 'gitlab' }), is404);
  await assert.rejects(engine.disconnect(bayo, pid), is404);
  assert.equal(await engine.snapshotFor(bayo.id, pid), null);
  assert.equal(rstore._s.projects[0].repo_provider, 'gitlab');
  assert.equal(rstore._s.files.length, 1);
  // The chat tools run on the caller's own project only.
  await assert.rejects(repos.readFile({ path: 'src/app.js' }, { user: bayo, projectId: pid }), is404);
  await assert.rejects(repos.search({ query: 'console' }, { user: bayo, projectId: pid }), is404);
});

test('the token never appears in answers, the model\'s context or the logs', async () => {
  const { engine, rstore, pid, net } = await setup();
  const logs = await captureLogs(async () => {
    const a = await engine.connect(ada, pid, { provider: 'gitlab', repo: 'ada/shop', token: TOKEN });
    const s = await engine.status(ada, pid);
    const y = await engine.sync(ada, pid);
    for (const o of [a, s, y]) assert.ok(!JSON.stringify(o).includes(TOKEN) && !JSON.stringify(o).includes(
      'repo_token'));
    // a failing call logs the failure, never the token
    await engine.connect(ada, pid, { provider: 'gitlab', repo: 'ada/missing', token: TOKEN }).catch(() => {});
  });
  assert.ok(!logs.includes(TOKEN), 'not in the logs');
  assert.ok(net.calls.some((c) => c.headers['PRIVATE-TOKEN'] === TOKEN), 'sent to the provider only');
  // The project as the app sees it, and the reply context: no token.
  const p = rstore._s.projects[0];
  const out = projects.projectOut(p);
  assert.ok(!JSON.stringify(out).includes(TOKEN) && out.repo.sha7 === 'ccccccc');
  const ctxBlock = extra.projectBlock({ name: 'Ada only', instructions: '', repo: out.repo, files: [] },
    { clean: (t) => t, flags: [] });
  assert.ok(!ctxBlock.includes(TOKEN) && !ctxBlock.includes(p.repo_token));
  const snap = await engine.snapshotFor(ada.id, pid);
  assert.ok(!JSON.stringify(snap).includes(TOKEN));
});

test('SSRF: Git URLs on private, loopback, link-local or metadata addresses are refused before git runs', async () => {
  const ran = [];
  const exec = async (bin, args) => { ran.push(args); return { stdout: 'git version 2.43.0' }; };
  const engine = (lookup) => repos.create({ store: repos.memoryStore({ projects: [{ id: 'p1', user_id: 1 }] }),
    cfg: CFG, exec, net: { lookup } });
  for (const [url, lookup] of [['https://127.0.0.1/a.git'], ['https://169.254.169.254/latest'], ['https://[::1]/a.git'],
    ['https://10.0.0.8/team/app.git'], ['https://git.internal/a.git'], ['https://printer.local/a.git'],
    ['https://rebind.example/a.git', async () => [{ address: '93.184.216.34' }, { address: '192.168.1.4' }]],
    ['https://meta.example/a.git', async () => [{ address: '169.254.169.254' }]]]) {
    await assert.rejects(engine(lookup || publicLookup).connect(ada, 'p1', { provider: 'git', url }),
      (e) => e.code === 'blocked_url' && e.status === 422, url);
  }
  for (const url of ['http://example.com/a.git', 'file:///etc/passwd', 'ssh://git@example.com/a.git']) {
    await assert.rejects(engine(publicLookup).connect(ada, 'p1', { provider: 'git', url }), (e) => e.status === 422,
      url);
  }
  assert.deepEqual(ran, [], 'git never ran');
});

test('SSRF: a redirect to a private address is refused, and the token is not sent to another host', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url: String(url), auth: (init.headers || {}).Authorization });
    if (String(url).includes('first.example')) return new Response(null, { status: 302, headers: {
      location: 'https://cdn.example/archive.zip' } });
    if (String(url).includes('cdn.example')) return new Response(null, { status: 302, headers: {
      location: 'https://169.254.169.254/latest/meta-data/' } });
    return new Response('secret metadata');
  };
  const lookup = async (host) => [{ address: host === '169.254.169.254' ? '169.254.169.254' : '93.184.216.34' }];
  await assert.rejects(download.get('https://first.example/zip', { fetch, lookup,
    auth: { Authorization: 'Bearer t' } }), (e) => e.code === 'blocked_url');
  assert.deepEqual(seen.map((s) => s.auth), ['Bearer t', undefined]);
  assert.ok(!seen.some((s) => s.url.includes('169.254')), 'the metadata address was never fetched');
});

test('git runs pinned to the checked address, https only, with the token in the environment only', async () => {
  const runs = [];
  const exec = async (bin, args, o) => {
    runs.push({ args, env: o.env });
    if (args[0] === '--version') return { stdout: 'git version 2.43.0' };
    if (args.includes('rev-parse')) return { stdout: `${'d'.repeat(40)}\nmain\n` };
    if (args[0] === 'clone') require('fs').mkdirSync(args[args.length - 1], { recursive: true });
    return { stdout: '' };
  };
  const c = await git.clone({ url: 'https://code.example/team/app.git', token: TOKEN, lookup: publicLookup, exec,
    cfg: CFG });
  await c.cleanup();
  const clone = runs.find((r) => r.args[0] === 'clone');
  assert.ok(!clone.args.join(' ').includes(TOKEN), 'not on the command line');
  assert.deepEqual(clone.args.slice(clone.args.indexOf('--')), ['--', 'https://code.example/team/app.git',
    clone.args[clone.args.length - 1]]);
  const cfg = {};
  for (let i = 0; i < Number(clone.env.GIT_CONFIG_COUNT); i++) {
    cfg[clone.env[`GIT_CONFIG_KEY_${i}`]] = clone.env[`GIT_CONFIG_VALUE_${i}`];
  }
  assert.equal(cfg['http.curloptResolve'], 'code.example:443:93.184.216.34');
  assert.deepEqual([cfg['protocol.allow'], cfg['protocol.https.allow'], cfg['http.followRedirects']],
    ['never', 'always', 'false']);
  assert.ok(cfg['http.extraHeader'].startsWith('Authorization: Basic '));
  assert.equal(clone.env.GIT_TERMINAL_PROMPT, '0');
  assert.deepEqual([c.sha, c.branch], ['d'.repeat(40), 'main']);
});

test('tools registry: read_repo_file and search_repo are registered, offered only with a repository, validated',
  async () => {
    for (const n of ['read_repo_file', 'search_repo']) {
      const t = tools.registry.get(n);
      assert.ok(t && t.model && t.risk === 'low' && typeof t.run === 'function', n);
    }
    const names = (d) => d.map((x) => x.name);
    assert.ok(!names(browserTools.declsNow(null)).includes('read_repo_file'));
    assert.ok(names(browserTools.declsNow({ projectId: 'p' })).includes('search_repo'));
    await assert.rejects(tools.invoke('read_repo_file', {}, { user: ada, projectId: 'p' }), (e) => e.field === 'path');
    await assert.rejects(tools.invoke('search_repo', { query: 'x' }, { user: ada }), (e) => e.code === 'invalid');
    // Without a repository the model gets an error object back, not an exception.
    const r = await browserTools.answerOf({ name: 'read_repo_file', args: { path: 'a.js' } }, { user: ada }, null);
    assert.ok(r.error);
  });
