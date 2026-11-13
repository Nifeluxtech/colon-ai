// Secret forms (Phase 10): Saga never fills passwords, one-time / 2FA codes, card numbers or CVV, PINs, sign-in pages
// or payment pages (modules/saga/secrets.js), the phone's script agrees on every field (assets/saga/tools.js), the
// sign-in host list matches the app's (UrlRules.kt), and page snapshots reach the model redacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const secrets = require('../../src/modules/saga/secrets');
const tools = require('../../src/modules/saga/tools');
const prompt = require('../../src/modules/saga/prompt');
const safety = require('../../src/modules/safety');

const ROOT = path.resolve(__dirname, '../../../..');
const TOOLS_JS = fs.readFileSync(path.join(ROOT, 'apps/android/app/src/main/assets/saga/tools.js'), 'utf8');
const phoneTools = eval(TOOLS_JS); // eslint-disable-line no-eval -- the app's own script, as the WebView runs it
const phoneKind = (d) => JSON.parse(phoneTools('secret', { descriptor: d })).secret;

const FIELDS = [
  [{ tag: 'input', type: 'password', name: 'pw' }, 'password'],
  [{ tag: 'input', type: 'text', autocomplete: 'current-password' }, 'password'],
  [{ tag: 'input', name: 'user_password' }, 'password'],
  [{ tag: 'input', type: 'text', autocomplete: 'one-time-code' }, 'one_time_code'],
  [{ tag: 'input', name: 'otp' }, 'one_time_code'],
  [{ tag: 'input', name: 'otpCode', inputmode: 'numeric' }, 'one_time_code'],
  [{ tag: 'input', label: 'Enter the 2FA code' }, 'one_time_code'],
  [{ tag: 'input', label: 'Verification code', maxlength: 6 }, 'one_time_code'],
  [{ tag: 'input', label: 'Enter code', maxlength: 6 }, 'one_time_code'],
  [{ tag: 'input', autocomplete: 'cc-number' }, 'card'],
  [{ tag: 'input', autocomplete: 'billing cc-csc' }, 'card'],
  [{ tag: 'input', name: 'cardNumber' }, 'card'],
  [{ tag: 'input', name: 'cvv' }, 'card'],
  [{ tag: 'input', placeholder: 'CVC' }, 'card'],
  [{ tag: 'input', label: 'Expiry date' }, 'card'],
  [{ tag: 'input', name: 'transactionPin' }, 'pin'],
  [{ tag: 'input', label: 'Enter your 4-digit PIN' }, 'pin'],
  [{ tag: 'input', label: 'Passcode' }, 'pin'],
  // Not secret: ordinary fields, buttons, links, and look-alike words.
  [{ tag: 'input', name: 'q', label: 'Search' }, null],
  [{ tag: 'input', name: 'email', type: 'email' }, null],
  [{ tag: 'input', name: 'shipping_address' }, null],
  [{ tag: 'input', label: 'Name on card' }, null],
  [{ tag: 'input', label: 'Gift card code' }, null],
  [{ tag: 'input', label: 'Promo code' }, null],
  [{ tag: 'input', label: 'Postal code', maxlength: 10 }, null],
  [{ tag: 'a', text: 'Forgot password?', href: 'https://x.ng/forgot' }, null],
  [{ tag: 'button', text: 'Pay with card', type: 'submit' }, null],
  [{ tag: 'input', type: 'submit', name: 'password_submit' }, null],
];

test('fieldKind: passwords, codes, cards and PINs are secret; ordinary fields are not', () => {
  for (const [el, want] of FIELDS) assert.equal(secrets.fieldKind(el), want, JSON.stringify(el));
});

test('the phone script (tools.js) classifies every field exactly like the server', () => {
  for (const [el] of FIELDS) assert.equal(phoneKind(el), secrets.fieldKind(el), JSON.stringify(el));
});

test('pageKind: the app\'s sign-in hosts, sign-in paths and hosted payment pages', () => {
  assert.equal(secrets.pageKind('https://accounts.google.com/v3/signin'), 'sign_in');
  assert.equal(secrets.pageKind('https://ibank.gtbank.com/'), 'sign_in');
  assert.equal(secrets.pageKind('https://www.jumia.com.ng/customer/account/login/'), 'sign_in');
  assert.equal(secrets.pageKind('https://x.ng/auth/verify-otp'), 'sign_in');
  assert.equal(secrets.pageKind('https://checkout.paystack.com/abc123'), 'payment');
  assert.equal(secrets.pageKind('https://www.paypal.com/checkoutnow?token=x'), 'payment');
  assert.equal(secrets.pageKind('https://shop.ng/checkout/card'), 'payment');
  assert.equal(secrets.pageKind('https://punchng.com/how-to-login-safely/'), null);
  assert.equal(secrets.pageKind('https://www.paypal.com/ng/home'), null);
  assert.equal(secrets.pageKind('not a url'), null);
});

