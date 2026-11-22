// Workspace handlers (v0.25.0, Workspace step 1; routes: src/http/routes/workspace.js). Signed-in users only;
// every call acts on req.user's own workspaces (another user's workspace id answers 404).
const audit = (...a) => require('../../shared/audit')(...a);   // lazy: tests load this without mysql2
const engine = () => require('./index').instance();
const qp = (req, k) => (req.query && req.query.get ? req.query.get(k) : null);

// GET /workspaces -> { workspaces[], templates[], limits }
const getWorkspaces = async (req) => [200, await engine().list(req.user)];

// POST /workspaces { title, template? } -> { workspace, files[] }
const postWorkspaces = async (req) => {
  const out = await engine().add(req.user, req.body || {});
  await audit(req, 'workspace.created', { actorId: req.user.id, targetType: 'workspace', targetId: out.workspace.id,
    meta: { template: out.workspace.template } });
  return [201, out];
};

// GET /workspaces/:id -> { workspace, files[] (no content) }
const getWorkspace = async (req) => [200, await engine().get(req.user, req.params.id)];

// PATCH /workspaces/:id { title } -> { workspace }
const patchWorkspace = async (req) => [200, { workspace: await engine().edit(req.user, req.params.id,
  req.body || {}) }];

// DELETE /workspaces/:id (its files and versions go with it)
const deleteWorkspace = async (req) => {
  await engine().remove(req.user, req.params.id);
  await audit(req, 'workspace.deleted', { actorId: req.user.id, targetType: 'workspace',
    targetId: String(req.params.id) });
  return [200, { ok: true }];
};

// GET /workspaces/:id/bundle -> { workspace, files[] with content }
const getBundle = async (req) => [200, await engine().bundle(req.user, req.params.id)];

// GET /workspaces/:id/file?path=index.html -> { path, type, size, encoding, content }
const getFile = async (req) => [200, await engine().readFile(req.user, req.params.id, qp(req, 'path'))];

// PUT /workspaces/:id/file { path, content, encoding?: 'utf8' | 'base64', note? } -> { file, version }
const putFile = async (req) => [200, await engine().writeFile(req.user, req.params.id, req.body || {})];

// POST /workspaces/:id/file/move { from, to } -> { version }
const moveFile = async (req) => [200, await engine().moveFile(req.user, req.params.id, req.body || {})];

// DELETE /workspaces/:id/file?path=… -> { version }
const deleteFile = async (req) => [200, await engine().deleteFile(req.user, req.params.id, qp(req, 'path'))];

// GET /workspaces/:id/versions -> { current, versions[] }
const getVersions = async (req) => [200, await engine().versions(req.user, req.params.id)];

// POST /workspaces/:id/versions/:n/restore -> { version, files[] }
const restoreVersion = async (req) => [200, await engine().restore(req.user, req.params.id, req.params.n)];

// ---------- v0.26.0 (step 2): the Workspace chat ----------
// Live pieces, loaded on first use (tests replace them with setChatDeps).
let chatDeps = null, chatShared = null;
function liveDeps() {
  const ai = require('../ai');
  return { generate: ai.generate, loadRouting: () => ai.dynamic.load(), isConfigured: ai.isConfigured,
    resolveCounters: (req) => ai.limits.resolveCounters(req, 'developer'), consumeAll: (c) => ai.limits.consumeAll(c),
    refundAll: (c) => ai.limits.refundAll(c), checkInput: require('../safety').checkInput,
    record: (info) => ai.calls.record(info), log: require('../../shared/logger') };
}
function chat() {
  if (!chatShared) {
    const d = chatDeps || liveDeps();
    chatShared = { d, chat: require('./chat').createChat({ engine: engine(), deps: d }) };
  }
  return chatShared;
}
const setChatDeps = (d) => { chatDeps = d; chatShared = null; };

// GET /workspaces/:id/chat -> { messages[], working, version }
const getChat = async (req) => [200, await chat().chat.history(req.user, req.params.id)];

// POST /workspaces/:id/chat { message } -> 202 { message, working: true }; poll GET /chat for the reply.
const postChat = async (req) => {
  const { d, chat: c } = chat();
  await engine().owned(req.user, req.params.id);
  const text = String((req.body || {}).message || '');
  const verdict = await d.checkInput({ text, req, mode: 'developer', language: 'en', route: 'workspace.chat' });
  if (verdict.action === 'refuse') return [422, { error: 'refused', message: verdict.refusal }];
  const routing = await d.loadRouting();
  if (!d.isConfigured(routing)) {
    throw Object.assign(new Error('Colon isn’t connected to an AI provider yet.'), { status: 503,
      code: 'no_provider' });
  }
  const counters = await d.resolveCounters(req);
  await d.consumeAll(counters);
  const signal = AbortSignal.timeout(240000);
  const record = (r) => d.record({ mode: 'developer', route: 'workspace', userId: req.user.id,
    attempts: r.attempts || [] });
  try {
    return [202, await c.send(req.user, req.params.id, req.body || {}, { routing, signal, record,
      onFail: () => d.refundAll(counters) })];
  } catch (e) { await d.refundAll(counters); throw e; }
};

module.exports = { getWorkspaces, postWorkspaces, getWorkspace, patchWorkspace, deleteWorkspace, getBundle, getFile,
  putFile, moveFile, deleteFile, getVersions, restoreVersion, getChat, postChat, setChatDeps };
