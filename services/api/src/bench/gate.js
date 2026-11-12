// Colon benchmark gate (Phase 5 release standard: "every model change is re-benchmarked first").
// A model may go into routing (added, its id or provider changed, or switched back on) only when a finished
// Colon benchmark run for exactly that provider + model exists that is newer than BENCH_MAX_AGE_DAYS
// (default 30). BENCH_GATE=off switches the gate off (e.g. on a fresh install); a Super Admin can skip it
// once with a written reason, which is audited.
const DEFAULT_MAX_AGE_DAYS = 30;

const enabled = () => String(process.env.BENCH_GATE || 'on').toLowerCase() !== 'off';
const maxAgeDays = () => {
  const n = Number(process.env.BENCH_MAX_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_DAYS;
};

/**
 * check({ provider, model }, runs, { now, maxAgeDays }) -> { ok, reason, run }
 * runs: eval_runs-like rows { provider, model, kind, status, created_at }. Pure, so it is unit-tested directly.
 */
function check({ provider, model }, runs, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const days = opts.maxAgeDays || maxAgeDays();
  const mine = (runs || []).filter(r => r && r.kind === 'bench' && r.status === 'done' && r.provider === provider && r.model === model)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!mine.length) return { ok: false, reason: `${provider}:${model} has no Colon benchmark run. Run "npm run bench -- --models ${provider}:${model} --save" first.`, run: null };
  const run = mine[0];
  const ageDays = (now - new Date(run.created_at).getTime()) / 86400000;
  if (ageDays > days) return { ok: false, reason: `The last Colon benchmark of ${provider}:${model} is ${Math.floor(ageDays)} days old (limit ${days}). Re-run the benchmark first.`, run };
  return { ok: true, reason: 'benchmarked', run };
}

const fetchRuns = (db, provider, model) => db.query(
  "SELECT id, provider, model, kind, status, score, created_at FROM eval_runs WHERE provider = ? AND model = ? AND kind = 'bench' AND status = 'done' ORDER BY created_at DESC LIMIT 5",
  [provider, model]);

/**
 * For the admin save paths. Resolves with { ok, skipped?, run? }; throws 409 needs_benchmark when refused.
 * skipReason: a Super Admin's written reason to skip the gate once (the caller audits it).
 */
async function requireBenchmark(db, { provider, model }, { isSuper = false, skipReason = '' } = {}) {
  if (!enabled()) return { ok: true, skipped: 'gate_off' };
  if (skipReason && isSuper) return { ok: true, skipped: 'super_admin' };
  let runs;
  try { runs = await fetchRuns(db, provider, model); }
  catch (e) {
    // Database before migration 0005 (no provider/kind columns): refuse with a clear message rather than guess.
    throw Object.assign(new Error('The benchmark gate could not read eval_runs (run migration 0005).'), { status: 409, code: 'needs_benchmark' });
  }
  const r = check({ provider, model }, runs);
  if (!r.ok) throw Object.assign(new Error(r.reason), { status: 409, code: 'needs_benchmark', field: 'model' });
  return r;
}

module.exports = { check, requireBenchmark, enabled, maxAgeDays, DEFAULT_MAX_AGE_DAYS };
