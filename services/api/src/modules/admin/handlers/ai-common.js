// Helpers shared by the admin-ai handlers.
const db = require('../../../db');
const audit = require('../../../shared/audit');
const dynamic = require('../../ai').dynamic;
const benchGate = require('../../bench').gate;
const { RANK } = require('../../auth').guards;

const isSuper = (req) => RANK[req.user.role] >= RANK.super_admin;

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const changed = () => { dynamic.clear(); };

// Phase 5 release standard: a model goes into routing only after a fresh Colon benchmark of it (src/bench/gate.js).
// A Super Admin may skip it once with a written reason ("skip_benchmark"), which is audited.
async function gateModel(req, provider, model) {
  const skipReason = String(req.body.skip_benchmark || '').trim().slice(0, 300);
  const r = await benchGate.requireBenchmark(db, { provider, model }, { isSuper: isSuper(req), skipReason });
  if (r.skipped === 'super_admin') await audit(req, 'admin.bench_gate_skipped', { actorId: req.user.id,
    targetType: 'model', targetId: `${provider}:${model}`, meta: { reason: skipReason } });
  return r;
}

module.exports = { isSuper, ID_RE, changed, gateModel };
