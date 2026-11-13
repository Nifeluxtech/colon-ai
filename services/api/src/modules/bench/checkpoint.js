// Benchmark checkpoints: a run lives in bench/results/runs/<run>/, one <model>.jsonl per model (one line per item,
// appended as soon as the item is graded) and one <model>.status.json (running | done | stopped | unreliable).
// A stopped run is resumed with `npm run bench -- --resume [run]`: items already answered with the same settings
// are skipped, so nothing is asked twice and nothing is lost when the process dies.
const fs = require('fs');
const path = require('path');

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }      // a line cut short by a kill is skipped
}).filter(Boolean) : []);

/** Latest row per item id, in first-seen order. */
function latest(rows) {
  const m = new Map();
  for (const r of rows) { if (m.has(r.id)) m.delete(r.id); m.set(r.id, r); }
  return [...m.values()];
}

/** A row counts for the current settings when it has the same fingerprint (rows from before v0.5.6 have none). */
const sameCfg = (row, cfg) => !cfg || !row.cfg || row.cfg === cfg;

/**
 * plan(rows, { cfg, retryErrors }) -> { prior, done, stale, errors }
 * retryErrors: false | true (every error) | 'code' (only errors with that code, e.g. rate_limited or timeout).
 * prior = rows kept (counted for the unreliable check), done = their ids. Rows with other settings are re-asked.
 */
function plan(rows, { cfg = null, retryErrors = false } = {}) {
  const all = latest(rows);
  const stale = all.filter(r => !sameCfg(r, cfg));
  const fresh = all.filter(r => sameCfg(r, cfg));
  const redo = (r) => r.error && (retryErrors === true || (typeof retryErrors === 'string' && ((r.error_code
    || String(r.error).split(/[\s:]/)[0]) === retryErrors)));
  const prior = fresh.filter(r => !redo(r));
  return { prior, done: new Set(prior.map(r => r.id)), stale: stale.length, errors: fresh.length - prior.length };
}

/** Rows for the report: latest per item, current settings only. */
const reportRows = (rows, cfg) => latest(rows).filter(r => sameCfg(r, cfg));

const statusPath = (jsonl) => jsonl.replace(/\.jsonl$/, '.status.json');
function readStatus(jsonl) {
  try { return JSON.parse(fs.readFileSync(statusPath(jsonl), 'utf8')); } catch { return null; }
}
function writeStatus(jsonl, patch) {
  const s = { ...(readStatus(jsonl) || {}), ...patch, updated: new Date().toISOString() };
  if (s.state === 'unreliable') s.unreliable = true; else delete s.unreliable;   // older readers check .unreliable
  fs.writeFileSync(statusPath(jsonl), JSON.stringify(s, null, 2));
  return s;
}

/** The most recently changed run id under <results>/runs, or null. */
function latestRun(resultsDir) {
  const dir = path.join(resultsDir, 'runs');
  if (!fs.existsSync(dir)) return null;
  const runs = fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory())
    .map(d => ({ d, t: fs.statSync(path.join(dir, d, 'meta.json'), { throwIfNoEntry: false }) }))
    .filter(x => x.t).sort((a, b) => b.t.mtimeMs - a.t.mtimeMs);
  return runs.length ? runs[0].d : null;
}

module.exports = { readJsonl, latest, plan, reportRows, readStatus, writeStatus, statusPath, latestRun, sameCfg };
