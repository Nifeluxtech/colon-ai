// 0.10.4: picking a Saga task up again (docs/decisions/0006, addendum "Continue and reconnect").
//   summary(task, actions) -> a few lines of what a task did (its steps, where it ended), for Saga's next prompt.
//   historyOf(actions) -> the earlier work a task starts from: the summary its Continue was created with (a
//     'continue' row) plus, for a task adopted mid-way, its own steps so far. '' for a fresh task.
//   adoptOrphans(users, deps, o) -> live tasks of these users that no worker holds (the phone's socket came back on
//     this worker, or the worker running it was recycled: its stamps stopped) are adopted and run on from where they
//     were: a wait for the user goes on waiting, a running task carries on with its history.
const store = require('./store');

const MAX_LINES = 12;
const MAX_SUMMARY = 1500;
const STALE_MS = 40000;                   // a worker stamps its tasks every BEAT_MS; this much silence: it is gone
const BEAT_MS = 12000;
const ENDED = { done: 'finished', stopped: 'was stopped by the user', interrupted: 'was interrupted',
  failed: 'could not finish', timeout: 'ran out of time', step_limit: 'used all its steps' };

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const one = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function summary(task, actions) {
  const lines = [];
  for (const a of actions || []) {
    if (a.kind === 'action') {
      const where = a.url ? ` on ${host(a.url)}` : '';
      lines.push(`${one(a.say || a.tool || a.command, 120)}${where}${a.ok === false ? ` (failed: ${one(a.error, 30)})`
        : ''}`);
    } else if (a.kind === 'handoff') lines.push(`Asked the user: ${one(a.say, 140)}`);
    else if (a.kind === 'finish' && a.say) lines.push(`Finished: ${one(a.say, 120)}`);
  }
  const shown = lines.slice(-MAX_LINES).map((l, i) => `${i + 1}. ${l}`);
  const t = task || {};
  const end = ENDED[t.status] ? `The earlier attempt ${ENDED[t.status]}${t.error ? ` (${one(t.error, 30)})` : ''}.`
    : '';
  const answer = t.answer ? ` Its answer: ${one(t.answer, 300)}` : '';
  const head = lines.length > MAX_LINES ? `(${lines.length - MAX_LINES} earlier steps not shown)\n` : '';
  return `${head}${shown.join('\n')}${shown.length ? '\n' : ''}${end}${answer}`.trim().slice(0, MAX_SUMMARY);
}

function historyOf(actions) {
  const list = actions || [];
  const cont = list.find((a) => a.kind === 'continue');
  const before = cont && cont.args && cont.args.summary ? String(cont.args.summary).slice(0, MAX_SUMMARY) : '';
  const own = summary(null, list.filter((a) => a.kind !== 'continue'));
  const parts = [];
  if (before) parts.push(`Earlier attempt at this task:\n${before}`);
  if (own) parts.push(`This task so far (the connection to the phone dropped and came back):\n${own}`);
  return parts.join('\n\n');
}

/** The note Saga's loop starts from when there is history. */
function prompt(history) {
  return history ? `${history}\n\nThis continues that work in the same browser, which kept its page (things may `
    + 'have changed since). Call getPageContent first to see where the page is now, then carry on toward the goal. '
    + 'Do not redo steps that already worked; if the user was asked to sign in, check whether they did.' : '';
}

async function adoptOrphans(users, deps, o) {
  if (!users.length) return [];
  const now = Date.now();
  const oldest = new Date(now - o.graceMs - STALE_MS);
  await store.expireOrphans(oldest);
  const taken = [];
  for (const t of await store.orphansFor(users, new Date(now - STALE_MS), oldest)) {
    if (o.running.has(t.id)) continue;             // this worker's own task, waiting for its phone here
    const b = o.pick(t.user_id);
    if (!b || !(await store.adopt(t.id, o.worker, b.state.ref, new Date(now - STALE_MS)))) continue;
    taken.push(t.id);
    o.run(t, b, { ...deps, waiting: store.WAITING.includes(t.status) ? t.status : null, adopted: true });
  }
  return taken;
}

module.exports = { summary, historyOf, prompt, adoptOrphans, STALE_MS, BEAT_MS, MAX_SUMMARY };
