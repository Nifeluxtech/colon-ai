// Colon JetX's round collector, v0.35.2: how the injected script finds SportyBet's JetX history
// (apps/android/app/src/colonjetx/assets/jetx/collector-find.js, used by collector.js). Chips written "4.54×",
// with NBSP or zero-width characters, bare "1.07" with the x drawn by CSS ::after, a grid of rows with a More
// button, a clipped first chip, and the text-free diagnostic.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const DIR = path.resolve(__dirname, '../../../../apps/android/app/src/colonjetx/assets/jetx');
const C = require(path.join(DIR, 'collector.js'));
const F = require(path.join(DIR, 'collector-find.js'));
const SAFE = /^[0-9.,xX\u00d7 ]{1,12}$/;

// A tiny DOM: tag, children, own text, attributes; textContent joins the descendants' text; `after` is what a
// stubbed getComputedStyle(el, '::after').content returns.
function el(tag, kids = [], text = '', opts = {}) {
  const node = { tagName: tag, children: kids, shadowRoot: null, after: opts.after || 'none',
    getAttribute: (a) => ((opts.attrs || {})[a] ?? null) };
  Object.defineProperty(node, 'textContent', { get: () => text + node.children.map((k) => k.textContent).join('') });
  return node;
}
const span = (t) => el('SPAN', [], t);
const chip = (t) => el('DIV', [span(t)]);
const ms = (s) => s && s.map((x) => x.m);
const withStyle = (fn) => {
  C.useStyle((node, pseudo) => ({ content: pseudo === '::after' ? node.after : 'none' }));
  try { fn(); } finally { C.useStyle(null); }
};

test('chip text: "×", "X", NBSP, zero-width characters and comma decimals', () => {
  const ok = [['4.54×', 4.54], ['1.07X', 1.07], ['1.07\u00a0x', 1.07], ['\u200b1.0\u200b7x\u200b', 1.07],
    ['12,50 x', 12.5], ['2\u202fx', 2]];
  for (const [t, want] of ok) assert.equal(C.parseMultiplier(t), want, JSON.stringify(t));
  assert.deepEqual(['1.07', '1,07', '1.0', '1.07x', '1.234'].map(C.parseBare), [1.07, 1.07, null, null, null]);
  const row = el('DIV', ['1.07×', '4.54×', '1.23\u00a0×', '2.00 X', '9.81×', '1.5\u200bx'].map(chip));
  const doc = { body: el('BODY', [el('DIV', [row])]) };
  assert.equal(C.findStrip(doc), row);
  assert.deepEqual(ms(C.readStrip(C.itemsOf(row))), [1.07, 4.54, 1.23, 2, 9.81, 1.5]);
});

test('bare numbers: taken with an x drawn by ::after, or when 5+ of them make up 80% of the strip', () => {
  withStyle(() => {
    const x = (t) => el('DIV', [], t, { after: '"x"' });
    assert.equal(C.chipText(x('1.07')), '1.07x');
    assert.equal(C.chipText(el('DIV', [el('SPAN', [], '4.54', { after: '"×"' })])), '4.54x', 'on the inner span');
    const row = el('DIV', [x('1.07'), x('4.54'), x('1.23'), el('SPAN', [], 'Bet'), el('SPAN', [], 'Cash')]);
    assert.equal(C.readStrip(C.itemsOf(row)), null, 'three are not a strip');
    row.children.push(x('2.10'), x('7.77'));
    assert.deepEqual(ms(C.readStrip(C.itemsOf(row))), [1.07, 4.54, 1.23, 2.1, 7.77]);
  });
  const bare = (...t) => t.map((text) => ({ text }));
  assert.deepEqual(ms(C.readStrip(bare('1.07', '4.54', '1.23', '2.10', '7.77', ''))), [1.07, 4.54, 1.23, 2.1, 7.77]);
  assert.equal(C.readStrip(bare('1.07', '4.54', '1.23', '2.10', '7.77', 'Bet', 'Win', '')), null, 'odds-like 62%');
  assert.equal(C.readStrip(bare('1.07', '4.54', '1.23', '2.10')), null);
});

test('grouped strip: a grid of 3 rows x 8 chips with a More button and a chevron', () => {
  const values = Array.from({ length: 24 }, (_, i) => (1 + i / 10).toFixed(2) + 'x');
  const rows = [0, 1, 2].map((r) => el('DIV', values.slice(r * 8, r * 8 + 8).map(chip)));
  const grid = el('DIV', [...rows, el('BUTTON', [], 'More'), el('BUTTON', [el('SVG')])]);
  const doc = { body: el('BODY', [el('MAIN', [el('SECTION', [grid]), el('DIV', [span('Balance 1,200.00')])])]) };
  assert.equal(C.findGrouped(doc), grid);
  assert.deepEqual(ms(C.readStrip(C.leafItems(grid), F.GROUP_SHARE)), values.map(parseFloat), 'document order');
  assert.ok(C.findStrip(doc), 'a full row of 8 is a strip on its own as well');

  // Rows of 4: no single parent holds 5 chips, so only the grouped search finds the history.
  const small = [0, 1, 2].map((r) => el('DIV', values.slice(r * 4, r * 4 + 4).map(chip)));
  const grid2 = el('DIV', [...small, el('BUTTON', [], 'More')]);
  const doc2 = { body: el('BODY', [grid2]) };
  assert.equal(C.findStrip(doc2), null);
  assert.equal(C.findGrouped(doc2), grid2);
  const busy = el('DIV', [...values.slice(0, 5).map(chip), ...'12345678'.split('').map((n) => span('#' + n))]);
  assert.equal(C.findGrouped({ body: el('BODY', [busy]) }), null, 'chips must be most of the short leaves');
});

