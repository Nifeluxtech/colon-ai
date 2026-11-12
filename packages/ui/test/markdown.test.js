// Unit tests for packages/ui/assets/colon-markdown.js (run: node --test packages/ui/test)
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColonMarkdown: MD } = require('../js/markdown/index.js');

test('escapes raw HTML so replies cannot inject markup', () => {
  const out = MD.render('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('only safe link protocols become anchors', () => {
  assert.match(MD.render('[ok](https://example.com)'),
    /<a href="https:\/\/example.com"[^>]*rel="noopener noreferrer nofollow"/);
  assert.ok(!MD.render('[bad](javascript:alert(1))').includes('<a '));
  assert.ok(!MD.render('[bad](data:text/html,hi)').includes('<a '));
  assert.equal(MD.safeUrl('vbscript:x'), null);
  assert.equal(MD.safeUrl('www.nifelux.com'), 'https://www.nifelux.com');
});

test('headings, emphasis, inline code, strike', () => {
  const out = MD.render('# Title\n\n**bold** *it* `code` ~~gone~~');
  assert.match(out, /<h2>Title<\/h2>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<code>code<\/code>/);
  assert.match(out, /<del>gone<\/del>/);
});

test('lists: nested, ordered start, tasks, type switch', () => {
  const out = MD.render('- a\n- b\n  - c\n- [x] done\n\n3. three\n4. four');
  assert.match(out, new RegExp(String.raw`<ul><li>a<\/li><li>b<ul><li>c<\/li><\/ul><\/li>`
    + String.raw`<li class="task"><input type="checkbox" disabled checked> done<\/li><\/ul>`));
  assert.match(out, /<ol start="3"><li>three<\/li><li>four<\/li><\/ol>/);
});

test('tables with alignment and escaped pipes', () => {
  const out = MD.render('| A | B |\n|:--|--:|\n| x \\| y | 2 |');
  assert.match(out, /<th style="text-align:left">A<\/th><th style="text-align:right">B<\/th>/);
  assert.match(out, /<td style="text-align:left">x \| y<\/td>/);
});

test('fenced code is highlighted, escaped, and has a copy button', () => {
  const out = MD.render('```js\nconst a = "<b>"; // c\n```');
  assert.match(out, /class="md-copy" data-copy-code/);
  assert.match(out, /<span class="tok-kw">const<\/span>/);
  assert.match(out, /<span class="tok-str">&quot;&lt;b&gt;&quot;<\/span>/);
  assert.match(out, /<span class="tok-com">\/\/ c<\/span>/);
});

test('unclosed fence while streaming renders as code', () => {
  const out = MD.render('Here:\n```python\nprint(1)');
  assert.match(out, /md-code streaming/);
  assert.match(out, /tok-kw">print/);
});

test('highlighter languages', () => {
  assert.match(MD.highlight('SELECT name FROM users', 'sql'), /tok-kw">SELECT<\/span>/);
  assert.match(MD.highlight('{"a": 1}', 'json'), /tok-attr">&quot;a&quot;<\/span>/);
  assert.match(MD.highlight('<div class="x">', 'html'), /tok-kw">div<\/span> <span class="tok-attr">class<\/span>/);
  assert.match(MD.highlight('def f(): pass', 'py'), /tok-kw">def<\/span>/);
  assert.equal(MD.highlight('<x>', 'unknownlang'), '&lt;x&gt;');
});

test('maths: inline and display TeX subset', () => {
  const inl = MD.render('Area $\\pi r^2$ and $\\frac{1}{2}$');
  assert.match(inl, /class="math"/);
  assert.match(inl, /π/);
  assert.match(inl, /<sup>2<\/sup>/);
  assert.match(inl, /m-frac/);
  const block = MD.render('$$\n\\sqrt{x} \\le \\alpha_i\n$$');
  assert.match(block, /class="math-block"/);
  assert.match(block, /√/);
  assert.match(block, /≤/);
  assert.match(block, /<sub><i>i<\/i><\/sub>/);
});

test('money is not mistaken for maths', () => {
  const out = MD.render('It costs $5 and $10 today.');
  assert.ok(!out.includes('class="math"'));
});

test('citations link to message sources', () => {
  const out = MD.render('Fact [1] and [2].', { sources: [{ title: 'Wiki',
    url: 'https://en.wikipedia.org/wiki/Lagos' }] });
  assert.match(out, /<sup class="cite"><a href="https:\/\/en.wikipedia.org\/wiki\/Lagos" data-cite="1" title="Wiki"/);
  assert.match(out, /data-cite="2"/);
});

test('blockquote and rule', () => {
  const out = MD.render('> quoted\n\n---');
  assert.match(out, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(out, /<hr>/);
});

test('toText strips markdown for copy and previews', () => {
  assert.equal(MD.toText('**Hi** `x` [a](https://b.c)'), 'Hi x a (https://b.c)');
});
