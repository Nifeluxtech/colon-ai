// What a Saga task carries beyond its goal (0.11.0), for runner.js: the phone's commands (hello capabilities, which
// decide the tools Saga is offered), speed mode, a saved routine's recorded steps, the user's messages sent while it
// works, and a schedule (its consent flag on the phone, the tick that runs its jobs, the report when it ends).
const log = require('../../shared/logger');
const store = require('./store');
const routines = require('./routines');
const guidanceStore = require('./guidance');
const schedules = require('./schedules');
const scheduleJobs = require('./schedule-jobs');

/** options(task, bridge) -> { caps, speed, routine, scheduleId } (the task row is read again for its origin). */
async function options(task, bridge) {
  const row = (await store.get(task.id).catch(() => null)) || task;
  const caps = bridge && bridge.state && Array.isArray(bridge.state.capabilities) ? bridge.state.capabilities : null;
  let routine = null;
  if (row.routine_id) {
    routine = routines.view(await routines.getFor(task.user_id, row.routine_id).catch(() => null));
    if (routine) routines.used(routine.id).catch(() => {});
  }
  task.schedule_id = row.schedule_id || null;
  return { caps: caps && caps.length ? caps : null, speed: Boolean(Number(row.speed)), routine,
    scheduleId: task.schedule_id };
}

const withRoutine = (routine, history) => (routine ? `${routines.promptFor(routine)}${history ? `\n\n${history}` : ''}`
  : history);

/** The user's messages since Saga's last decision (empty on any database trouble: the task goes on). */
const guidance = (taskId) => guidanceStore.take(taskId).catch(() => []);

/** The phone's consent flag for a scheduled run: { id, name } (the phone may allow schedules the user set up). */
async function scheduledFor(task) {
  const row = task.schedule_id === undefined ? await store.get(task.id).catch(() => null) : task;
  const id = row && row.schedule_id;
  if (!id) return null;
  const s = await schedules.get(id).catch(() => null);
  return s ? { id: Number(s.id), name: String(s.name).slice(0, 80) } : null;
}

// Posts a message in one of the user's chats (lazy: the chat module requires this one for chat deletion).
async function post(userId, conv, content, sources) {
  const chat = require('../chat');
  const c = await chat.store.getConv(userId, conv);
  await chat.store.insertMessage(c, { role: 'assistant', content: String(content).slice(0, 60000),
    sources: (sources || []).slice(0, 20).map((s, i) => ({ n: Number(s.n) || i + 1, title: String(s.title || '')
      .slice(0, 200), url: String(s.url || '').slice(0, 2000), snippet: '' })).filter((s) => /^https?:/.test(s.url)),
    status: 'complete', origin: 'browse' });
  await chat.store.touch(c, { preview: String(content).replace(/[*_]/g, '').slice(0, 200) });
}

/** A task ended: a scheduled run reports in its chat (never fails the task's own ending). */
async function finished(task, r) {
  try {
    const row = task.schedule_id !== undefined ? task : await store.get(task.id);
    if (!row || !row.schedule_id) return null;
    return await schedules.complete({ id: task.id, schedule_id: row.schedule_id }, r, { post });
  } catch (e) {
    log.warn('saga_schedule_report_failed', { task: task.id, err: e.message });
    return null;
  }
}

/** The scheduler's tick for the users whose phones are on this worker (0.16.0: their due 'saga.schedule' jobs; every
 *  `ensureEvery`th call also makes sure each of their active schedules has a waiting job). */
let ticks = 0;
async function tick(users, start, o = {}) {
  if (++ticks % (o.ensureEvery || 10) === 1) await scheduleJobs.ensure({ users }).catch((e) =>
    log.warn('saga_schedule_ensure_failed', { err: e.message }));
  return scheduleJobs.runDue(users, (s, { late }) => {
    log.warn('saga_schedule_run', { schedule: s.id, user: s.user_id, late: Boolean(late) });
    return start({ user: { id: s.user_id }, ip: '' }, { goal: s.goal, language: s.language,
      conversationId: s.conversation_id, mode: 'ai', scheduleId: s.id });
  });
}

module.exports = { options, withRoutine, guidance, scheduledFor, finished, tick, post };
