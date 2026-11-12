// Security tests for the SSRF guard used by the page reader and SearXNG (modules/search/net.js): private,
// loopback, link-local, CGNAT and metadata addresses refused, redirects re-checked and capped. DNS is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../../src/modules/search/search');
const { checkUrl, isPrivateIp, safeFetch } = require('../../src/modules/search/net');
const reader = require('../../src/modules/search/reader');
/* ---------- helpers ---------- */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const res = (body, { status = 200, type = 'text/html; charset=utf-8', headers = {} } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type, ...headers } });
// fetch mock by URL pattern; records calls.
function routeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    for (const [re, reply] of routes) if (re.test(String(url))) return typeof reply === 'function' ? reply(String(url), init) : reply();
    return res('not found', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}
test.beforeEach(() => { search._resting.clear(); reader.pageCache.clear(); });
/* ---------- SSRF guard ---------- */
test('SSRF guard: private, loopback, link-local, CGNAT and metadata addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'not-an-ip']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['93.184.216.34', '102.89.4.10', '172.32.0.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) assert.ok(!isPrivateIp(ip), ip);
  const bad = ['file:///etc/passwd', 'ftp://x.ng/', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://user:pw@example.com/', 'http://example.com:8080/', 'gopher://x', 'http://printer.local/'];
  for (const u of bad) await assert.rejects(checkUrl(u, { lookup: publicLookup }), (e) => e.code === 'blocked_url', u);
  // A public-looking name that resolves to a private address (DNS rebinding style) is refused too.
  await assert.rejects(checkUrl('https://evil.example/', { lookup: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }] }), (e) => e.code === 'blocked_url');
  assert.equal((await checkUrl('https://www.cbn.gov.ng/x', { lookup: publicLookup })).hostname, 'www.cbn.gov.ng');
});
test('SSRF guard: redirects are re-checked (no hop to a private address) and capped at 3', async () => {
  const toPrivate = routeFetch([[/start\.example/, () => res('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })]]);
  await assert.rejects(safeFetch('https://start.example/', { fetch: toPrivate, lookup: publicLookup }), (e) => e.code === 'blocked_url');
  assert.equal(toPrivate.calls.length, 1);
  let n = 0;
  const loop = routeFetch([[/loop\.example/, () => res('', { status: 301, headers: { location: `https://loop.example/${++n}` } })]]);
  await assert.rejects(safeFetch('https://loop.example/', { fetch: loop, lookup: publicLookup }), (e) => e.code === 'too_many_redirects');
  assert.equal(loop.calls.length, 4);
  // Size cap: a huge page is cut, not loaded whole.
  const big = routeFetch([[/big\.example/, () => res('<p>' + 'x'.repeat(3 * 1024 * 1024) + '</p>')]]);
  const r = await safeFetch('https://big.example/', { fetch: big, lookup: publicLookup, maxBytes: 100 * 1024 });
  assert.ok(r.text.length <= 100 * 1024);
});
