// 0.11.5: the phone's page scripts for the chat model and for cookie banners, on a small fake DOM
// (apps/android/app/src/main/assets/saga): consent.js runs Consent-O-Matic's rules (vendor/consent-o-matic, MIT) in
// passes the way SagaTools.kt clearConsent does (detectors only, then the one rule, resumed after each click or
// wait), rejecting everything; summary.js reads the page with the vendored Readability and Turndown (stubbed here:
// the fake DOM is no HTML parser) and numbers the clickable items, <main> first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { node, page, matches } = require('../helpers/fake-dom');

const DIR = path.resolve(__dirname, '../../../../apps/android/app/src/main/assets/saga');
const CONSENT = fs.readFileSync(path.join(DIR, 'consent.js'), 'utf8');
const SUMMARY = fs.readFileSync(path.join(DIR, 'summary.js'), 'utf8');
const VENDOR = path.join(DIR, 'vendor');

function rig(root, o = {}) {
  const p = page(root, o);
  const all = () => [p.document.body, ...p.all()];
  all().forEach((el) => {
    el.closest = (sel) => { for (let x = el; x; x = x.parentElement) if (matches(x, sel)) return x; return null; };
    if (el.offsetHeight === undefined) el.offsetHeight = el.rect.height;
  });
  const ctx = vm.createContext({ document: p.document, window: p.window, location: p.window.location, JSON });
  p.window.top = p.window;
  return { ...p, ctx, fn: (src) => vm.runInContext(src, ctx) };
}
const detach = (el) => { const k = el.parentElement.kids; k.splice(k.indexOf(el), 1); el.parentElement = null; };
const attach = (parent, el) => { el.parentElement = parent; parent.kids.push(el); };

// A consent platform: a banner with "Cookie settings"; the settings panel shows up a moment after the click with an
// analytics checkbox (on) and "Save choices", which closes everything.
function demo() {
  const clicks = [];
  const analytics = Object.assign(node('input', { attrs: { type: 'checkbox', 'data-cat': 'analytics' } }),
    { checked: true });
  analytics.click = () => { clicks.push('analytics'); analytics.checked = !analytics.checked; };
  const save = node('button', { attrs: { 'data-act': 'save' }, text: 'Save choices' });
  const panel = node('div', { attrs: { 'data-cmp': 'panel' }, kids: [analytics, save] });
  const settings = node('button', { attrs: { 'data-act': 'settings' }, text: 'Cookie settings' });
  const banner = node('div', { attrs: { 'data-cmp': 'banner' }, rect: { left: 0, top: 600, width: 400, height: 200 },
    kids: [node('p', { text: 'We use cookies' }), settings] });
  const body = node('body', { kids: [node('main', { kids: [node('h1', { text: 'News' })] }), banner] });
  let pending = 0;
  settings.click = () => { clicks.push('settings'); pending = 2; };          // the panel needs two ticks
  save.click = () => { clicks.push('save'); detach(banner); };
  const tick = () => { if (pending && --pending === 0) { attach(banner, panel); panel.offsetHeight = 100; } };
  return { body, clicks, tick, analytics };
}
const RULES = { demo: {
  detectors: [{ presentMatcher: { type: 'css', target: { selector: 'div[data-cmp=banner]' } },
    showingMatcher: { type: 'css', target: { selector: 'div[data-cmp=banner]', displayFilter: true } } }],
  methods: {
    OPEN_OPTIONS: { type: 'click', target: { selector: 'button[data-act=settings]' } },
    DO_CONSENT: { type: 'list', actions: [
      { type: 'waitcss', target: { selector: 'div[data-cmp=panel]' }, retries: 5, waitTime: 100 },
      { type: 'consent', consents: [{ type: 'B', matcher: { type: 'checkbox', target: {
        selector: 'input[data-cat=analytics]' } }, toggleAction: { type: 'click', target: {
        selector: 'input[data-cat=analytics]' } } }] }] },
    SAVE_CONSENT: { type: 'ifcss', target: { selector: 'button[data-act=save]' },
      trueAction: { type: 'click', target: { selector: 'button[data-act=save]' } },
      falseAction: { type: 'click', target: { selector: 'button[data-act=reject]' } } } } } };
const detectorsOnly = (rules) => Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, { detectors:
  v.detectors }]));

// SagaTools.clearConsent, in JavaScript: detectors, then the rule, resumed on every wait (at most 20 rounds).
function clear(r, rules, tick = () => {}) {
  const consent = r.fn(CONSENT);
  let out = JSON.parse(consent(detectorsOnly(rules), {}));
  if (out.state !== 'found') return { out, rounds: 0 };
  const name = out.cmp;
  let resume = { cmp: name }, rounds = 0;
  for (;;) {
    out = JSON.parse(consent({ [name]: rules[name] }, resume));
    if (out.state !== 'wait' || ++rounds > 20) return { out, rounds };
    tick();
    resume = out.resume;
  }
}

test('consent.js: a known banner is rejected (every category off, then saved), each click once, no model call', () => {
  const d = demo();
  const r = rig(d.body);
  const { out, rounds } = clear(r, RULES, d.tick);
  assert.deepEqual(out, { state: 'done', cmp: 'demo', cleared: true, clicks: 3 });
  assert.deepEqual(d.clicks, ['settings', 'analytics', 'save']);      // replays never click again
  assert.equal(d.analytics.checked, false);
  assert.ok(rounds >= 4, `waited for the panel (${rounds} rounds)`);
  assert.equal(r.document.querySelector('div[data-cmp=banner]'), null);
});