test('the server\'s sign-in hosts are the app\'s Custom Tab sign-in hosts (UrlRules.kt)', () => {
  const kt = fs.readFileSync(path.join(ROOT, 'apps/android/app/src/main/kotlin/ng/nifelux/colonai/UrlRules.kt'),
    'utf8');
  const block = (name) => [...kt.split(`val ${name}: Set<String> = setOf(`)[1].split(')')[0]
    .matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const app = [...block('GOOGLE_SIGNIN_HOSTS'), ...block('BANK_SIGNIN_HOSTS')].sort();
  assert.deepEqual([...secrets.SIGN_IN_HOSTS].sort(), app);
});

test('check: fill or click on a secret field, typing on sign-in / payment pages or secret forms', () => {
  const els = new Map([['c1', { tag: 'input', type: 'password', label: 'Password' }],
    ['c2', { tag: 'input', type: 'email', label: 'Email', form_secret: 'password' }],
    ['c3', { tag: 'input', label: 'Search' }], ['c4', { tag: 'button', text: 'Log in', type: 'submit' }],
    ['c5', { tag: 'input', label: 'One-time code', secret: 'one_time_code' }]]);
  const cmd = (a, args) => tools.toCommand(a, args, { elements: els });
  let s = secrets.check(cmd('fill', { id: 'c1', value: 'hunter2' }), { elements: els, url: 'https://x.ng/' });
  assert.equal(s.kind, 'password');
  assert.equal(s.message, 'Enter your password here, then tap Return to AI.');
  assert.equal(secrets.check(cmd('click', { id: 'c1' }), { elements: els }).kind, 'password');
  assert.equal(secrets.check(cmd('fill', { id: 'c5', value: '1' }), { elements: els }).kind, 'one_time_code');
  assert.equal(secrets.check(cmd('fill', { id: 'c2', value: 'a@b.ng' }), { elements: els }).kind, 'password');
  assert.equal(secrets.check(cmd('fill', { id: 'c3', value: 'rice' }), { elements: els, url: 'https://x.ng/' }), null);
  // On a sign-in or payment page nothing is typed, even into an ordinary field.
  assert.equal(secrets.check(cmd('fill', { id: 'c3', value: 'x' }), { elements: els,
    url: 'https://checkout.paystack.com/x' }).kind, 'payment');
  assert.equal(secrets.check(cmd('fill', { id: 'c3', value: 'x' }), { elements: els,
    url: 'https://jumia.com.ng/customer/account/login/' }).kind, 'sign_in');
  // Clicking the form's button is not typing a secret (it still needs its form-submission approval).
  assert.equal(secrets.check(cmd('click', { id: 'c4' }), { elements: els }), null);
  // Opening the app's sign-in hosts is the user's job; reading a payment page is not refused.
  assert.equal(secrets.check(cmd('openUrl', { url: 'https://accounts.google.com/' })).kind, 'sign_in');
  assert.equal(secrets.check(cmd('openUrl', { url: 'https://checkout.paystack.com/x' })), null);
  assert.equal(secrets.check(cmd('scroll', { direction: 'down' })), null);
});

test('redactContent: secret elements lose their text, typed values never pass, codes and cards are hidden', () => {
  const r = secrets.redactContent({ url: 'https://bank.ng/otp', title: 'Your OTP is 552019',
    text: 'We sent the code 482913 to 0803… Card 4111 1111 1111 1111 on file. Total ₦12,500.',
    elements: [{ id: 'c1', tag: 'input', label: 'OTP', placeholder: 'e.g. 123456', value: '552019' },
      { id: 'c2', tag: 'input', label: 'Search', value: 'my secret search' },
      { id: 'c3', tag: 'button', text: 'Verify' }] });
  assert.equal(r.elements[0].secret, 'one_time_code');
  assert.equal(r.elements[0].text, '');
  assert.equal(r.elements[0].placeholder, 'e.g. ••••••');
  assert.ok(r.elements.every((e) => !('value' in e)));
  assert.doesNotMatch(r.text, /482913|4111 1111/);
  assert.match(r.text, /₦12,500/);
  assert.doesNotMatch(r.title, /552019/);
  // The observation the model reads marks the field as the user's.
  const els = new Map();
  const ob = prompt.observe({ tool: 'getPageContent', name: 'get_page_content' }, { ok: true, result: r },
    { guard: safety.collector(), pages: [], id: 'n1' });
  for (const [k, v] of ob.elements) els.set(k, v);
  assert.match(ob.text, /c1: input "OTP" \(secret: the user types this, never you\)/);
  assert.equal(els.get('c1').secret, 'one_time_code');
  assert.doesNotMatch(ob.text, /552019|482913/);
});

// A tiny DOM for the phone script: a sign-in form with a password field.
function signInPage() {
  const events = [];
  const form = { querySelectorAll: () => fields };
  const mk = (tag, attrs, text = '') => {
    const a = { ...attrs };
    return { tagName: tag.toUpperCase(), textContent: text, value: '', type: a.type || '', id: a.id || '', form,
      href: '', disabled: false, isContentEditable: false, getAttribute: (k) => (k in a ? a[k] : null),
      setAttribute: (k, v) => { a[k] = String(v); }, removeAttribute: (k) => { delete a[k]; }, has: (k) => k in a,
      closest: () => null, getBoundingClientRect: () => ({ width: 10, height: 10 }), scrollIntoView() {},
      focus() { events.push(['focus', tag]); }, click() { events.push(['click', text]); },
      dispatchEvent: (e) => { events.push([e.type]); return true; } };
  };
  const fields = [mk('input', { type: 'email', name: 'email', id: 'email' }),
    mk('input', { type: 'password', name: 'password', id: 'pw', placeholder: 'Password' })];
  const button = mk('button', { type: 'submit' }, 'Log in');
  const els = [...fields, button];
  const document = { title: 'Sign in', body: { innerText: 'Sign in to your account' },
    documentElement: { scrollHeight: 900 },
    querySelectorAll: (sel) => (sel.startsWith('[data-colon-saga]') ? els.filter((e) => e.has('data-colon-saga'))
      : sel === 'a[href]' ? [] : els),
    querySelector: (sel) => { const m = /="(c\d+)"/.exec(sel); return m ? els.find((e) => e.getAttribute(
      'data-colon-saga') === m[1]) || null : null; } };
  const window = { location: { href: 'https://shop.ng/account' }, innerHeight: 800, scrollY: 0,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), Event: function E(t) {
      this.type = t; }, KeyboardEvent: function K(t) { this.type = t; },
    HTMLInputElement: { prototype: {} }, HTMLTextAreaElement: { prototype: {} }, HTMLSelectElement: { prototype: {} } };
  return { document, window, events };
}

