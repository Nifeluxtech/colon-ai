// v0.31.1: the Code tab, Shell and Data-tab cards in light mode (apps/chat/public/assets/css/chat-ide.css). The
// --ide-* / --term-* variables exist in both themes, and every text / surface pair they make reaches WCAG AA 4.5:1
// with the light tokens of packages/ui/css/tokens.css.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const tokens = fs.readFileSync(path.join(ROOT, 'packages/ui/css/tokens.css'), 'utf8');
const ide = fs.readFileSync(path.join(ROOT, 'apps/chat/public/assets/css/chat-ide.css'), 'utf8');
const ws = fs.readFileSync(path.join(ROOT, 'apps/chat/public/assets/css/chat-workspace.css'), 'utf8');

function block(css, selector) {
  const i = css.indexOf(selector + '{');
  assert.ok(i > -1, 'missing ' + selector);
  const body = css.slice(i + selector.length + 1, css.indexOf('}', i));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = Object.assign(block(tokens, ':root'), block(tokens, '[data-theme="light"]'),
  block(ide, '[data-theme="light"]'));
const darkIde = block(ide, ':root,[data-theme="dark"]');
const lightIde = block(ide, '[data-theme="light"]');

function resolve(v) {
  for (let i = 0; i < 10 && /var\(/.test(v); i++) v = v.replace(/var\((--[\w-]+)\)/, (a, k) => light[k]);
  return v;
}
function rgb(v, over = [255, 255, 255]) {
  v = resolve(v);
  const h = /^#([0-9a-f]{6})/i.exec(v);
  if (h) return h[1].match(/../g).map((x) => parseInt(x, 16));
  const m = /rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/.exec(v.replace(/\s/g, ''));
  assert.ok(m, 'unreadable colour ' + v);
  const a = Number(m[4]);
  return [m[1], m[2], m[3]].map((c, i) => Number(c) * a + over[i] * (1 - a));
}
function lum(c) {
  const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(fg, bg) {
  const b = rgb(bg), x = lum(rgb(fg, b)), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('every IDE / Shell variable is set for both themes', () => {
  assert.deepEqual(Object.keys(lightIde).sort(), Object.keys(darkIde).sort());
  assert.ok(Object.keys(darkIde).length >= 20);
});

test('dark mode keeps 0.31.0\'s Shell colours', () => {
  assert.equal(darkIde['--term-bg'], '#0d1117');
  assert.equal(darkIde['--term-head'], '#161b22');
  assert.equal(darkIde['--ide-ed'], 'var(--code-bg)');
  assert.equal(darkIde['--ide-tabs'], 'var(--bg)');
});

test('light mode text on its surfaces reaches 4.5:1', () => {
  const pairs = [['--ide-tab-fg', '--ide-tabs'], ['--text', '--ide-ed'], ['--text', '--ide-tabs'],
    ['--ide-chip-fg', '--ide-chip'], ['--ide-sha', '--ide-chip'], ['--text', '--ide-chip'], ['--ide-ok', '--ok-bg'],
    ['--muted', '--ide-ed'], ['--text-2', '--bg'], ['--term-fg', '--term-bg'], ['--term-dim', '--term-bg'],
    ['--term-ok', '--term-bg'], ['--term-err', '--term-bg'], ['--term-in', '--term-bg'], ['--term-fg', '--term-key'],
    ['--term-err', '--term-key'], ['--term-head-fg', '--term-head'], ['--term-head-dim', '--term-head'],
    ['--text-2', '--primary-soft']];
  for (const [fg, bg] of pairs) {
    const r = ratio(`var(${fg})`, `var(${bg})`);
    assert.ok(r >= 4.5, `${fg} on ${bg}: ${r.toFixed(2)}`);
  }
});

test('the Shell and IDE rules use the variables, not 0.31.0\'s hard-coded dark colours', () => {
  const rules = ide.slice(ide.indexOf('.ide{')) + ws.slice(ws.indexOf('.wk-term{'), ws.indexOf('/* v0.27.2'));
  for (const hex of ['#0d1117', '#161b22', '#1c2430', '#c9d1d9', '#8b949e', '#7ee787', '#ff7b72', '#21262d']) {
    assert.ok(!rules.toLowerCase().includes(hex), hex + ' is still hard-coded');
  }
  assert.ok(!/\.ide-tab\.on\{[^}]*--code-bg/.test(ide), 'the active tab must not use the chat code-block navy');
});
