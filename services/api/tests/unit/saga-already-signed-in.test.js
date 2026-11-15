// 0.11.4 (owner's report on 0.11.3: "Login to GitHub" with github.com already signed in, the dashboard saying "Good
// evening, Nifeluxtech!", ended with "Saga needs you: Your saved login didn't get you in here"). Any site: a page that
// shows a signed-in account ends a sign-in as done with no hand-over; no sign-in form is not a failed saved login;
// "your saved login didn't get you in" only while a password / code field is on the page. Scripted model and phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const saved = require('../../src/modules/saga/saved-login');
const signed = require('../../src/modules/saga/signed-in');
const goal = require('../../src/modules/saga/goal');

console.log = () => {};
const LIMITS = { maxSteps: 12, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const CAPS = ['open_url', 'get_page_content', 'click', 'fill', 'get_page_state', 'sign_in'];
const J = (o) => JSON.stringify(o);
const text = (msgs) => msgs.map((m) => m.content).join('\n');

// Signed-in pages on four sites (what the phone's getPageContent returns).
const SIGNED = {
  github: { goal: 'Login to GitHub', who: 'Nifeluxtech', site: 'github.com', page: { url: 'https://github.com/',
    title: 'GitHub', text: 'Dashboard\nGood evening, Nifeluxtech!\nTop repositories\nNifeluxtech/colon-ai',
    elements: [{ id: 'c1', tag: 'button', label: 'Open user navigation menu' },
      { id: 'c2', tag: 'a', text: 'Nifeluxtech/colon-ai', href: 'https://github.com/Nifeluxtech/colon-ai' }] } },
  jumia: { goal: 'Sign in to Jumia', who: 'Oluwanifemi', site: 'jumia.com.ng', page: {
    url: 'https://www.jumia.com.ng/customer/account/index/', title: 'My Account | Jumia Nigeria',
    text: 'Hi, Oluwanifemi\nMy Jumia Account\nOrders\nInbox', elements: [{ id: 'c1', tag: 'a', text: 'My Account' },
      { id: 'c2', tag: 'a', text: 'Orders' }, { id: 'c3', tag: 'button', text: 'Logout' }] } },
  yolotask: { goal: 'log into yolotask.com.ng', who: 'Nifesco', site: 'yolotask.com.ng', page: {
    url: 'https://yolotask.com.ng/dashboard', title: 'Dashboard - YOLOTASK', text: 'Welcome back, Nifesco!\nWallet',
    elements: [{ id: 'c1', tag: 'a', text: 'Tasks' }, { id: 'c2', tag: 'a', text: '', href: '/logout' }] } },
  google: { goal: 'Login to my Google account', who: 'Oluwanifemi Olude', site: 'myaccount.google.com', page: {
    url: 'https://myaccount.google.com/', title: 'Google Account', text: 'Home\nPersonal info\nSecurity',
    elements: [{ id: 'c1', tag: 'a', label: 'Google Account: Oluwanifemi Olude (oluwanifemiolude682@gmail.com)' },
      { id: 'c2', tag: 'a', text: 'Sign out' }] } },
};
const LOGIN = { url: 'https://github.com/login', title: 'Sign in to GitHub', text: 'Sign in',
  elements: [{ id: 'c1', tag: 'input', type: 'text', label: 'Username', form: true, form_secret: 'password' },
    { id: 'c2', tag: 'input', type: 'password', label: 'Password', form: true, secret: 'password' }] };
const JUMIA_OUT = { url: 'https://www.jumia.com.ng/', title: 'Jumia Nigeria', text: 'Welcome to Jumia!\nAccount',
  elements: [{ id: 'c1', tag: 'button', text: 'Account' }, { id: 'c2', tag: 'a', text: 'Sign In' }] };

function rig(o) {
  const calls = [], handoffs = [], seen = [];
  let signIns = 0, reads = 0;
  const pages = o.pages;
  const command = async (name, args) => {
    calls.push({ name, args });
    if (name === 'sign_in') return (o.signIn || [{ ok: false, error: 'no_form' }])[signIns++]
      || { ok: false, error: 'no_form' };
    if (name === 'get_page_content') return { ok: true, result: pages[Math.min(reads++, pages.length - 1)] };
    if (name === 'get_page_state') return { ok: true, result: { loading: false } };
    return { ok: true, result: {} };
  };
  const decide = async (m) => { seen.push(m); return J(o.replies[Math.min(seen.length - 1, o.replies.length - 1)]); };
  const go = () => run({ goal: o.goal, limits: LIMITS, isStopped: async () => false, decide, command, caps: CAPS,
    autoRead: true, log: async () => {}, takeNote: () => '',
    handoff: async (info) => { handoffs.push(info); return 'return_to_ai'; } });
  return { calls, handoffs, seen, go };
}
const READ = { say: 'Reading', action: 'getPageContent', args: {} };
const SIGN_IN = (site) => ({ say: 'Signing in', action: 'signIn', args: { site } });
const ASK = { say: 'Sign in needed', action: 'requestUserControl', args: { reason: 'sign_in' } };
const FIN = { say: 'Done', action: 'finish', args: { answer: 'Done.' } };

test('detect: signed-in pages on GitHub, Jumia, yolotask.com.ng and Google, with the account name', () => {
  for (const [k, c] of Object.entries(SIGNED)) {
    const d = signed.detect(c.page);
    assert.equal(d.state, 'signed_in', k);
    assert.equal(d.who, c.who, k);
  }
});

test('detect: sign-in forms, code pages and signed-out pages are never "signed in"', () => {
  assert.equal(signed.detect(LOGIN).state, 'secret');
  assert.equal(signed.detect({ url: 'https://github.com/sessions/two-factor', text: 'Welcome back, Nife!',
    elements: [{ id: 'c1', tag: 'input', autocomplete: 'one-time-code', label: 'Code' }] }).kind, 'one_time_code');
  assert.equal(signed.detect({ url: 'https://accounts.google.com/signin/v2/identifier', title: 'Sign in',
    elements: [{ id: 'c1', tag: 'input', type: 'email', autocomplete: 'username' }] }).state, 'sign_in_page');
  assert.equal(signed.detect(JUMIA_OUT).state, 'unknown');
  assert.equal(signed.detect({ url: 'https://example.ng/', text: 'Hello there! Welcome to Example.',
    elements: [{ id: 'c1', tag: 'a', text: 'Log in' }] }).state, 'unknown');
  assert.equal(signed.detect(null).state, 'unknown');
});

test('"Login to <site>" while already signed in: done with no hand-over, no saved login (4 sites)', async () => {
  for (const c of Object.values(SIGNED)) {
    const r = rig({ goal: c.goal, pages: [c.page], replies: [READ, SIGN_IN(c.site), ASK, FIN] });
    const out = await r.go();
    assert.equal(out.status, 'done', c.site);
    assert.equal(out.answer, `You're already signed in to ${c.site} as ${c.who}.`);
    assert.equal(r.handoffs.length, 0, c.site);
    assert.ok(!r.calls.some((x) => x.name === 'sign_in'), c.site);
  }
});

test('the 0.11.3 report replayed: signIn on the dashboard (no form) -> already signed in, never AFTER_TRY',
  async () => {
    const c = SIGNED.github;
    const r = rig({ goal: c.goal, pages: [c.page], replies: [SIGN_IN('github.com'), ASK, FIN] });
    const out = await r.go();
    assert.equal(out.status, 'done');
    assert.equal(out.answer, 'You\'re already signed in to github.com as Nifeluxtech.');
    assert.equal(r.calls.filter((x) => x.name === 'sign_in').length, 1);
    assert.equal(r.handoffs.length, 0);
  });

test('requestUserControl for a sign-in on a signed-in page, the task goes on: no hand-over, Saga is told', async () => {
  for (const c of Object.values(SIGNED)) {
    const r = rig({ goal: `Log in to ${c.site} and open my orders`, pages: [c.page], replies: [READ, ASK, FIN] });
    const out = await r.go();
    assert.equal(out.status, 'done', c.site);
    assert.equal(r.handoffs.length, 0, c.site);
    assert.match(text(r.seen[2]), new RegExp(`You're already signed in to ${c.site.replace(/\./g, '\\.')}`));
    assert.ok(!r.calls.some((x) => x.name === 'sign_in'), c.site);
  }
});

test('a real login form: the saved login first, no hand-over when it gets Saga in', async () => {
  const r = rig({ goal: 'Login to GitHub', pages: [LOGIN, SIGNED.github.page], signIn: [{ ok: true,
    result: { submitted: true } }], replies: [READ, SIGN_IN('github.com'), FIN] });
  const out = await r.go();
  assert.equal(out.status, 'done');
  assert.equal(r.calls.filter((x) => x.name === 'sign_in').length, 1);
  assert.equal(r.handoffs.length, 0);
});

test('a real login form the saved login could not clear: then (only then) the hand-over says so', async () => {
  const r = rig({ goal: 'Login to GitHub', pages: [LOGIN, LOGIN], signIn: [{ ok: true, result: { submitted: true } }],
    replies: [READ, SIGN_IN('github.com'), ASK, FIN] });
  await r.go();
  assert.deepEqual(r.handoffs.map((h) => h.kind), ['sign_in']);
  assert.equal(r.handoffs[0].message, saved.AFTER_TRY);
});

test('signed out, no form on the page: no failed-login hand-over; Saga is sent to the sign-in page', async () => {
  const r = rig({ goal: 'Sign in to Jumia', pages: [JUMIA_OUT], replies: [READ, SIGN_IN('jumia.com.ng'), ASK, ASK,
    ASK, FIN] });
  await r.go();
  const seen = text(r.seen.at(-1));
  assert.match(seen, /signIn found no sign-in form on this page/);
  assert.match(seen, /Not handed to the user: this page has no password or code field/);
  // After MAX_NO_FIELD refusals a hand-over may happen, but never with "your saved login didn't get you in".
  assert.equal(r.handoffs.length, 1);
  assert.notEqual(r.handoffs[0].message, saved.AFTER_TRY);
  assert.equal(saved.handoffMessage('sign_in', 'https://www.jumia.com.ng/', new Set(['jumia.com.ng']), 'x', false),
    'x');
});

test('goal check: a sign-in goal is met on a signed-in page, even a "go to … and log in" one', () => {
  const page = { url: 'https://github.com/', title: 'GitHub' };
  assert.match(goal.check({ goal: 'Go to GitHub and log in', page, acted: 2 }), /sign-in page/);
  assert.equal(goal.check({ goal: 'Go to GitHub and log in', page, acted: 2, account: 'signed_in' }), null);
  assert.ok(signed.pureLogin('Login to GitHub', 'github.com'));
  assert.ok(!signed.pureLogin('Login to GitHub and open colon-ai', 'github.com'));
  assert.ok(signed.pureLogin('log into yolotask', 'yolotask.com.ng'));
});
