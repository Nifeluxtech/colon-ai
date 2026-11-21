// Project repositories (v0.24.0): connect a code repository to a project and keep a synced, read-only snapshot of
// one branch for Developer mode and the chat model's read_repo_file / search_repo tools.
//
//   connect     provider (github, gitlab, bitbucket: their APIs and archive downloads; git: any https Git URL with a
//               shallow clone), owner/name or URL, branch (default: the repository's), optional read-only token
//   sync        pulls the branch's latest commit (nothing is downloaded when the commit has not changed)
//   snapshot    developer.fromZip / fromEntries: fixed ignore rules + the repo's .gitignore / .colonignore,
//               binaries, lockfiles and secret files skipped, REPO_* caps; stored as a project attachment
//   token       encrypted at rest (shared/crypto.js); never in an answer, the model's context or a log line;
//               disconnect deletes it with the snapshot
//   ownership   every call is scoped to the user's own project; another user's project answers 404
const crypto = require('crypto');
const config = require('../../config');
const cryptoBox = require('../../shared/crypto');
const log = require('../../shared/logger');
const developer = require('../developer');
const providers = require('./providers');
const download = require('./download');
const git = require('./git');
const repoTools = require('./tools');
const { sqlStore, memoryStore } = require('./store');

const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });
const notFound = () => err(404, 'not_found', 'This project no longer exists.');
const noRepo = () => err(404, 'no_repo', 'This project has no connected repository.');
const newId = () => crypto.randomBytes(12).toString('base64url');

function repoOut(p) {
  if (!p || !p.repo_provider) return null;
  return { provider: p.repo_provider, owner: p.repo_owner, name: p.repo_name, url: p.repo_url,
    branch: p.repo_branch, sha: p.repo_sha || null, sha7: p.repo_sha ? String(p.repo_sha).slice(0, 7) : null,
    synced_at: p.repo_synced_at || null, files: p.repo_files == null ? null : Number(p.repo_files),
    has_token: Boolean(p.repo_token) };
}

/**
 * create({ store, cfg, net: { fetch, lookup }, exec, seal, open, now })
 *   net: injected fetch and DNS lookup (tests); exec: runs git (tests); seal/open: token encryption.
 */
