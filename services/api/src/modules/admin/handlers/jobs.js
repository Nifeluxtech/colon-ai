// Admin › Jobs (v0.16.0, Blueprint C13; handlers for routes/admin/jobs.js). Admin and Super Admin only (route
// guards). Retry and cancel need a reason and are written to the audit log with the acting admin, like the 0.14
// billing pages; the work itself is in modules/jobs/admin.js.

const audit = require('../../../shared/audit');
const jobs = require('../../jobs');

// GET /admin/jobs?status=&type=&limit=
const getJobs = async (req) => [200, await jobs.admin().overview({ status: req.query.get('status') || '',
  type: req.query.get('type') || '', limit: req.query.get('limit') })];

const act = (kind) => async (req) => {
  const reason = jobs.adminReason(req.body && req.body.reason);
  const r = kind === 'retry' ? await jobs.admin().retry(req.params.id) : await jobs.admin().cancel(req.params.id);
  await audit(req, kind === 'retry' ? 'admin.job_retried' : 'admin.job_cancelled', { actorId: req.user.id,
    targetType: 'job', targetId: r.job.id, meta: { reason, type: r.job.type, from: r.before.status,
      attempts: r.before.attempts, last_error: r.before.last_error ? r.before.last_error.slice(0, 120) : null } });
  return [200, { ok: true, job: r.job }];
};

// POST /admin/jobs/:id/retry {reason}   a dead, failed or cancelled job runs again now, attempts reset
// POST /admin/jobs/:id/cancel {reason}  a queued, failed or running job is cancelled
module.exports = { getJobs, postRetry: act('retry'), postCancel: act('cancel') };
