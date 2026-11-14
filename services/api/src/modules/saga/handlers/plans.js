// /browser/schedules and /browser/routines (0.11.0, ADR 0007): the signed-in user's scheduled browsing checks (per
// chat) and saved routines. Only the owner can read or change them. A schedule's goal passes the safety layer's
// input check like any Saga task; it runs on the user's phone at its time (runner-extra.tick).
const safety = require('../../safety');
const S = require('../schedule');
const schedules = require('../schedules');
const routines = require('../routines');
const store = require('../store');

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const idOf = (req) => { const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw fail(404, 'not_found', 'Not found.'); return id; };
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  .slice(0, n);

async function checked(req, goal, language) {
  const c = await safety.checkInput({ text: goal, req, mode: 'general', route: 'saga', language });
  if (c.action === 'refuse') throw Object.assign(fail(422, 'refused', c.refusal), { extra: { refusal: c.refusal } });
}

// GET /browser/schedules[?conversation_id=]
async function listSchedules(req) {
  const conv = String(req.query.get('conversation_id') || '').slice(0, 64) || null;
  return [200, { schedules: (await schedules.list(req.user.id, conv)).map(schedules.view) }];
}

// POST /browser/schedules { text } or { goal, cadence, at_minute, weekday }, + name, conversation_id, tz_offset
async function createSchedule(req) {
  const b = req.body || {};
  const parsed = b.text ? S.parse(b.text) : null;
  if (b.text && !parsed) throw fail(422, 'invalid', 'Say when, like “every morning” or “every Monday at 9am”.');
  const cadence = parsed ? parsed.cadence : String(b.cadence || 'daily');
  if (!S.CADENCES.includes(cadence)) throw fail(422, 'invalid', 'Choose hourly, daily, weekdays or weekly.');
  const goal = clean(b.goal || (parsed && parsed.goal), 1000);
  if (goal.length < 3) throw fail(422, 'invalid', 'Say what Saga should check.');
  const at = parsed ? parsed.at_minute : Number(b.at_minute);
  if (!Number.isInteger(at) || at < 0 || at > 1439) throw fail(422, 'invalid', 'Choose a time of day.');
  const weekday = cadence === 'weekly' ? Number(parsed ? parsed.weekday : b.weekday) : null;
  if (cadence === 'weekly' && !(weekday >= 0 && weekday <= 6)) throw fail(422, 'invalid', 'Choose a day of the week.');
  const tz = Number.isInteger(Number(b.tz_offset)) ? Math.max(-840, Math.min(840, Number(b.tz_offset))) : 60;
  const language = ['en', 'pcm', 'yo', 'ha', 'ig'].includes(b.language) ? b.language : 'en';
  await checked(req, goal, language);
  const name = clean(b.name, 80) || clean(goal, 40);
  const conv = b.conversation_id == null ? null : String(b.conversation_id).slice(0, 64);
  const id = await schedules.create(req.user.id, { name, goal, cadence, at_minute: at, weekday, tz_offset: tz,
    language, conversationId: conv });
  return [201, { schedule: schedules.view(await schedules.getFor(req.user.id, id)) }];
}

// PATCH /browser/schedules/:id { status: active | paused }
async function patchSchedule(req) {
  const status = String((req.body || {}).status || '');
  if (!schedules.STATUSES.includes(status)) throw fail(422, 'invalid', 'Status is active or paused.');
  const row = await schedules.setStatus(req.user.id, idOf(req), status);
  if (!row) throw fail(404, 'not_found', 'Unknown schedule.');
  return [200, { schedule: schedules.view(row) }];
}

async function deleteSchedule(req) {
  const id = idOf(req);
  if (!(await schedules.getFor(req.user.id, id))) throw fail(404, 'not_found', 'Unknown schedule.');
  await schedules.remove(req.user.id, id);
  return [200, { ok: true }];
}

// POST /browser/schedules/:id/run: due now (runs as soon as the phone is connected).
async function runSchedule(req) {
  const id = idOf(req);
  const row = await schedules.getFor(req.user.id, id);
  if (!row) throw fail(404, 'not_found', 'Unknown schedule.');
  if (row.status !== 'active') throw fail(409, 'paused', 'Resume the schedule first.');
  await schedules.runNow(req.user.id, id);
  return [202, { ok: true }];
}

// GET /browser/routines
async function listRoutines(req) {
  return [200, { routines: (await routines.list(req.user.id)).map(routines.view) }];
}

// POST /browser/routines { task_id, name }: records a finished task as a routine.
async function createRoutine(req) {
  const b = req.body || {};
  const name = routines.cleanName(b.name);
  const task = await store.getFor(req.user.id, Number(b.task_id));
  if (!task) throw fail(404, 'not_found', 'Unknown task.');
  if (task.status !== 'done') throw fail(409, 'not_done', 'Only a task that finished can be saved as a routine.');
  const steps = routines.fromActions(await store.actions(task.id, 0));
  if (!steps.length) throw fail(422, 'empty', 'That task had no steps to record.');
  const row = await routines.save(req.user.id, { name, goal: task.goal, steps, fromTask: task.id });
  return [201, { routine: routines.view(row) }];
}

async function deleteRoutine(req) {
  const id = idOf(req);
  if (!(await routines.getFor(req.user.id, id))) throw fail(404, 'not_found', 'Unknown routine.');
  await routines.remove(req.user.id, id);
  return [200, { ok: true }];
}

module.exports = { listSchedules, createSchedule, patchSchedule, deleteSchedule, runSchedule, listRoutines,
  createRoutine, deleteRoutine };
