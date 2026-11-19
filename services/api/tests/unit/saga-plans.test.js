// Scheduled browsing, saved routines and messages while a task runs (0.11.0: modules/saga/schedule.js, schedules.js,
// routines.js, guidance.js; 0.16.0: schedule-jobs.js on an in-memory job store). In-memory database
// (tests/helpers/saga-db.js); no phone, no model.
const fake = require('../helpers/saga-db').install();
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/modules/saga/schedule');
const schedules = require('../../src/modules/saga/schedules');
const routines = require('../../src/modules/saga/routines');
const guidance = require('../../src/modules/saga/guidance');
const scheduleJobs = require('../../src/modules/saga/schedule-jobs');
const jobs = require('../../src/modules/jobs');

console.log = () => {};

test('reading a schedule out of a request', () => {
  assert.deepEqual(S.parse('check yolotask every morning and tell me about new tasks'), { cadence: 'daily',
    at_minute: 480, weekday: null, goal: 'check yolotask and tell me about new tasks' });
  assert.equal(S.parse('every Monday at 9am open jumia deals').weekday, 1);
  assert.equal(S.parse('every Monday at 9am open jumia deals').at_minute, 540);
  assert.equal(S.parse('look at nairaland daily at 6:30 pm').at_minute, 18 * 60 + 30);
  assert.equal(S.parse('check my orders every weekday').cadence, 'weekdays');
  assert.equal(S.parse('check the rate hourly').cadence, 'hourly');
  assert.equal(S.parse('open google.com'), null);
});

test('next run in the user\'s time (Lagos, UTC+1), weekdays skip the weekend', () => {
  const s = { cadence: 'daily', at_minute: 480, tz_offset: 60 };
  assert.equal(S.nextRun(s, new Date(Date.UTC(2026, 10, 14, 6, 0))).getTime(), Date.UTC(2026, 10, 14, 7, 0));
  assert.equal(S.nextRun(s, new Date(Date.UTC(2026, 10, 14, 8, 0))).getTime(), Date.UTC(2026, 10, 15, 7, 0));
  // Saturday 14 Nov 2026 -> Monday 16 Nov.
  const wd = S.nextRun({ cadence: 'weekdays', at_minute: 480, tz_offset: 60 }, new Date(Date.UTC(2026, 10, 14, 9)));
  assert.equal(wd.getTime(), Date.UTC(2026, 10, 16, 7, 0));
  assert.equal(S.describe({ cadence: 'weekly', weekday: 1, at_minute: 540 }), 'every Monday at 09:00');
});

test('new since last run: list lines or table rows, compared without markdown or citations', () => {
  const a = S.items('Tasks:\n- Write a blog post [1]\n- Translate a page\n', []);
  const b = S.items('Tasks:\n- **Write a blog post**\n- Design a logo\n', []);
  assert.deepEqual(S.diff(null, a).first, true);
  assert.deepEqual(S.diff(a, b).fresh.map((x) => x.text), ['Design a logo']);
  const t = S.items('', [{ rows: [['Logo', '₦5,000'], ['Logo', '₦5,000']] }]);
  assert.equal(t.length, 1);
});

test('schedules (0.16.0 jobs): create queues the due time, the phone\'s worker runs it once (late when overdue) and '
  + 'queues the next, report, pause cancels', async () => {
    const store = jobs.memoryStore();
    jobs.use({ store });
    const id = await schedules.create(7, { name: 'yolotask', goal: 'check yolotask for new tasks', cadence: 'daily',
      at_minute: 480, weekday: null, tz_offset: 60, conversationId: 'c-1' });
    const row = fake.tables.schedules.find((x) => x.id === id);
    const waiting = () => store.tables.jobs.filter((j) => j.ref === `saga_schedule:${id}` && j.status === 'queued');
    assert.equal(waiting().length, 1);
    assert.equal(waiting()[0].run_at.getTime(), row.next_run_at.getTime());
    // The phone was offline: the due time passed 3 h ago. Its job is still waiting in the table.
    row.next_run_at = new Date(Date.now() - 3 * 3600e3);
    await scheduleJobs.sync(row);
    assert.equal(waiting().length, 1);                                       // the old time's job was cancelled
    const started = [];
    const start = async (s, o) => { started.push({ s, o }); };
    assert.equal((await scheduleJobs.runDue([8], start)).claimed, 0);      // not this user's phone
    assert.equal((await jobs.runBatch({ where: 'cron' })).claimed, 0);    // the cron never runs a phone job
    assert.equal((await scheduleJobs.runDue([7], start)).done, 1);
    assert.equal((await scheduleJobs.runDue([7], start)).claimed, 0);      // the next one is not due yet
    assert.equal(started.length, 1);
    assert.ok(started[0].o.late);
    assert.ok(row.next_run_at > new Date());
    const next = waiting();                                                // re-enqueued for the next due time
    assert.equal(next.length, 1);
    assert.equal(next[0].run_at.getTime(), row.next_run_at.getTime());
    const posted = [];
    const post = async (u, conv, content) => { posted.push({ u, conv, content }); };
    await schedules.complete({ id: 1, schedule_id: id }, { status: 'done', answer: '- Task A\n- Task B' }, { post });
    assert.equal(posted[0].conv, 'c-1');
    assert.match(posted[0].content, /ran late/);
    assert.match(posted[0].content, /First run/);
    await schedules.complete({ id: 2, schedule_id: id }, { status: 'done', answer: '- Task A\n- Task C' }, { post });
    assert.match(posted[1].content, /New since last run \(1\)\*\*\n- Task C/);
    assert.doesNotMatch(posted[1].content, /ran late/);
    const v = schedules.view(await schedules.setStatus(7, id, 'paused'));
    assert.equal(v.status, 'paused');
    assert.equal(v.when, 'every day at 08:00');
    assert.equal(waiting().length, 0);                                     // paused: nothing waits
    await schedules.setStatus(7, id, 'active');
    assert.equal(waiting().length, 1);                                     // resumed: queued again
    await schedules.remove(7, id);
    assert.equal(waiting().length, 0);
  });