test('consent.js: no known banner -> none; a hidden banner is not "showing"; a broken rule never throws', () => {
  const plain = rig(node('body', { kids: [node('main', { text: 'Hello' })] }));
  assert.deepEqual(clear(plain, RULES).out, { state: 'none' });
  const d = demo();
  const r = rig(d.body);
  r.document.querySelector('div[data-cmp=banner]').offsetHeight = 0;
  assert.equal(clear(r, RULES).out.state, 'none');
  const bad = { bad: { detectors: [{ presentMatcher: { type: 'css', target: { selector: 'div[[[' } } }] } };
  assert.equal(clear(rig(demo().body), bad).out.state, 'none');
});

test('vendored: each library keeps its LICENSE; the curated Consent-O-Matic rules only reject', () => {
  for (const [dir, lic] of [['readability', 'LICENSE.md'], ['turndown', 'LICENSE'], ['consent-o-matic', 'LICENSE']]) {
    assert.ok(fs.existsSync(path.join(VENDOR, dir, lic)), dir);
  }
  assert.match(fs.readFileSync(path.join(VENDOR, 'readability', 'LICENSE.md'), 'utf8'), /Apache License/);
  assert.match(fs.readFileSync(path.join(VENDOR, 'turndown', 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(path.join(VENDOR, 'consent-o-matic', 'LICENSE'), 'utf8'), /MIT License/);
  const j = JSON.parse(fs.readFileSync(path.join(VENDOR, 'consent-o-matic', 'rules.json'), 'utf8'));
  assert.ok(j.count >= 40 && j.count === Object.keys(j.rules).length);
  for (const [name, rule] of Object.entries(j.rules)) {
    assert.ok(Array.isArray(rule.detectors) && rule.detectors.length, name);
    for (const m of Object.keys(rule.methods)) {
      assert.ok(['OPEN_OPTIONS', 'DO_CONSENT', 'SAVE_CONSENT'].includes(m) || /runmethod/.test(JSON.stringify(
        rule.methods)), `${name}.${m}`);
    }
    assert.doesNotMatch(JSON.stringify(rule.methods), /"type":"(?:slide|close|runrooted)"/, name);
  }
  // Readability and Turndown load in one function scope, as SagaTools.read wraps them: nothing on the global.
  const ctx = vm.createContext({});
  const kinds = vm.runInContext(`(function(){\n${fs.readFileSync(path.join(VENDOR, 'readability', 'Readability.js'),
    'utf8')}\n${fs.readFileSync(path.join(VENDOR, 'turndown', 'turndown.js'), 'utf8')}\nreturn [typeof Readability, `
    + 'typeof TurndownService];\n})()', ctx);
  assert.deepEqual([...kinds], ['function', 'function']);
  assert.equal(ctx.Readability, undefined);
  assert.equal(ctx.TurndownService, undefined);
});

function shop() {
  const a = (text, href, extra = {}) => node('a', { attrs: { href, ...extra }, text, rect: { left: 0, top: 10,
    width: 200, height: 20 } });
  const item = (t, h, extra) => Object.assign(a(t, h, extra), { href: h });
  const body = node('body', { kids: [
    node('header', { kids: [item('Jumia home', 'https://www.jumia.com.ng/'),
      item('Account', 'https://www.jumia.com.ng/customer/')] }),
    node('main', { text: 'Results for phones', kids: [
      item('Tecno Spark 30 Pro', 'https://www.jumia.com.ng/tecno-spark-30-pro.html'),
      item('Infinix Smart 20', 'https://www.jumia.com.ng/infinix-smart-20.html'),
      Object.assign(node('input', { attrs: { type: 'password' } }), { value: 'secret' }),
      item('Hidden one', 'https://www.jumia.com.ng/x', { hidden: '' }),
      node('button', { text: 'Load more', rect: { left: 0, top: 500, width: 100, height: 30 } })] })] });
  return body;
}
const STUB_R = function () { this.parse = () => null; };
function STUB_T() { this.remove = () => {}; this.addRule = () => {}; this.turndown = (h) => `MD:${h}`; }

test('summary.js: the main text, the clickable items numbered <main> first, header last, no secrets', () => {
  const r = rig(shop(), { url: 'https://www.jumia.com.ng/catalog/?q=phones', title: 'Phones | Jumia' });
  const out = JSON.parse(r.fn(SUMMARY)(STUB_R, STUB_T, { max: 1500 }));
  assert.equal(out.url, 'https://www.jumia.com.ng/catalog/?q=phones');
  assert.match(out.summary, /Results for phones/);
  assert.doesNotMatch(JSON.stringify(out), /secret/);
  assert.deepEqual(out.items.map((x) => x.text), ['Tecno Spark 30 Pro', 'Infinix Smart 20', 'Load more',
    'Jumia home', 'Account']);
  assert.equal(out.items[1].href, 'https://www.jumia.com.ng/infinix-smart-20.html');
  assert.equal(out.items[2].kind, 'button');
});

test('summary.js: an article goes through Readability and Turndown, capped at about 1,500 characters', () => {
  const r = rig(shop());
  r.document.cloneNode = () => r.document;
  const R = function () {
    this.parse = () => ({ title: 'Big story', content: '<p>x</p>', textContent: 'y'.repeat(900) });
  };
  function T() { this.remove = () => {}; this.addRule = () => {}; this.turndown = () => 'word '.repeat(800); }
  const out = JSON.parse(r.fn(SUMMARY)(R, T, {}));
  assert.ok(out.summary.startsWith('# Big story\n\nword word'));
  assert.ok(out.summary.length <= 1500, String(out.summary.length));
  assert.ok(out.summary.endsWith('…'));
});
