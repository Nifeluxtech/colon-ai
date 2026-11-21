// Repository providers (v0.24.0): what the user typed, made into a checked source, and the provider APIs a sync uses.
//   github     api.github.com (fine-grained or classic personal access token, read-only), zipball of a commit
//   gitlab     gitlab.com API v4 (personal / project access token with read_repository), archive.zip of a commit
//   bitbucket  api.bitbucket.org 2.0 (repository / workspace access token, or "user:app-password"), get/<sha>.zip
//   git        any public https Git URL (optional token), fetched with a shallow clone (git.js)
// A token only ever goes into an Authorization / PRIVATE-TOKEN header for the provider's own host (download.js drops
// it on a redirect to another host). Error messages never include the token or the provider's answer.
const download = require('./download');

const PROVIDERS = ['github', 'gitlab', 'bitbucket', 'git'];
const HOSTS = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };
const SEG = /^[A-Za-z0-9_.-]{1,100}$/;
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });
const invalid = (field, message) => err(422, 'invalid', message, { field });

/** branch names: no option-looking or traversal names (they reach the git command line and provider URLs). */
function cleanBranch(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^[\w./@+-]{1,255}$/.test(s) || s.startsWith('-') || s.includes('..') || s.endsWith('/')
    || s.endsWith('.lock')) throw invalid('branch', 'That branch name doesn’t look right.');
  return s;
}

/** tokens: printable, no spaces or line breaks (they go into an HTTP header). */
function cleanToken(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (s.length < 8 || s.length > 512 || !/^[\x21-\x7e]+$/.test(s)) {
    throw invalid('token', 'That access token doesn’t look right. Paste the whole token.');
  }
  return s;
}

/**
 * parse({ provider, url?, repo?, owner?, name? }) -> { provider, owner, name, url }
 *   github / gitlab / bitbucket: "owner/name" or the repository's https address on that host (GitLab owners may be
 *   groups with subgroups). git: an https URL without a user name or password.
 */
function parse(b = {}) {
  const provider = String(b.provider || '').toLowerCase();
  if (!PROVIDERS.includes(provider)) throw invalid('provider', 'Choose GitHub, GitLab, Bitbucket or a Git URL.');
  if (provider === 'git') return parseGitUrl(b.url);
  let path = b.repo || (b.owner && b.name ? `${b.owner}/${b.name}` : '');
  if (b.url) {
    let u;
    try { u = new URL(String(b.url).trim()); } catch { throw invalid('url', 'Paste the repository address.'); }
    if (u.protocol !== 'https:' || u.hostname.toLowerCase().replace(/^www\./, '') !== HOSTS[provider]) {
      throw invalid('url', `That isn’t a ${HOSTS[provider]} address. Use “Any Git URL” for other hosts.`);
    }
    path = u.pathname.split(/\/-\/|\/(?:tree|src|blob|branch)\//)[0];
  }
  const parts = String(path || '').replace(/\.git$/i, '').split('/').filter(Boolean);
  const max = provider === 'gitlab' ? 6 : 2;
  if (parts.length < 2 || parts.length > max || !parts.every((p) => SEG.test(p) && p !== '.' && p !== '..')) {
    throw invalid('repo', 'Use the repository as owner/name.');
  }
  const owner = parts.slice(0, -1).join('/'), name = parts[parts.length - 1];
  return { provider, owner, name, url: `https://${HOSTS[provider]}/${owner}/${name}` };
}

function parseGitUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw invalid('url', 'Paste an https Git address.'); }
  if (u.protocol !== 'https:') throw invalid('url', 'Only https Git addresses are supported.');
  if (u.username || u.password) throw invalid('url', 'Leave the user name and password out of the address; add a '
    + 'token instead.');
  if (u.port && u.port !== '443') throw invalid('url', 'Only the standard https port (443).');
  const parts = u.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (!parts.length || u.search || parts.some((p) => p === '..')) throw invalid('url', 'Paste the repository’s '
    + 'https clone address.');
  u.hash = '';
  return { provider: 'git', owner: parts.slice(0, -1).join('/').slice(0, 190) || u.hostname,
    name: parts[parts.length - 1].slice(0, 190), url: u.toString() };
}

