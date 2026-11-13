#!/usr/bin/env node
// The Colon benchmark (Phase 5). Runs every item of bench/sets/*.json against each candidate model through the
// app's own provider client and writes bench/results/<run>.json and .md. Docs: docs/phases/phase-5-benchmark.md.
//
//   npm run bench                                   all candidates, all sets (new run id)
//   npm run bench -- --probe                        one tiny request per model: does each endpoint answer, how fast
//   npm run bench -- --models nvidia:z-ai/glm-5.3-flash,gemini:gemma-4-26b-a4b-it --sets waec,jamb
//   npm run bench -- --resume [run]                 continue a stopped run (latest run when no id is given)
//   npm run bench -- --run 2026-11-12 --report      rebuild the report only (add --regrade to re-grade saved replies)
//   npm run bench -- --run 2026-11-12 --judge gemini:gemma-4-26b-a4b-it   LLM-judge the language sets
//   npm run bench -- --run 2026-11-12 --save        store the run in eval_runs (Admin › Evaluation); needs DB_* env
//   npm run bench -- --gate nvidia:z-ai/glm-5.3-flash   exit 1 unless a fresh benchmark of that model exists
// Options: --concurrency 1 (per model, max 4; --concurrency-nvidia 2 sets it per provider), --retry-errors [code],
// --rpm-nvidia 30 / --inflight-nvidia 4 (provider-wide limits, all models together; 0 = none), --reset-unreliable,
// --order interleave, --gap-ms 1500, --limit N (items per set), --max-tokens 2048, --first-token-ms 60000 (a model's
// own options in src/modules/bench/candidates.js win). BENCH_SANDBOX=1 drops the client's own key headers
// (sandbox key injection only). Ctrl-C / SIGTERM marks running models "stopped"; --resume picks them up.
const fs = require('fs');
const path = require('path');
const runner = require('../src/modules/bench').runner;
const report = require('../src/modules/bench').report;
const gate = require('../src/modules/bench').gate;
const ckpt = require('../src/modules/bench').checkpoint;
const { limitersFor } = require('../src/modules/bench').limiter;
const probe = require('../src/modules/bench').probe;

const RESULTS = process.env.BENCH_RESULTS_DIR ? path.resolve(process.env.BENCH_RESULTS_DIR) : path.resolve(__dirname,
  '../bench/results');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    o[k] = v;
  }
  return o;
}

const readJsonl = ckpt.readJsonl;
const now = () => new Date().toISOString();

