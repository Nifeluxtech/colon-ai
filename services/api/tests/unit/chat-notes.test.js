// 0.22.1: chat notes (modules/chat/notes.js): commands and video cards saved in the thread without a model reply.
const test = require('node:test');
const assert = require('node:assert/strict');
const { notePlan } = require('../../src/modules/chat/notes');

const VIDEO = { title: 'Davido - Feel', url: 'https://www.youtube.com/watch?v=abcdefghijk', snippet: 'Davido' };

test('a command: the user line is role user, the reply is the assistant', () => {
  assert.deepEqual(notePlan({ role: 'user', origin: 'command', content: ' take me to WhatsApp ' }),
    { role: 'user', origin: 'command', content: 'take me to WhatsApp', sources: [] });
  assert.equal(notePlan({ origin: 'command', content: 'I’ll take you to WhatsApp now.' }).role, 'assistant');
});

test('a video card keeps exactly one YouTube watch link', () => {
  const p = notePlan({ origin: 'video', content: 'Here’s Feel.', sources: [VIDEO, VIDEO] });
  assert.equal(p.origin, 'video');
  assert.deepEqual(p.sources, [Object.assign({ n: 1 }, VIDEO)]);
  const bad = notePlan({ origin: 'video', content: 'x', sources: [{ title: 't', url: 'https://evil.example/watch' }] });
  assert.equal(bad.origin, 'command');
  assert.deepEqual(bad.sources, []);
});

test('only browse and command notes may be the user’s; unknown origins are notes', () => {
  assert.equal(notePlan({ role: 'user', origin: 'video', content: 'x' }).role, 'assistant');
  assert.equal(notePlan({ role: 'user', origin: 'whatever', content: 'x' }).role, 'assistant');
  assert.equal(notePlan({ origin: 'whatever', content: 'x' }).origin, 'note');
  assert.equal(notePlan({ role: 'user', origin: 'browse', content: 'open google.com' }).role, 'user');
  assert.equal(notePlan({}).content, '');
});
