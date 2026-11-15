// Phase 10: chat-driven browsing (apps/chat/src/lib/browser-intent.js). The chat opens this chat's browser and
// hands browsing instructions to Saga without a Browse button, and leaves every ordinary message alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIntent, siteUrl } = require('../../../apps/chat/src/lib/browser-intent.js');

const OPEN = { open: true };

test('"open the browser" in many phrasings opens this chat\'s browser', () => {
  for (const t of ['open the browser', 'Open browser please', 'Saga, can you open the browser?', 'show the browser',
    'please open my browser', 'launch the colon browser', 'open the browser here', 'ok open the browser for me']) {
    assert.deepEqual(parseIntent(t), { kind: 'open' }, t);
  }
  assert.deepEqual(parseIntent('close the browser'), { kind: 'close' });
});

test('"open google.com" opens that page; known site names work without a domain', () => {
  assert.deepEqual(parseIntent('open google.com'), { kind: 'open', url: 'https://google.com/' });
  assert.deepEqual(parseIntent('Go to www.punchng.com/news'), { kind: 'open', url: 'https://www.punchng.com/news' });
  assert.deepEqual(parseIntent('visit https://Example.com/Path?x=1'), { kind: 'open',
    url: 'https://example.com/Path?x=1' });
  assert.deepEqual(parseIntent('open jumia'), { kind: 'open', url: 'https://www.jumia.com.ng/' });
  assert.deepEqual(parseIntent('take me to the nairaland website'), { kind: 'open',
    url: 'https://www.nairaland.com/' });
  assert.equal(siteUrl('javascript:alert(1)'), null);
  assert.equal(parseIntent('open javascript:alert(1)'), null);
});

test('"go to my bank site" is a Saga task that opens the browser first', () => {
  assert.deepEqual(parseIntent('go to my bank site'), { kind: 'task', goal: 'go to my bank site', open: true });
  assert.deepEqual(parseIntent('Open the JAMB portal'), { kind: 'task', goal: 'Open the JAMB portal', open: true });
});

test('while the browser is open, instructions for it become Saga tasks run on it', () => {
  for (const t of ['search for jollof rice recipes', 'click the second result', 'scroll down',
    'what does this page say?', 'Summarise this page', 'go back', 'open the first result', 'type my name in the box',
    'add it to cart', 'sign in', 'what\'s on this page']) {
    assert.deepEqual(parseIntent(t, OPEN), { kind: 'task', goal: t, open: true }, t);
  }
  // Steps that only make sense on an open page are ordinary chat with the browser closed; 0.11.2: a search is not
  // (it needs the live web, so the browser opens itself).
  assert.deepEqual(parseIntent('search for jollof rice recipes'), { kind: 'task',
    goal: 'search for jollof rice recipes', open: true });
  assert.equal(parseIntent('scroll down'), null);
  assert.equal(parseIntent('sign in'), null);
});

test('ordinary messages, questions about browsers and long texts stay chat', () => {
  for (const t of ['How do I open the browser on my phone?', 'what is the capital of Nigeria?',
    'Which browser is best for Android?', 'open a new chat', 'I like google.com a lot',
    'Write me a poem about the browser', '', 'open the browser\nand then write an essay']) {
    assert.equal(parseIntent(t, OPEN), null, t);
  }
  assert.equal(parseIntent('search for ' + 'x '.repeat(200), OPEN), null);
  // 0.11.3: with this chat's browser open, "open my email" is a follow-up for Saga (it was chat before).
  assert.deepEqual(parseIntent('open my email', OPEN), { kind: 'task', goal: 'open my email', open: true,
    follow: true });
});

