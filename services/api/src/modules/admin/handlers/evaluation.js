// Admin: evaluation and benchmark runs (handlers for src/http/routes/admin/evaluation.js).

const db = require('../../../db');
const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const { deny } = require('../../auth').guards;
const { ID_RE } = require('./ai-common');

/* ---------- Evaluation (stub runs; full benchmarks are Phase 5) + feedback per model ---------- */
// GET /admin/evaluation
const getAdminEvaluation = async () => {
  let runs;
  try {
    runs = await db.query('SELECT r.id, r.name, r.model, r.provider, r.kind, r.suite, r.status, r.score, r.items, r.error_rate, r.first_token_ms, r.details, r.notes, r.created_at, u.email AS created_by FROM eval_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.created_at DESC, r.id DESC LIMIT 100');
  } catch {   // before migration 0005
    runs = await db.query('SELECT r.id, r.name, r.model, r.status, r.score, r.notes, r.created_at, u.email AS created_by FROM eval_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id DESC LIMIT 100');
  }
  const feedback = await db.query(
    `SELECT COALESCE(provider, '') AS provider, COALESCE(provider_model, '') AS model, SUM(rating = 'up') AS up, SUM(rating = 'down') AS down
       FROM chat_feedback WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY provider, provider_model ORDER BY COUNT(*) DESC LIMIT 30`);
  const reasons = await db.query(
    "SELECT reason, COUNT(*) AS n FROM chat_feedback WHERE rating = 'down' AND created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY reason ORDER BY n DESC");
  return [200, {
    runs: runs.map(x => ({ ...x, score: x.score == null ? null : Number(x.score), ...(x.error_rate !== undefined ? { error_rate: x.error_rate == null ? null : Number(x.error_rate), details: typeof x.details === 'string' ? JSON.parse(x.details || 'null') : x.details } : {}) })),
    feedback: feedback.map(f => ({ provider: f.provider, model: f.model, up: Number(f.up || 0), down: Number(f.down || 0) })),
    reasons: reasons.map(x => ({ reason: x.reason || 'Other', n: Number(x.n) })),
  }];
};

// POST /admin/evaluation/runs
const postAdminEvaluationRuns = async (req) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!name) v.fail('name', 'Name the benchmark run.');
  const model = String(req.body.model || '').trim().slice(0, 128);
  const status = ['planned', 'running', 'done', 'failed'].includes(req.body.status) ? req.body.status : 'planned';
  let score = null;
  if (req.body.score !== undefined && req.body.score !== null && req.body.score !== '') {
    score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) v.fail('score', 'Use a score from 0 to 100.');
  }
  const notes = req.body.notes ? String(req.body.notes).slice(0, 1000) : null;
  const res = await db.query('INSERT INTO eval_runs (name, model, status, score, notes, created_by) VALUES (?,?,?,?,?,?)', [name, model, status, score, notes, req.user.id]);
  await audit(req, 'admin.eval_run_created', { actorId: req.user.id, targetType: 'eval_run', targetId: res.insertId, meta: { name, model, status, score } });
  return [201, { ok: true, id: res.insertId }];
};

// Imports a Colon benchmark run (bench/results/<run>.eval.json from scripts/bench.js): one eval_runs row per model.
// POST /admin/evaluation/bench
const postAdminEvaluationBench = async (req) => {
  const list = Array.isArray(req.body.runs) ? req.body.runs.slice(0, 40) : null;
  if (!list || !list.length) v.fail('runs', 'Send the runs from bench/results/<run>.eval.json.');
  const rows = list.map((x, i) => {
    if (!x || typeof x !== 'object') v.fail(`runs.${i}`, 'Each run needs a provider and a model.');
    const at = new Date(x.created_at);
    const score = Number(x.score);
    if (!x || typeof x.model !== 'string' || !x.model || typeof x.provider !== 'string' || !ID_RE.test(x.provider)) v.fail(`runs.${i}`, 'Each run needs a provider and a model.');
    if (!Number.isFinite(score) || score < 0 || score > 100) v.fail(`runs.${i}.score`, 'Use a score from 0 to 100.');
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60e3) v.fail(`runs.${i}.created_at`, 'Give when the run finished.');
    return {
      name: String(x.name || 'Colon benchmark').slice(0, 120), model: x.model.slice(0, 128), provider: x.provider, kind: 'bench', suite: String(x.suite || '').slice(0, 32),
      status: x.status === 'done' ? 'done' : 'failed', score, items: Math.max(0, Math.round(Number(x.items) || 0)),
      error_rate: Number.isFinite(Number(x.error_rate)) ? Number(x.error_rate) : null, first_token_ms: Number.isFinite(Number(x.first_token_ms)) ? Math.round(Number(x.first_token_ms)) : null,
      notes: x.notes ? String(x.notes).slice(0, 1000) : null, details: x.details && typeof x.details === 'object' ? JSON.stringify(x.details).slice(0, 20000) : null, created_at: at,
    };
  });
  const ids = [];
  for (const r of rows) {
    const res = await db.query('INSERT INTO eval_runs (name, model, provider, kind, suite, status, score, items, error_rate, first_token_ms, notes, details, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [r.name, r.model, r.provider, r.kind, r.suite, r.status, r.score, r.items, r.error_rate, r.first_token_ms, r.notes, r.details, req.user.id, r.created_at]);
    ids.push(res.insertId);
  }
  await audit(req, 'admin.bench_imported', { actorId: req.user.id, targetType: 'eval_run', targetId: ids[0], meta: { runs: rows.length, name: rows[0].name } });
  return [201, { ok: true, ids }];
};

// DELETE /admin/evaluation/runs/:id
const deleteAdminEvaluationRunsById = async (req) => {
  const res = await db.query('DELETE FROM eval_runs WHERE id = ?', [Number(req.params.id)]);
  if (!res.affectedRows) deny(404, 'not_found', 'Run not found.');
  await audit(req, 'admin.eval_run_deleted', { actorId: req.user.id, targetType: 'eval_run', targetId: req.params.id });
  return [200, { ok: true }];
};

module.exports = { getAdminEvaluation, postAdminEvaluationRuns, postAdminEvaluationBench, deleteAdminEvaluationRunsById };
