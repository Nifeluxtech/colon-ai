// Security tests for the Phase 8 server reader (GET /browser/fetch, modules/browser): the SSRF guard (private,
// loopback, link-local, CGNAT, metadata refused; the socket pinned to the checked address; every redirect checked
// again, at most 5), robots.txt, the block list, every error code of docs/phase8-backend-contract.md §1, the
// 10-minute cache and privacy-safe logging. DNS and the network are mocked (one test uses a local server).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const net = require('../../src/modules/browser/net');
const reader = require('../../src/modules/browser/reader');

const PUBLIC = '93.184.216.34';
const lookup = async (host) => (host.startsWith('private.') ? [{ address: '10.0.0.7', family: 4 }]
  : [{ address: PUBLIC, family: 4 }]);
const ARTICLE = '<html lang="en"><head><title>Fuel price news</title><meta name="author" content="Punch">'
  + '</head><body><nav>Menu</nav><article><h1>Fuel</h1><p>' + 'Petrol prices rose again this week. '.repeat(20)
  + '</p><script>steal()</script><img src="/pic.jpg"><a href="/more" onclick="x()">More</a></article></body></html>';

// A mock transport: routes keyed by full URL; anything else (robots.txt included) answers 404. Records each hop.
function site(routes) {
  const calls = [];
  const fn = async (u, pin, o) => {
    calls.push({ url: u.toString(), address: pin.address });
    let r = routes[u.toString()];
    if (typeof r === 'function') r = await r(o);
    r = r || { status: 404, headers: { 'content-type': 'text/plain' }, body: 'nope' };
    const out = { status: r.status || 200, headers: { 'content-type': 'text/html; charset=utf-8', ...(r.headers
      || {}) }, body: Buffer.from(r.body || ''), truncated: false, tooLarge: r.tooLarge };
    if (out.status >= 300 && out.status < 400 && out.headers.location) out.body = Buffer.alloc(0);
    else if (o.head && o.head(out)) out.body = Buffer.alloc(0);
    return out;
  };
  fn.calls = calls;
  return fn;
}
console.log = () => {};   // the reader logs one JSON line per request; the last test captures and checks them
const read = (url, transport, extra = {}) => reader.read(url, { lookup, transport, userId: 7, ...extra });
const rejectsWith = (p, status, code, check) => assert.rejects(p, (e) => {
  assert.equal(e.code, code); assert.equal(e.status, status); if (check) check(e); return true; });

test.beforeEach(() => { reader.cache.clear(); reader.robots.clear(); delete process.env.BROWSER_READER;
  delete process.env.BROWSER_READER_BLOCKLIST; });

test('SSRF: URL shape and resolved addresses are checked (bad_url / blocked_private)', async () => {
  for (const u of ['ftp://x.ng/', 'file:///etc/passwd', 'http://user:pw@example.com/', 'http://example.com:8080/',
    'https://example.com:8443/', 'not a url', 'javascript:alert(1)']) {
    await assert.rejects(net.resolve(u, { lookup }), (e) => e.code === 'bad_url', u);
  }
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/', 'http://localhost/', 'http://10.1.2.3/',
    'http://100.64.0.1/', 'http://192.168.0.1/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://224.0.0.1/',
    'http://[::ffff:a9fe:a9fe]/', 'https://private.example/']) {
    await assert.rejects(net.resolve(u, { lookup }), (e) => e.code === 'blocked_private', u);
  }
  // One private answer among public ones is enough to refuse (DNS rebinding style).
  await assert.rejects(net.resolve('https://mixed.example/', { lookup: async () => [{ address: PUBLIC, family: 4 },
    { address: '127.0.0.1', family: 4 }] }), (e) => e.code === 'blocked_private');
  const ok = await net.resolve('https://punchng.com:443/x#frag', { lookup });
  assert.equal(ok.address, PUBLIC);
  assert.equal(ok.url.hash, '');
});

