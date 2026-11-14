// The phone's typing and scrolling (0.10.2): apps/android/app/src/main/assets/saga/act.js, evaluated with tools.js
// on the tab (SagaTools.kt) and run only after tools.js found the element and refused secret fields. Owner's report:
// Saga could not really type or scroll. fill now goes through the browser's own editing path (execCommand
// insertText: beforeinput / input events pages register), falls back to the native value setter with an
// InputEvent, verifies the text is there (typed), picks <select> options by text; scroll finds the container that
// really scrolls when the page itself does not, and says whether anything moved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ASSETS = path.resolve(__dirname, '../../../../apps/android/app/src/main/assets/saga');
const TOOLS = fs.readFileSync(path.join(ASSETS, 'tools.js'), 'utf8');
const ACT = fs.readFileSync(path.join(ASSETS, 'act.js'), 'utf8');

class Ev { constructor(type, init) { this.type = type; Object.assign(this, init || {}); this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; } }
class InputEv extends Ev {}

// A small DOM. o.exec: how document.execCommand behaves ('works' | 'ignored' | 'missing').
function rig(o = {}) {
  const events = [], setterCalls = [];
  const proto = {};
  Object.defineProperty(proto, 'value', { configurable: true,
    get() { return this._v || ''; }, set(v) { setterCalls.push(v); this._v = v; } });
  function make(tag, extra = {}) {
    const attrs = { ...(extra.attrs || {}) };
    const el = Object.assign(Object.create(tag === 'input' || tag === 'textarea' ? proto : {}), {
      tagName: tag.toUpperCase(), type: attrs.type || '', disabled: false, isContentEditable: !!extra.editable,
      textContent: extra.text || '', innerText: extra.text || '', form: extra.form || null, id: '',
      options: extra.options,
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; }, hasAttr: (k) => k in attrs, closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 100, width: 200, height: 40 }),
      scrollIntoView() {}, focus() { doc.activeElement = el; }, select() { el.selected = true; },
      dispatchEvent(e) { events.push([e.type, e.inputType || '', e.constructor.name]);
        if (extra.onKey && e.type === 'keydown') extra.onKey(e); return !e.defaultPrevented; },
    });
    if (!(tag === 'input' || tag === 'textarea')) Object.defineProperty(el, 'value', { writable: true, value: '' });
    if (extra.editable) Object.defineProperty(el, 'innerText', { get: () => el.textContent });
    return el;
  }
  const els = [];
  const doc = {
    title: 'Site', body: { innerText: 'Hello', tagName: 'BODY' }, activeElement: null,
    documentElement: { scrollHeight: o.pageHeight || 2000 }, scrollingElement: null,
    querySelectorAll: (sel) => (sel.startsWith('[data-colon-saga]') ? els.filter((e) => e.hasAttr('data-colon-saga'))
      : sel === 'input,textarea,select' ? [] : els),
    querySelector: (sel) => {
      const m = /^\[data-colon-saga="(c\d+)"\]$/.exec(sel);
      return m ? els.find((e) => e.getAttribute('data-colon-saga') === m[1]) || null : null;
    },
    elementFromPoint: () => o.under || null,
    getElementsByTagName: () => ({ length: 10 }),
  };
  doc.scrollingElement = doc.documentElement;
  if (o.exec !== 'missing') {
    doc.execCommand = (cmd, ui, v) => {
      events.push(['exec', cmd]);
      const el = doc.activeElement;
      if (o.exec === 'ignored' || !el) return true;          // the page swallowed it
      if (el.isContentEditable) el.textContent = cmd === 'delete' ? '' : v;
      else el._v = cmd === 'delete' ? '' : v;
      el.dispatchEvent(new InputEv('input', { inputType: cmd === 'delete' ? 'deleteContent' : 'insertText' }));
      return true;
    };
  }
  const win = { location: { href: 'https://site.ng/' }, innerWidth: 400, innerHeight: 800, scrollY: 0,
    getComputedStyle: (e) => ({ visibility: 'visible', display: 'block', opacity: '1',
      overflowY: (e && e.overflowY) || 'visible' }),
    HTMLInputElement: { prototype: proto }, HTMLTextAreaElement: { prototype: proto },
    HTMLSelectElement: { prototype: {} }, Event: Ev, InputEvent: InputEv, KeyboardEvent: Ev,
    scrollTo(a) { win.scrollY = Math.max(0, Math.min(typeof a === 'object' ? a.top : 0, 1200)); },
    scrollBy() {} };
  const ctx = vm.createContext({ document: doc, window: win });
  const fn = vm.runInContext(TOOLS, ctx), ext = vm.runInContext(ACT, ctx);
  const run = (cmd, args = {}) => JSON.parse(fn(cmd, args, ext));
  return { make, els, doc, win, events, setterCalls, run, add(e) { els.push(e); return e; } };
}

