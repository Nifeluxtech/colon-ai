// Unit tests for apps/chat/src/lib/saga-route.js (0.11.6): where a message typed while a Saga task is live goes.
// Owner's report: Saga waited on the Colon Secured Login form and "Login n", "Hi" got no reply at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../../../apps/chat/src/lib/saga-route.js');

const LOGIN = { kind: 'login', site: 'reviewer.yolotask.com.ng' };

test('no live task: not a Saga matter (the usual path)', () => {
  assert.equal(r.routeTyped('Hi', {}), null);
  assert.equal(r.routeTyped('continue', { task: null, waiting: LOGIN }), null);
});

test('Saga is working: every message steers its next step (guide)', () => {
  for (const t of ['use the cheaper one', 'Hi', 'continue', 'stop']) {
    assert.deepEqual(r.routeTyped(t, { task: '42', waiting: null }), { kind: 'guide' });
  }
});

test('Saga waits for a login: "Hi" and questions are a normal chat turn (a reply, never silence)', () => {
  for (const t of ['Hi', 'Hello Colon', 'why is it stuck?', 'what does Saga need?', 'login to github instead']) {
    assert.deepEqual(r.routeTyped(t, { task: '42', waiting: LOGIN }), { kind: 'chat', waiting: LOGIN }, t);
  }
});

test('Saga waits: login / try again / continue / I\'ve saved it resume it, with the user\'s words', () => {
  for (const t of ['login', 'Login', 'Log in', 'Login n', 'sign in', 'try again', 'Try again please', 'continue',
    'Continue.', 'ok, continue', 'I\'ve saved it', 'I have saved the login', 'saved', 'it\'s saved', 'done',
    'I\'ve logged in, continue', 'logged in', 'go ahead', 'resume', 'Saga, carry on']) {
    const out = r.routeTyped(t, { task: '42', waiting: LOGIN });
    assert.equal(out && out.kind, 'resume', t);
    assert.equal(out.note, t.trim());
  }
  // A hand-over or a pause resumes the same way.
  assert.equal(r.routeTyped('continue', { task: '42', waiting: { kind: 'user' } }).kind, 'resume');
  assert.equal(r.routeTyped('resume', { task: '42', waiting: { kind: 'paused' } }).kind, 'resume');
});

test('Saga waits: stop / cancel stop it', () => {
  for (const t of ['stop', 'Stop.', 'cancel', 'cancel the login', 'never mind', 'stop saga']) {
    assert.deepEqual(r.routeTyped(t, { task: '42', waiting: LOGIN }), { kind: 'stop' }, t);
  }
});

test('waitingOf: the app\'s card or the server\'s status, whichever knows first', () => {
  // The card already shows the request (needs_user, a login).
  assert.deepEqual(r.waitingOf({ state: 'needs_user', request: { kind: 'login' } }, null), { kind: 'login', site: '' });
  // The card is still "running" (the bug's race) but the server says Saga waits on the login form.
  assert.deepEqual(r.waitingOf({ state: 'running' }, { status: 'handoff', kind: 'login', site: 'x.ng' }),
    { kind: 'login', site: 'x.ng' });
  assert.deepEqual(r.waitingOf({ state: 'user_control', resumes: true }, { status: 'running' }),
    { kind: 'user', site: '' });
  assert.equal(r.waitingOf({ state: 'paused' }, null).kind, 'paused');
  assert.equal(r.waitingOf({ state: 'user_control', resumes: false }, null), null);   // an idle take-over
  assert.equal(r.waitingOf({ state: 'running' }, { status: 'running', kind: 'login' }), null);
  assert.equal(r.waitingOf(null, null), null);
  assert.match(r.guideNote(), /next step/);
});
