// Memory handlers (v0.15.0, Blueprint B9; routes: src/http/routes/memory.js). Signed-in users only, and every call
// acts on req.user's own memories (the engine scopes each statement to the user; anyone else's id answers 404).
const audit = require('../../shared/audit');
const engine = () => require('./index').instance();

// GET /memory?project_id= -> { memory: {enabled, chosen, count, max, token_budget, notice}, memories[] }
const getMemory = async (req) => {
  const e = engine();
  const projectId = req.query.get('project_id') || null;
  return [200, { memory: await e.status(req.user), memories: await e.list(req.user, { projectId }) }];
};

// PUT /memory/consent { enabled } -> { memory }
const putMemoryConsent = async (req) => {
  const memory = await engine().setConsent(req.user, req.body.enabled);
  await audit(req, memory.enabled ? 'memory.enabled' : 'memory.disabled', { actorId: req.user.id });
  return [200, { memory }];
};

// POST /memories { content, scope?, project_id?, conversation_id? } -> { memory }
const postMemories = async (req) => [201, { memory: await engine().add(req.user, req.body || {}) }];

// PATCH /memories/:id { content } -> { memory }
const patchMemoriesById = async (req) => [200, { memory: await engine().edit(req.user, req.params.id,
  req.body || {}) }];

// DELETE /memories/:id
const deleteMemoriesById = async (req) => {
  await engine().remove(req.user, req.params.id);
  return [200, { ok: true }];
};

// DELETE /memories (all of the user's memories)
const deleteMemories = async (req) => {
  const removed = await engine().clear(req.user);
  await audit(req, 'memory.cleared', { actorId: req.user.id, meta: { removed } });
  return [200, { ok: true, removed }];
};

module.exports = { getMemory, putMemoryConsent, postMemories, patchMemoriesById, deleteMemoriesById, deleteMemories };
