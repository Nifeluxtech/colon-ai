// Project repository handlers (v0.24.0; routes: src/http/routes/projects.js). Signed-in users only; every call acts
// on req.user's own project (another user's project answers 404). Tokens arrive in the request body, are stored
// encrypted and never come back: answers carry has_token only.
const audit = require('../../shared/audit');
const engine = () => require('./index').instance();

// GET /projects/:id/repo -> { repo | null }
const getProjectsByIdRepo = async (req) => [200, await engine().status(req.user, req.params.id)];

// POST /projects/:id/repo { provider, url | repo, branch?, token? } -> { repo } (connected and synced)
const postProjectsByIdRepo = async (req) => {
  const out = await engine().connect(req.user, req.params.id, req.body || {});
  await audit(req, 'project.repo_connected', { actorId: req.user.id, targetType: 'project',
    targetId: String(req.params.id), meta: { provider: out.repo.provider, private_token: out.repo.has_token } });
  return [200, out];
};

// POST /projects/:id/repo/sync -> { repo, unchanged }
const postProjectsByIdRepoSync = async (req) => [200, await engine().sync(req.user, req.params.id)];

// DELETE /projects/:id/repo (the token and the stored copy are deleted)
const deleteProjectsByIdRepo = async (req) => {
  await engine().disconnect(req.user, req.params.id);
  await audit(req, 'project.repo_disconnected', { actorId: req.user.id, targetType: 'project',
    targetId: String(req.params.id) });
  return [200, { ok: true }];
};

// POST /projects/:id/repo/branches { provider, url | repo, token? } -> { branches[], default_branch }
const postProjectsByIdRepoBranches = async (req) => [200, await engine().branches(req.user, req.params.id,
  req.body || {})];

// POST /projects/:id/repo/repos { provider, token? } -> { repos: [{ repo, private, default_branch }] }
const postProjectsByIdRepoRepos = async (req) => [200, await engine().repos(req.user, req.params.id,
  req.body || {})];

module.exports = { getProjectsByIdRepo, postProjectsByIdRepo, postProjectsByIdRepoSync, deleteProjectsByIdRepo,
  postProjectsByIdRepoBranches, postProjectsByIdRepoRepos };