async function main() {
  const o = args(process.argv.slice(2));
  if (o.gate) return runGate(o);
  if (o.probe) return runProbe(o);
  const resume = o.resume === true ? ckpt.latestRun(RESULTS) : o.resume ? String(o.resume) : null;
  if (o.resume && !resume) throw new Error('Nothing to resume: no run under bench/results/runs');
  if (resume) console.log(`Resuming run ${resume} (${path.join(RESULTS, 'runs', resume)})`);
  const run = resume || (o.run && o.run !== true ? String(o.run) : new Date().toISOString().slice(0, 16).replace(
    /[:T]/g, '-'));
  const dir = path.join(RESULTS, 'runs', run);
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(dir, 'meta.json');
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { run,
    suite: runner.SUITE_VERSION, started: now(), models: [], settings: {} };

  const sets = runner.loadSets(runner.SETS_DIR, o.sets && o.sets !== true ? String(o.sets).split(',') : null);
  const limit = Number(o.limit) || 0;
  const bySet = sets.map(s => (limit ? s.items.slice(0, limit) : s.items));
  // --order interleave: one item from each set in turn, so a run cut short still covers every set evenly.
  const items = o.order === 'interleave'
    ? Array.from({ length: Math.max(0, ...bySet.map(l => l.length)) }, (_, i) => bySet.map(l => l[i]).filter(
      Boolean)).flat()
    : bySet.flat();
  const candidates = o.models && o.models !== true ? String(o.models).split(',').map(runner.parseCandidate)
    : meta.models.length && (resume || o.report || o.judge || o.save) ? meta.models.map(runner.parseCandidate) :
      runner.CANDIDATES;
  for (const c of candidates) if (!meta.models.includes(runner.keyOf(c))) meta.models.push(runner.keyOf(c));

  const opts = {
    fetch: process.env.BENCH_SANDBOX === '1' ? runner.sandboxFetch() : undefined,
    concurrency: Number(o.concurrency) || 1, gapMs: o['gap-ms'] !== undefined ? Number(o['gap-ms']) : 1500,
    maxTokens: Number(o['max-tokens']) || 2048, firstTokenTimeoutMs: Number(o['first-token-ms']) || 60000,
    temperature: process.env.BENCH_TEMPERATURE !== undefined ? Number(process.env.BENCH_TEMPERATURE) : undefined,
  };
  const limits = Object.fromEntries([...new Set(candidates.map(c => c.provider))].map(p => [p, {
    ...(o[`rpm-${p}`] !== undefined || process.env[`BENCH_RPM_${p.toUpperCase()}`] ? { rpm: Number(o[`rpm-${p}`]
      ?? process.env[`BENCH_RPM_${p.toUpperCase()}`]) } : {}),
    ...(o[`inflight-${p}`] !== undefined ? { concurrency: Number(o[`inflight-${p}`]) } : {}) }]));
  const limiters = limitersFor(candidates.map(c => c.provider), limits);
  meta.settings = { max_tokens: opts.maxTokens, first_token_timeout_ms: opts.firstTokenTimeoutMs,
    concurrency_per_model: opts.concurrency, gap_ms: opts.gapMs, retries: 2,
    temperature: opts.temperature === undefined ? 'provider default' : opts.temperature, limit_per_set: limit || null,
    provider_limits: Object.fromEntries(Object.entries(limiters).map(([k, l]) => [k, { rpm: l.stats().rpm,
      inflight: l.stats().concurrency }])),
    per_model: Object.fromEntries(candidates.filter(c => c.opts || runner.bodyOf(c)).map(c => [runner.keyOf(c), {
      body: runner.bodyOf(c), ...(c.opts || {}), cfg: runner.cfgOf(c, opts) }])) };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  if (!o.report && !o.judge && !o.save) {
    const running = new Map();            // jsonl file -> items answered so far
    const stop = (sig) => {               // Ctrl-C / kill: leave a checkpoint that --resume understands
      for (const [f, n] of running) ckpt.writeStatus(f, { state: 'stopped', reason: sig, done: n });
      console.log(`\n${sig}: stopped. Continue with: npm run bench -- --resume ${run}`);
      process.exit(130);
    };
    process.once('SIGINT', () => stop('SIGINT')); process.once('SIGTERM', () => stop('SIGTERM'));
    // Every model runs in parallel (one request at a time each by default); a provider's limiter keeps all of its
    // models together under that provider's rate limit.
    await Promise.all(candidates.map(async (c) => {
      const file = path.join(dir, `${runner.slug(runner.keyOf(c))}.jsonl`);
      const cfg = runner.cfgOf(c, opts);
      const status = ckpt.readStatus(file);
      if (status && status.unreliable && !o['reset-unreliable']) { console.log(
        `${runner.keyOf(c)}: marked unreliable, skipped (--reset-unreliable to ask again)`); return; }
      // "--retry-errors rate_limited" re-asks only errors with that code (e.g. 429s caused by our own load).
      const p = ckpt.plan(readJsonl(file), { cfg, retryErrors: o['retry-errors'] === true ? true
        : o['retry-errors'] ? String(o['retry-errors']) : false });
      const todo = items.filter(i => !p.done.has(i.id)).length;
      console.log(`${runner.keyOf(c)}: ${todo} items to run (${p.done.size} kept${p.stale ? `, ${p.stale} with other `
        + 'settings re-asked' : ''}${p.errors ? `, ${p.errors} errors re-asked` : ''})`);
      if (!todo) { ckpt.writeStatus(file, { state: 'done', cfg, done: p.done.size, total: items.length }); return; }
      running.set(file, p.done.size);
      ckpt.writeStatus(file, { state: 'running', cfg, done: p.done.size, total: items.length, reason: null });
      const concurrency = Number(o[`concurrency-${c.provider}`]) || opts.concurrency;
      let n = p.done.size;
      const r = await runner.runModel(c, items, { ...opts, concurrency, limiter: limiters[c.provider], done: p.done,
        prior: p.prior, onResult: (row) => {
          fs.appendFileSync(file, JSON.stringify(row) + '\n');
          running.set(file, ++n);
          if (n % 5 === 0) ckpt.writeStatus(file, { done: n });
          console.log(`${runner.keyOf(c)} ${row.id} ${row.error ? `ERROR ${row.error.slice(0, 100)}` : `${row.pass
            ? 'pass' : 'fail'} ${row.score} ft=${row.first_token_ms}ms`}`);
        } });
      running.delete(file);
      ckpt.writeStatus(file, { state: r.fatal ? 'failed' : r.unreliable ? 'unreliable' : 'done', done: n,
        reason: r.fatal || null });
      if (r.fatal) console.log(`${runner.keyOf(c)}: stopped, ${r.fatal} (fix and --resume ${run})`);
      else if (r.unreliable) console.log(`${runner.keyOf(c)}: more than 50% errors, stopped (unreliable)`);
    }));
  }

  if (o.judge && o.judge !== true) {
    const judge = runner.parseCandidate(String(o.judge));
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    for (const c of candidates) {
      const file = path.join(dir, `${runner.slug(runner.keyOf(c))}.jsonl`);
      const jfile = file.replace(/\.jsonl$/, '.judge.jsonl');
      const have = new Set(readJsonl(jfile).map(r => r.id));
      for (const row of readJsonl(file)) {
        const it = byId[row.id];
        if (!it || !it.judge || have.has(row.id) || row.error) continue;
        const score = await runner.judgeItem(judge, it, row, { ...opts, firstTokenTimeoutMs: 60000 });
        fs.appendFileSync(jfile, JSON.stringify({ id: row.id, judge: score, by: runner.keyOf(judge) }) + '\n');
        console.log(`judge ${runner.keyOf(c)} ${row.id} ${score}`);
        if (opts.gapMs) await new Promise(r => setTimeout(r, opts.gapMs));
      }
    }
    meta.judge = runner.keyOf(judge);
  }

  // Report
  meta.finished = meta.finished && (o.report || o.judge || o.save) ? meta.finished : now();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  const wanted = new Set(items.map(i => i.id));
  const models = meta.models.map(runner.parseCandidate).map((c) => {
    const file = path.join(dir, `${runner.slug(runner.keyOf(c))}.jsonl`);
    const judged = Object.fromEntries(readJsonl(file.replace(/\.jsonl$/, '.judge.jsonl')).filter(j =>
      j.judge !== null).map(j => [j.id, j.judge]));
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    const rows = ckpt.reportRows(readJsonl(file), runner.cfgOf(c, opts)).filter(r => wanted.has(r.id))
      .map(r => (o.regrade ? runner.regrade(r, byId[r.id]) : r))
      .map(r => (judged[r.id] !== undefined ? { ...r, judge: judged[r.id] } : r));
    const st = ckpt.readStatus(file);
    const unreliable = !!(st && st.unreliable);
    const failed = st && st.state === 'failed' ? st.reason || 'failed' : null;
    return { provider: c.provider, model: c.model, note: c.note, rows, unreliable, failed, expected: wanted.size };
  }).filter(m => m.rows.length);
  const rep = report.buildReport({ run, suite: meta.suite, started: meta.started, finished: meta.finished,
    settings: { ...meta.settings, judge: meta.judge || null }, models });
  fs.writeFileSync(path.join(RESULTS, `${run}.json`), JSON.stringify(rep, null, 2));
  fs.writeFileSync(path.join(RESULTS, `${run}.md`), report.markdown(rep));
  // For Admin › Evaluation without database access from here: POST this file's body to /admin/evaluation/bench.
  fs.writeFileSync(path.join(RESULTS, `${run}.eval.json`), JSON.stringify({ runs: report.evalRows(rep) }, null, 2));
  console.log(`\nReport: bench/results/${run}.md`);
  for (const m of rep.models) {
    const status = m.status === 'done' ? '' : `(${m.status}) `;
    console.log(`${status}${m.key}: score ${m.score}, accuracy ${m.components.accuracy}, `
      + `ft median ${m.overall.first_token_ms.median} ms, errors ${m.overall.error_rate}`);
  }

  if (o.save) {
    const db = require('../src/db');
    const ids = await report.saveRuns(db, rep);
    console.log(`Saved ${ids.length} eval_runs rows: ${ids.join(', ')}`);
    await (db.getPool() && db.getPool().end());
  }
}

