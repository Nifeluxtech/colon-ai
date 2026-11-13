// The phone's half of Saga's clicks (0.10.1): apps/android/app/src/main/assets/saga/tools.js `point`, `click`
// and `outcome`, run on a fake DOM with geometry. `point` says where the element's centre is as fractions of the
// visible viewport (SagaTap.kt turns them into a real tap) and what lies over it; it refuses secret fields, even
// one laid over the element; the script fallback fires the events a finger does; `outcome` tells Saga whether the
// click changed anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '../../../../apps/android/app/src/main/assets/saga/tools.js'),
  'utf8');

function dom(specs, o = {}) {
  const events = [];
  const body = { innerText: o.text || 'Hello', tagName: 'BODY', getAttribute: () => null };
  const els = specs.map((s) => {
    const attrs = { ...(s.attrs || {}) };
    const el = {
      tagName: s.tag.toUpperCase(), textContent: s.text || '', value: '', type: attrs.type || '', href: '',
      disabled: false, isContentEditable: false, form: s.form || null, id: s.id || '', rect: { ...s.rect },
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; }, hasAttr: (k) => k in attrs, closest: () => null,
      contains: (x) => x === el || (s.child && x === s.child),
      getBoundingClientRect: () => ({ ...el.rect }),
      scrollIntoView(opts) { events.push(['scroll', opts && opts.behavior]); el.rect.top = 400; },
      focus() { events.push(['focus', s.tag]); document.activeElement = el; },
      click() { events.push(['click', el.textContent]); if (s.onClick) s.onClick(document, window); },
      dispatchEvent: (e) => { events.push([e.type, e.init && e.init.pointerType]); return true; },
    };
    return el;
  });
  const document = {
    title: 'Shop', body, activeElement: body, documentElement: { scrollHeight: 2000 },
    querySelectorAll: (sel) => (sel.startsWith('[data-colon-saga]') ? els.filter((e) => e.hasAttr('data-colon-saga'))
      : sel === 'input,textarea,select' ? [] : els),
    querySelector: (sel) => {
      const m = /^\[data-colon-saga="(c\d+)"\]$/.exec(sel);
      return m ? els.find((e) => e.getAttribute('data-colon-saga') === m[1]) || null : null;
    },
    getElementsByTagName: () => ({ length: 10 + (o.extraNodes ? o.extraNodes() : 0) }),
    elementFromPoint: (x, y) => (o.cover ? o.cover : els.find((e) => x >= e.rect.left && x <= e.rect.left
      + e.rect.width && y >= e.rect.top && y <= e.rect.top + e.rect.height) || null),
  };
  class Ev { constructor(type, init) { this.type = type; this.init = init; } }
  const window = { location: { href: 'https://shop.ng/' }, innerWidth: 400, innerHeight: 800, scrollY: 0,
    visualViewport: o.vv || { offsetLeft: 0, offsetTop: 0, width: 400, height: 800 },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    HTMLInputElement: { prototype: {} }, HTMLTextAreaElement: { prototype: {} }, HTMLSelectElement: { prototype: {} },
    Event: Ev, KeyboardEvent: Ev, MouseEvent: Ev, PointerEvent: Ev, scrollTo() {}, scrollBy() {} };
  const fn = vm.runInNewContext(SRC, { document, window });
  const run = (cmd, args = {}) => JSON.parse(fn(cmd, args));
  run('content');
  return { run, els, events, document, window };
}
const BTN = { tag: 'button', text: 'Show more', rect: { left: 100, top: 1200, width: 200, height: 40 } };

test('point scrolls the element to the middle and gives its centre as fractions of the visible viewport', () => {
  const d = dom([BTN]);
  const p = d.run('point', { id: 'c1', action: 'click' });
  assert.deepEqual(d.events[0], ['scroll', 'instant']); // smooth scrolling would move it after we measured
  assert.equal(p.cx, 0.5);
  assert.equal(p.cy, 0.525);       // (400 + 20) / 800
  assert.equal(p.in_view, true);
  assert.equal(p.hit, true);
  assert.equal(p.covered, '');
  assert.equal(p.before.url, 'https://shop.ng/');
  assert.equal(d.events.some((e) => e[0] === 'click'), false); // point never clicks
});

