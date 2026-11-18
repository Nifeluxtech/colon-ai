// Job types (0.16.0): what each `colon_jobs.type` does and who may run it.
//   run(job, ctx)   the handler: job.payload is parsed JSON; ctx carries the runner's tools (ctx.start on the worker
//                   that holds the phone, ctx.now, ctx.log). Throw to fail (retried with backoff); return to finish.
//   where           'cron'  any runner: the cron CLI, the HTTP trigger, the optional in-process fallback.
//                   'phone' only the API worker that holds the user's phone (WebSocket): Saga's scheduled runs.
//   every           ms: a recurring system job, enqueued once per period by the dispatcher (idempotency key per slot).
//   maxAttempts, leaseMs, timeoutMs   per-type overrides of the JOBS_* settings.
const WHERE = ['cron', 'phone'];

function create() {
  const types = new Map();
  function register(type, def) {
    if (!/^[a-z][a-z0-9_]*\.[a-z0-9_.]+$/.test(type)) throw new Error(`jobs: bad type name ${type}`);
    if (typeof def.run !== 'function') throw new Error(`jobs: ${type} has no run()`);
    const where = def.where || 'cron';
    if (!WHERE.includes(where)) throw new Error(`jobs: ${type} where must be ${WHERE.join(' or ')}`);
    types.set(type, { ...def, type, where });
    return types.get(type);
  }
  return {
    register,
    get: (type) => types.get(type) || null,
    has: (type) => types.has(type),
    all: () => [...types.values()],
    typesFor: (where) => [...types.values()].filter((d) => d.where === where).map((d) => d.type),
    recurring: () => [...types.values()].filter((d) => d.every),
  };
}

module.exports = { create, WHERE };
