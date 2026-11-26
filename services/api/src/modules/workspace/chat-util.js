// Workspace chat helpers (moved out of chat.js in 0.38.0, size limit): the message shape the app gets, the age
// checks for builds and queued requests, and what an earlier message looks like to the model.
const exporter = require('./exporter');
const photos = require('./images');
const RUN_STALE_MS = 2 * 60 * 1000;

const msgOut = (m) => ({ id: Number(m.id), role: m.role, content: m.content, error: Boolean(Number(m.error)),
  changes: m.changes ? (typeof m.changes === 'string' ? JSON.parse(m.changes) : m.changes) : [],
  version_before: m.version_before == null ? null : Number(m.version_before),
  version_after: m.version_after == null ? null : Number(m.version_after),
  steps: m.steps ? (typeof m.steps === 'string' ? JSON.parse(m.steps) : m.steps) : [], kind: m.kind || null,
  images: photos.parse(m.images), created_at: m.created_at });
const young = (m, ms) => Date.now() - new Date(m.created_at).getTime() < ms;
// a running build is alive while its newest step (or the message itself) is under RUN_STALE_MS old
const alive = (m) => {
  const at = Math.max(new Date(m.created_at).getTime(), ...(m.steps || []).map((x) => Number(x.at) || 0));
  return Date.now() - at < RUN_STALE_MS;
};

const kb = (n) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);
const VERB = { created: 'Created', edited: 'Edited', deleted: 'Deleted' };

// What an earlier assistant message looked like to the model: its note plus the files it touched.
const asHistory = (m) => {
  const ex = m.role === 'assistant' ? exporter.stripMark(m.content) : { text: m.content };
  const text = ex.marked ? `${ex.text}\n(Gave the user a ZIP download of the files.)` : ex.text;
  return { role: m.role, content: m.role === 'assistant' && m.changes.length
    ? `${text}\n(Changed: ${m.changes.map((c) => `${c.op} ${c.path}`).join(', ')})` : text };
};

module.exports = { msgOut, young, alive, kb, VERB, asHistory, RUN_STALE_MS };
