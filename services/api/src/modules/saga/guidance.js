// Ask while it works (0.11.0, migration 0011): messages the user sends in the chat while a Saga task runs ("use the
// cheaper one", "skip the cookie banner") are stored here and read by the worker running the task before Saga's next
// decision, where they arrive as the user's words (never page content). The task is not stopped. Secrets the user
// might type ("the code is 552019") are hidden before they are kept, like a hand-back note (browser frames.note).
const db = require('../../db');
const { frames } = require('../browser');

const MAX_PENDING = 5;

/** add(userId, taskId, text) -> the kept text ('' when nothing was left to keep). */
async function add(userId, taskId, text) {
  const t = frames.note(text);
  if (!t) return '';
  const n = await db.one('SELECT COUNT(*) AS n FROM saga_guidance WHERE task_id = ? AND taken_at IS NULL', [taskId]);
  if (n && Number(n.n) >= MAX_PENDING) {
    throw Object.assign(new Error('Saga already has a few messages to read. Wait for its next step.'),
      { status: 429, code: 'rate_limited' });
  }
  await db.query('INSERT INTO saga_guidance (task_id, user_id, text, created_at) VALUES (?,?,?,?)',
    [taskId, userId, t, new Date()]);
  return t;
}

/** take(taskId) -> the messages not read yet, oldest first; they are marked read. */
async function take(taskId) {
  const rows = await db.query('SELECT id, text FROM saga_guidance WHERE task_id = ? AND taken_at IS NULL ORDER BY id '
    + 'LIMIT 10', [taskId]);
  if (!rows.length) return [];
  await db.query('UPDATE saga_guidance SET taken_at = ? WHERE task_id = ? AND id <= ? AND taken_at IS NULL',
    [new Date(), taskId, rows[rows.length - 1].id]);
  return rows.map((r) => r.text);
}

module.exports = { add, take, MAX_PENDING };