test('SSRF: the socket connects to the checked address (no second DNS lookup) and sends no credentials', async () => {
  const seen = [];
  const big = 'x'.repeat(300 * 1024);
  const srv = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, headers: req.headers, url: req.url });
    if (req.url === '/gz') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      return res.end(zlib.gzipSync('<p>zipped</p>')); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url === '/big' ? big : '<p>pinned</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    // "reader-pin.invalid" can't resolve anywhere: the request only works because it goes to the pinned IP.
    const u = new URL(`http://reader-pin.invalid:${port}/page`);
    const r = await net.request(u, { address: '127.0.0.1', family: 4 }, { maxBytes: 1024 * 1024 });
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), '<p>pinned</p>');
    assert.equal(seen[0].host, `reader-pin.invalid:${port}`);
    assert.equal(seen[0].headers['user-agent'], 'ColonReader/1.0 (+https://chat.apparatus.name.ng)');
    assert.equal(seen[0].headers.cookie, undefined);
    assert.equal(seen[0].headers.authorization, undefined);
    const gz = await net.request(new URL(`http://reader-pin.invalid:${port}/gz`), { address: '127.0.0.1',
      family: 4 }, { maxBytes: 1024 });
    assert.equal(gz.body.toString(), '<p>zipped</p>');
    const cut = await net.request(new URL(`http://reader-pin.invalid:${port}/big`), { address: '127.0.0.1',
      family: 4 }, { maxBytes: 64 * 1024 });
    assert.equal(cut.truncated, true);
    assert.equal(cut.body.length, 64 * 1024);
  } finally { srv.close(); }
});

test('SSRF: every redirect is checked again and at most 5 are followed', async () => {
  const toPrivate = site({ 'https://start.example/': { status: 302, headers: {
    location: 'http://127.0.0.1/admin' } } });
  await rejectsWith(read('https://start.example/', toPrivate), 403, 'blocked_private');
  assert.equal(toPrivate.calls.filter((c) => !c.url.endsWith('robots.txt')).length, 1);
  const toPrivateName = site({ 'https://start.example/': { status: 301, headers: { location:
    'https://private.example/x' } } });
  await rejectsWith(read('https://start.example/', toPrivateName), 403, 'blocked_private');
  const hops = {};
  for (let i = 0; i < 7; i++) hops[`https://loop.example/${i}`] = { status: 302, headers: { location:
    `https://loop.example/${i + 1}` } };
  const loop = site(hops);
  await rejectsWith(read('https://loop.example/0', loop), 502, 'upstream_error');
  assert.equal(loop.calls.filter((c) => !c.url.endsWith('robots.txt')).length, 6);   // the start + 5 redirects
  const five = {};
  for (let i = 0; i < 5; i++) five[`https://five.example/${i}`] = { status: 302, headers: { location:
    `https://five.example/${i + 1}` } };
  five['https://five.example/5'] = { body: ARTICLE };
  const fiveSite = site(five);
  const page = await read('https://five.example/0', fiveSite);
  assert.equal(page.final_url, 'https://five.example/5');
  assert.ok(fiveSite.calls.every((c) => c.address === PUBLIC));
});

