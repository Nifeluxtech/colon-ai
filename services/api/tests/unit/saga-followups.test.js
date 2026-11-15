// 0.11.3 (owner's report on 0.11.2, Developer mode): browser follow-ups went to the chat model, and Saga ended
// "Open the colon ai repository" after 1 step with "if you can see it, tap on it". Covers the server's follow-up
// guard (modules/chat/browse-follow.js) and the finish checks (modules/saga/goal.js) on several sites. No database;
// the model and the phone are scripted fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const follow = require('../../src/modules/chat/browse-follow');
const goal = require('../../src/modules/saga/goal');
const { run } = require('../../src/modules/saga/loop');

console.log = () => {};
const NOW = Date.parse('2026-11-15T00:00:00Z');
const at = (min) => new Date(NOW - min * 60000).toISOString();
const msgs = (extra) => [
  { id: 'u1', role: 'user', content: 'Login to GitHub', origin: 'browse', created_at: at(5) },
  { id: 'a1', role: 'assistant', content: 'You are already signed in.\n\n**How Saga browsed**\n1. x', origin: 'browse',
    created_at: at(4) },
  ...extra];

test('follow-ups on any site are recognised; code and explain requests stay chat', () => {
  for (const t of ['Go to Colon repo', 'Open the colon ai repository', 'Go to the repository named colon ai',
    'Open the browser and check', 'check', 'open the second result', 'click the first one', 'that one', 'next',
    'scroll down', 'add it to cart', 'Open the Infinix Smart 20 page', 'find the cheapest one', 'go to my earnings',
    'In the logged in GitHub account', 'on the jumia page', 'Saga, please open the third link']) {
    assert.ok(follow.followUp(t), t);
  }
  for (const t of ['Explain this code', 'Fix the bug in my function', 'What is a closure?', 'go ahead',
    'Review this pull request description for tone and grammar please, I want it to sound friendly', 'thanks',
    'Write me a Python function that reverses a list', 'hello']) {
    assert.ok(!follow.followUp(t), t);
  }
});

test('route: only after a recent browser turn in this chat; a fragment carries the previous message', () => {
  const u2 = { id: 'u2', role: 'user', content: 'Go to Colon repo', created_at: at(1) };
  assert.equal(follow.route(u2, msgs([u2]), NOW), 'Go to Colon repo');
  const u3 = { id: 'u3', role: 'user', content: 'In the logged in GitHub account', created_at: at(0) };
  assert.equal(follow.route(u3, msgs([u2, u3]), NOW), 'Go to Colon repo (In the logged in GitHub account)');
  // No browser turn in the chat (or only an old one): the chat model answers.
  assert.equal(follow.route(u2, [u2], NOW), '');
  const old = msgs([u2]).map((m) => ({ ...m, created_at: m.id === 'u2' ? m.created_at : at(60 * 24) }));
  assert.equal(follow.route(u2, old, NOW), '');
  // Attachments and ordinary messages stay chat.
  assert.equal(follow.route({ ...u2, attachments: [{ id: 'f' }] }, msgs([u2]), NOW), '');
  const q = { id: 'u4', role: 'user', content: 'Explain this code', created_at: at(0) };
  assert.equal(follow.route(q, msgs([q]), NOW), '');
});

test('goal.wantedName: the named thing on any site, loosely; nothing for results, domains and generic words', () => {
  assert.equal(goal.wantedName('Open the colon ai repository'), 'colonai');
  assert.equal(goal.wantedName('Go to the repository named colon ai'), 'colonai');
  assert.equal(goal.wantedName('Open the Infinix Smart 20 page on Jumia'), 'infinixsmart20');
  assert.equal(goal.wantedName('Open the earnings page on yolotask.com.ng'), 'earnings');
  for (const g of ['open the first result', 'open google.com', 'open the second result', 'check', 'go back',
    'open the dashboard']) assert.equal(goal.wantedName(g), '', g);
});

