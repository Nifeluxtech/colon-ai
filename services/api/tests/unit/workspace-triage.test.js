// Unit tests for Workspace chat triage (v0.31.2): commands and questions answer fast, changes still build.
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../../src/modules/workspace');
const triage = require('../../src/modules/workspace/triage');
const { createChat } = require('../../src/modules/workspace/chat');

const ME = { id: 1 };

test('classify: tab commands, small talk and questions vs changes', () => {
  const k = (s) => triage.classify(s);
  assert.deepEqual(k('Open browser'), { kind: 'command', action: 'open_site' });
  assert.deepEqual(k('open the preview'), { kind: 'command', action: 'open_preview' });
  assert.deepEqual(k('please show me the code'), { kind: 'command', action: 'open_code' });
  assert.deepEqual(k('Open terminal'), { kind: 'command', action: 'open_code' });
  assert.deepEqual(k('go to the database tab'), { kind: 'command', action: 'open_data' });
  assert.equal(k('hi').kind, 'answer');
  assert.equal(k('thanks!').kind, 'answer');
  assert.equal(k('what files are there?').kind, 'answer');
  assert.equal(k('what colour is the title?').kind, 'answer');
  for (const s of ['make the header blue', 'add a contact page', 'can you add a map?', 'open a new page for blog',
    'Open browser and add a navbar', 'fix the footer', 'build me a bakery site']) assert.equal(k(s).kind, 'build', s);
});

test('commandLine: open_site falls back to the preview when the site isn\'t published', () => {
  assert.deepEqual(triage.commandLine('open_site', true), { action: 'open_site', text: 'Opening your site.' });
  assert.equal(triage.commandLine('open_site', false).action, 'open_preview');
});

async function setup(generate) {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  const calls = [];
  const chat = createChat({ engine: e, deps: { quick: true, generate: async (o) => { calls.push(o);
    return generate(o); } } });
  return { e, w, chat, calls };
}

test('chat: a command answers at once with no model call and no build', async () => {
  const { w, chat, calls } = await setup(() => ({ text: 'x' }));
  const r = await chat.send(ME, w.id, { message: 'Open browser' }, { wait: true });
  assert.equal(r.working, false);
  assert.equal(r.action, 'open_preview');
  assert.equal(r.free, true);
  assert.equal(calls.length, 0);
  const h = await chat.history(ME, w.id);
  assert.equal(h.working, false);
  assert.equal(h.messages[1].content, 'Your site isn’t published yet, so I opened the preview.');
  assert.equal(h.version, 1);
});

test('chat: a question gets a quick answer, not a build', async () => {
  const { w, chat, calls } = await setup(() => ({ text: 'Your title is dark grey.' }));
  await chat.send(ME, w.id, { message: 'what colour is the title?' }, { wait: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'general');
  assert.match(calls[0].context, /Files:\n- index\.html/);
  const h = await chat.history(ME, w.id);
  assert.equal(h.messages[1].content, 'Your title is dark grey.');
  assert.equal(h.messages[1].kind, 'quick');
  assert.equal(h.working, false);
  assert.equal(h.version, 1);
});

test('chat: "BUILD:" or a failing quick model hands the message to a normal build', async () => {
  const reply = '=== EDIT: style.css\n<<<<<<< SEARCH\n\n=======\n.t{color:blue}\n>>>>>>> REPLACE\n=== END';
  let s = await setup((o) => (o.mode === 'general' ? { text: 'BUILD:' } : { text: reply }));
  await s.chat.send(ME, s.w.id, { message: 'the title looks too small?' }, { wait: true });
  assert.deepEqual(s.calls.map((c) => c.mode), ['general', 'developer']);
  assert.equal((await s.chat.history(ME, s.w.id)).version, 2);
  s = await setup((o) => { if (o.mode === 'general') throw new Error('down'); return { text: reply }; });
  await s.chat.send(ME, s.w.id, { message: 'hello' }, { wait: true });
  assert.deepEqual(s.calls.map((c) => c.mode), ['general', 'developer']);
});

test('chat: a change still builds straight away, and quick messages stay out of build history', async () => {
  const s = await setup((o) => (o.mode === 'general' ? { text: 'Hi there!' } : { text: 'Done.' }));
  await s.chat.send(ME, s.w.id, { message: 'hi' }, { wait: true });
  await s.chat.send(ME, s.w.id, { message: 'add a contact page' }, { wait: true });
  assert.deepEqual(s.calls.map((c) => c.mode), ['general', 'developer']);
  assert.ok(s.calls[1].messages.every((m) => !/Hi there|^hi$/.test(m.content)));
});

test('links: http(s) addresses in a message, trailing punctuation dropped, at most two', () => {
  assert.deepEqual(triage.links('read https://a.com/x, then http://b.org. and https://c.net'),
    ['https://a.com/x', 'http://b.org', 'https://c.net'].slice(0, 2));
  assert.deepEqual(triage.links('no link here'), []);
  assert.equal(triage.classify('read https://bakery.ng and tell me what they sell').kind, 'answer');
  assert.equal(triage.classify('make my menu like https://bakery.ng/menu').kind, 'build');
});

test('chat: a linked page is read for a quick answer and a build; a failed read is reported', async () => {
  const read = [];
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  const calls = [];
  const chat = createChat({ engine: e, deps: { quick: true,
    readLink: async (url) => { read.push(url); if (url.includes('bad')) throw Object.assign(new Error('x'),
      { code: 'timeout' }); return { url, title: 'Bakery', text: 'Fresh bread daily. Agege bread 500 naira.' }; },
    generate: async (o) => {
      calls.push(o);
      return { text: o.mode === 'general' ? 'They sell bread.' : 'Done.' };
    } } });
  await chat.send(ME, w.id, { message: 'read https://bakery.ng and tell me what they sell' }, { wait: true });
  assert.match(calls[0].context, /--- https:\/\/bakery\.ng \(Bakery\) ---\nFresh bread daily/);
  await chat.send(ME, w.id, { message: 'make my menu like https://bakery.ng/menu and https://bad.ng' }, { wait: true });
  assert.equal(calls[1].mode, 'developer');
  assert.match(calls[1].context, /Pages the user linked[\s\S]*Agege bread[\s\S]*Could not be read: it took too long/);
  const steps = (await chat.history(ME, w.id)).messages.filter((m) => m.role === 'user').pop().steps;
  assert.ok(steps.some((x) => x.label === 'Reading the links' && x.state === 'done' && x.detail === 'bakery.ng'));
  assert.deepEqual(read, ['https://bakery.ng', 'https://bakery.ng/menu', 'https://bad.ng']);
});

test('triage: plans and lists answer in the chat; a change to the site still builds (v0.31.3)', () => {
  for (const m of ['Retry\nJust list out', 'Write out the 5 phase to production', 'list the steps to launch',
    'give me ideas for the hero']) assert.equal(triage.classify(m).kind, 'answer', m);
  for (const m of ['add a list of products', 'make a plan page', 'list the prices and add them to the menu'])
    assert.equal(triage.classify(m).kind, 'build', m);
});

test('prompt: a linked repository is cut to 12 KB per build (v0.31.3)', () => {
  const p = require('../../src/modules/workspace/prompt');
  const out = p.context({ files: [], reference: 'x'.repeat(30000) });
  assert.ok(out.includes('… (cut)'));
  assert.ok(out.length < 12000 + 8000);
});