/* ---------- Provider APIs ---------- */
function headers(provider, token) {
  if (!token) return {};
  if (provider === 'gitlab') return { 'PRIVATE-TOKEN': token };
  if (provider === 'bitbucket' && token.includes(':')) {
    return { Authorization: `Basic ${Buffer.from(token).toString('base64')}` };
  }
  return { Authorization: `Bearer ${token}` };
}
const ACCEPT = { github: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
const enc = encodeURIComponent;
const glId = (s) => enc(`${s.owner}/${s.name}`);
const API = {
  github: {
    info: (s) => [`https://api.github.com/repos/${s.owner}/${s.name}`,
      (j) => ({ default_branch: j.default_branch, private: Boolean(j.private) })],
    head: (s, b) => [`https://api.github.com/repos/${s.owner}/${s.name}/branches/${enc(b)}`, (j) => j.commit.sha],
    branches: (s) => [`https://api.github.com/repos/${s.owner}/${s.name}/branches?per_page=100`,
      (j) => j.map((x) => x.name)],
    repos: () => ['https://api.github.com/user/repos?per_page=100&sort=updated', (j) => j.map((r) => ({
      repo: r.full_name, private: Boolean(r.private), default_branch: r.default_branch }))],
    archive: (s, sha) => `https://api.github.com/repos/${s.owner}/${s.name}/zipball/${sha}`,
  },
  gitlab: {
    info: (s) => [`https://gitlab.com/api/v4/projects/${glId(s)}`, (j) => ({ default_branch: j.default_branch,
      private: j.visibility !== 'public' })],
    head: (s, b) => [`https://gitlab.com/api/v4/projects/${glId(s)}/repository/branches/${enc(b)}`,
      (j) => j.commit.id],
    branches: (s) => [`https://gitlab.com/api/v4/projects/${glId(s)}/repository/branches?per_page=100`,
      (j) => j.map((x) => x.name)],
    repos: () => ['https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at',
      (j) => j.map((r) => ({ repo: r.path_with_namespace, private: r.visibility !== 'public',
        default_branch: r.default_branch }))],
    archive: (s, sha) => `https://gitlab.com/api/v4/projects/${glId(s)}/repository/archive.zip?sha=${sha}`,
  },
  bitbucket: {
    info: (s) => [`https://api.bitbucket.org/2.0/repositories/${s.owner}/${s.name}`,
      (j) => ({ default_branch: j.mainbranch && j.mainbranch.name, private: Boolean(j.is_private) })],
    head: (s, b) => [`https://api.bitbucket.org/2.0/repositories/${s.owner}/${s.name}/refs/branches/${enc(b)}`,
      (j) => j.target.hash],
    branches: (s) => [`https://api.bitbucket.org/2.0/repositories/${s.owner}/${s.name}/refs/branches?pagelen=100`,
      (j) => j.values.map((x) => x.name)],
    repos: () => ['https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100&sort=-updated_on',
      (j) => j.values.map((r) => ({ repo: r.full_name, private: Boolean(r.is_private),
        default_branch: r.mainbranch && r.mainbranch.name }))],
    archive: (s, sha) => `https://bitbucket.org/${s.owner}/${s.name}/get/${sha}.zip`,
  },
};

/** call(src.provider, [url, pick], { token, net }) -> pick(json). Maps provider answers to our error codes. */
async function call(provider, [url, pick], { token, net = {} } = {}) {
  const r = await download.get(url, { ...net, headers: { Accept: 'application/json', ...(ACCEPT[provider] || {}) },
    auth: headers(provider, token), maxBytes: 4 * 1048576 });
  if (r.status === 401 || r.status === 403) throw err(422, 'repo_auth', token ? 'The token was refused. Check it '
    + 'has read access to this repository and hasn’t expired.' : 'This repository needs an access token.');
  if (r.status === 404) throw err(422, 'repo_not_found', 'We couldn’t find that repository or branch. For a private '
    + 'repository, add a token with read access.');
  if (r.status < 200 || r.status >= 300) throw err(502, 'repo_unreachable', 'The code host didn’t answer. Try again '
    + 'in a minute.');
  try { return pick(JSON.parse(r.buf.toString('utf8'))); } catch {
    throw err(502, 'repo_unreachable', 'The code host sent an answer we couldn’t read.');
  }
}

const api = (provider) => API[provider] || null;

module.exports = { parse, parseGitUrl, cleanBranch, cleanToken, headers, call, api, PROVIDERS, HOSTS };