test('goal.check: the named page must be open (address or title); a search results page is not it', () => {
  const G = 'Open the colon ai repository';
  assert.match(goal.check({ goal: G, acted: 1, page: { url: 'https://github.com/', title: 'GitHub' } }),
    /Not done yet: the task asks for "colonai"/);
  assert.equal(goal.check({ goal: G, acted: 1, page: { url: 'https://github.com/Nifeluxtech/colon-ai',
    title: 'Nifeluxtech/colon-ai' } }), null);
  assert.ok(goal.check({ goal: G, acted: 1, page: { url: 'https://www.google.com/search?q=colon+ai',
    title: 'colon ai - Google Search' } }));
  const J = 'Open the Infinix Smart 20 page on Jumia';
  assert.equal(goal.check({ goal: J, acted: 2, page: { url: 'https://www.jumia.com.ng/infinix-smart-20-64gb-123.html',
    title: 'Infinix Smart 20' } }), null);
  assert.ok(goal.check({ goal: J, acted: 2, page: { url: 'https://www.jumia.com.ng/catalog/?q=infinix+smart+20',
    title: 'Infinix Smart 20 | Jumia' } }));
  const Y = 'Open the earnings page on yolotask.com.ng';
  assert.equal(goal.check({ goal: Y, acted: 1, page: { url: 'https://yolotask.com.ng/dashboard/earnings',
    title: 'Dashboard' } }), null);
});

test('goal.check: a finish that asks the user to tap, or only narrates, is sent back', () => {
  const page = { url: 'https://github.com/', title: 'GitHub' };
  for (const a of ['If you can see the repository on the screen, tap on it to open it.',
    'I am attempting to navigate to the "colon ai" repository.', 'Please click the repository you want.',
    'Could you provide the full URL?']) {
    assert.match(goal.check({ goal: 'Summarise what is new here', acted: 1, page, answer: a }) || '',
      /do not ask the user to tap/, a);
  }
  assert.equal(goal.check({ goal: 'Summarise what is new here', acted: 1, page,
    answer: 'I read your dashboard: 2 new pull requests.' }), null);
  assert.equal(goal.said({ say: 's', args: { answer: 'A', result: 'B' } }), 'A B');
  assert.equal(goal.said({ say: 's', args: {} }), 's');
});

const LIMITS = { maxSteps: 10, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
test('loop: "Open the colon ai repository" from the dashboard: a "tap it yourself" finish is refused, Saga clicks',
  async () => {
    const replies = [
      { say: 'Looking', action: 'finish', args: { answer: 'If you can see the repository, tap on it. Otherwise I will '
        + 'try to find it now.' } },
      { say: 'Opening Nifeluxtech/colon-ai from the sidebar', action: 'openUrl',
        args: { url: 'https://github.com/Nifeluxtech/colon-ai' } },
      { say: 'Done', action: 'finish', args: { result: 'Opened colon-ai', answer: 'I opened the colon-ai '
        + 'repository.' } }];
    let i = 0;
    const seen = [];
    const decide = async (messages) => { seen.push(messages); return JSON.stringify(replies[Math.min(i++, 2)]); };
    const calls = [];
    const command = async (name) => { calls.push(name); return { ok: true, result: name === 'open_url'
      ? { url: 'https://github.com/Nifeluxtech/colon-ai', title: 'Nifeluxtech/colon-ai' } : {} }; };
    const r = await run({ goal: 'Open the colon ai repository', limits: LIMITS, isStopped: async () => false, decide,
      command, pageState: () => ({ url: 'https://github.com/', title: 'GitHub', at: 1 }) });
    assert.equal(r.status, 'done');
    assert.equal(r.answer, 'I opened the colon-ai repository.');
    assert.ok(calls.includes('open_url'));
    assert.match(seen[1].at(-1).content, /do not ask the user to tap/);
  });
