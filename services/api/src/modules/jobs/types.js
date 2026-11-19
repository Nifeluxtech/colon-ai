// The job types Colon runs (0.16.0). Handlers that belong to another module call that module's facade, required
// lazily (saga and chat require this module's facade to enqueue, so a top-level require would be a cycle).
//   saga.schedule          one due time of a Saga scheduled check; runs only on the worker holding the user's phone
//                          and enqueues the schedule's next time itself (modules/saga/schedule-jobs.js).
//   saga.schedules_ensure  heals: every active schedule has a waiting job (one per period).
//   chat.reconcile         a chat or Research reply cut off by a restart: its reserved credits are refunded (or
//                          settled when text was saved) and the message is marked interrupted (one per period).
//   jobs.prune             deletes done and cancelled jobs and cron runs older than JOBS_KEEP_DAYS (once a day).
//   research.step          0.17.0: one bounded step of a deep research run (modules/research); queues the next step.
//   research.sweep         0.17.0: resumes a deep research run whose job is gone, or ends it and refunds (per period).
const DAY = 864e5;

function registerAll(registry, cfg, store) {
  const interval = () => Math.max(1, Number(cfg().cronIntervalMin) || 5) * 60e3;
  registry.register('saga.schedule', { where: 'phone', maxAttempts: 3,
    run: (job, ctx) => require('../saga').scheduleJobs.run(job, ctx) });
  registry.register('saga.schedules_ensure', { every: interval, maxAttempts: 2,
    run: () => require('../saga').scheduleJobs.ensure({}) });
  registry.register('chat.reconcile', { every: interval, maxAttempts: 2,
    run: (job, ctx) => require('../chat').reconcile.run({ now: ctx.now }) });
  registry.register('research.step', { maxAttempts: 3,
    timeoutMs: () => require('../../config').research.stepMs + 10000,
    run: (job, ctx) => require('../research').jobs.runStep(job, ctx) });
  registry.register('research.sweep', { every: interval, maxAttempts: 2,
    run: () => require('../research').jobs.sweep({ olderThanMs: 2 * interval() + Number(cfg().leaseMs || 0) }) });
  registry.register('jobs.prune', { every: DAY, maxAttempts: 2,
    run: (job, ctx) => store().prune(new Date(ctx.now.getTime() - Math.max(1, Number(cfg().keepDays) || 14) * DAY)) });
  return registry;
}

module.exports = { registerAll };