test('pinch zoom: the visual viewport offset and size are used, not the layout viewport', () => {
  const d = dom([BTN], { vv: { offsetLeft: 100, offsetTop: 300, width: 200, height: 400 } });
  const p = d.run('point', { id: 'c1', action: 'click' });
  assert.equal(p.cx, 0.5);         // (200 - 100) / 200
  assert.equal(p.cy, 0.3);         // (420 - 300) / 400
});

test('something over the element is reported (the tap would hit it), so the phone acts on the element itself', () => {
  const banner = { tagName: 'DIV', textContent: 'Accept cookies', getAttribute: () => null, closest: () => null };
  const p = dom([BTN], { cover: banner }).run('point', { id: 'c1', action: 'click' });
  assert.equal(p.hit, false);
  assert.equal(p.covered, 'Accept cookies');
});

test('secret fields are refused by point, and a secret field laid over the element is refused too', () => {
  const pw = { tag: 'input', attrs: { type: 'password' }, rect: { left: 0, top: 0, width: 300, height: 40 } };
  const d = dom([pw]);
  assert.deepEqual(d.run('point', { id: 'c1', action: 'click' }), { error: 'secret_field', kind: 'password' });
  assert.deepEqual(d.run('click', { id: 'c1' }), { error: 'secret_field', kind: 'password' });
  assert.equal(d.events.length, 0);
  const otp = { tagName: 'INPUT', type: 'text', textContent: '', closest: () => null, isContentEditable: false,
    getAttribute: (k) => ({ autocomplete: 'one-time-code', type: 'text' })[k] || null };
  const d2 = dom([BTN], { cover: otp });
  assert.deepEqual(d2.run('point', { id: 'c1', action: 'click' }), { error: 'secret_field', kind: 'one_time_code' });
  assert.deepEqual(d2.run('click', { id: 'c1' }), { error: 'secret_field', kind: 'one_time_code' });
  assert.equal(d2.events.some((e) => e[0] === 'click'), false);
  assert.deepEqual(dom([BTN]).run('point', { id: 'c7', action: 'click' }), { error: 'no_element' });
});

test('the script fallback fires what a finger does: pointer and mouse down/up, focus, then click', () => {
  const d = dom([BTN]);
  const r = d.run('click', { id: 'c1' });
  assert.equal(r.method, 'script');
  assert.ok(r.before);
  assert.deepEqual(d.events.slice(1).map((e) => e[0]),
    ['pointerdown', 'mousedown', 'focus', 'pointerup', 'mouseup', 'click']);
  assert.equal(d.events[1][1], 'touch');
});

test('outcome: what changed since point (navigation, content, element state, focus, nothing)', () => {
  const d = dom([BTN]);
  const before = d.run('point', { id: 'c1', action: 'click' }).before;
  assert.equal(d.run('outcome', { id: 'c1', before }).changed, 'none');
  d.els[0].setAttribute('aria-expanded', 'true');
  assert.equal(d.run('outcome', { id: 'c1', before }).changed, 'element_changed');
  d.document.body.innerText = 'Hello and more items';
  assert.equal(d.run('outcome', { id: 'c1', before }).changed, 'page_changed');
  d.window.location.href = 'https://shop.ng/#more';
  assert.equal(d.run('outcome', { id: 'c1', before }).changed, 'url_changed');
  d.window.location.href = 'https://shop.ng/prices';
  const o = d.run('outcome', { id: 'c1', before });
  assert.equal(o.changed, 'navigated');
  assert.equal(o.url, 'https://shop.ng/prices');
  assert.equal(d.run('outcome', { id: 'c1', before: null }).changed, 'unknown');
});

test('outcome: focus alone, and an element removed by the click', () => {
  const d = dom([BTN]);
  const before = d.run('point', { id: 'c1', action: 'click' }).before;
  d.document.activeElement = d.els[0];
  assert.equal(d.run('outcome', { id: 'c1', before }).changed, 'focused');
  const s = d.run('changed', { before: { url: 'u', title: 't', len: 1, hash: 1, nodes: 1, el: '|||||', focus: '' },
    after: { url: 'u', title: 't', len: 1, hash: 1, nodes: 1, el: 'gone', focus: '' } });
  assert.equal(s.changed, 'element_changed');
});
