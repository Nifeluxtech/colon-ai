// Unit tests for packages/ui/assets/colon-url.js: address-bar parsing and the client-side SSRF guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColonURL: U } = require('../js/url.js');

test('address bar: URLs vs search queries', () => {
  assert.equal(U.parseInput('https://punchng.com/news').type, 'url');
  assert.equal(U.parseInput('punchng.com').url, 'https://punchng.com/');
  assert.equal(U.parseInput('www.bbc.com/pidgin').url, 'https://www.bbc.com/pidgin');
  assert.equal(U.parseInput('jollof rice recipe').type, 'search');
  assert.equal(U.parseInput('jollof rice', 'duckduckgo').url, 'https://duckduckgo.com/?q=jollof%20rice');
  assert.equal(U.parseInput('file.txt').type, 'search');             // no known TLD
  assert.equal(U.parseInput('javascript:alert(1)').type, 'search');  // never executed
  assert.equal(U.parseInput('colon://newtab').type, 'internal');
  assert.equal(U.parseInput('   '), null);
});

test('guard blocks private, loopback, link-local and metadata hosts', () => {
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://172.16.3.4/', 'http://192.168.1.1/admin',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/',
    'http://2130706433/', 'http://0x7f000001/', 'http://router.local/', 'http://intranet/', 'http://metadata.google.internal/', 'http://100.64.0.1/']) {
    const r = U.guard(u);
    assert.equal(r.ok, false, u);
  }
});

test('guard blocks bad schemes, credentials and odd ports', () => {
  assert.equal(U.guard('ftp://example.com/').reason, 'scheme');
  assert.equal(U.guard('file:///etc/passwd').reason, 'scheme');
  assert.equal(U.guard('https://user:pw@example.com/').reason, 'credentials');
  assert.equal(U.guard('http://example.com:22/').reason, 'port');
  assert.equal(U.guard('not a url').reason, 'invalid');
});

test('guard allows public sites', () => {
  for (const u of ['https://en.wikipedia.org/wiki/Lagos', 'https://punchng.com/', 'http://example.com:8080/x', 'https://8.8.8.8/', 'https://[2001:4860:4860::8888]/']) {
    assert.equal(U.guard(u).ok, true, u);
  }
});

test('display helpers', () => {
  assert.equal(U.hostOf('https://www.jumia.com.ng/phones'), 'jumia.com.ng');
  assert.equal(U.displayUrl('https://www.jumia.com.ng/'), 'jumia.com.ng');
  assert.equal(U.queryFrom('https://www.google.com/search?q=naira%20rate'), 'naira rate');
  assert.equal(U.isSecure('http://x.com'), false);
  assert.equal(U.resolve('/wiki/Nigeria', 'https://en.wikipedia.org/wiki/Lagos'), 'https://en.wikipedia.org/wiki/Nigeria');
});