test('reader: 200 answer has the contract fields, sanitised HTML and absolute links', async () => {
  const s = site({ 'https://punchng.com/x': { status: 301, headers: { location: '/x/' } },
    'https://punchng.com/x/': { body: ARTICLE } });
  const p = await read('https://punchng.com/x', s);
  assert.equal(p.url, 'https://punchng.com/x');
  assert.equal(p.final_url, 'https://punchng.com/x/');
  assert.equal(p.status, 200);
  assert.equal(p.title, 'Fuel price news');
  assert.equal(p.byline, 'Punch');
  assert.equal(p.lang, 'en');
  assert.equal(p.cached, false);
  assert.match(p.fetched_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.doesNotMatch(p.html, /script|steal|onclick|Menu/);
  assert.match(p.html, /href="https:\/\/punchng\.com\/more"/);
  assert.match(p.html, /src="https:\/\/punchng\.com\/pic\.jpg"/);
  assert.match(p.text, /^Fuel\n\nPetrol prices rose/);
  assert.ok(p.text.length <= 200000);
  assert.ok(s.calls.every((c) => c.address === PUBLIC));
  // Plain text pages are wrapped as paragraphs.
  const t = await read('https://txt.example/a.txt', site({ 'https://txt.example/a.txt': { headers: {
    'content-type': 'text/plain' }, body: 'Line <one>\n\nTwo' } }));
  assert.equal(t.html, '<p>Line &lt;one&gt;</p><p>Two</p>');
});

test('reader: error codes match the contract', async () => {
  await rejectsWith(read('ftp://x.example/', site({})), 400, 'bad_url');
  await rejectsWith(read('https://u:p@x.example/', site({})), 400, 'bad_url');
  await rejectsWith(read('http://169.254.169.254/', site({})), 403, 'blocked_private');
  await rejectsWith(read('https://big.example/', site({ 'https://big.example/': { tooLarge: true } })), 413,
    'too_large');
  await rejectsWith(read('https://pdf.example/a', site({ 'https://pdf.example/a': { headers: { 'content-type':
    'application/pdf' }, body: '%PDF' } })), 415, 'not_html', (e) => assert.equal(e.extra.content_type,
    'application/pdf'));
  await rejectsWith(read('https://wall.example/', site({ 'https://wall.example/': { status: 401 } })), 422,
    'needs_login');
  await rejectsWith(read('https://wall2.example/', site({ 'https://wall2.example/': { status: 302, headers: {
    location: '/login?next=/' } }, 'https://wall2.example/login?next=/': { body: '<form><input type="password">'
    + '</form><p>Sign in</p>' } })), 422, 'needs_login');
  await rejectsWith(read('https://down.example/', site({ 'https://down.example/': { status: 503 } })), 502,
    'upstream_error', (e) => assert.equal(e.extra.upstream_status, 503));
  await rejectsWith(read('https://nowhere.example/', site({}), { lookup: async () => { throw new Error('ENOTFOUND');
  } }), 502, 'upstream_error');
  const hang = site({ 'https://slow.example/': (o) => new Promise((_, rej) => o.signal.addEventListener('abort',
    () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  await rejectsWith(read('https://slow.example/', hang, { timeoutMs: 50 }), 504, 'timeout');
  process.env.BROWSER_READER = 'off';
  await rejectsWith(read('https://punchng.com/', site({})), 501, 'not_enabled');
});

test('reader: robots.txt Disallow and the block list are honoured', async () => {
  const robots = 'User-agent: *\nDisallow: /private\n\nUser-agent: ColonReader\nDisallow: /no-readers\nAllow: /';
  const s = site({ 'https://r.example/robots.txt': { headers: { 'content-type': 'text/plain' }, body: robots },
    'https://r.example/ok': { body: ARTICLE }, 'https://r.example/private': { body: ARTICLE } });
  await rejectsWith(read('https://r.example/no-readers/1', s), 403, 'blocked_robots');
  assert.equal((await read('https://r.example/ok', s)).status, 200);
  // Our own group allows /private (the "*" group is not used when a group names ColonReader).
  assert.equal((await read('https://r.example/private', s)).status, 200);
  // A redirect into a disallowed path is refused too.
  const s2 = site({ 'https://r2.example/robots.txt': { headers: { 'content-type': 'text/plain' }, body:
    'User-agent: *\nDisallow: /secret' }, 'https://r2.example/go': { status: 302, headers: {
    location: '/secret/x' } } });
  await rejectsWith(read('https://r2.example/go', s2), 403, 'blocked_robots');
  await rejectsWith(read('https://www.pornhub.com/', site({})), 403, 'blocked_site');
  process.env.BROWSER_READER_BLOCKLIST = 'bad.example, worse.example';
  await rejectsWith(read('https://cdn.bad.example/x', site({})), 403, 'blocked_site');
  const hop = site({ 'https://good.example/': { status: 302, headers: { location: 'https://worse.example/' } } });
  await rejectsWith(read('https://good.example/', hop), 403, 'blocked_site');
});

test('reader: 10-minute cache (shared only when the upstream allows it) and privacy-safe logs', async () => {
  const s = site({ 'https://c.example/a': { body: ARTICLE }, 'https://c.example/b': { body: ARTICLE, headers: {
    'set-cookie': 'sid=1', 'cache-control': 'private' } } });
  const lines = [];
  const orig = console.log;
  console.log = (l) => lines.push(String(l));   // restored to the silent stub afterwards
  try {
    await read('https://c.example/a', s, { userId: 1 });
    const again = await read('https://c.example/a', s, { userId: 2 });
    assert.equal(again.cached, true);
    await read('https://c.example/b', s, { userId: 1 });
    assert.equal((await read('https://c.example/b', s, { userId: 1 })).cached, true);
    assert.equal((await read('https://c.example/b', s, { userId: 2 })).cached, false);   // not shared
  } finally { console.log = orig; }
  const pages = s.calls.filter((c) => !c.url.endsWith('robots.txt')).length;
  assert.equal(pages, 3);
  const logs = lines.filter((l) => l.includes('browser_fetch')).map((l) => JSON.parse(l));
  assert.equal(logs.length, 5);
  for (const l of logs) {
    assert.deepEqual(Object.keys(l).filter((k) => !['t', 'level', 'msg', 'req_id'].includes(k)).sort(),
      ['bytes', 'cached', 'host', 'ms', 'status', 'user_id']);
    assert.equal(l.host, 'c.example');
  }
  assert.ok(!lines.join('\n').includes('Petrol'));
});
