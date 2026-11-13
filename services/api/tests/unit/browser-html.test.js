// Unit tests for the Phase 8 server reader's sanitiser (modules/browser/html.js), robots.txt rules
// (modules/browser/robots.js) and the safety layer's host block list (modules/safety/hosts.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = require('../../src/modules/browser/html');
const robots = require('../../src/modules/browser/robots');
const { blockedHost } = require('../../src/modules/safety');

const BASE = 'https://news.example.ng/2026/story';
const body = (inner) => `<html><body><article>${inner}<p>${'Long enough body text. '.repeat(30)}</p></article>`
  + '</body></html>';
const clean = (inner) => html.sanitize(body(inner), BASE).html;

test('sanitiser: same tag allow-list and drop-list as the web client (sanitize.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../../packages/ui/js/browser/sanitize.js'), 'utf8');
  const list = (name) => new Set([...new RegExp(`var ${name} = \\{([\\s\\S]*?)\\};`).exec(src)[1]
    .matchAll(/([A-Z0-9]+):\s*1/g)].map((m) => m[1].toLowerCase()));
  assert.deepEqual([...html.ALLOWED].sort(), [...list('ALLOWED')].sort());
  for (const tag of list('DROP')) assert.ok(html.DROP.has(tag), `${tag} is dropped by the client, not the server`);
});

test('sanitiser: scripts, styles, frames, forms, media, nav/aside and handlers are removed', () => {
  const out = clean('<script>alert(1)</script><style>p{color:red}</style><iframe src="https://x"></iframe>'
    + '<object data="x"></object><embed src="x"><form action="/x"><input name="q"><button>Go</button>Inside</form>'
    + '<svg><circle onload="x()"/></svg><math><mi>x</mi></math><canvas></canvas><video src="v.mp4"></video>'
    + '<audio src="a.mp3"></audio><nav>Menu</nav><aside>Side</aside>'
    + '<p onclick="steal()" style="x" class="c">Kept <b onmouseover="x()">bold</b></p>'
    + '<script>document.write("</p><p>")</script>');
  const GONE = /<(script|style|iframe|object|embed|form|input|button|svg|math|canvas|video|audio|nav|aside)/i;
  assert.doesNotMatch(out, GONE);
  assert.doesNotMatch(out, /on\w+=|style=|class=|alert|Menu|Side|Inside|document\.write/);
  assert.match(out, /<p>Kept <b>bold<\/b><\/p>/);
});

