// Unit tests for apps/chat/src/lib/ws-site.js (v0.27.0, Workspace step 3): the preview page builder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPage, pagePath, resolvePath, bridgeScript } = require('../../../apps/chat/src/lib/ws-site.js');

const t = (path, content, type) => ({ path, content, encoding: 'utf8', type: type || 'text/plain' });
const FILES = [
  t('index.html', '<html><head><link rel="stylesheet" href="css/site.css"></head><body>'
    + '<img src="img/logo.png"><a href="about.html">About</a><a href="/contact.html">C</a>'
    + '<script src="js/app.js"></script><img src="missing.png"></body></html>', 'text/html'),
  t('css/site.css', 'body{background:url(../img/logo.png)}', 'text/css'),
  t('js/app.js', 'console.log("</script>")', 'text/javascript'),
  { path: 'img/logo.png', content: 'iVBOR', encoding: 'base64', type: 'image/png' },
  t('about.html', '<p>About</p>', 'text/html'),
  t('blog/index.html', '<p>Blog</p>', 'text/html'),
];

test('resolvePath: relative, parent, absolute and external references', () => {
  assert.equal(resolvePath('css/site.css', '../img/a.png'), 'img/a.png');
  assert.equal(resolvePath('index.html', './a.html?x=1#top'), 'a.html');
  assert.equal(resolvePath('index.html', '/a.html'), '');
  assert.equal(resolvePath('index.html', '../a.html'), '');
  assert.equal(resolvePath('index.html', 'https://x.com/a.png'), null);
  assert.equal(resolvePath('index.html', '#top'), null);
  assert.equal(resolvePath('index.html', 'mailto:a@b.c'), null);
});

test('pagePath finds pages by file, extensionless name or folder index', () => {
  const m = {}; FILES.forEach((f) => { m[f.path] = f; });
  assert.equal(pagePath(m, 'about'), 'about.html');
  assert.equal(pagePath(m, 'blog/'), 'blog/index.html');
  assert.equal(pagePath(m, 'blog'), 'blog/index.html');
  assert.equal(pagePath(m, ''), 'index.html');
  assert.equal(pagePath(m, 'css/site.css'), null);
});

test('buildPage inlines css and scripts, turns assets into data URLs, injects the bridge first', () => {
  const r = buildPage(FILES, 'index.html', 'BRIDGE()');
  assert.match(r.html, /<head><script>BRIDGE\(\)/);
  assert.match(r.html, /<style data-from="css\/site\.css">body\{background:url\("data:image\/png;base64,iVBOR"\)\}/);
  assert.match(r.html, /<img src="data:image\/png;base64,iVBOR">/);
  assert.match(r.html, /console\.log\("<\\\/script>"\)/);
  assert.doesNotMatch(r.html, /src="js\/app\.js"/);
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings.some((w) => /“\/contact\.html” points outside your site/.test(w)));
  assert.ok(r.warnings.some((w) => /“missing\.png” wasn’t found/.test(w)));
});

test('buildPage on a missing page', () => {
  assert.deepEqual(buildPage(FILES, 'nope.html', '').warnings, ['Missing page: nope.html']);
});

test('v0.29.0: code inside scripts and encoded SVG ids are not reported as missing files', () => {
  const html = '<head></head><script>el.innerHTML = `<img src="${esc(src)}"><a href="${href}">x</a>`;'
    + "var t = '<a href=\"' + back + '\">';</script><img src=\"{{ logo }}\"><div style=\"background:url("
    + "'data:image/svg+xml,%3Csvg filter=%22url(%23noise)%22/%3E')\"></div>";
  const out = buildPage([{ path: 'index.html', type: 'text/html', encoding: 'utf8', content: html }], 'index.html', '');
  assert.deepEqual(out.warnings, []);
  assert.equal(resolvePath('index.html', '%23noise'), null);
  assert.equal(resolvePath('index.html', 'img/a.png'), 'img/a.png');
});

test('v0.30.0: the preview bridge gives sign-in libraries in-memory storage when the sandbox has none', () => {
  const win = {};
  Object.defineProperty(win, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  win.sessionStorage = { getItem: () => null, real: true };
  const doc = { addEventListener() {} };
  new Function('window', 'document', 'addEventListener', 'parent', 'console', bridgeScript('index.html'))(
    win, doc, () => {}, { postMessage() {} }, { error() {} });
  win.localStorage.setItem('sb', 1);
  assert.equal(win.localStorage.getItem('sb'), '1');
  assert.equal(win.localStorage.length, 1);
  assert.equal(win.sessionStorage.real, true);
});

test('v0.31.0: nothing loads from Colon’s address; folder modules are inlined; a copy of Colon’s app is named', () => {
  const t = (path, content) => ({ path, content, encoding: 'utf8', type: 'text/plain' });
  const files = [t('index.html', '<html><head><script type="module">import { a } from "./js/app.js";'
    + 'import z from "lib";</script><script src="/main.js"></script><link rel="stylesheet" href="gone.css">'
    + '</head><body><img src="/logo.png"></body></html>'), t('js/app.js', 'import { b } from "./lib/b.js";'
    + 'export const a = b;'), t('js/lib/b.js', 'export const b = 1;')];
  const r = buildPage(files, 'index.html', '');
  assert.doesNotMatch(r.html, /src="\/main\.js"|src="\/logo\.png"|href="gone\.css"/);
  assert.match(r.html, /<script\s+data-missing><\/script>/);
  assert.match(r.html, /src="about:blank"/);
  assert.match(r.html, /from "data:text\/javascript;base64,/);
  assert.match(r.html, /import z from "lib"/);
  const inner = Buffer.from(/from "data:text\/javascript;base64,([^"]+)"/.exec(r.html)[1], 'base64').toString();
  assert.match(inner, /from "data:text\/javascript;base64,/);
  assert.equal(r.warnings.length, 3);
  const copy = buildPage([t('index.html', '<script type="module" src="/v0.30.1/apps/chat/src/main.js"></script>')],
    'index.html', '');
  assert.equal(copy.colonCopy, true);
  assert.match(copy.html, /copy of Colon AI’s own app/);
  assert.doesNotMatch(copy.html, /v0\.30\.1/);
});
