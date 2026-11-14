// Saga's goal check (modules/saga/goal.js, 0.10.6): a finish is checked against the page the browser is really on.
// The owner's report on 0.10.5: "Open browser and get to the GitHub login page" ended at once as "I have reached the
// GitHub login page." while the browser still showed another site, and the reply said "I finished browsing but have
// nothing to report". The model and the phone are scripted fakes; no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/modules/saga/loop');
const goal = require('../../src/modules/saga/goal');

console.log = () => {};
const LIMITS = { maxSteps: 8, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const J = (o) => JSON.stringify(o);
const GOAL = 'Open browser and get to the GitHub login page';
const FINISH = { say: 'I\'m opening the browser to take you to the GitHub login page.', action: 'finish',
  args: { result: 'I have reached the GitHub login page.' } };

function model(replies) {
  const seen = [];
  const decide = async (messages) => {
    seen.push(messages);
    const r = replies[Math.min(seen.length - 1, replies.length - 1)];
    return typeof r === 'string' ? r : J(r);
  };
  return { decide, seen };
}
function phone(map = {}) {
  const calls = [];
  return { calls, command: async (name, args) => { calls.push({ name, args }); return map[name] || { ok: true,
    result: {} }; } };
}
const go = (o) => run({ goal: GOAL, limits: LIMITS, isStopped: async () => false, ...o });

test('goal parsing: the site a "go to" goal names, and whether it asks for a sign-in page', () => {
  assert.deepEqual(goal.parseGoal(GOAL), { nav: true, host: 'github.com', login: true });
  assert.equal(goal.targetHost('open yolotask.com.ng dashboard'), 'yolotask.com.ng');
  assert.equal(goal.targetHost('Find the CBN exchange rate today'), '');
  assert.equal(goal.parseGoal('Summarise this page').nav, false);
  assert.ok(goal.sameSite('gist.github.com', 'github.com'));
  assert.ok(!goal.sameSite('notgithub.com', 'github.com'));
  assert.ok(goal.sameSite('twitter.com', 'x.com'));
});

test('check: the wrong site, a non-sign-in page and a finish with nothing done are refused; the right page passes',
  () => {
    const yolo = { url: 'https://yolotask.com.ng/dashboard/tasks', title: 'Tasks' };
    assert.match(goal.check({ goal: GOAL, page: yolo, acted: 0 }), /needs github\.com.*yolotask\.com\.ng/s);
    assert.match(goal.check({ goal: GOAL, page: null, acted: 0 }), /needs github\.com/);
    assert.match(goal.check({ goal: GOAL, page: { url: 'https://github.com/explore', title: 'Explore' }, acted: 1 }),
      /sign-in page/);
    assert.equal(goal.check({ goal: GOAL, page: { url: 'https://github.com/login', title: 'Sign in to GitHub' },
      acted: 1 }), null);
    // A task that names no site only needs something done (or a page seen) before it finishes.
    assert.match(goal.check({ goal: 'Find the CBN rate', page: null, acted: 0 }), /Not done yet/);
    assert.equal(goal.check({ goal: 'Find the CBN rate', page: { url: 'https://cbn.gov.ng/' }, acted: 1 }), null);
  });

test('loop: a finish before any navigation is sent back; Saga opens GitHub and the reply says what it did',
  async () => {
    const m = model([FINISH, { say: 'Opening GitHub\'s sign-in page', action: 'openUrl',
      args: { url: 'https://github.com/login' } }, { say: 'Done', action: 'finish',
      args: { result: 'Opened GitHub\'s sign-in page' } }]);
    const p = phone({ open_url: { ok: true, result: { url: 'https://github.com/login',
      title: 'Sign in to GitHub' } } });
    const rows = [];
    const r = await go({ decide: m.decide, command: p.command, log: async (e) => { rows.push(e); },
      pageState: () => ({ url: 'https://yolotask.com.ng/dashboard/tasks', title: 'Tasks', at: 1 }) });
    assert.equal(r.status, 'done');
    assert.deepEqual(p.calls.map((c) => c.name), ['open_url']);
    assert.ok(rows.some((x) => x.kind === 'error' && x.error === 'goal_not_met'), 'the early finish is logged');
    assert.match(m.seen[1].at(-1).content, /Not done yet: the task needs github\.com.*yolotask\.com\.ng/s);
    assert.equal(r.answer, 'Opened GitHub\'s sign-in page.', 'no "nothing to report": the result line instead');
    assert.ok(!/nothing to report/.test(r.answer));
  });

test('loop: a check that keeps refusing gives way after MAX_REFUSALS, so a task is never trapped', async () => {
  const m = model([FINISH]);
  const r = await go({ decide: m.decide, command: phone().command });
  assert.equal(r.status, 'done');
  assert.equal(r.steps, goal.MAX_REFUSALS + 1);
  assert.equal(r.answer, 'I have reached the GitHub login page.');
});

test('loop: with no written answer and no result line, the reply falls back to Saga\'s last step', async () => {
  const m = model([{ say: 'Opening GitHub sign-in', action: 'openUrl', args: { url: 'https://github.com/login' } },
    { action: 'finish', args: {} }]);
  const p = phone({ open_url: { ok: true, result: { url: 'https://github.com/login', title: 'Sign in to GitHub' } } });
  const r = await go({ decide: m.decide, command: p.command });
  assert.equal(r.status, 'done');
  assert.equal(r.answer, 'Opening GitHub sign-in.');
});
