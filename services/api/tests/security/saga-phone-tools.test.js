// The phone's half of Saga's approvals (Phase 9): apps/android/app/src/main/assets/saga/tools.js, the script
// SagaTools.kt injects into the tab. It lives in the Android app but is plain JavaScript, so it is tested here with a
// tiny fake DOM: the phone's risk check agrees with the server's policy (modules/saga/policy.js) on every case,
// it checks the REAL element at action time (a page that relabels a button after Saga read it still triggers the
// approval), and typed values never leave the page in element descriptions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const policy = require('../../src/modules/saga/policy');

const SRC = fs.readFileSync(path.resolve(__dirname, '../../../../apps/android/app/src/main/assets/saga/tools.js'),
  'utf8');

// A minimal DOM: enough for content, inspect, click, fill and links.
function dom(specs) {
  const events = [];
  const els = specs.map((s) => {
    const attrs = { ...(s.attrs || {}) };
    const el = {
      tagName: s.tag.toUpperCase(), textContent: s.text || '', value: s.value || '', type: attrs.type || '',
      href: s.href || '', disabled: false, isContentEditable: false, form: s.form ? {} : null, id: '',
      getAttribute: (k) => (k in attrs ? attrs[k] : k === 'type' && s.attrs && s.attrs.type ? s.attrs.type : null),
      setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; },
      hasAttr: (k) => k in attrs, closest: () => null, getBoundingClientRect: () => ({ width: 10, height: 10 }),
      scrollIntoView() {}, focus() { events.push(['focus', s.tag]); },
      click() { events.push(['click', el.textContent]); },
      dispatchEvent: (e) => { events.push([e.type, el.value]); return true; },
    };
    return el;
  });
  const document = {
    title: 'Shop', body: { innerText: 'Cart total ₦12,500' },
    documentElement: { scrollHeight: 2000 },
    querySelectorAll: (sel) => (sel === 'a[href]' ? els.filter((e) => e.tagName === 'A')
      : sel.startsWith('[data-colon-saga]') ? els.filter((e) => e.hasAttr('data-colon-saga')) : els),
    querySelector: (sel) => {
      const m = /^\[data-colon-saga="(c\d+)"\]$/.exec(sel);
      return m ? els.find((e) => e.getAttribute('data-colon-saga') === m[1]) || null : null;
    },
  };
  class Ev { constructor(type) { this.type = type; } }
  const window = { location: { href: 'https://shop.ng/cart' }, innerHeight: 800, scrollY: 0,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    HTMLInputElement: { prototype: {} }, HTMLTextAreaElement: { prototype: {} }, HTMLSelectElement: { prototype: {} },
    Event: Ev, KeyboardEvent: Ev, scrollTo() {}, scrollBy() {} };
  const fn = vm.runInNewContext(SRC, { document, window });
  return { run: (cmd, args = {}) => JSON.parse(fn(cmd, args)), els, events };
}

const CASES = [
  ['click', { tag: 'button', text: 'Pay ₦12,500', form: true }],
  ['click', { tag: 'button', text: 'Add to cart' }],
  ['click', { tag: 'button', text: 'Send message' }],
  ['click', { tag: 'button', type: 'submit', text: 'Go', form: true }],
  ['click', { tag: 'a', text: 'Comments (4)', href: 'https://shop.ng/c' }],
  ['click', { tag: 'a', text: 'Buy now', href: 'https://shop.ng/buy' }],
  ['click', { tag: 'button', text: 'Next', form: true }],
  ['click', { tag: 'button', text: 'Show more' }],
  ['fill', { tag: 'input', type: 'password', label: 'Password' }, 'secret123'],
  ['fill', { tag: 'input', type: 'text', label: 'Search' }, 'fuel price lagos'],
  ['fill', { tag: 'input', type: 'text', label: 'Search' }, 'ada@example.com'],
  ['fill', { tag: 'input', type: 'text', label: 'Search' }, '5399 8300 0000 0008'],
  ['fill', { tag: 'input', type: 'text', label: 'Search' }, 'fuel', true],
  ['fill', { tag: 'input', type: 'tel', label: 'Phone number' }, '0803'],
  ['fill', { tag: 'textarea', label: 'Your reply' }, 'Thanks!'],
  ['fill', { tag: 'textarea', label: 'Search', name: 'q' }, 'fuel price'],
];

test('the phone\'s risk check agrees with the server policy', () => {
  const d = dom([]);
  for (const [action, desc, value, submit] of CASES) {
    const phone = d.run('risk', { action, descriptor: desc, value, submit }).risk;
    const server = policy.approval({ name: action, args: { id: 'c1', value, submit } },
      { elements: new Map([['c1', desc]]) });
    assert.equal(phone && phone.kind, server && server.kind, `${action} ${JSON.stringify(desc)} ${value || ''}`);
  }
});

test('content numbers the elements, never sends typed values, and inspect reads the real element', () => {
  const d = dom([
    { tag: 'input', attrs: { type: 'password', name: 'pw' }, value: 'hunter2' },
    { tag: 'input', attrs: { type: 'submit' }, value: 'Continue', form: true },
    { tag: 'button', text: 'Show more' },
    { tag: 'a', text: 'Help', href: 'https://shop.ng/help' },
  ]);
  const c = d.run('content');
  assert.deepEqual(c.elements.map((e) => e.id), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(c.url, 'https://shop.ng/cart');
  assert.ok(!JSON.stringify(c).includes('hunter2'), 'a typed password never leaves the page');
  assert.equal(c.elements[1].text, 'Continue', 'an input button\'s value is its label');
  assert.equal(d.run('inspect', { id: 'c3', action: 'click' }).risk, null);
  // The page relabels the harmless button after Saga read it: the phone sees the truth at action time.
  d.els[2].textContent = 'Pay ₦50,000 now';
  assert.equal(d.run('inspect', { id: 'c3', action: 'click' }).risk.kind, 'payment');
  assert.equal(d.run('inspect', { id: 'c9', action: 'click' }).error, 'no_element');
  // A fresh read renumbers from scratch.
  assert.deepEqual(d.run('content').elements.map((e) => e.id), ['c1', 'c2', 'c3', 'c4']);
});

test('click and fill act on the element; links lists http(s) links once', () => {
  const d = dom([
    { tag: 'input', attrs: { type: 'text', 'aria-label': 'Search' } },
    { tag: 'button', text: 'Search' },
    { tag: 'a', text: 'A', href: 'https://a.ng/' }, { tag: 'a', text: 'A again', href: 'https://a.ng/' },
    { tag: 'a', text: 'JS', href: 'javascript:void(0)' },
  ]);
  d.run('content');
  assert.equal(d.run('fill', { id: 'c1', value: 'fuel price' }).url, 'https://shop.ng/cart');
  assert.equal(d.els[0].value, 'fuel price');
  assert.ok(d.events.some((e) => e[0] === 'input') && d.events.some((e) => e[0] === 'change'));
  d.run('click', { id: 'c2' });
  assert.ok(d.events.some((e) => e[0] === 'click' && e[1] === 'Search'));
  assert.deepEqual(d.run('links').links, [{ text: 'A', url: 'https://a.ng/' }]);
  assert.equal(d.run('scroll', { direction: 'down' }).max, 2000);
});
