#!/usr/bin/env node
// The Colon benchmark (Phase 5). Runs every item of bench/sets/*.json against each candidate model through the
// app's own provider client and writes bench/results/<run>.json and .md. Docs: docs/phase-5-benchmark.md.
//
//   npm run bench                                   all candidates, all sets (new run id)
//   npm run bench -- --models nvidia:z-ai/glm-5.3-flash,gemini:gemma-4-26b-a4b-it --sets waec,jamb
//   npm run bench -- --run 2026-11-12 ...           resume a run (finished items are skipped)
//   npm run bench -- --run 2026-11-12 --report      rebuild the report only (add --regrade to re-grade saved replies)
//   npm run bench -- --run 2026-11-12 --judge gemini:gemma-4-26b-a4b-it   LLM-judge the language sets
//   npm run bench -- --run 2026-11-12 --save        store the run in eval_runs (Admin › Evaluation); needs DB_* env
//   npm run bench -- --gate nvidia:z-ai/glm-5.3-flash   exit 1 unless a fresh benchmark of that model exists
// Options: --concurrency 1 (per model, max 4; --concurrency-nvidia 1 sets it per provider), --retry-errors [code],
// --order interleave, --gap-ms 1500, --limit N (items per set), --max-tokens 2048,
//          --first-token-ms 60000. BENCH_SANDBOX=1 drops the client's own key headers (sandbox key injection only).
const fs = require('fs');
const path = require('path');
const runner = require('../src/modules/bench').runner;
const report = require('../src/modules/bench').report;
const gate = require('../src/modules/bench').gate;

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

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try {
  return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const now = () => new Date().toISOString();

async function main() {
  const o = args(process.argv.slice(2));
  if (o.gate) return runGate(o);
  const run = o.run && o.run !== true ? String(o.run) : new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
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
    : meta.models.length && (o.report || o.judge || o.save) ? meta.models.map(runner.parseCandidate) :
      runner.CANDIDATES;
  for (const c of candidates) if (!meta.models.includes(runner.keyOf(c))) meta.models.push(runner.keyOf(c));

  const opts = {
    fetch: process.env.BENCH_SANDBOX === '1' ? runner.sandboxFetch() : undefined,
    concurrency: Number(o.concurrency) || 1, gapMs: o['gap-ms'] !== undefined ? Number(o['gap-ms']) : 1500,
    maxTokens: Number(o['max-tokens']) || 2048, firstTokenTimeoutMs: Number(o['first-token-ms']) || 60000,
    temperature: process.env.BENCH_TEMPERATURE !== undefined ? Number(process.env.BENCH_TEMPERATURE) : undefined,
  };
  meta.settings = { max_tokens: opts.maxTokens, first_token_timeout_ms: opts.firstTokenTimeoutMs,
    concurrency_per_model: opts.concurrency, gap_ms: opts.gapMs, retries: 2,
    temperature: opts.temperature === undefined ? 'provider default' : opts.temperature, limit_per_set: limit || null };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  if (!o.report && !o.judge && !o.save) {
    // Every model runs in parallel (one request at a time each by default), so slow hosts don't hold up fast ones.
    await Promise.all(candidates.map(async (c) => {
      const file = path.join(dir, `${runner.slug(runner.keyOf(c))}.jsonl`);
      const statusFile = file.replace(/\.jsonl$/, '.status.json');
      // Latest row per item; with --retry-errors, items whose latest row is an error are asked again.
      const latestRows = Object.values(Object.fromEntries(readJsonl(file).map(r => [r.id, r])));
      // "--retry-errors rate_limited" retries only errors with that code (e.g. 429s caused by our own load).
      const retryCode = typeof o['retry-errors'] === 'string' ? o['retry-errors'] : null;
      const prior = o['retry-errors'] ? latestRows.filter(r => !r.error || (retryCode && !r.error.startsWith(
        retryCode))) : latestRows;
      const done = new Set(prior.map(r => r.id));
      if (fs.existsSync(statusFile) && JSON.parse(fs.readFileSync(statusFile, 'utf8')).unreliable) { console.log(
        `${runner.keyOf(c)}: marked unreliable, skipped`); return; }
      console.log(`${runner.keyOf(c)}: ${items.length - items.filter(i => done.has(i.id)).length} items to run`);
      const concurrency = Number(o[`concurrency-${c.provider}`]) || opts.concurrency;
      const r = await runner.runModel(c, items, { ...opts, concurrency, done, prior, onResult: (row) => {
        fs.appendFileSync(file, JSON.stringify(row) + '\n');
        console.log(`${runner.keyOf(c)} ${row.id} ${row.error ? `ERROR ${row.error.slice(0, 80)}` : `${row.pass
          ? 'pass' : 'fail'} ${row.score} ft=${row.first_token_ms}ms`}`);
      } });
      if (r.unreliable) { fs.writeFileSync(statusFile, JSON.stringify({ unreliable: true, at: now() }));
        console.log(`${runner.keyOf(c)}: more than 50% errors, stopped (unreliable)`); }
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
    const latest = {};
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    for (const r of readJsonl(file)) if (wanted.has(r.id)) latest[r.id] = o.regrade ? runner.regrade(r, byId[r.id]) : r;
    const rows = Object.values(latest).map(r => (judged[r.id] !== undefined ? { ...r, judge: judged[r.id] } : r));
    const statusFile = file.replace(/\.jsonl$/, '.status.json');
    const unreliable = fs.existsSync(statusFile) && JSON.parse(fs.readFileSync(statusFile, 'utf8')).unreliable;
    return { provider: c.provider, model: c.model, note: c.note, rows, unreliable, expected: wanted.size };
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
