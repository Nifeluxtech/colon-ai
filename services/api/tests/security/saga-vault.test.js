// Colon Secured Login (0.11.0, ADR 0007): the user's saved logins live only in the phone's Keystore-encrypted vault.
// The server and the model only ever learn the site and whether a login exists / signing in worked. These tests try
// to make a credential travel anyway: through Saga's arguments, the bridge frame, a phone that answers with too
// much, the action log, the model's prompt, the user's hand-back note and messages sent mid-task.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../helpers/browser-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const frames = require('../../src/modules/browser/frames');
const { run } = require('../../src/modules/saga/loop');
const tools = require('../../src/modules/saga/tools');

console.log = () => {};
const SECRET = 'Hunter2-Very-Secret!';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMITS = { maxSteps: 6, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };

test('Saga cannot put a credential in a sign_in command: only the host name survives', () => {
  for (const args of [{ site: 'github.com', password: SECRET }, { site: 'github.com', value: SECRET, username: 'me' },
    { site: `https://me:${SECRET}@github.com/login` }]) {
    const c = tools.toCommand('signIn', args);
    assert.deepEqual(c.args, { site: 'github.com' });
    assert.doesNotMatch(JSON.stringify(c), /Hunter2/);
  }
});

test('the bridge frame for sign_in carries the site only, and a chatty phone ack never reaches log or prompt',
  async () => {
    const sent = [];
    const b = createBridge({ send: (m) => sent.push(m), user: { id: 7001 }, req: { ip: '1.1.1.1' }, audit,
      throttleMs: 0, ackTimeoutMs: 300 });
    await b.handle(JSON.stringify({ type: 'hello', v: 1, device_id: 'dev-vault', app: 'colonai', control: 'manual',
      capabilities: ['get_page_content', 'sign_in'], conversation_id: '9' }));
    await b.handle(JSON.stringify({ type: 'control', mode: 'ai', paused: false, reason: 'consent' }));
    const seen = [], rows = [];
    const decide = async (messages) => { seen.push(JSON.stringify(messages));
      return seen.length === 1 ? JSON.stringify({ say: 'Signing in', action: 'signIn', args: { site: 'github.com',
        password: SECRET } }) : JSON.stringify({ say: 'Done', action: 'finish', args: { answer: 'Signed in.' } }); };
    const command = async (name, args, o) => {
      const p = b.command(name, args, undefined, { ...o, conversation: '9' });
      await wait(5);
      const f = [...sent].reverse().find((x) => x.type === 'command');
      // A buggy phone that echoes what it filled: the server must drop it.
      await b.handle(JSON.stringify({ type: 'ack', ref: f.id, ok: true, result: { submitted: true,
        password: SECRET, username: 'ada@example.com', url: 'https://github.com/' } }));
      return p;
    };
    const r = await run({ goal: 'Sign in to GitHub', limits: LIMITS, isStopped: async () => false, decide, command,
      caps: ['get_page_content', 'sign_in'], log: async (e) => rows.push(e) });
    assert.equal(r.status, 'done');
    const frame = sent.find((x) => x.type === 'command' && x.name === 'sign_in');
    assert.deepEqual(frame.args, { site: 'github.com' });
    for (const out of [JSON.stringify(sent), JSON.stringify(rows), seen.join('\n'), JSON.stringify(r)]) {
      assert.doesNotMatch(out, /Hunter2/);
      assert.doesNotMatch(out, /ada@example\.com/);
    }
  });

test('a password typed into a hand-back note or a mid-task message is hidden before anything keeps it', () => {
  for (const said of [`my password is ${SECRET}`, `password: ${SECRET}`, 'the code was 552019',
    'OTP 552019 then continue']) {
    const kept = frames.note(said);
    assert.doesNotMatch(kept, /Hunter2|552019/, said);
  }
});

test('signIn answered not_trusted or wrong_site: the model is told what to do next (no value, no retry loop)',
  async () => {
    for (const [error, hint] of [['not_trusted', /Do not call signIn again/], ['wrong_site', /Open the site/]]) {
      const seen = [];
      const decide = async (messages) => { seen.push(JSON.stringify(messages));
        return seen.length === 1 ? JSON.stringify({ say: 'Signing in', action: 'signIn', args: { site: 'github.com' } })
          : JSON.stringify({ say: 'Done', action: 'finish', args: { answer: 'Stopped.' } }); };
      const command = async () => ({ ok: false, error, result: {} });
      const r = await run({ goal: 'Sign in to GitHub', limits: LIMITS, isStopped: async () => false, decide, command,
        caps: ['get_page_content', 'sign_in'], log: async () => {} });
      assert.equal(r.status, 'done');
      assert.match(seen[1], hint);
    }
  });
