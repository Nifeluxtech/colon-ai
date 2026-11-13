// Per-provider request limiter for the benchmark: every model on one provider shares one key, so the provider's
// free-tier limits apply to all of them together (NVIDIA build.nvidia.com: about 40 requests per minute per key).
// A limiter caps requests in flight (`concurrency`) and request starts per rolling minute (`rpm`); 0 = no cap.
// Every attempt, retries included, goes through it.

// Defaults chosen below the published free tiers. Override per run with --rpm-<provider> / --inflight-<provider>.
const PROVIDER_LIMITS = {
  nvidia: { rpm: 30, concurrency: 4 },
  gemini: { rpm: 0, concurrency: 0 },
};

const realSleep = (ms) => new Promise(r => setTimeout(r, ms));

/** createLimiter({ rpm, concurrency, now, sleep }) -> { acquire() -> Promise<release()>, stats() } */
function createLimiter({ rpm = 0, concurrency = 0, now = Date.now, sleep = realSleep } = {}) {
  const starts = [];                 // start times inside the rolling minute
  let inFlight = 0, waitedMs = 0;
  const waiters = [];                // resolvers waiting for a free slot (FIFO)
  let gate = Promise.resolve();      // serialises acquire() so requests start in arrival order

  const freeSlot = () => {
    if (!concurrency || inFlight < concurrency) return Promise.resolve();
    return new Promise(r => waiters.push(r));
  };
  async function rateWait() {
    if (!rpm) return;
    for (;;) {
      const t = now();
      while (starts.length && t - starts[0] >= 60000) starts.shift();
      if (starts.length < rpm) return;
      const ms = 60000 - (t - starts[0]) + 5;
      waitedMs += ms;
      await sleep(ms);
    }
  }
  function acquire() {
    const turn = gate.then(async () => {
      await freeSlot();
      inFlight++;
      await rateWait();
      starts.push(now());
    });
    gate = turn.catch(() => {});
    return turn.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight--;
        const next = waiters.shift();
        if (next) next();
      };
    });
  }
  return { acquire, stats: () => ({ rpm, concurrency, inFlight, waitedMs }) };
}

/** limitersFor(providerIds, overrides { nvidia: { rpm, concurrency } }) -> { [provider]: limiter } */
function limitersFor(ids, overrides = {}, deps = {}) {
  const out = {};
  for (const id of new Set(ids)) {
    const d = PROVIDER_LIMITS[id] || { rpm: 0, concurrency: 0 };
    const o = overrides[id] || {};
    out[id] = createLimiter({ rpm: o.rpm !== undefined ? o.rpm : d.rpm,
      concurrency: o.concurrency !== undefined ? o.concurrency : d.concurrency, ...deps });
  }
  return out;
}

module.exports = { createLimiter, limitersFor, PROVIDER_LIMITS };
