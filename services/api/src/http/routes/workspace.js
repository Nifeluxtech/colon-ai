// Workspace (v0.25.0 step 1, v0.26.0 step 2 chat): route wiring only. Handlers: modules/workspace/handlers.js.
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { perUser } = require('../middleware/ratelimit');
const h = require('../../modules/workspace').handlers;
const d = require('../../modules/workspace').dataHandlers;

const BODY = { bodyLimit: 2 * 1024 * 1024 };   // a 1 MB image arrives base64-encoded (~1.4 MB)
const r = new Router();
r.get('/workspaces', requireUser, h.getWorkspaces);
r.post('/workspaces', requireUser, perUser('workspace-create', 30, 3600), h.postWorkspaces);
r.get('/workspaces/:id', requireUser, h.getWorkspace);
r.patch('/workspaces/:id', requireUser, perUser('workspace-edit', 120, 3600), h.patchWorkspace);
r.delete('/workspaces/:id', requireUser, h.deleteWorkspace);
r.get('/workspaces/:id/bundle', requireUser, perUser('workspace-read', 600, 3600), h.getBundle);
r.get('/workspaces/:id/file', requireUser, perUser('workspace-read', 600, 3600), h.getFile);
r.put('/workspaces/:id/file', BODY, requireUser, perUser('workspace-write', 600, 3600), h.putFile);
r.delete('/workspaces/:id/file', requireUser, perUser('workspace-write', 600, 3600), h.deleteFile);
r.post('/workspaces/:id/file/move', requireUser, perUser('workspace-write', 600, 3600), h.moveFile);
r.get('/workspaces/:id/versions', requireUser, h.getVersions);
r.post('/workspaces/:id/versions/:n/restore', requireUser, perUser('workspace-write', 600, 3600), h.restoreVersion);
// v0.26.0 (step 2): the Workspace chat. Each message is one Developer-mode reply against the daily limits.
r.get('/workspaces/:id/chat', requireUser, perUser('workspace-read', 600, 3600), h.getChat);
r.post('/workspaces/:id/chat', requireUser, perUser('workspace-chat', 60, 3600), h.postChat);
// v0.27.3: clone a repository into the workspace, or learn from one
r.post('/workspaces/:id/repo', requireUser, perUser('workspace-repo', 30, 3600), h.postRepo);
r.delete('/workspaces/:id/reference', requireUser, h.deleteReference);
// v0.28.0 (step 4): publish to apparatus.name.ng/<name>/.
r.get('/workspaces/:id/publish/check', requireUser, perUser('workspace-read', 600, 3600), h.getPublishCheck);
r.post('/workspaces/:id/publish', requireUser, perUser('workspace-publish', 60, 3600), h.postPublish);
r.delete('/workspaces/:id/publish', requireUser, perUser('workspace-publish', 60, 3600), h.deletePublish);
// v0.29.0 (step 5): secrets and the site's database (public side: routes/sites.js).
r.get('/workspaces/:id/data', requireUser, perUser('workspace-read', 600, 3600), d.getData);
r.put('/workspaces/:id/secrets/:name', requireUser, perUser('workspace-secret', 120, 3600), d.putSecret);
r.delete('/workspaces/:id/secrets/:name', requireUser, perUser('workspace-secret', 120, 3600), d.deleteSecret);
r.put('/workspaces/:id/tables/:name', requireUser, perUser('workspace-write', 600, 3600), d.putTable);
r.delete('/workspaces/:id/tables/:name', requireUser, perUser('workspace-write', 600, 3600), d.deleteTable);
r.get('/workspaces/:id/tables/:name/records', requireUser, perUser('workspace-read', 600, 3600), d.getRecords);
r.post('/workspaces/:id/tables/:name/records', requireUser, perUser('workspace-write', 600, 3600), d.postRecord);
r.delete('/workspaces/:id/tables/:name/records/:rid', requireUser, perUser('workspace-write', 600, 3600),
  d.deleteRecord);

module.exports = r;