test('modes and control: "let me help", "you do it", "take control", "done", "stop"', () => {
  assert.deepEqual(parseIntent('let me help', OPEN), { kind: 'mode', mode: 'shared' });
  assert.deepEqual(parseIntent('AI + me', OPEN), { kind: 'mode', mode: 'shared' });
  assert.deepEqual(parseIntent('you do it', OPEN), { kind: 'mode', mode: 'ai' });
  assert.deepEqual(parseIntent('take control', OPEN), { kind: 'control', op: 'take_control' });
  assert.deepEqual(parseIntent('stop', OPEN), { kind: 'control', op: 'stop' });
  // "done" hands control back only when Saga is waiting for the user (a password, a code) or was paused by them.
  assert.deepEqual(parseIntent('done', { open: true, waiting: true }), { kind: 'control', op: 'return_to_ai' });
  assert.deepEqual(parseIntent('I have entered the code', { waiting: true }), { kind: 'control',
    op: 'return_to_ai' });
  assert.deepEqual(parseIntent('continue', { resumable: true }), { kind: 'control', op: 'return_to_ai' });
  assert.equal(parseIntent('done', OPEN), null);
  // Without the browser open these are ordinary chat.
  assert.equal(parseIntent('let me help'), null);
  assert.equal(parseIntent('stop'), null);
});

test('0.10.4: "reshow the browser" and friends bring this chat\'s browser back; never plain chat', () => {
  for (const t of ['Reshow the browser', 'reshow browser', 'show the browser again', 'reopen the browser',
    'Re-open my browser', 'bring back the browser', 'bring the browser back', 'show me the browser',
    'Where is the browser?', 'where\'s my browser gone', 'I can\'t see the browser', 'open this chat\'s browser',
    'display the browser card', 'Saga, please show the browser']) {
    assert.deepEqual(parseIntent(t), { kind: 'open' }, t);
  }
  // Questions about browsers in general stay ordinary chat.
  for (const t of ['what is a web browser?', 'which browser is best for android', 'show me how photosynthesis works',
    'where is the nearest bank']) assert.equal(parseIntent(t), null, t);
});

test('0.10.4: "continue" after the chat\'s last task ended continues it; while Saga waits it is the hand-back', () => {
  const ENDED = { open: true, ended: true };
  for (const t of ['continue', 'Carry on', 'go on please', 'resume', 'try again', 'continue where you stopped',
    'I\'ve logged in, continue', 'ok I have logged in now, please carry on', 'pick up where you left off']) {
    assert.deepEqual(parseIntent(t, ENDED), { kind: 'continue' }, t);
  }
  // Waiting for the user (or the user has the browser): the same words give it back instead.
  assert.deepEqual(parseIntent('continue', { open: true, ended: true, waiting: true }), { kind: 'control',
    op: 'return_to_ai' });
  // Saga is busy, or there is no task to continue: not a continuation.
  assert.equal(parseIntent('continue', { open: true, ended: true, busy: true }), null);
  assert.equal(parseIntent('continue', OPEN), null);
  // A long message that merely mentions continuing is ordinary chat.
  assert.equal(parseIntent('can you explain how I should continue my essay about the civil war in more detail',
    ENDED), null);
  assert.equal(parseIntent('how do I continue my studies?', ENDED), null);
});

test('0.11.2: a message that needs the browser opens it by itself (no "open the browser" first)', () => {
  for (const t of ['Search the web for fuel price in Lagos', 'google yolotask earners', 'check yolotask',
    'Check my yolotask dashboard', 'log in to github', 'login to yolotask', 'sign in to yolotask.com.ng',
    'fill out the JAMB registration form', 'compare prices of iPhone 15 on jumia and konga',
    'find the cheapest rice on jumia', 'how much is a bag of rice on jumia today?', 'what is the latest news on punch?',
    'see what\'s new on nairaland', 'check the price of cement in Lagos', 'search online for NYSC news',
    'buy a phone charger on konga', 'Saga, please check punchng.com for today\'s headlines']) {
    assert.deepEqual(parseIntent(t), { kind: 'task', goal: t, open: true }, t);
  }
  // Going to a named site still just opens it.
  assert.deepEqual(parseIntent('go to yolotask'), { kind: 'open', url: 'https://yolotask.com.ng/' });
});

test('0.11.2: questions answerable without a browser stay ordinary chat', () => {
  for (const t of ['what is the capital of Nigeria?', 'check my grammar', 'How do I sign in to github?',
    'what is jumia?', 'find me a good name for my dog', 'buy me a gift idea', 'write a poem about Lagos',
    'explain how search engines work', 'compare python and javascript', 'which is better, jumia or konga?',
    'check this sentence for errors: I has a pen', 'what does google mean?']) {
    assert.equal(parseIntent(t), null, t);
  }
});

