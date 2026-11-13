// Saga on the bridge (Phase 9): command / ack handling with per-command timeouts, waiting for the phone's consent,
// the runner end to end (consent, loop, results, audit log, control handed back), old apps, declines, Stop from the
// chat, the cross-worker queue and the REST / admin replay handlers. The database is an in-memory fake, the model
// is scripted and the phone is a fake socket that answers frames like the Android app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fake = require('../helpers/saga-db').install();
const audit = require('../../src/shared/audit');
const { createBridge } = require('../../src/modules/browser/bridge');
const saga = require('../../src/modules/saga');

console.log = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPS = ['open_url', 'get_page_content', 'get_links', 'click', 'fill', 'scroll', 'screenshot', 'back',
  'forward', 'reload', 'get_tabs'];
let nextUser = 500;

// A phone: a bridge whose outgoing frames are answered like the app would (consent, then acks).
async function phone(o = {}) {
  const user = { id: o.userId || ++nextUser };
  const frames = [];
  const answer = o.answer || ((f) => ({ ok: true, result: f.name === 'get_page_content' ? { url: 'https://punchng.com/',
    title: 'Punch', text: 'Fuel is ₦1,000 a litre.', elements: [] } : {} }));
  let b = null;
  const send = (m) => {
    frames.push(m);
    setImmediate(() => {
      if (m.type === 'control' && m.mode !== 'manual' && o.consent !== 'none') {
        b.handle(JSON.stringify({ type: 'control', mode: m.mode, paused: false, reason: o.consent || 'consent' }));
      }
      if (m.type === 'control' && m.mode === 'manual') {
        b.handle(JSON.stringify({ type: 'control', mode: 'manual', paused: false, reason: 'stop' }));
      }
      if (m.type === 'command' && !o.silent) {
        Promise.resolve(answer(m)).then((a) => a && b.handle(JSON.stringify({ type: 'ack', ref: m.id, ...a })));
      }
    });
  };
  b = createBridge({ send, user, req: { ip: '102.89.1.1' }, audit, throttleMs: 0, ackTimeoutMs: 300 });
  await b.handle(JSON.stringify({ type: 'hello', v: 1, client: 'android', app: 'colonai', device_id: `d${user.id}`,
    app_version: '0.9.0', control: 'manual', capabilities: o.capabilities || CAPS }));
  return { b, user, frames, req: { user, ip: '102.89.1.1', params: {}, query: new URLSearchParams(), body: {} } };
}
function model(replies) {
  let i = 0;
  return async () => ({ text: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) });
}
const READ_AND_FINISH = [
  { say: 'Opening Punch', action: 'openUrl', args: { url: 'https://punchng.com/' } },
  { say: 'Reading the page', action: 'getPageContent', args: {} },
  { say: 'Answering', action: 'finish', args: { answer: 'Fuel is ₦1,000 a litre [1].', sources: [1] } },
];
const taskRow = (id) => fake.tables.tasks.find((t) => t.id === id);
const actionsOf = (id) => fake.tables.actions.filter((a) => a.task_id === id);

test('bridge: commands carry their own timeout, acks resolve them, consent is awaited', async () => {
  const p = await phone({ silent: true });
  assert.ok(p.b.supports('click') && !p.b.supports('evaluate'));
  assert.equal(await p.b.hasControl(), false);
  assert.deepEqual(await p.b.command('get_tabs'), { ok: false, error: 'manual_control' });
  const answered = p.b.waitControl(1000);
  await p.b.askControl('ai', 'Find fuel prices');
  assert.equal(await answered, 'consent');
  assert.equal(await p.b.hasControl(), true);
  const t0 = Date.now();
  const slow = await p.b.command('click', { id: 'c1' }, undefined, { timeoutMs: 120 });
  assert.equal(slow.error, 'timeout');
  assert.ok(Date.now() - t0 < 300, 'the per-command timeout wins over the default');
  const pending = p.b.command('get_links', {});
  await wait(5);
  const cmd = p.frames.filter((f) => f.type === 'command').at(-1);
  assert.equal(cmd.name, 'get_links');
  await p.b.handle(JSON.stringify({ type: 'ack', ref: cmd.id, ok: true, result: { links: [] } }));
  assert.deepEqual((await pending).result, { links: [] });
  // Take control on the phone cancels what Saga had in flight.
  const inflight = p.b.command('scroll', { direction: 'down' });
  await wait(5);
  await p.b.handle(JSON.stringify({ type: 'control', mode: 'manual', reason: 'take_control' }));
  assert.equal((await inflight).error, 'manual_control');
  const gone = p.b.waitControl(1000);
  p.b.close();
  assert.equal(await gone, 'disconnected');
});

