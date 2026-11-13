// /browser/history: opt-in history for web RemoteBrowserData (packages/ui/js/browser/data.js). The phones keep
// their history on the phone and never call this. colon:// pages and private tabs are never stored.
const store = require('../store');
const S = require('../session');

const iso = (v) => (v ? new Date(v).toISOString() : null);
const shape = (h) => ({ id: String(h.id), url: h.url, title: h.title || '', visited_at: iso(h.visited_at) });

async function listHistory(req) {
  const q = String(req.query.get('q') || '').slice(0, 200);
  const rows = await store.listHistory(req.user.id, { q, limit: req.query.get('limit') });
  return [200, { history: rows.map(shape) }];
}

async function addHistory(req) {
  const b = req.body || {};
  if (S.isPrivate(b)) return [200, { entry: null }];
  const url = S.okUrl(b.url);
  if (!url || !/^https?:/i.test(url)) {
    throw Object.assign(new Error('Send an http or https URL (up to 2048 characters).'), { status: 400,
      code: 'bad_url' });
  }
  const title = String(b.title || url).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 200);
  const entry = await store.addHistory(req.user.id, { url, title });
  return [201, { entry: shape(entry) }];
}

async function removeHistory(req) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw Object.assign(new Error('Unknown history entry.'), { status: 404, code: 'not_found' });
  }
  await store.removeHistory(req.user.id, id);
  return [200, { ok: true }];
}

async function clearHistory(req) {
  await store.clearHistory(req.user.id);
  return [200, { ok: true }];
}

module.exports = { listHistory, addHistory, removeHistory, clearHistory };
