// Admin › Browser: Saga tasks across users and the step-by-step replay of one (Phase 9, "every action is logged
// and replayable for the user and admins"). Read-only; opening a replay is itself audited.
const audit = require('../../../shared/audit');
const store = require('../store');

async function getAdminSagaTasks(req) {
  const rows = await store.adminList({ status: String(req.query.get('status') || ''),
    before: req.query.get('before') });
  return [200, { tasks: rows.map((r) => ({ ...store.view(r), user_id: Number(r.user_id), user_email: r.user_email
    || null })), statuses: store.STATUSES }];
}

async function getAdminSagaTask(req) {
  const id = Number(req.params.id);
  const row = Number.isSafeInteger(id) && id > 0 ? await store.get(id) : null;
  if (!row) throw Object.assign(new Error('Unknown task.'), { status: 404, code: 'not_found' });
  await audit(req, 'admin.saga_replay_viewed', { actorId: req.user.id, targetType: 'saga_task', targetId: id });
  return [200, { task: { ...store.view(row), user_id: Number(row.user_id) }, actions: await store.actions(id, 0) }];
}

module.exports = { getAdminSagaTasks, getAdminSagaTask };
