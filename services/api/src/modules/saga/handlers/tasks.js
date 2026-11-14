// /browser/agent: Saga browsing tasks for the signed-in user (Phase 9). Start one (the phone with Colon AI open
// runs it), follow it (status plus the action log since a sequence number, which is also the replay), stop it, and
// list recent ones. Only the task's owner can read or stop it. The goal passes the safety layer's input check first.
// 0.10.4: continue_of (one of the user's earlier tasks): a Continue in the same chat's browser. The new task starts
// from the earlier one's summary (resume.summary: its steps and how it ended); with no goal it takes the earlier
// goal; an earlier task still live is stopped first, so two tasks never drive one browser.
const safety = require('../../safety');
const store = require('../store');
const runner = require('../runner');
const resume = require('../resume');

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

function taskId(req) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw fail(404, 'not_found', 'Unknown task.');
  return id;
}

// Answers 501 not_enabled when SAGA_BROWSE=off.
async function gate() {
  if (!runner.settings().enabled) throw fail(501, 'not_enabled', 'Saga browsing is switched off on this server.');
}

async function earlier(req, b) {
  if (b.continue_of == null || b.continue_of === '') return null;
  const id = Number(b.continue_of);
  const prev = Number.isSafeInteger(id) && id > 0 ? await store.getFor(req.user.id, id) : null;
  if (!prev) throw fail(404, 'not_found', 'Unknown task to continue.');
  if (!store.TERMINAL.includes(prev.status)) await runner.stop(req.user.id, prev.id);
  return { prev, history: resume.summary(prev, await store.actions(prev.id, 0)) };
}

async function postTask(req) {
  const b = req.body || {};
  const cont = await earlier(req, b);
  const goal = String(b.goal || (cont ? cont.prev.goal : '')).replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ')
    .trim();
  if (!goal || goal.length > 1000) throw fail(422, 'invalid', 'Say what Saga should do (up to 1000 characters).');
  const language = ['en', 'pcm', 'yo', 'ha', 'ig'].includes(b.language) ? b.language : 'en';
  const conv = b.conversation_id == null ? (cont ? cont.prev.conversation_id || null : null)
    : String(b.conversation_id).slice(0, 64);
  // Phase 10: the chat's browser mode, "ai" (AI only) or "shared" (AI + me); anything else is "ai".
  const mode = store.MODES.includes(b.mode) ? b.mode : 'ai';
  const check = await safety.checkInput({ text: goal, req, mode: 'general', route: 'saga', language });
  if (check.action === 'refuse') {
    throw Object.assign(fail(422, 'refused', check.refusal), { extra: { refusal: check.refusal } });
  }
  const r = await runner.start(req, { goal, language, conversationId: conv, mode,
    continueOf: cont ? cont.prev.id : null, history: cont ? cont.history : '' });
  return [202, { task: store.view(await store.getFor(req.user.id, r.id)), phone: r.local ? 'this_server' : 'queued' }];
}

async function getTask(req) {
  const id = taskId(req);
  let row = await store.getFor(req.user.id, id);
  if (!row) throw fail(404, 'not_found', 'Unknown task.');
  if (row.status === 'queued' && Date.now() - new Date(row.created_at).getTime() > runner.QUEUE_MS) {
    await store.expireQueued(new Date(Date.now() - runner.QUEUE_MS));
    row = await store.getFor(req.user.id, id);
  }
  const after = Math.max(0, Number(req.query.get('after')) || 0);
  return [200, { task: store.view(row), actions: await store.actions(id, after) }, { 'Cache-Control': 'no-store' }];
}

async function stopTask(req) {
  const id = taskId(req);
  if (!(await store.getFor(req.user.id, id))) throw fail(404, 'not_found', 'Unknown task.');
  await runner.stop(req.user.id, id);
  return [200, { ok: true }];
}

async function listTasks(req) {
  // 0.10.3: ?conversation_id= gives one chat's tasks (its cards on the web).
  const conv = String(req.query.get('conversation_id') || '').slice(0, 64) || null;
  const rows = await store.list(req.user.id, 20, conv);
  return [200, { tasks: rows.map(store.view) }];
}

module.exports = { gate, postTask, getTask, stopTask, listTasks };