test('tools.js: content marks secret fields, inspect reports them, click / fill refuse them', () => {
  const p = signInPage();
  const run = new Function('document', 'window', `return (${TOOLS_JS});`)(p.document, p.window); // eslint-disable-line
  const content = JSON.parse(run('content', {}));
  const [email, pw, btn] = content.elements;
  assert.equal(pw.secret, 'password');
  assert.equal(pw.form_secret, 'password');
  assert.equal(email.secret, undefined);
  assert.equal(email.form_secret, 'password');
  assert.equal(btn.secret, undefined);
  assert.equal(JSON.parse(run('inspect', { id: pw.id, action: 'fill' })).secret, 'password');
  assert.equal(JSON.parse(run('inspect', { id: email.id, action: 'fill' })).secret, 'password');
  assert.equal(JSON.parse(run('inspect', { id: btn.id, action: 'click' })).secret, null);
  assert.deepEqual(JSON.parse(run('fill', { id: pw.id, value: 'hunter2' })), { error: 'secret_field',
    kind: 'password' });
  assert.deepEqual(JSON.parse(run('fill', { id: email.id, value: 'a@b.ng' })), { error: 'secret_field',
    kind: 'password' });
  assert.deepEqual(JSON.parse(run('click', { id: pw.id })), { error: 'secret_field', kind: 'password' });
  assert.equal(p.events.filter((e) => e[0] === 'input').length, 0, 'nothing was typed');
  assert.equal(JSON.parse(run('click', { id: btn.id })).title, 'Sign in');
});
