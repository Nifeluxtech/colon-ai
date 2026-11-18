// Saga's scheduled checks on the job table (0.16.0, Blueprint C12). Each due time of an active schedule is one
// 'saga.schedule' job (run_at = next_run_at, idempotency key = schedule + due time, ref = saga_schedule:<id>):
//   sync(s)      keeps the schedule's one waiting job in step after create, pause / resume and run now (pausing
//                cancels it; a new due time cancels the old one). Never throws: ensure() heals a missed sync.
//   run(job)     on the API worker that holds the user's phone (the job type is where: 'phone'): claims the due time
//                (schedules.claimDue, atomic), starts the Saga task, then enqueues the next due time. A stale job (the
//                schedule was paused, deleted or moved) just finishes; a due time already taken is not run twice.
//   runDue       what the runner's light tick calls for the users whose phones are connected to this worker.
//   ensure       every active schedule has a waiting job (the cron's saga.schedules_ensure, and the phone tick).
// Nothing about running changes for the user: same times, same "ran late" report, same approvals. Saga tasks are not
// charged credits (BILLING_CREDITS_SAGA is "not charged yet"), so scheduled runs are not either.
const jobs = require('../jobs');
const log = require('../../shared/logger');

const TYPE = 'saga.schedule';
const refOf = (id) => `saga_schedule:${Number(id)}`;
const keyOf = (s) => `${TYPE}:${Number(s.id)}:${new Date(s.next_run_at).toISOString()}`;

async function sync(s) {
  if (!s) return null;
  try {
    if (s.status !== 'active') { await jobs.cancelRef(refOf(s.id)); return null; }
    const key = keyOf(s);
    const r = await jobs.enqueue(TYPE, { schedule_id: Number(s.id) }, { userId: s.user_id, runAt: s.next_run_at, key,
      ref: refOf(s.id), maxAttempts: 3, revive: true });
    await jobs.cancelRef(refOf(s.id), key);
    return r;
  } catch (e) {
    log.warn('saga_schedule_job_sync_failed', { schedule: s.id, err: e.message });
    return null;
  }
}

/** A deleted schedule's waiting job goes too. */
const drop = (id) => jobs.cancelRef(refOf(id)).catch((e) => log.warn('saga_schedule_job_drop_failed',
  { schedule: id, err: e.message }));

async function run(job, ctx = {}) {
  const schedules = require('./schedules');
  const s = await schedules.get(job.payload && job.payload.schedule_id);
  if (!s) return { skipped: 'gone' };
  if (s.status !== 'active') return { skipped: 'paused' };
  const now = ctx.now || new Date();
  if (new Date(s.next_run_at) > now) { await sync(s); return { skipped: 'not_due' }; }
  if (typeof ctx.start !== 'function') {
    throw Object.assign(new Error('runs only on the worker holding the phone'), { code: 'no_phone' });
  }
  const claimed = await schedules.claimDue(s, now);
  if (claimed) {
    try { await ctx.start(s, claimed); } catch (e) {        // as before 0.16.0: the next due time tries again
      log.warn('saga_schedule_start_failed', { schedule: s.id, err: e.message });
    }
  }
  await sync(await schedules.get(s.id));
  return { started: Boolean(claimed) };
}

/** runDue(users, start): runs the due schedule jobs of these users (their phones are on this worker). */
function runDue(users, start) {
  if (!users || !users.length) return Promise.resolve({ claimed: 0 });
  return jobs.runBatch({ where: 'phone', users, limit: 20, budgetMs: 20000, ctx: { start } });
}

/** ensure({ users }): enqueues a job for each active schedule (of these users, or all) that has none waiting. */
async function ensure(o = {}) {
  const schedules = require('./schedules');
  const all = await schedules.active(o.users || null);
  if (!all.length) return { added: 0 };
  const live = new Set(await jobs.liveRefs(all.map((s) => refOf(s.id))));
  let added = 0;
  for (const s of all) {
    if (live.has(refOf(s.id))) continue;
    const r = await sync(s);
    if (r && r.created) added++;
  }
  return { added };
}

module.exports = { sync, drop, run, runDue, ensure, refOf, keyOf, TYPE };
