// Unit tests for the Developer mode system prompt (ai/prompts.js) and its larger output cap (ai/generate.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../../src/modules/ai/prompts');
const config = require('../../src/config');

test('developer prompt: explain, fix, generate and review shapes', () => {
  const p = prompts.systemPrompt({ mode: 'developer' });
  assert.match(p, /Mode: Developer/);
  assert.match(p, /Explain: walk through the code/);
  assert.match(p, /complexity/i);
  assert.match(p, /pitfalls/);
  assert.match(p, /Fix: find the bug first/);
  assert.match(p, /root cause/);
  assert.match(p, /minimal diff/);
  assert.match(p, /full corrected file/);
  assert.match(p, /how to\s+test the fix/);
  assert.match(p, /Generate: write complete, runnable code/);
  assert.match(p, /Name every file/);
  assert.match(p, /run instructions/);
  assert.match(p, /Review\/refactor/);
});

test('developer prompt: format, honesty, security, clarifying question, local context, language', () => {
  const p = prompts.systemPrompt({ mode: 'developer', language: 'yo' });
  assert.match(p, /fenced code block with a language tag/);
  assert.match(p, /never invent APIs/);
  assert.match(p, /say so and say how to check/);
  assert.match(p, /never hard-code secrets/);
  assert.match(p, /parameterised SQL/);
  assert.match(p, /validate and sanitise all input/);
  assert.match(p, /Ask one short clarifying question only when/);
  assert.match(p, /Paystack/);
  assert.match(p, /Flutterwave/);
  assert.match(p, /cPanel/);
  assert.match(p, /Keep code, identifiers, comments in code, commands and error messages in\s+English/);
  assert.match(p, /explanations in the reply language/);
  assert.match(p, /Reply in Yorùbá/);
  assert.match(p, /never guess their contents/);
  assert.match(p, /untrusted/, 'the safety section (untrusted blocks rule) is still there');
});

test('developer prompt stays in Developer mode only', () => {
  for (const mode of ['general', 'study', 'research']) {
    const p = prompts.systemPrompt({ mode });
    assert.ok(!/Mode: Developer/.test(p) && !/minimal diff/.test(p), mode);
  }
});

test('developer replies get a larger max output (AI_DEVELOPER_MAX_TOKENS, default 8192)', () => {
  assert.equal(config.chat.developerMaxTokens, 8192);
  assert.ok(config.chat.developerMaxTokens > config.chat.maxTokens);
});
