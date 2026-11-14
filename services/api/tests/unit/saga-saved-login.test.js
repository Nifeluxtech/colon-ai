// 0.11.2 (owner's request): before Saga hands a sign-in to the user it uses the login saved on the phone (Colon
// Secured Login, the same store the chat's login form card fills); with none saved it offers that form card first,
// and only when the user closes it, the site isn't trusted, or the login didn't get Saga in (a wrong password, a
// 2FA code) does "Take control" run. Scripted model and phone (modules/saga/loop.js + saved-login.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const saved = require('../../src/modules/saga/saved-login');

console.log = () => {};
const LIMITS = { maxSteps: 10, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const CAPS = ['open_url', 'get_page_content', 'click', 'fill', 'get_page_state', 'sign_in'];
const J = (o) => JSON.stringify(o);
const FIN = { say: 'Done', action: 'finish', args: { answer: 'Signed in.' } };
const LOGIN = { url: 'https://github.com/login', title: 'Sign in to GitHub', text: 'Sign in',
  elements: [{ id: 'c1', tag: 'input', type: 'text', label: 'Username', form: true, form_secret: 'password' },
    { id: 'c2', tag: 'input', type: 'password', label: 'Password', form: true, secret: 'password' }] };
const OTP = { ...LOGIN, url: 'https://github.com/sessions/two-factor', elements: [{ id: 'c3', tag: 'input',
  label: 'Authentication code', autocomplete: 'one-time-code' }] };
const text = (msgs) => msgs.map((m) => m.content).join('\n');

function model(replies) {
  const seen = [];
  return { seen, decide: async (m) => { seen.push(m);
    return J(replies[Math.min(seen.length - 1, replies.length - 1)]); } };
}
function rig(o = {}) {
  const calls = [], handoffs = [];
  let signIns = 0, reads = 0;
  const pages = o.pages || [LOGIN];
  const command = async (name, args) => {
    calls.push({ name, args });
    if (name === 'sign_in') return (o.signIn || [{ ok: true, result: { submitted: true } }])[signIns++]
      || { ok: false, error: 'no_login' };
    if (name === 'get_page_content') return { ok: true, result: pages[Math.min(reads++, pages.length - 1)] };
    if (name === 'get_page_state') return { ok: true, result: { loading: false } };
    if (o.phone && (name === 'fill' || name === 'click')) return o.phone(args);
    return { ok: true, result: {} };
  };
  const notes = [...(o.notes || [])];
  const m = model(o.replies || [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Typing the password', action: 'fill', args: { id: 'c2', value: 'x' } }, FIN]);
  const go = () => run({ goal: 'Sign in to GitHub', limits: LIMITS, isStopped: async () => false, decide: m.decide,
    command, caps: o.caps || CAPS, autoRead: true, log: async () => {},
    handoff: async (info, h) => { handoffs.push({ ...info, phoneStarted: h.phoneStarted });
      return o.back ? o.back(info) : 'return_to_ai'; },
    takeNote: () => notes.shift() || '' });
  return { calls, handoffs, m, go };
}
const names = (r) => r.calls.map((c) => c.name).filter((n) => n !== 'get_page_state');

test('a saved login is used before any hand-over: no Take control, the page is read after it', async () => {
  const r = rig();
  const out = await r.go();
  assert.equal(out.status, 'done');
  assert.deepEqual(names(r), ['get_page_content', 'sign_in', 'get_page_content']);
  assert.deepEqual(r.calls.find((c) => c.name === 'sign_in').args, { site: 'github.com' });
  assert.equal(r.handoffs.length, 0);
  assert.match(text(r.m.seen[2]), /Colon signed in on github\.com with the login the user saved/);
  assert.ok(!r.calls.some((c) => c.name === 'fill'));            // the password is never typed by Saga
});

test('no saved login: the Colon Secured Login form card first; saved -> Saga signs in with it', async () => {
  const r = rig({ signIn: [{ ok: false, error: 'no_login' }, { ok: true, result: {} }],
    notes: ['Login saved for github.com in Colon Secured Login'] });
  assert.equal((await r.go()).status, 'done');
  assert.deepEqual(r.handoffs.map((h) => h.kind), ['login']);
  assert.match(r.handoffs[0].message, /Save your github\.com login in Colon Secured Login/);
  assert.equal(r.calls.filter((c) => c.name === 'sign_in').length, 2);
});

test('the user closes the form without saving: then (and only then) Take control', async () => {
  const r = rig({ signIn: [{ ok: false, error: 'no_login' }], notes: ['I didn\'t save a login.'] });
  await r.go();
  assert.deepEqual(r.handoffs.map((h) => h.kind), ['login', 'password']);
  assert.equal(r.calls.filter((c) => c.name === 'sign_in').length, 1);
});

test('not trusted (or the wrong site, or a failed fill): straight to Take control, no form', async () => {
  for (const error of ['not_trusted', 'wrong_site', 'page_error']) {
    const r = rig({ signIn: [{ ok: false, error }] });
    await r.go();
    assert.deepEqual(r.handoffs.map((h) => h.kind), ['password'], error);
  }
});

test('the login was tried and the page still asks (wrong password, 2FA code): the user, once per site', async () => {
  const again = rig({ pages: [LOGIN, LOGIN], replies: [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Password', action: 'fill', args: { id: 'c2', value: 'x' } },
    { say: 'Password again', action: 'fill', args: { id: 'c2', value: 'x' } }, FIN] });
  await again.go();
  assert.equal(again.calls.filter((c) => c.name === 'sign_in').length, 1);
  assert.deepEqual(again.handoffs.map((h) => h.kind), ['password']);
  assert.equal(again.handoffs[0].message, saved.AFTER_TRY);
  const code = rig({ pages: [LOGIN, OTP], replies: [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Password', action: 'fill', args: { id: 'c2', value: 'x' } },
    { say: 'Code', action: 'fill', args: { id: 'c3', value: '123456' } }, FIN] });
  await code.go();
  assert.deepEqual(code.handoffs.map((h) => h.kind), ['one_time_code']);    // codes are never tried
});

test('a phone without sign_in, and codes / cards: the hand-over as before', async () => {
  const r = rig({ caps: CAPS.filter((c) => c !== 'sign_in') });
  await r.go();
  assert.ok(!r.calls.some((c) => c.name === 'sign_in'));
  assert.deepEqual(r.handoffs.map((h) => h.kind), ['password']);
  assert.equal(saved.eligible('card', 'https://pay.ng/', CAPS, new Set()), null);
  assert.equal(saved.eligible('password', 'http://plain.ng/login', CAPS, new Set()), null);  // https only
});

test('the phone found the password field: deferred -> saved login first; an older phone hands over itself',
  async () => {
    const replies = [{ say: 'Reading', action: 'getPageContent', args: {} },
      { say: 'Next', action: 'click', args: { id: 'c1' } }, FIN];
    const page = { ...LOGIN, elements: [{ id: 'c1', tag: 'button', text: 'Next' }] };
    const newer = rig({ replies, pages: [page], phone: (a) => ({ ok: false, error: 'secret_field',
      result: { kind: 'password', deferred: a.saved_login === true } }) });
    await newer.go();
    assert.equal(newer.calls.find((c) => c.name === 'click').args.saved_login, true);
    assert.equal(newer.calls.filter((c) => c.name === 'sign_in').length, 1);
    assert.equal(newer.handoffs.length, 0);
    const older = rig({ replies, pages: [page], phone: () => ({ ok: false, error: 'secret_field',
      result: { kind: 'password' } }) });
    await older.go();
    assert.ok(!older.calls.some((c) => c.name === 'sign_in'));
    assert.deepEqual(older.handoffs.map((h) => [h.kind, h.phoneStarted]), [['password', true]]);
  });

test('requestUserControl for a sign-in tries the saved login too; a form left unanswered ends the task', async () => {
  const replies = [{ say: 'Reading', action: 'getPageContent', args: {} },
    { say: 'Sign in needed', action: 'requestUserControl', args: { reason: 'sign_in' } }, FIN];
  const ok = rig({ replies });
  assert.equal((await ok.go()).status, 'done');
  assert.equal(ok.handoffs.length, 0);
  const gone = rig({ replies, signIn: [{ ok: false, error: 'no_login' }], back: () => 'timeout' });
  const out = await gone.go();
  assert.equal(out.status, 'interrupted');
  assert.equal(out.error, 'handoff_timeout');
});
