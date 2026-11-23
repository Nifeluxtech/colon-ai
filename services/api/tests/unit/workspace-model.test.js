// Unit tests for src/modules/workspace/model.js (v0.31.3): Workspace tries the fast model first, then the chain.
const test = require('node:test');
const assert = require('node:assert');
const { wrap, model } = require('../../src/modules/workspace/model');

const chain = async (o) => ({ text: 'from chain', providerId: 'chain', mode: o.mode });
const kit = (stream, extra = {}) => ({ stream, available: () => true, env: {},
  systemPrompt: (p) => `SYS ${p.mode} ${p.context}`, ...extra });
const msg = [{ role: 'user', content: 'list out the phases' }];

test('model: WORKSPACE_MODEL defaults to gemini-3.5-flash-lite; off turns it off', () => {
  assert.equal(model({}), 'gemini-3.5-flash-lite');
  assert.equal(model({ WORKSPACE_MODEL: 'off' }), '');
});

test('model: the fast model answers with the system prompt and context first', async () => {
  let seen;
  const g = wrap(chain, kit(async (o) => {
    seen = o;
    return { text: 'fast', providerId: 'gemini', model: o.models[0] };
  }));
  const r = await g({ mode: 'developer', context: 'FILES', messages: msg });
  assert.equal(r.text, 'fast');
  assert.deepEqual(seen.models, ['gemini-3.5-flash-lite']);
  assert.deepEqual(seen.messages[0], { role: 'system', content: 'SYS developer FILES' });
  assert.equal(seen.messages[1].content, 'list out the phases');
});

test('model: a failure, an empty answer, no key or off falls back to the chain', async () => {
  const fail = wrap(chain, kit(async () => { throw Object.assign(new Error('x'), { code: 'tools_failed' }); }));
  assert.equal((await fail({ mode: 'general', messages: msg })).text, 'from chain');
  const empty = wrap(chain, kit(async () => ({ text: '  ' })));
  assert.equal((await empty({ mode: 'general', messages: msg })).text, 'from chain');
  const nokey = wrap(chain, kit(async () => ({ text: 'fast' }), { available: () => false }));
  assert.equal((await nokey({ mode: 'general', messages: msg })).text, 'from chain');
  const off = wrap(chain, kit(async () => ({ text: 'fast' }), { env: { WORKSPACE_MODEL: 'off' } }));
  assert.equal((await off({ mode: 'general', messages: msg })).text, 'from chain');
});

test('model: a stop (abort) is not retried on the chain', async () => {
  const ctl = new AbortController(); ctl.abort();
  const g = wrap(async () => { throw new Error('chain should not run'); },
    kit(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }));
  await assert.rejects(g({ mode: 'developer', messages: msg, signal: ctl.signal }), { name: 'AbortError' });
});
