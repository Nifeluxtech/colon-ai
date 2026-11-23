// Bitbucket Cloud (v0.31.0): commit through POST /2.0/repositories/<workspace>/<repo>/src (multipart: one field per
// file, `files` for each path to delete, one commit; a branch that doesn't exist is created), pull requests (list,
// open, merge). Bitbucket has no direct branch-merge call, so merging a branch opens a pull request and merges it.
// Auth: an Atlassian API token with the account's email (Basic), or a repository / workspace access token (Bearer).
// (App passwords were retired in 2026.)
const { must } = require('../remote/http');

const API = 'https://api.bitbucket.org/2.0';

function bitbucket({ config, secret }, http) {
  const [ws, repo] = String(config.repo || '').split('/');
  const R = `${API}/repositories/${encodeURIComponent(ws)}/${encodeURIComponent(repo)}`, label = 'Bitbucket';
  const headers = { authorization: secret.email ? `Basic ${Buffer.from(`${secret.email}:${secret.token}`)
    .toString('base64')}` : `Bearer ${secret.token}` };
  const call = (path, o = {}) => http.call(`${R}${path}`, { ...o, headers: { ...headers, ...(o.headers || {}) },
    label });
  const api = async (path, o) => must(await call(path, o), label);

  async function main() {
    if (config.branch) return config.branch;
    const r = await api('');
    return (r.mainbranch && r.mainbranch.name) || 'main';
  }
  async function commit({ files, removed = [], message, branch }) {
    const target = branch || await main();
    const form = new FormData();
    form.append('message', message);
    form.append('branch', target);
    for (const f of files) form.append(f.path, new Blob([f.content]), f.path.split('/').pop());
    for (const p of removed) form.append('files', p);
    await api('/src', { method: 'POST', form });
    const b = await api(`/refs/branches/${encodeURIComponent(target)}`);
    const sha = b.target && b.target.hash;
    return { sha, branch: target, url: `https://bitbucket.org/${ws}/${repo}/commits/${sha}`, files: files.length,
      removed: removed.length };
  }
  async function pulls() {
    const d = await api('/pullrequests?state=OPEN&pagelen=20');
    return (d.values || []).map((p) => ({ number: p.id, title: p.title, head: p.source && p.source.branch.name,
      base: p.destination && p.destination.branch.name, url: p.links && p.links.html && p.links.html.href }));
  }
  async function openPull({ head, base, title, body }) {
    const p = await api('/pullrequests', { method: 'POST', json: { title: title || 'Update from Colon',
      description: body || 'Opened by Colon AI.', source: { branch: { name: head } },
      destination: { branch: { name: base || await main() } } } });
    return { number: p.id, url: p.links && p.links.html && p.links.html.href };
  }
  async function mergePull(number) {
    const r = await api(`/pullrequests/${Number(number)}/merge`, { method: 'POST', json: { merge_strategy:
      'merge_commit', message: `Merged by Colon AI` } });
    return { merged: r.state === 'MERGED', sha: r.merge_commit && r.merge_commit.hash, number: Number(number) };
  }
  async function mergeBranch({ head, base }) {
    const p = await openPull({ head, base, title: `Merge ${head} into ${base || await main()}` });
    return mergePull(p.number);
  }
  return { label, commit, pulls, openPull, mergePull, mergeBranch };
}

module.exports = { bitbucket };