test('install: a grid of rows is collected; first look sends nothing, then the new round once', () => {
  const sent = [], timers = [];
  let changed = null;
  const rows = [['1.07x', '4.54x', '1.23x', '2.00x'], ['3.10x', '1.01x', '5.55x', '1.90x'], ['2.22x', '1.11x']]
    .map((r) => el('DIV', r.map(chip)));
  const grid = el('DIV', [...rows, el('BUTTON', [], 'More')]);
  grid.isConnected = true;
  const win = { ColonJetXRounds: { postMessage: (m) => sent.push(JSON.parse(m)) }, location: { hostname: 'jx.test' },
    document: { body: el('BODY', [grid]) }, setTimeout: (fn) => timers.push(fn), setInterval: () => 0,
    MutationObserver: class { constructor(fn) { changed = fn; } observe() {} } };
  C.install(win);
  timers.shift()();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].diag.strip_found, true);
  assert.equal(sent[0].diag.items, 10);
  rows[0].children.unshift(chip('8.88x'));
  rows[2].children.pop();
  changed();
  timers.shift()();
  assert.deepEqual(sent.slice(1).map((m) => m.multiplier), [8.88]);
});

test('a clipped first chip ("3.96x4.35x") is skipped, the rest is read', () => {
  const row = el('DIV', [el('DIV', [], '3.96x4.35x'), ...['4.35x', '1.07x', '4.54x', '1.23x', '2.50x'].map(chip)]);
  assert.equal(C.findStrip({ body: el('BODY', [row]) }), row);
  assert.deepEqual(ms(C.readStrip(C.itemsOf(row))), [4.35, 1.07, 4.54, 1.23, 2.5]);
  assert.equal(C.chipText(el('DIV', [span('3.96x'), span('4.35x')])), '', 'two overlapping leaves: neither');
});

test('diagStats: counts, and samples only of [0-9.,xX× ], at most 3 of at most 12 characters', () => {
  const host = el('DIV');
  host.shadowRoot = { children: [span('1.07x')] };
  const body = el('BODY', [host, el('CANVAS'), el('JETX-HISTORY'), span('4.54\u00a0×'), span('Max 10x bonus'),
    span('500.00'), span('3.96x4.35x'), span('1234567890.12x'), span('Your balance: 2.00x of your stake today'),
    el('SCRIPT', [], 'var a = "9.99x";'), el('DIV', [span('Bet')])]);
  const d = C.diagStats({ body });
  assert.deepEqual([d.mult_texts, d.canvases, d.shadow_hosts, d.closed_hint], [6, 1, 1, 1]);
  assert.deepEqual(d.sample, ['1.07x', '4.54 ×', '3.96x4.35x']);
  for (const s of d.sample) assert.match(s, SAFE);
  assert.equal(JSON.stringify({ diag: { ...d, frame_host: 'x'.repeat(100), strip_found: false, items: 0 } }).length
    < 512, true, 'fits the app limit');
  const many = el('BODY', Array.from({ length: 50 }, (_, i) => span(`${i}.0${i % 10}x`)));
  assert.equal(C.diagStats({ body: many }).sample.length, 3);
  assert.deepEqual(C.diagStats({ body: el('BODY', [span('Welcome back')]) }).sample, []);
});

test('0.37.0: nested open shadow roots and a same-origin iframe inside one are walked; diag counts frames', () => {
  const values = ['2.01x', '2.25x', '1.79x', '5.31x', '1.12x', '3.40x'];
  const row = el('DIV', values.map(chip));
  const inner = { body: el('BODY', [el('DIV', [row])]) };
  const frame = el('IFRAME', [], '', { attrs: { src: 'https://jetx.provider.example/game?token=secret#x' } });
  frame.contentDocument = inner;
  const cross = el('IFRAME', [], '', { attrs: { src: 'https://other.example:8443/a' } });
  Object.defineProperty(cross, 'contentDocument', { get: () => { throw new Error('cross-origin'); } });
  const deep = el('GAME-VIEW'); deep.shadowRoot = { children: [frame, cross, el('CANVAS')] };
  const host = el('APP-ROOT'); host.shadowRoot = { children: [el('DIV', [deep])] };
  const doc = { body: el('BODY', [host, el('IFRAME', [], '', { attrs: { src: 'about:blank' } })]),
    baseURI: 'https://www.sportybet.com/ng/' };
  assert.equal(C.findStrip(doc), row, 'found through two shadow roots and an iframe');
  const d = C.diagStats(doc);
  assert.equal(d.iframes, 3);
  assert.equal(d.shadow_iframes, 2);
  assert.equal(d.canvases, 1);
  assert.equal(d.shadow_hosts, 2);
  assert.deepEqual(d.frame_origins, ['https://jetx.provider.example', 'https://other.example:8443']);
  assert.ok(d.frame_origins.every((o) => !/[?#/]/.test(o.replace('https://', ''))), 'origin only, no path');
  assert.equal(C.originOf('javascript:alert(1)'), null);
  assert.equal(C.originOf('/x', 'https://a.example/b'), 'https://a.example');
});
