// Projects (v0.15.0, Blueprint B10): route wiring only. Handlers: modules/projects/handlers.js
// v0.24.0: a project's connected repository (modules/repos/handlers.js).
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/projects').handlers;
const rh = require('../../modules/repos').handlers;

const r = new Router();
r.get('/projects', requireUser, h.getProjects);
r.post('/projects', requireUser, perUser('project-create', 30, 3600), h.postProjects);
r.get('/projects/:id', requireUser, h.getProjectsById);
r.patch('/projects/:id', requireUser, perUser('project-edit', 120, 3600), h.patchProjectsById);
r.delete('/projects/:id', requireUser, h.deleteProjectsById);
r.get('/projects/:id/repo', requireUser, rh.getProjectsByIdRepo);
r.post('/projects/:id/repo', requireUser, perUser('repo-connect', 20, 3600), rh.postProjectsByIdRepo);
r.post('/projects/:id/repo/sync', requireUser, perUser('repo-sync', 30, 3600), rh.postProjectsByIdRepoSync);
r.delete('/projects/:id/repo', requireUser, rh.deleteProjectsByIdRepo);
r.post('/projects/:id/repo/branches', requireUser, perUser('repo-browse', 120, 3600), rh.postProjectsByIdRepoBranches);
r.post('/projects/:id/repo/repos', requireUser, perUser('repo-browse', 120, 3600), rh.postProjectsByIdRepoRepos);

module.exports = r;
