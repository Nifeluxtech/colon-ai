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
  // The same words with the browser closed are ordinary chat.
  assert.equal(parseIntent('search for jollof rice recipes'), null);
  assert.equal(parseIntent('scroll down'), null);
});

test('ordinary messages, questions about browsers and long texts stay chat', () => {
  for (const t of ['How do I open the browser on my phone?', 'what is the capital of Nigeria?',
    'Which browser is best for Android?', 'open a new chat', 'open my email', 'I like google.com a lot',
    'Write me a poem about the browser', '', 'open the browser\nand then write an essay']) {
    assert.equal(parseIntent(t, OPEN), null, t);
  }
  assert.equal(parseIntent('search for ' + 'x '.repeat(200), OPEN), null);
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