test('fill types through the browser\'s editing path and says the text is there', () => {
  const r = rig();
  const box = r.add(r.make('input', { attrs: { type: 'text', 'aria-label': 'Search' } }));
  r.run('content');
  const out = r.run('fill', { id: 'c1', value: 'fuel price lagos' });
  assert.equal(out.typed, true); assert.equal(out.method, 'insert'); assert.equal(out.url, 'https://site.ng/');
  assert.equal(box.value, 'fuel price lagos');
  assert.equal(box.selected, true);                          // what was there is replaced, not appended to
  assert.ok(r.events.some((e) => e[0] === 'input' && e[1] === 'insertText'));
  assert.ok(r.events.some((e) => e[0] === 'change'));
  assert.equal(r.setterCalls.length, 0);
});

test('a page that ignored the edit gets the native setter (React) and an InputEvent; typed is checked', () => {
  for (const exec of ['ignored', 'missing']) {
    const r = rig({ exec });
    const box = r.add(r.make('textarea', { attrs: { name: 'q' } }));
    r.run('content');
    const out = r.run('fill', { id: 'c1', value: 'hello' });
    assert.equal(out.method, 'setter', exec); assert.equal(out.typed, true);
    assert.deepEqual(r.setterCalls, ['hello']); assert.equal(box.value, 'hello');
    assert.ok(r.events.some((e) => e[0] === 'input' && e[1] === 'insertText' && e[2] === 'InputEv'));
  }
});

test('contenteditable editors get the text too', () => {
  const r = rig({ exec: 'missing' });
  const ed = r.add(r.make('div', { editable: true, attrs: { contenteditable: 'true', 'aria-label': 'Post' } }));
  r.run('content');
  const out = r.run('fill', { id: 'c1', value: 'Good morning' });
  assert.equal(ed.textContent, 'Good morning'); assert.equal(out.typed, true);
  const r2 = rig();
  const ed2 = r2.add(r2.make('div', { editable: true, attrs: { contenteditable: 'true' } }));
  r2.run('content');
  assert.equal(r2.run('fill', { id: 'c1', value: 'Hi' }).method, 'insert'); assert.equal(ed2.textContent, 'Hi');
});

test('select picks the option by value or visible text; an unknown option is an error', () => {
  const r = rig();
  const opts = [{ value: 'ng', text: 'Nigeria' }, { value: 'gh', text: 'Ghana' }];
  const sel = r.add(r.make('select', { options: opts, attrs: { name: 'country' } }));
  r.run('content');
  assert.equal(r.run('fill', { id: 'c1', value: 'ghana' }).typed, true); assert.equal(sel.value, 'gh');
  assert.equal(r.run('fill', { id: 'c1', value: 'ng' }).typed, true); assert.equal(sel.value, 'ng');
  assert.deepEqual(r.run('fill', { id: 'c1', value: 'Kenya' }), { typed: false, method: 'select',
    error: 'no_option' });
});