test('schedules (0.16.0): a stale job never runs twice; ensure() heals a schedule with no waiting job', async () => {
  const store = jobs.memoryStore();
  jobs.use({ store });
  const id = await schedules.create(9, { name: 'nairaland', goal: 'check nairaland', cadence: 'hourly',
    at_minute: 0, weekday: null, tz_offset: 60, conversationId: 'c-9' });
  const row = fake.tables.schedules.find((x) => x.id === id);
  row.next_run_at = new Date(Date.now() - 60e3);
  await scheduleJobs.sync(row);
  // A worker that held the job died after starting the task: its lease ran out, another worker takes the job over,
  // but the due time was already taken (next_run_at moved on), so the task is not started again.
  const [job] = await jobs.instance().claim({ types: ['saga.schedule'], users: [9], limit: 1, leaseMs: 1 });
  const due = { ...row };
  const started = [];
  await scheduleJobs.run(job, { start: async (s) => { started.push(s.id); }, now: new Date() });
  assert.equal(started.length, 1);
  await scheduleJobs.run({ ...job, payload: { schedule_id: id } }, { start: async (s) => { started.push(s.id); },
    now: new Date() });
  assert.equal(started.length, 1);
  assert.ok(row.next_run_at > due.next_run_at);
  store.tables.jobs.forEach((j) => { j.status = 'cancelled'; });           // lost every job (e.g. a bad deploy)
  assert.deepEqual(await scheduleJobs.ensure({ users: [9] }), { added: 1 });
  assert.deepEqual(await scheduleJobs.ensure({ users: [9] }), { added: 0 });
  await schedules.remove(9, id);
});

test('routines: steps from the log (personal data stays hidden), a replay prompt that re-plans', async () => {
  const steps = routines.fromActions([
    { kind: 'action', tool: 'openUrl', ok: true, args: { url: 'https://x.com/compose' }, say: 'Opening' },
    { kind: 'action', tool: 'fill', ok: true, args: { id: 'c2', value: 'Daily update: shipped 0.11' }, say: 'Typing' },
    { kind: 'action', tool: 'fill', ok: true, args: { id: 'c3', value: '[hidden: 18 characters]' } },
    { kind: 'action', tool: 'click', ok: false, args: { id: 'c9' } },
    { kind: 'action', tool: 'click', ok: true, args: { id: 'c4' }, approved: 'approved', say: 'Posting',
      url: 'https://x.com/compose?draft=1' },
  ]);
  assert.equal(steps.length, 4);
  assert.equal(steps[2].value, undefined);
  assert.equal(steps[3].approved, true);
  const p = routines.promptFor({ name: 'post my daily update', steps });
  assert.match(p, /saved routine "post my daily update"/);
  assert.match(p, /re-plan/);
  assert.match(p, /still ask/);
  assert.throws(() => routines.cleanName('<script>'), /short name/);
  const saved = await routines.save(7, { name: 'post my daily update', goal: 'Post my update on X', steps });
  assert.equal(routines.view(saved).steps.length, 4);
});

test('messages while a task runs: kept with secrets hidden, read once, at most 5 waiting', async () => {
  const kept = await guidance.add(7, 41, 'my password is hunter2, and use the cheaper one');
  assert.doesNotMatch(kept, /hunter2/);
  assert.match(kept, /cheaper/);
  assert.deepEqual((await guidance.take(41)).length, 1);
  assert.deepEqual(await guidance.take(41), []);
  for (let i = 0; i < 5; i++) await guidance.add(7, 42, `note ${i}`);
  await assert.rejects(guidance.add(7, 42, 'one more'), /already has a few messages/);
});
