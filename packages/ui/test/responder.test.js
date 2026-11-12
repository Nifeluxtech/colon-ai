// Unit tests for the on-device preview responder (apps/chat/public/js/chat-responder.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColonResponder: R } = require('../../../apps/chat/src/lib/responder.js');

test('exact arithmetic, and nothing else is evaluated', () => {
  assert.equal(R.evalArithmetic('2+3*4'), 14);
  assert.equal(R.evalArithmetic('what is (10-4)^2 / 3?'), 12);
  assert.equal(R.evalArithmetic('sqrt(16)+1'), 5);
  assert.equal(R.evalArithmetic('1,000 * 3'), 3000);
  assert.equal(R.evalArithmetic('2^3^2'), 512);
  assert.equal(R.evalArithmetic('-5 + 2'), -3);
  assert.equal(R.evalArithmetic('hello 2+2'), null);
  assert.equal(R.evalArithmetic('process.exit()'), null);
  assert.equal(R.evalArithmetic('1/0'), null);
  assert.equal(R.evalArithmetic('(2+3'), null);
});

test('intent detection follows the mode', () => {
  assert.equal(R.intent('hi', 'general'), 'greet');
  assert.equal(R.intent('solve x^2-5x+6=0', 'general'), 'maths');
  assert.equal(R.intent('build a website for my shop', 'general'), 'website');
  assert.equal(R.intent('anything at all', 'developer'), 'code');
  assert.equal(R.intent('compare MTN vs Airtel', 'general'), 'compare');
  assert.equal(R.intent('tell me about Lagos', 'research'), 'research');
  assert.equal(R.intent('photosynthesis', 'study'), 'study');
});

test('titles and topics', () => {
  assert.equal(R.titleFrom('help me build a website for my bakery in Ibadan please now'),
    'Help me build a website for my');
  assert.equal(R.titleFrom('   '), 'New chat');
  assert.equal(R.topicOf('Help me understand photosynthesis'), 'photosynthesis');
  assert.equal(R.topicOf('Research the history of Lagos'), 'Lagos');
});

test('chunks reassemble to the original text (streaming)', () => {
  const t = 'Hello **world**\n\n```js\nx = 1\n```';
  assert.equal(R.chunks(t).join(''), t.replace(/^\s+/, ''));
});

test('respond: arithmetic and code replies need no network', async () => {
  const a = await R.respond({ content: '2*21', mode: 'general' });
  assert.match(a.text, /\*\*42\*\*/);
  const c = await R.respond({ content: 'write a SQL query for sales', mode: 'developer' });
  assert.match(c.text, /```sql/);
  const f = await R.respond({ content: '', mode: 'general', attachments: [{ name: 'notes.txt', kind: 'text',
    excerpt: 'Hello there', words: 2, lines: 1 }] });
  assert.match(f.text, /notes\.txt/);
});
