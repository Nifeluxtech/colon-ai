// Unit tests for web light mode (v0.8.0, Phase 8): the server-side reader adapter's fallbacks
// (packages/ui/js/browser/reader-proxy.js), the "Open in the app" prompt rule (app-prompt.js) and where it links.
const test = require('node:test');
const assert = require('node:assert/strict');

const mem = {};
global.window = global;
global.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
global.sessionStorage = { getItem: (k) => mem['s:' + k] ?? null, setItem: (k, v) => { mem['s:' + k] = String(v); } };
global.document = { documentElement: { setAttribute() {}, getAttribute() {} }, createElement: () => ({ style: {} }),
  addEventListener() {}, querySelector() { return null; }, getElementById() { return {}; }, readyState: 'complete',
  head: { appendChild() {} }, body: { appendChild() {} } };
const { createProxyReader, mockPage } = require('../js/browser/reader-proxy.js');
const { promptKind } = require('../js/browser/app-prompt.js');
const { native: N } = require('../js/colon/native.js');

const needsProxy = () => Object.assign(new Error('blocked by CORS'), { code: 'needs_proxy' });
function adapter(own) {
  return { getSettings: () => Promise.resolve({ loadImages: true }), fetchPage: own };
}

test('auto mode: a page the browser can read never touches the server', async () => {
  let calls = 0;
  const reader = createProxyReader({ mode: () => 'auto', api: () => { calls++; return Promise.resolve({}); } });
  const data = reader.wrap(adapter(() => Promise.resolve({ url: 'https://en.wikipedia.org/wiki/Lagos' })));
  const page = await data.fetchPage('https://en.wikipedia.org/wiki/Lagos');
  assert.equal(page.url, 'https://en.wikipedia.org/wiki/Lagos');
  assert.equal(calls, 0);
});

test('auto mode: until the server reader exists, the original "needs proxy" error is kept (asked once)', async () => {
  let calls = 0;
  const api = () => { calls++; return Promise.reject(Object.assign(new Error('Not found'), { status: 404 })); };
  const data = createProxyReader({ mode: () => 'auto', api }).wrap(adapter(() => Promise.reject(needsProxy())));
  await assert.rejects(data.fetchPage('https://punchng.com/x'), { code: 'needs_proxy' });
  await assert.rejects(data.fetchPage('https://punchng.com/y'), { code: 'needs_proxy' });
  assert.equal(calls, 1); // a 404 marks the endpoint unavailable for this session
});

test('other errors pass straight through, and off mode never calls the server', async () => {
  let calls = 0;
  const api = () => { calls++; return Promise.resolve({}); };
  const timeout = Object.assign(new Error('slow'), { code: 'timeout' });
  const auto = createProxyReader({ mode: () => 'auto', api }).wrap(adapter(() => Promise.reject(timeout)));
  await assert.rejects(auto.fetchPage('https://a.ng'), { code: 'timeout' });
  const off = createProxyReader({ mode: () => 'off', api }).wrap(adapter(() => Promise.reject(needsProxy())));
  await assert.rejects(off.fetchPage('https://a.ng'), { code: 'needs_proxy' });
  assert.equal(calls, 0);
});

test('the mock page is labelled as a preview and names the site', () => {
  const p = mockPage('https://www.premiumtimesng.com/news/1.html');
  assert.equal(p.preview, true);
  assert.match(p.title, /premiumtimesng\.com · Preview/);
  assert.match(p.html, /isn’t switched on yet/);
  assert.doesNotMatch(p.html, /<script/i);
});

test('"Open in the app" prompt: never inside the app, always on sites that need the full browser', () => {
  assert.equal(promptKind(true, false, true), 'none');
  assert.equal(promptKind(false, false, false), 'bar');
  assert.equal(promptKind(false, true, false), 'none');  // hidden for this session
  assert.equal(promptKind(false, true, true), 'full');   // error pages can't hide it
});

test('the prompt links Colon Browser\'s APK on Android and the release page elsewhere', () => {
  const android = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
  assert.equal(N.browserAppLink(android), N.BROWSER_APK);
  assert.match(N.BROWSER_APK, /\/releases\/latest\/download\/colon-browser\.apk$/);
  assert.equal(N.browserAppLink('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), N.RELEASES);
  assert.equal(N.hasPanel(), false);
});

test('outside the app the native browser panel call rejects safely', async () => {
  await assert.rejects(N.browser('open', { url: 'https://punchng.com' }), { code: 'no_native' });
});