function create({ store = sqlStore(), cfg = config.repos, net = {}, exec, seal = cryptoBox.encrypt,
  open = cryptoBox.decrypt, now = () => new Date() } = {}) {
  const uid = (u) => { if (!u || !u.id) throw err(401, 'unauthorized', 'Log in to use projects.'); return u.id; };
  const on = () => { if (!cfg.enabled) throw err(501, 'repos_off', 'Connecting repositories is switched off.'); };
  async function owned(u, pid) { const p = await store.get(uid(u), pid); if (!p) throw notFound(); return p; }
  const tokenOf = (p) => { try { return p.repo_token ? open(p.repo_token) : null; } catch { return null; } };
  const caps = () => ({ maxFiles: cfg.maxFiles, maxChars: Math.floor(cfg.maxTextMb * 1048576),
    fileMax: Math.floor(cfg.fileMaxKb * 1024) });
  const gitOpts = (o) => ({ ...o, lookup: net.lookup, exec, cfg });

  // Branch head and snapshot for a source. -> { sha, branch, text, meta, files }
  async function fetchSnapshot(src, branch, token, knownSha) {
    const label = `${src.owner}/${src.name}`;
    if (src.provider === 'git') {
      const c = await git.clone(gitOpts({ url: src.url, branch, token }));
      try {
        const entries = await git.walk(c.dir);
        const snap = developer.fromEntries(entries, label, { ...caps(), extra: { source: 'repo', sha: c.sha } });
        return { sha: c.sha, branch: branch || c.branch || 'HEAD', ...snap };
      } finally { await c.cleanup(); }
    }
    const api = providers.api(src.provider);
    const o = { token, net };
    const info = branch ? null : await providers.call(src.provider, api.info(src), o);
    const b = branch || (info && info.default_branch);
    if (!b) throw err(422, 'repo_not_found', 'This repository has no branches yet.');
    const sha = String(await providers.call(src.provider, api.head(src, b), o) || '');
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw err(502, 'repo_unreachable', 'The code host sent an odd commit id.');
    if (knownSha && knownSha === sha) return { sha, branch: b, unchanged: true };
    const r = await download.get(api.archive(src, sha), { ...net, auth: providers.headers(src.provider, token),
      maxBytes: cfg.archiveMaxMb * 1048576, timeoutMs: cfg.timeoutMs });
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      throw err(422, 'repo_auth', 'The archive download was refused. Check the token can read this repository.');
    }
    if (r.status !== 200) throw err(502, 'repo_unreachable', 'The code host didn’t send the archive.');
    const snap = developer.fromZip(r.buf, label, { ...caps(), extra: { source: 'repo', sha } });
    return { sha, branch: b, ...snap };
  }

  async function store1(u, p, src, got, sealed) {
    const userId = uid(u);
    const old = p.repo_attachment_id || null;
    const fields = { repo_provider: src.provider, repo_owner: src.owner.slice(0, 190), repo_name: src.name.slice(0,
      190), repo_url: src.url.slice(0, 500), repo_branch: got.branch, repo_sha: got.sha, repo_synced_at: now(),
      repo_token: sealed };
    if (!got.unchanged) {
      const id = newId();
      await store.saveSnapshot(userId, p.id, { id, name: `${src.owner}/${src.name}@${got.branch}`.slice(0, 190),
        text: got.text, meta: { ...got.meta, format: 'zip', source: 'repo', provider: src.provider, sha: got.sha } });
      fields.repo_attachment_id = id;
      fields.repo_files = got.meta.files;
    }
    await store.set(userId, p.id, fields);
    if (!got.unchanged && old) await store.removeSnapshot(userId, old);
    return repoOut(await store.get(userId, p.id));
  }

  // Logs the failure without the token or the address; unexpected errors become one plain message.
  const failed = (src, e) => {
    log.warn('repo_sync_failed', { provider: src.provider, code: e.code || 'error', status: e.status || 0 });
    if (e.status) throw e;
    throw err(422, 'repo_unreadable', 'That repository couldn’t be read. It may be too large or damaged.');
  };

  return {
    async status(u, pid) { return { repo: repoOut(await owned(u, pid)) }; },

    /** connect(u, pid, { provider, url | repo | owner+name, branch?, token? }) -> { repo } (synced) */
    async connect(u, pid, b = {}) {
      on();
      const p = await owned(u, pid);
      const src = providers.parse(b);
      const branch = providers.cleanBranch(b.branch);
      const same = p.repo_provider === src.provider && p.repo_url === src.url;
      const token = providers.cleanToken(b.token) || (same ? tokenOf(p) : null);
      const got = await fetchSnapshot(src, branch, token, null).catch((e) => failed(src, e));
      return { repo: await store1(u, p, src, got, token ? seal(token) : null) };
    },

    async sync(u, pid) {
      on();
      const p = await owned(u, pid);
      if (!p.repo_provider) throw noRepo();
      const src = { provider: p.repo_provider, owner: p.repo_owner, name: p.repo_name, url: p.repo_url };
      const known = p.repo_attachment_id && (await store.snapshot(uid(u), p.id)) ? p.repo_sha : null;
      const got = await fetchSnapshot(src, p.repo_branch, tokenOf(p), known).catch((e) => failed(src, e));
      return { repo: await store1(u, p, src, got, p.repo_token || null), unchanged: Boolean(got.unchanged) };
    },

    /** Removes the token and the stored snapshot; the project's chats and other files stay. */
    async disconnect(u, pid) {
      const p = await owned(u, pid);
      if (p.repo_attachment_id) await store.removeSnapshot(uid(u), p.repo_attachment_id);
      await store.clear(uid(u), p.id);
      return { ok: true };
    },

    /** branches(u, pid, { provider, url | repo, token? }) -> { branches, default_branch } */
    async branches(u, pid, b = {}) {
      on();
      const p = await owned(u, pid);
      const src = providers.parse(b);
      const token = providers.cleanToken(b.token) || (p.repo_url === src.url ? tokenOf(p) : null);
      if (src.provider === 'git') return git.lsRemote(gitOpts({ url: src.url, token }));
      const api = providers.api(src.provider);
      const info = await providers.call(src.provider, api.info(src), { token, net });
      const list = await providers.call(src.provider, api.branches(src), { token, net });
      return { branches: list.slice(0, 200), default_branch: info.default_branch || null, private: info.private };
    },

    /** repos(u, pid, { provider, token }) -> { repos: [{ repo, private, default_branch }] } (the token's own) */
    async repos(u, pid, b = {}) {
      on();
      const p = await owned(u, pid);
      const provider = String(b.provider || '');
      if (!providers.api(provider)) throw err(422, 'invalid', 'Choose GitHub, GitLab or Bitbucket.',
        { field: 'provider' });
      const token = providers.cleanToken(b.token) || (p.repo_provider === provider ? tokenOf(p) : null);
      if (!token) throw err(422, 'invalid', 'Add an access token to list your repositories.', { field: 'token' });
      const list = await providers.call(provider, providers.api(provider).repos(), { token, net });
      return { repos: list.slice(0, 100) };
    },

    /** The stored snapshot (parsed) of the user's project, or null. Never throws for a missing project. */
    async snapshotFor(userId, pid) {
      if (!userId || !pid) return null;
      return developer.parseSnapshot(await store.snapshot(userId, pid).catch(() => null));
    },
  };
}

let shared = null;
const instance = () => (shared || (shared = create()));

// The chat tools' executors (modules/tools/catalogue.js): the user's own project only (ctx.user, ctx.projectId).
async function snapFor(ctx) {
  const snap = await instance().snapshotFor(ctx.user && ctx.user.id, ctx.projectId);
  if (!snap) throw err(404, 'no_repo', 'This chat’s project has no connected repository.');
  return snap;
}

module.exports = {
  create, instance, memoryStore, repoOut, providers, tools: repoTools,
  snapshotFor: (userId, pid) => instance().snapshotFor(userId, pid),
  readFile: async (args, ctx) => repoTools.readFile(await snapFor(ctx), args),
  search: async (args, ctx) => repoTools.search(await snapFor(ctx), args),
  handlers: require('./handlers'),
};