test('sanitiser: links and images are made absolute; javascript:, data: and non-https images are refused', () => {
  const out = clean('<a href="../other">rel</a><a href="javascript:alert(1)">js</a><a href="data:text/html,x">d</a>'
    + '<a href="#notes">frag</a><img src="/img/a.jpg" alt="A" width="640" height="99999">'
    + '<img src="http://insecure.example/b.jpg"><img src="javascript:alert(1)"><img data-src="//cdn.example/c.png">'
    + '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot"><img src="data:image/svg+xml;base64,PHN2Zz4=">'
    + '<img src="/d.jpg" srcset="/d1.jpg 1x, https://cdn.example/d2.jpg 2x">'
    + '<img src="/e.jpg" srcset="http://other.example/e1.jpg 1x">');
  assert.match(out, /<a href="https:\/\/news\.example\.ng\/other" rel="noopener noreferrer nofollow">rel<\/a>/);
  assert.match(out, /<a>js<\/a><a>d<\/a><a href="#notes">frag<\/a>/);
  assert.match(out, /src="https:\/\/news\.example\.ng\/img\/a\.jpg" alt="A"[^>]*width="640"/);
  assert.doesNotMatch(out, /height="99999"|insecure|javascript|svg\+xml|other\.example/);
  assert.match(out, /src="https:\/\/cdn\.example\/c\.png"/);
  assert.match(out, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(out, /srcset="https:\/\/news\.example\.ng\/d1\.jpg 1x, https:\/\/cdn\.example\/d2\.jpg 2x"/);
  assert.match(out, /referrerpolicy="no-referrer"/);
});

test('sanitiser: junk blocks go, unknown tags are unwrapped, text is escaped, output stays balanced', () => {
  const out = clean('<div class="cookie banner">Accept cookies</div><div role="navigation">Nav</div>'
    + '<span aria-hidden="true">hidden</span><custom-el>Unwrapped <i>text</i></custom-el>'
    + '<p>a &lt; b &amp; c &eacute; 5 > 3 &bogus</p><p>one<p>two</p><table><tr><td colspan="2" rowspan="99">x'
    + '</td></tr></table><div id="sec-1" title="T">t</div><div><span></span></div>');
  assert.doesNotMatch(out, /Accept cookies|Nav|hidden|custom-el/);
  assert.match(out, /Unwrapped <i>text<\/i>/);
  assert.match(out, /a &lt; b &amp; c &eacute; 5 &gt; 3 &amp;bogus/);
  assert.match(out, /<p>one<\/p><p>two<\/p>/);
  assert.match(out, /<td colspan="2">x<\/td>/);
  assert.match(out, /<div title="T" id="cb-sec-1">t<\/div>/);
  assert.doesNotMatch(out, /<div><\/div>|<span><\/span>/);
  const opens = (out.match(/<(p|div|table|tr|td|a|b|i)\b/g) || []).length;
  const closes = (out.match(/<\/(p|div|table|tr|td|a|b|i)>/g) || []).length;
  assert.equal(opens, closes);
});

test('sanitiser: picks the article, extracts title, byline, lang and plain text', () => {
  const page = '<html lang="yo"><head><title>Ìròyìn &amp; more</title><meta property="og:site_name" content="BBC">'
    + '</head><body><header>Site header</header><article><h2>Heading</h2><p>' + 'Ọ̀rọ̀ pàtàkì. '.repeat(60)
    + '</p></article><footer>Footer</footer></body></html>';
  const r = html.sanitize(page, BASE);
  assert.doesNotMatch(r.html, /Site header|Footer/);
  assert.match(r.text, /^Heading\n\nỌ̀rọ̀ pàtàkì\./);
  assert.deepEqual(html.meta(page), { title: 'Ìròyìn & more', byline: 'BBC', lang: 'yo' });
  assert.ok(html.sanitize('<p>' + 'x'.repeat(300000) + '</p>', BASE).text.length <= 200000);
  assert.equal(html.plainToHtml('a\n\n<b>'), '<p>a</p><p>&lt;b&gt;</p>');
});

test('sign-in wall detection', () => {
  assert.ok(html.looksLikeLogin('<input type="password">', 'Sign in', 'https://x.example/login'));
  assert.ok(html.looksLikeLogin('<input type=password>', 'short', 'https://x.example/'));
  assert.ok(!html.looksLikeLogin('<p>news</p>', 'x'.repeat(5000), 'https://x.example/login-tips-for-teens'));
  assert.ok(!html.looksLikeLogin('<input type="password">', 'x'.repeat(5000), 'https://x.example/article'));
});

test('robots.txt: our group wins over *, longest match decides, wildcards work', () => {
  const g = robots.parse('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nUser-agent: ColonReader\n'
    + 'Disallow: /private/\nAllow: /private/open\nDisallow: /*.pdf$\nDisallow:\n# comment\n');
  assert.equal(robots.allowed(g, '/news/1'), true);
  assert.equal(robots.allowed(g, '/private/x'), false);
  assert.equal(robots.allowed(g, '/private/open/1'), true);
  assert.equal(robots.allowed(g, '/files/a.pdf'), false);
  assert.equal(robots.allowed(g, '/files/a.pdf?x=1'), true);
  assert.equal(robots.allowed(robots.parse('User-agent: *\nDisallow: /'), '/a'), false);
  assert.equal(robots.allowed(robots.parse('User-agent: other\nDisallow: /'), '/a'), true);
  assert.equal(robots.allowed([], '/a'), true);
});

test('safety block list: adult and malware hosts, operator list, no false hits on ordinary names', () => {
  for (const h of ['pornhub.com', 'www.xvideos.com', 'cdn.onlyfans.com', 'free-porn-site.example', 'site.xxx',
    'sex.example.com', 'testsafebrowsing.appspot.com']) assert.ok(blockedHost(h).blocked, h);
  assert.equal(blockedHost('x.bad.example', { extra: ['bad.example'] }).category, 'listed');
  for (const h of ['punchng.com', 'www.sussex.ac.uk', 'essex.gov.uk', 'bbc.co.uk', 'wikipedia.org', 'badexample.com'])
    assert.ok(!blockedHost(h, { extra: ['bad.example'] }).blocked, h);
});
