// 0.22.1: voice mode replies (POST /conversations/:id/messages with voice: true) are short, plain and fast.
const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../../src/modules/ai/prompts');
const { forVoice } = require('../../src/modules/ai/generate');

test('the voice prompt asks for a short spoken answer; other turns never get it', () => {
  const v = prompts.systemPrompt({ mode: 'general', language: 'en', voice: true });
  assert.match(v, /spoken conversation/);
  assert.match(v, /under 60 words/);
  assert.doesNotMatch(prompts.systemPrompt({ mode: 'general', language: 'en' }), /spoken conversation/);
});

test('voice drops the slow Gemma 4 31B unless nothing else is left, and keeps the route name', () => {
  const chain = Object.assign([{ model: 'gemma-4-26b-a4b-it' }, { model: 'gemma-4-31b-it' },
    { model: 'gemini-flash-lite-latest' }], { route: 'gemma' });
  const v = forVoice(chain, true);
  assert.deepEqual(v.map(c => c.model), ['gemma-4-26b-a4b-it', 'gemini-flash-lite-latest']);
  assert.equal(v.route, 'gemma');
  assert.equal(forVoice(chain, false), chain);
  const only = Object.assign([{ model: 'gemma-4-31b-it' }], { route: 'gemma' });
  assert.equal(forVoice(only, true), only);
});
