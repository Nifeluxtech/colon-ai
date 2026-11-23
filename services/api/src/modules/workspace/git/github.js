// GitHub (v0.31.0): commit the workspace's files to a repository with the Git Data API (one commit: a tree on the
// branch's current tree with every file, minus the ones removed since the last push), open pull requests and merge
// them, or merge one branch into another. A fine-grained token with Contents and Pull requests: Read and write.
// An empty repository is first given a README through the contents API (the Git Data API needs one commit).
const { must } = require('../remote/http');

const API = 'https://api.github.com';
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

function github({ config, secret }, http) {
  const [owner, repo] = String(config.repo || '').split('/');
  const R = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, label = 'GitHub';
  const headers = { authorization: `Bearer ${secret.token}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28' };
  const call = (path, o = {}) => http.call(`${R}${path}`, { ...o, headers, label });
  const api = async (path, o) => must(await call(path, o), label);
  const ref = (b) => `heads/${String(b).split('/').map(encodeURIComponent).join('/')}`;

  async function info() { return api(''); }
  async function head(branch) {
    const r = await call(`/git/ref/${ref(branch)}`);
    if (r.status === 404) return null;
    if (r.status === 409) return { empty: true };
    return must(r, label).object.sha;
  }
  async function seed(branch) {
    await api('/contents/README.md', { method: 'PUT', json: { message: 'Start repository', branch,
      content: Buffer.from(`# ${repo}\n`).toString('base64') } });
    return head(branch);
  }
  // files: [{ path, content: Buffer }], removed: [path] -> { sha, url, files }
  async function commit({ files, removed = [], message, branch }) {
    const meta = await info();
    const base = config.branch || meta.default_branch || 'main', target = branch || base;
    let parent = await head(target);
    if (parent && parent.empty) parent = await seed(target);
    let created = false;
    if (!parent) {
      let from = await head(base);
      if (from && from.empty) from = await seed(base);
      if (!from) throw err(404, 'not_found', `The branch ${base} doesn’t exist in ${config.repo}.`);
      parent = from; created = true;
    }
    const pc = await api(`/git/commits/${parent}`);
    const tree = [];
    for (const f of files) {
      const text = !f.binary;
      if (text) tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.content.toString('utf8') });
      else {
        const b = await api('/git/blobs', { method: 'POST', json: { content: f.content.toString('base64'),
          encoding: 'base64' } });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
      }
    }
    for (const p of removed) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
    let t = await call('/git/trees', { method: 'POST', json: { base_tree: pc.tree.sha, tree } });
    if (!t.ok && removed.length) {   // a removed path that isn't there any more: try again without deletions
      t = await call('/git/trees', { method: 'POST', json: { base_tree: pc.tree.sha, tree: tree.filter((x) => x.sha
        !== null) } });
    }
    const nt = must(t, label);
    const c = await api('/git/commits', { method: 'POST', json: { message, tree: nt.sha, parents: [parent] } });
    if (created) await api('/git/refs', { method: 'POST', json: { ref: `refs/heads/${target}`, sha: c.sha } });
    else await api(`/git/refs/${ref(target)}`, { method: 'PATCH', json: { sha: c.sha } });
    return { sha: c.sha, branch: target, url: `https://github.com/${owner}/${repo}/commit/${c.sha}`,
      files: files.length, removed: removed.length };
  }
  async function pulls() {
    const list = await api('/pulls?state=open&per_page=20');
    return list.map((p) => ({ number: p.number, title: p.title, head: p.head && p.head.ref, base: p.base && p.base.ref,
      url: p.html_url }));
  }
  async function openPull({ head: h, base, title, body }) {
    const p = await api('/pulls', { method: 'POST', json: { head: h, base: base || config.branch || 'main',
      title: title || `Update from Colon`, body: body || 'Opened by Colon AI.' } });
    return { number: p.number, url: p.html_url };
  }
  async function mergePull(number) {
    const r = await api(`/pulls/${Number(number)}/merge`, { method: 'PUT', json: { merge_method: 'merge' } });
    return { merged: Boolean(r.merged), sha: r.sha, number: Number(number) };
  }
  async function mergeBranch({ head: h, base }) {
    const r = await call('/merges', { method: 'POST', json: { base: base || config.branch || 'main', head: h,
      commit_message: `Merge ${h} into ${base || config.branch || 'main'} (Colon)` } });
    if (r.status === 204) return { merged: true, already: true };
    if (r.status === 409) throw err(409, 'conflict', `${h} can’t be merged automatically (conflicts). Open a pull `
      + 'request and resolve them on GitHub.');
    const d = must(r, label);
    return { merged: true, sha: d.sha };
  }
  return { label, commit, pulls, openPull, mergePull, mergeBranch };
}

module.exports = { github };