// Probe: one tiny request per model (in parallel), to check endpoints and the key before a long run.
async function runProbe(o) {
  const cs = o.models && o.models !== true ? String(o.models).split(',').map(runner.parseCandidate) : runner.CANDIDATES;
  const fetch = process.env.BENCH_SANDBOX === '1' ? runner.sandboxFetch() : undefined;
  const providerConfig = (id) => runner.providerConfig(id);
  const res = await Promise.all(cs.map(c => probe.probe(c, { fetch, providerConfig,
    firstTokenTimeoutMs: Number(o['first-token-ms']) || undefined })));
  for (const r of res) console.log(probe.line(r));
  process.exitCode = res.every(r => r.ok) ? 0 : 1;
}

// Gate: is there a fresh, finished benchmark of this model? Looks at local reports, and eval_runs when DB_* env is set.
async function runGate(o) {
  const c = runner.parseCandidate(String(o.gate));
  const runs = [];
  if (fs.existsSync(RESULTS)) {
    for (const f of fs.readdirSync(RESULTS).filter(x => x.endsWith('.eval.json'))) {
      try { runs.push(...JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')).runs); } catch { /* unreadable */ }
    }
  }
  if (process.env.DB_NAME) {
    const db = require('../src/db');
    try { runs.push(...await db.query(
      "SELECT provider, model, kind, status, created_at FROM eval_runs WHERE kind = 'bench'")); } finally { await (
      db.getPool() && db.getPool().end()); }
  }
  const r = gate.check(c, runs, { maxAgeDays: Number(o['max-age-days']) || undefined });
  console.log(`${r.ok ? 'OK' : 'REFUSED'}: ${runner.keyOf(c)} — ${r.reason}${r.run ? ` (run of ${new Date(
    r.run.created_at).toISOString()}, score ${r.run.score})` : ''}`);
  process.exitCode = r.ok ? 0 : 1;
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
