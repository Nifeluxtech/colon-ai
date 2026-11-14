// Saved routines (0.11.0, migration 0011): a Saga task recorded once (its goal and the steps it took) and replayed by
// name ("post my daily update"). Replay is an ordinary task whose prompt carries the recorded steps as a guide: Saga
// reads each page and re-plans when it changed, and every risky step still asks for the user's approval (the same
// policy as any task). Typed personal data never enters a routine (the action log already hides it) and nothing
// typed into a secret field is ever recorded (Saga never types those).
const db = require('../../db');

const MAX_STEPS = 25;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} '’._-]{0,79}$/u;
const KEEP = new Set(['openUrl', 'click', 'fill', 'scroll', 'tabs', 'signIn', 'extract', 'back', 'forward', 'refresh']);

function cleanName(v) {
  const n = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!NAME.test(n)) throw Object.assign(new Error('Give the routine a short name (letters, numbers, spaces).'),
    { status: 422, code: 'invalid' });
  return n;
}

const shortUrl = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname}`.slice(0, 120); } catch {
  return ''; } };

/** The steps worth keeping from a task's action log: what worked, in order, typed values only when not hidden. */
function fromActions(actions) {
  const out = [];
  for (const a of actions || []) {
    if (!['action', 'extract'].includes(a.kind) || a.ok === false || !KEEP.has(a.tool)) continue;
    const args = a.args && typeof a.args === 'object' ? a.args : {};
    const step = { tool: a.tool, say: String(a.say || '').slice(0, 160) };
    if (a.tool === 'openUrl' && args.url) step.url = String(args.url).slice(0, 300);
    else if (a.url) step.at = shortUrl(a.url);
    if (a.tool === 'fill' && typeof args.value === 'string' && !/^\[hidden/.test(args.value)) {
      step.value = args.value.slice(0, 200);
    }
    if (a.approved === 'approved') step.approved = true;
    out.push(step);
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/** The guide folded into a replay's prompt. */
function promptFor(r) {
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, MAX_STEPS).map((s, i) => `${i + 1}. ${s.tool}`
    + (s.url ? ` ${s.url}` : '') + (s.at ? ` (on ${s.at})` : '') + (s.value ? ` typing "${s.value}"` : '')
    + (s.say ? ` — ${s.say}` : '') + (s.approved ? ' [the user approved this step]' : ''));
  return [`This task replays the user's saved routine "${r.name}". When it was recorded it went like this:`,
    ...steps, 'Follow the same path, but read each page first: if a page changed, re-plan from what you see. Steps '
    + 'that need the user\'s approval still ask for it again. Finish with what you did.'].join('\n').slice(0, 2400);
}

function view(r) {
  if (!r) return null;
  const steps = typeof r.steps === 'string' ? (() => { try { return JSON.parse(r.steps); } catch { return []; } })()
    : r.steps || [];
  return { id: Number(r.id), name: r.name, goal: r.goal, steps, runs: Number(r.runs) || 0,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null };
}

async function save(userId, { name, goal, steps, fromTask }) {
  const at = new Date();
  await db.query(
    `INSERT INTO saga_routines (user_id, name, goal, steps, from_task, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE goal = VALUES(goal), steps = VALUES(steps), from_task = VALUES(from_task),
        updated_at = VALUES(updated_at)`,
    [userId, name, String(goal).slice(0, 1000), JSON.stringify(steps || []), fromTask || null, at, at]);
  return db.one('SELECT * FROM saga_routines WHERE user_id = ? AND name = ?', [userId, name]);
}

const list = (userId) => db.query('SELECT * FROM saga_routines WHERE user_id = ? ORDER BY name LIMIT 50', [userId]);
const getFor = (userId, id) => db.one('SELECT * FROM saga_routines WHERE id = ? AND user_id = ?', [id, userId]);
const remove = (userId, id) => db.query('DELETE FROM saga_routines WHERE id = ? AND user_id = ?', [id, userId]);
const used = (id) => db.query('UPDATE saga_routines SET runs = runs + 1, updated_at = ? WHERE id = ?',
  [new Date(), id]);

module.exports = { cleanName, fromActions, promptFor, view, save, list, getFor, remove, used, MAX_STEPS };