// 0.11.3 (owner's report on 0.11.2, Developer mode): after a browser task, follow-ups went to the chat model.
const { followUp } = require('../../../apps/chat/src/lib/browser-intent.js');
const AFTER = (prev) => ({ recent: true, prev: prev || '' });
const FOLLOW = (goal) => ({ kind: 'task', goal, open: true, follow: true });

test('0.11.3: after a browser task, follow-ups on any site continue it in the same browser', () => {
  // GitHub (the owner's report)
  for (const t of ['Go to Colon repo', 'Go to the repository named colon ai', 'Open the colon ai repository',
    'open repository']) assert.deepEqual(parseIntent(t, AFTER()), FOLLOW(t), t);
  assert.deepEqual(parseIntent('In the logged in GitHub account', AFTER('Go to Colon repo')),
    FOLLOW('Go to Colon repo (In the logged in GitHub account)'));
  // Jumia, yolotask.com.ng, Google results
  for (const t of ['open the Infinix Smart 20', 'add it to cart', 'click the cheapest one', 'go to my earnings',
    'check my withdrawals', 'open the second result', 'the first one', 'that one', 'next', 'scroll down',
    'find the price', 'show me the reviews', 'on the jumia page']) {
    assert.deepEqual(parseIntent(t, AFTER()), FOLLOW(t), t);
  }
  // With the browser open (no earlier task) it works too.
  assert.deepEqual(parseIntent('Go to Colon repo', { open: true }), FOLLOW('Go to Colon repo'));
});

test('0.11.3: "open the browser and check" is a task anywhere; ordinary messages stay chat after a task', () => {
  assert.deepEqual(parseIntent('Open the browser and check'), FOLLOW('Open the browser and check'));
  assert.deepEqual(parseIntent('open the browser'), { kind: 'open' });
  for (const t of ['Explain this code', 'Fix the bug in my function', 'What is a closure?', 'go ahead', 'thanks',
    'show me how to write a loop in python', 'Write me a Python function that reverses a list', 'hello']) {
    assert.equal(parseIntent(t, AFTER()), null, t);
  }
  // Without a browser task in this chat, a follow-up-looking message stays chat.
  assert.equal(parseIntent('Go to Colon repo', {}), null);
  assert.equal(parseIntent('check', {}), null);
  assert.ok(followUp('click the first one') && !followUp('explain the error'));
});

// 0.11.5 (owner): signed in, the chat model decides whether to browse (its browse tool), so the page keeps only the
// browser's own controls; tasks and follow-ups go to the chat model as messages.
test('ctx.tools: only the browser\'s controls are read here; tasks and follow-ups go to the chat model', () => {
  const T = { tools: true, open: true, recent: true, prev: 'Go to Colon repo' };
  for (const t of ['go to Colon repo', 'open it', 'click the second one', 'check my orders', 'In the logged in account',
    'Login to GitHub', 'open yolotask.com.ng', 'search for phones on jumia', 'open the browser and check my tasks',
    'scroll down', 'how much is rice on jumia?']) {
    assert.equal(parseIntent(t, T), null, t);
  }
  assert.deepEqual(parseIntent('open the browser', T), { kind: 'open' });
  assert.deepEqual(parseIntent('close the browser', T), { kind: 'close' });
  assert.deepEqual(parseIntent('stop', T), { kind: 'control', op: 'stop' });
  assert.deepEqual(parseIntent('take control', T), { kind: 'control', op: 'take_control' });
  assert.deepEqual(parseIntent('done', { ...T, waiting: true }), { kind: 'control', op: 'return_to_ai' });
  assert.deepEqual(parseIntent('continue', { ...T, ended: true }), { kind: 'continue' });
  // Without the tools (signed out, the web reader), the 0.11.3 rules still apply.
  assert.equal(parseIntent('go to Colon repo', { open: true, recent: true }).kind, 'task');
});
