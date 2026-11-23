// Git for a workspace (v0.31.0): the workspace's connected GitHub or Bitbucket repository (Data → Connect). Colon
// commits every file of the workspace to it (into the connection's folder, or the repository root), opens pull
// requests and merges them, or merges a branch into another. The Data tab's buttons and the Workspace chat's
// === COMMIT / PR / MERGE blocks (tools.js) both land here. Each push remembers the paths it sent (connection state),
// so a file deleted in the workspace is deleted in the repository on the next push.
const { github } = require('./github');
const { bitbucket } = require('./bitbucket');
const { createHttp } = require('../remote/http');

const ADAPTERS = { github, bitbucket };
const BRANCH = /^(?!-)(?!.*\.\.)[\w./@+-]{1,200}(?<![/.])$/;
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

function cleanBranch(v, field = 'branch') {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!BRANCH.test(s) || s.endsWith('.lock')) throw err(422, 'invalid', 'That branch name doesn’t look right.',
    { field });
  return s;
}
const cleanMessage = (v, dflt) => String(v || dflt).replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || dflt;

function createGit({ engine, data, http = createHttp() }) {
  async function open(u, id, provider) {
    if (!ADAPTERS[provider]) throw err(404, 'not_found', 'Colon can’t push to that service.');
    const c = await data.credentials(u, id, provider);
    return { c, a: ADAPTERS[provider](c, http) };
  }
  async function commit(u, id, provider, b = {}) {
    const { c, a } = await open(u, id, provider);
    const folder = c.config.folder ? `${c.config.folder}/` : '';
    const bundle = await engine.bundle(u, id);
    const files = bundle.files.map((f) => ({ path: folder + f.path, binary: f.encoding === 'base64',
      content: Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8') }));
    if (!files.length) throw err(422, 'empty', 'This workspace has no files to push yet.');
    const branch = cleanBranch(b.branch) || '';
    const sent = new Set(files.map((f) => f.path));
    const before = (c.state.pushed && c.state.pushed[branch || c.config.branch || '']) || [];
    const removed = before.filter((p) => !sent.has(p) && (!folder || p.startsWith(folder)));
    const r = await a.commit({ files, removed, branch: branch || undefined,
      message: cleanMessage(b.message, 'Update site from Colon') });
    const pushed = { ...(c.state.pushed || {}), [branch || c.config.branch || '']: [...sent] };
    const last = { sha: r.sha, message: cleanMessage(b.message, 'Update site from Colon'), branch: r.branch,
      url: r.url, at: new Date().toISOString() };
    await data.setState(u, id, provider, { ...c.state, pushed, last });
    return { ...r, message: last.message };
  }
  async function pulls(u, id, provider) {
    const { a } = await open(u, id, provider);
    return { pulls: await a.pulls() };
  }
  async function openPull(u, id, provider, b = {}) {
    const head = cleanBranch(b.head, 'head');
    if (!head) throw err(422, 'invalid', 'Choose the branch to merge from.', { field: 'head' });
    const { a } = await open(u, id, provider);
    return a.openPull({ head, base: cleanBranch(b.base, 'base') || undefined, title: cleanMessage(b.title,
      `Update from Colon`) });
  }
  // { number } merges that pull request; { head, base? } merges a branch
  async function merge(u, id, provider, b = {}) {
    const { a } = await open(u, id, provider);
    if (b.number != null && b.number !== '') {
      const n = Number(b.number);
      if (!Number.isInteger(n) || n < 1) throw err(422, 'invalid', 'That pull request number isn’t valid.');
      return a.mergePull(n);
    }
    const head = cleanBranch(b.head, 'head');
    if (!head) throw err(422, 'invalid', 'Choose the branch to merge from.', { field: 'head' });
    return a.mergeBranch({ head, base: cleanBranch(b.base, 'base') || undefined });
  }
  return { commit, pulls, openPull, merge, providers: Object.keys(ADAPTERS) };
}

module.exports = { createGit, cleanBranch, ADAPTERS };
