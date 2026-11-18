// Projects (v0.15.0, Blueprint B10): route wiring only. Handlers: modules/projects/handlers.js
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/projects').handlers;

const r = new Router();
r.get('/projects', requireUser, h.getProjects);
r.post('/projects', requireUser, perUser('project-create', 30, 3600), h.postProjects);
r.get('/projects/:id', requireUser, h.getProjectsById);
r.patch('/projects/:id', requireUser, perUser('project-edit', 120, 3600), h.patchProjectsById);
r.delete('/projects/:id', requireUser, h.deleteProjectsById);

module.exports = r;