test('submit: Enter first; the form is submitted only when the page did not handle Enter itself', () => {
  let submitted = 0;
  const form = { requestSubmit() { submitted++; } };
  const r = rig();
  r.add(r.make('input', { form, attrs: { type: 'search' } }));
  r.add(r.make('input', { form, attrs: { type: 'search' }, onKey: (e) => e.preventDefault() }));
  r.run('content');
  assert.equal(r.run('fill', { id: 'c1', value: 'rice', submit: true }).submitted, true);
  assert.equal(submitted, 1);
  assert.ok(r.events.some((e) => e[0] === 'keydown') && r.events.some((e) => e[0] === 'keyup'));
  r.run('fill', { id: 'c2', value: 'beans', submit: true });
  assert.equal(submitted, 1);                                // the page's own Enter handler did it
});

test('secret fields are still refused before act.js runs', () => {
  const r = rig();
  const pw = r.add(r.make('input', { attrs: { type: 'password' } }));
  r.run('content');
  assert.deepEqual(r.run('fill', { id: 'c1', value: 'hunter2' }), { error: 'secret_field', kind: 'password' });
  assert.equal(pw.value, '');
  assert.ok(!r.events.some((e) => e[0] === 'exec'));
});

test('scroll: the page when it scrolls, else the container under the middle; moved says if anything did', () => {
  const r = rig();
  let out = r.run('scroll', { direction: 'down' });
  assert.deepEqual(out, { y: 640, max: 1200, target: 'page', moved: true });
  assert.deepEqual(r.run('scroll', { direction: 'bottom' }), { y: 1200, max: 1200, target: 'page', moved: true });
  assert.equal(r.run('scroll', { direction: 'bottom' }).moved, false);   // already at the end
  assert.equal(r.run('scroll', { direction: 'top' }).y, 0);
  // A web app: the page is exactly one screen; a feed container scrolls.
  const feed = { tagName: 'DIV', overflowY: 'auto', scrollTop: 0, scrollHeight: 3000, clientHeight: 700,
    scrollLeft: 0, scrollTo(a) { feed.scrollTop = Math.max(0, Math.min(a.top, 2300)); } };
  const item = { tagName: 'P', parentElement: feed };
  const app = rig({ pageHeight: 800, under: item });
  assert.deepEqual(app.run('scrollinfo'), { y: 0, max: 2300, target: 'element' });
  out = app.run('scroll', { direction: 'down' });
  assert.deepEqual(out, { y: 560, max: 2300, target: 'element', moved: true });
  assert.equal(app.run('scroll', { direction: 'up' }).y, 0);
  assert.equal(app.run('scroll', { direction: 'bottom' }).y, 2300);
  // An older element without scrollTo: the property is set instead.
  delete feed.scrollTo;
  assert.equal(app.run('scroll', { direction: 'top' }).y, 0);
});

test('0.10.4 type: Saga types the text out piece by piece (watchable), never into a secret field', () => {
  const r = rig({ exec: 'missing' });
  const box = r.add(r.make('input', { attrs: { type: 'text', 'aria-label': 'Username' } }));
  const pw = r.add(r.make('input', { attrs: { type: 'password', name: 'password' } }));
  box._v = 'old';
  r.run('content');
  assert.deepEqual(r.run('type', { id: 'c1', text: 'yo', first: true }), { typed: true });
  assert.equal(box.value, 'yo', 'the first piece replaces what was there');
  r.run('type', { id: 'c1', text: 'lo' });
  assert.equal(box.value, 'yolo');
  assert.ok(r.events.filter((e) => e[0] === 'input' && e[1] === 'insertText').length >= 2);
  // The fill after the last piece makes the field exact.
  assert.equal(r.run('fill', { id: 'c1', value: 'yolotask' }).typed, true);
  assert.equal(box.value, 'yolotask');
  assert.equal(pw.value, '');
  assert.equal(r.run('type', { id: 'c2', text: 'x', first: true }).error, 'secret_field');
  assert.equal(pw.value, '');
});