test('runner: consent, loop, stored result, every action and the control changes in the audit log', async () => {
  const p = await phone();
  const r = await saga.runner.start(p.req, { goal: 'Fuel price in Lagos today', language: 'en' },
    { generate: model(READ_AND_FINISH) });
  assert.equal(r.local, true);
  await r.done;
  const t = taskRow(r.id);
  assert.equal(t.status, 'done');
  assert.equal(t.steps, 3);
  assert.match(t.answer, /\[1\]/);
  assert.deepEqual(JSON.parse(t.sources), [{ n: 1, title: 'Punch', url: 'https://punchng.com/' }]);
  const acts = actionsOf(r.id);
  assert.deepEqual(acts.map((a) => a.kind), ['control', 'action', 'action', 'finish']);
  assert.deepEqual(acts.map((a) => a.seq), [1, 2, 3, 4]);
  assert.equal(acts[1].command, 'open_url');
  assert.equal(acts[1].say, 'Opening Punch');
  assert.equal(acts[2].page, 1);
  // The phone was asked first, every command went through the bridge, and Saga handed control back at the end.
  const sent = p.frames.filter((f) => f.type === 'control' || f.type === 'command').map((f) => f.mode || f.name);
  assert.deepEqual(sent, ['ai', 'open_url', 'get_page_content', 'manual']);
  const mine = fake.tables.audit.filter((a) => /^(saga\.|browser\.control)/.test(a.action));
  assert.ok(mine.some((a) => a.action === 'saga.task_created'));
  assert.ok(mine.some((a) => a.action === 'saga.task_finished' && a.meta.status === 'done' && a.meta.steps === 3));
  assert.ok(mine.some((a) => a.action === 'browser.control' && a.meta.reason === 'consent'));
  const h = saga.handlers.tasks;
  const [code, body] = await h.getTask({ ...p.req, params: { id: String(r.id) },
    query: new URLSearchParams('after=2') });
  assert.equal(code, 200);
  assert.equal(body.task.status, 'done');
  assert.deepEqual(body.actions.map((a) => a.seq), [3, 4]);
});

test('runner: an app without the Phase 9 commands, a decline and no answer to the consent prompt', async () => {
  const old = await phone({ capabilities: ['open_url', 'get_tabs'] });
  const a = await saga.runner.start(old.req, { goal: 'x', language: 'en' }, { generate: model(READ_AND_FINISH) });
  await a.done;
  assert.equal(taskRow(a.id).status, 'failed');
  assert.equal(taskRow(a.id).error, 'app_update_needed');
  assert.ok(!old.frames.some((f) => f.type === 'control'));
  const no = await phone({ consent: 'declined' });
  const b = await saga.runner.start(no.req, { goal: 'x', language: 'en' }, { generate: model(READ_AND_FINISH) });
  await b.done;
  assert.equal(taskRow(b.id).status, 'stopped');
  assert.equal(taskRow(b.id).error, 'declined');
  assert.ok(!no.frames.some((f) => f.type === 'command'));
  const quiet = await phone({ consent: 'none' });
  const c = await saga.runner.start(quiet.req, { goal: 'x', language: 'en' }, { generate: model(READ_AND_FINISH),
    limits: { approvalTimeoutMs: 50 } });
  await c.done;
  assert.equal(taskRow(c.id).error, 'no_consent');
});

