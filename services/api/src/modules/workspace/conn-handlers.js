// Workspace connection handlers (v0.31.0; routes: src/http/routes/workspace.js): server access to the connected
// database (Data tab tables and rows) and Git (commit & push, pull requests, merge). Owner only: every call acts on
// req.user's own workspace, with credentials decrypted on the server (data.js credentials()).
const audit = (...a) => require('../../shared/audit')(...a);   // lazy: tests load this without mysql2
const { createRemote } = require('./remote');
const { createGit } = require('./git');

let shared = null, deps = null;
function kit() {
  if (shared) return shared;
  const data = require('./data-handlers').data(), engine = require('./index').instance();
  shared = { remote: createRemote({ data, ...(deps || {}) }), git: createGit({ engine, data, ...(deps || {}) }) };
  return shared;
}
const setConnDeps = (d) => { deps = d; shared = null; };
const p = (req) => req.params;
const qp = (req, k) => (req.query && req.query.get ? req.query.get(k) : null);
const bad = (m) => Object.assign(new Error(m), { status: 404, code: 'not_found' });

// GET /workspaces/:id/remote/:provider/tables -> { tables: [{ name, columns[], rows|null }] }
const getTables = async (req) => [200, await kit().remote.tables(req.user, p(req).id, String(p(req).provider))];
// GET /workspaces/:id/remote/:provider/rows?table= -> { rows[], columns? }
const getRows = async (req) => [200, await kit().remote.rows(req.user, p(req).id, String(p(req).provider),
  String(qp(req, 'table') || ''))];
// GET /workspaces/:id/git/:provider/pulls -> { pulls: [{ number, title, head, base, url }] }
const getPulls = async (req) => [200, await kit().git.pulls(req.user, p(req).id, String(p(req).provider))];

// POST /workspaces/:id/git/:provider/commit { message, branch? } -> { sha, branch, url, files, removed }
// POST /workspaces/:id/git/:provider/pulls { head, base?, title? } -> { number, url }
// POST /workspaces/:id/git/:provider/merge { number } | { head, base? } -> { merged, sha }
const ACTIONS = { commit: 'commit', pulls: 'openPull', merge: 'merge' };
const postGit = async (req) => {
  const fn = ACTIONS[p(req).action];
  if (!fn) throw bad('Unknown Git action.');
  const out = await kit().git[fn](req.user, p(req).id, String(p(req).provider), req.body || {});
  await audit(req, `workspace.git_${p(req).action}`, { actorId: req.user.id, targetType: 'workspace',
    targetId: String(p(req).id), meta: { provider: String(p(req).provider), sha: out.sha || null,
      number: out.number || null } });
  return [200, out];
};

module.exports = { getTables, getRows, getPulls, postGit, setConnDeps, kit };
