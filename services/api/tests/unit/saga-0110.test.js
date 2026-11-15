// Saga 0.11.0 in the loop (modules/saga/loop.js): messages while it works, extract into the chat, signIn with the
// phone's saved login (and the Colon Secured Login hand-over when there is none), the tab limit, speed mode (pages
// read for Saga, follow-up steps) and the new "delete" approval. Scripted model and phone; no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, MAX_TABS } = require('../../src/modules/saga/loop');
const policy = require('../../src/modules/saga/policy');
const prompt = require('../../src/modules/saga/prompt');
const tools = require('../../src/modules/saga/tools');

console.log = () => {};
const LIMITS = { maxSteps: 10, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const J = (o) => JSON.stringify(o);
const page = (url, elements = [], text = 'Hello') => ({ ok: true, result: { url, title: 'T', text, elements } });
function model(replies) {
  const seen = [];
  return { seen, decide: async (messages) => { seen.push(messages);
    const r = replies[Math.min(seen.length - 1, replies.length - 1)];
    return J(typeof r === 'function' ? r(messages) : r); } };
}
function phone(map = {}) {
  const calls = [];
  return { calls, command: async (name, args, o) => { calls.push({ name, args, o }); const a = map[name];
    return typeof a === 'function' ? a(args, o) : a || { ok: true, result: {} }; } };
}
const logger = () => { const rows = []; return { rows, log: async (e) => { rows.push(e); } }; };
const go = (o) => run({ goal: 'Compare prices', limits: LIMITS, isStopped: async () => false, ...o });
const FIN = { say: 'Done', action: 'finish', args: { answer: 'Done.' } };
const text = (msgs) => msgs.map((m) => m.content).join('\n');

test('a message sent mid-task reaches the next decision as the user\'s words, without stopping', async () => {
  let pending = ['use the cheaper one'];
  const m = model([{ say: 'Reading', action: 'getPageContent', args: {} }, FIN]);
  const p = phone({ get_page_content: page('https://a.ng/') });
  const l = logger();
  const r = await go({ decide: m.decide, command: p.command, log: l.log,
    guidance: async () => { const g = pending; pending = []; return g; } });
  assert.equal(r.status, 'done');
  assert.match(text(m.seen[0]), /The user sent this while you work[^\n]*"use the cheaper one"/);
  assert.ok(l.rows.some((x) => x.kind === 'guide' && /cheaper/.test(x.say)));
});

test('extract: the table goes to the chat (r.tables, a logged extract row) and Saga sees the first rows', async () => {
  const m = model([{ say: 'Pulling the table', action: 'extract', args: { what: 'table' } }, FIN]);
  const rows = Array.from({ length: 30 }, (_, i) => [`Item ${i}`, `₦${i * 100}`]);
  const p = phone({ extract: { ok: true, result: { what: 'table', columns: ['Name', 'Price'], rows, total: 30 } } });
  const l = logger();
  const r = await go({ decide: m.decide, command: p.command, log: l.log, caps: ['get_page_content', 'extract'] });
  assert.equal(r.tables.length, 1);
  assert.deepEqual(r.tables[0].columns, ['Name', 'Price']);
  const row = l.rows.find((x) => x.kind === 'extract');
  assert.equal(row.args.rows.length, 30);
  assert.match(text(m.seen[1]), /a table with 30 rows went into the chat/);
  assert.match(text(m.seen[1]), /UNTRUSTED/);
});

test('signIn: offered only to phones that can; no saved login -> Colon Secured Login hand-over, then signed in',
  async () => {
    assert.ok(!tools.available(['get_page_content']).includes('signIn'));
    assert.ok(tools.available(['get_page_content', 'sign_in']).includes('signIn'));
    assert.doesNotMatch(prompt.system({ maxSteps: 5, caps: ['get_page_content'] }), /signIn \{/);
    let tries = 0;
    // 0.11.6: once the login is saved Colon signs in at once (no second decision needed).
    const m = model([{ say: 'Signing in', action: 'signIn', args: { site: 'https://www.GitHub.com/login' } }, FIN]);
    const p = phone({ sign_in: () => (tries++ === 0 ? { ok: false, error: 'no_login' }
      : { ok: true, result: { submitted: true, url: 'https://github.com/' } }) });
    const handoffs = [];
    const r = await go({ decide: m.decide, command: p.command, caps: ['get_page_content', 'sign_in'],
      handoff: async (info) => { handoffs.push(info); return 'return_to_ai'; }, takeNote: () => 'Login saved' });
    assert.equal(r.status, 'done');
    assert.deepEqual(p.calls.filter((c) => c.name === 'sign_in').map((c) => c.args), [{ site: 'github.com' },
      { site: 'github.com' }]);
    assert.equal(p.calls[2].name, 'get_page_content');           // the page is read for Saga after signing in
    assert.equal(handoffs[0].kind, 'login');
    assert.match(handoffs[0].message, /Colon Secured Login/);
    assert.match(text(m.seen[1]), /Colon signed in on github\.com with the login the user saved/);
    // Only the site ever goes to the phone; no field of a sign_in command can carry a credential.
    assert.throws(() => tools.toCommand('signIn', { site: 'not a site' }), /host name/);
    assert.deepEqual(tools.toCommand('signIn', { site: 'x.ng', password: 'hunter2', user: 'me' }).args,
      { site: 'x.ng' });
  });

test('at most 6 tabs opened by Saga in a task', async () => {
  const opens = Array.from({ length: MAX_TABS + 1 }, (_, i) => ({ say: `Tab ${i}`, action: 'openUrl',
    args: { url: `https://shop${i}.ng/`, newTab: true } }));
  const m = model([...opens, FIN]);
  const p = phone();
  const r = await go({ decide: m.decide, command: p.command, limits: { ...LIMITS, maxSteps: 12 } });
  assert.equal(r.status, 'done');
  assert.equal(p.calls.filter((c) => c.name === 'open_url').length, MAX_TABS);
  assert.match(text(m.seen[MAX_TABS + 1]), /already opened 6 tabs/);
});

test('speed mode: the page is read after navigating without asking the model; follow-ups run in one decision',
  async () => {
    const el = [{ id: 'c1', tag: 'input', type: 'text', label: 'Search' }, { id: 'c2', tag: 'button', text: 'Go' }];
    const m = model([
      { say: 'Opening', action: 'openUrl', args: { url: 'https://jumia.com.ng/' } },
      { say: 'Searching', action: 'fill', args: { id: 'c1', value: 'rice' }, then: [{ action: 'click',
        args: { text: 'Go' } }] },
      FIN]);
    const p = phone({ get_page_state: { ok: true, result: { loading: false } },
      get_page_content: page('https://jumia.com.ng/', el), click: { ok: true, result: { changed: 'none' } } });
    const r = await go({ decide: m.decide, command: p.command, speed: true });
    assert.equal(r.status, 'done');
    assert.equal(m.seen.length, 3);                                  // 3 model calls for 5 browser steps
    assert.deepEqual(p.calls.map((c) => c.name).filter((n) => n !== 'get_page_state'),
      ['open_url', 'get_page_content', 'fill', 'click']);
    assert.equal(p.calls.find((c) => c.name === 'click').args.id, 'c2');  // named by its text, one match
    assert.match(prompt.system({ maxSteps: 5, speed: true }), /Speed mode is on/);
  });

test('delete, remove, cancel my order: Saga stops and asks (approval kind delete)', () => {
  const els = new Map([['c1', { tag: 'button', text: 'Delete repository' }], ['c2', { tag: 'button',
    text: 'Cancel my order' }], ['c3', { tag: 'a', href: 'https://x.ng/remove', text: 'Remove' }]]);
  assert.equal(policy.approval({ name: 'click', args: { id: 'c1' } }, { elements: els }).kind, 'delete');
  assert.equal(policy.approval({ name: 'click', args: { id: 'c2' } }, { elements: els }).kind, 'delete');
  assert.equal(policy.approval({ name: 'click', args: { id: 'c3' } }, { elements: els }), null); // a plain link
  assert.equal(policy.stronger({ kind: 'delete' }, { kind: 'send_message' }).kind, 'delete');
});