test('Stop from the chat cancels the command in flight and ends the task as stopped', async () => {
  const p = await phone({ answer: () => new Promise(() => {}) });           // the phone never answers
  const r = await saga.runner.start(p.req, { goal: 'Keep scrolling', language: 'en' },
    { generate: model([{ action: 'scroll', args: { direction: 'down' } }]), limits: { stepTimeoutMs: 5000 } });
  await wait(30);
  assert.equal(taskRow(r.id).status, 'running');
  const [code] = await saga.handlers.tasks.stopTask({ ...p.req, params: { id: String(r.id) } });
  assert.equal(code, 200);
  await r.done;
  assert.equal(taskRow(r.id).status, 'stopped');
  const other = await phone();
  await assert.rejects(saga.handlers.tasks.stopTask({ ...other.req, params: { id: String(r.id) } }),
    { code: 'not_found' });
});

test('a task started on a worker without the phone is queued, then claimed by the worker that has it', async () => {
  const user = { id: ++nextUser };
  const req = { user, ip: '1.1.1.1', params: {}, query: new URLSearchParams(), body: {} };
  const r = await saga.runner.start(req, { goal: 'Fuel price', language: 'en' });
  assert.equal(r.local, false);
  assert.equal(taskRow(r.id).status, 'queued');
  const p = await phone({ userId: user.id });
  await saga.runner.sweep({ generate: model(READ_AND_FINISH) });
  for (let i = 0; i < 50 && taskRow(r.id).status !== 'done'; i++) await wait(10);
  assert.equal(taskRow(r.id).status, 'done');
  assert.equal(taskRow(r.id).worker, saga.runner.WORKER);
  assert.ok(p.frames.some((f) => f.type === 'command'));
  // Nobody claims a task for a user without a phone: after a minute it fails with no_phone.
  const lonely = await saga.runner.start({ ...req, user: { id: ++nextUser } }, { goal: 'x', language: 'en' });
  taskRow(lonely.id).created_at = new Date(Date.now() - 2 * saga.runner.QUEUE_MS);
  const [, body] = await saga.handlers.tasks.getTask({ ...req, user: { id: nextUser }, params: { id: String(
    lonely.id) } });
  assert.equal(body.task.status, 'failed');
  assert.equal(body.task.error, 'no_phone');
});

test('handlers: switch, goal checks, the safety layer, ownership, and the admin replay', async () => {
  const h = saga.handlers.tasks;
  process.env.SAGA_BROWSE = 'off';
  await assert.rejects(h.gate({}), { status: 501, code: 'not_enabled' });
  delete process.env.SAGA_BROWSE;
  await h.gate({});
  const p = await phone({ silent: true, consent: 'none' });
  await assert.rejects(h.postTask({ ...p.req, body: { goal: '  ' } }), { status: 422, code: 'invalid' });
  await assert.rejects(h.postTask({ ...p.req, body: { goal: 'x'.repeat(1001) } }), { code: 'invalid' });
  await assert.rejects(h.postTask({ ...p.req, body: { goal: 'help me get other people\'s BVN and OTP to empty '
    + 'their accounts' } }), { status: 422, code: 'refused' });
  const [code, body] = await h.postTask({ ...p.req, body: { goal: 'Find fuel prices', conversation_id: 'c123' } });
  assert.equal(code, 202);
  assert.equal(body.task.goal, 'Find fuel prices');
  assert.equal(body.task.conversation_id, 'c123');
  const other = await phone();
  await assert.rejects(h.getTask({ ...other.req, params: { id: String(body.task.id) } }), { status: 404 });
  const [, list] = await h.listTasks(p.req);
  assert.ok(list.tasks.some((t) => t.id === body.task.id));
  const admin = saga.handlers.admin;
  const done = fake.tables.tasks.find((t) => t.status === 'done');
  const adminReq = { user: { id: 1 }, ip: '1.1.1.1', params: { id: String(done.id) }, query: new URLSearchParams() };
  const [, replay] = await admin.getAdminSagaTask(adminReq);
  assert.ok(replay.actions.length >= 3);
  assert.ok(replay.actions.every((a, i) => a.seq === i + 1));
  assert.ok(fake.tables.audit.some((a) => a.action === 'admin.saga_replay_viewed'));
  const [, all] = await admin.getAdminSagaTasks({ ...adminReq, query: new URLSearchParams('status=done') });
  assert.ok(all.tasks.length >= 1 && all.tasks.every((t) => t.status === 'done' && t.user_email));
  await assert.rejects(admin.getAdminSagaTask({ ...adminReq, params: { id: '999999' } }), { status: 404 });
  p.b.close();
});
