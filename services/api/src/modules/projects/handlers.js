// Projects handlers (v0.15.0, Blueprint B10; routes: src/http/routes/projects.js). Signed-in users only; every call
// acts on req.user's own projects (another user's project id answers 404).
// Chats join a project with POST /conversations { project_id } or PATCH /conversations/:id { project_id }, files
// with POST /uploads (field project_id), memories with POST /memories { scope: 'project', project_id }.
const audit = require('../../shared/audit');
const engine = () => require('./index').instance();

// GET /projects -> { projects[], limit: { limit, used, mode, plan } }
const getProjects = async (req) => [200, await engine().list(req.user)];

// POST /projects { name, instructions? } -> { project, over_limit }
const postProjects = async (req) => {
  const out = await engine().add(req.user, req.body || {});
  await audit(req, 'project.created', { actorId: req.user.id, targetType: 'project', targetId: out.project.id,
    meta: out.over_limit ? { over_limit: true } : undefined });
  return [201, out];
};

// GET /projects/:id -> { project, chats[], files[] }
const getProjectsById = async (req) => [200, await engine().get(req.user, req.params.id)];

// PATCH /projects/:id { name?, instructions?, archived? } -> { project }
const patchProjectsById = async (req) => [200, { project: await engine().edit(req.user, req.params.id,
  req.body || {}) }];

// DELETE /projects/:id (its chats and files stay and leave the project; its memories are deleted)
// v0.24.0: a connected repository's token and stored copy are deleted first (modules/repos).
const deleteProjectsById = async (req) => {
  await engine().owned(req.user.id, String(req.params.id));
  await require('../repos').instance().disconnect(req.user, req.params.id);
  await engine().remove(req.user, req.params.id);
  await audit(req, 'project.deleted', { actorId: req.user.id, targetType: 'project', targetId: String(req.params.id) });
  return [200, { ok: true }];
};

module.exports = { getProjects, postProjects, getProjectsById, patchProjectsById, deleteProjectsById };
