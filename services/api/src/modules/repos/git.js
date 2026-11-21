// Any Git URL (v0.24.0): a shallow clone (depth 1, one branch, no tags) of a public https repository, or a private one
// with a token, into a temporary folder that is read into a snapshot and then deleted.
// SSRF: the host is resolved here and every address must be public (the search module's isPrivateIp rules); git is
// then pinned to that address (http.curloptResolve, so there is no second DNS answer to rebind to), redirects are
// off and only the https protocol is allowed. Hooks, submodules, LFS downloads and symlinks are off. The token goes
// to git through the environment (GIT_CONFIG_* as an Authorization header), never on the command line or in the URL,
// and git's own output is never passed on (it can echo the address).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const dns = require('dns');
const { execFile } = require('child_process');
const search = require('../search');

const MIN_GIT = [2, 37];   // http.curloptResolve
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const lookupAll = (host) => new Promise((resolve, reject) => dns.lookup(host, { all: true, verbatim: true },
  (e, a) => (e ? reject(e) : resolve(a))));

function run(bin, args, { env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1048576, killSignal: 'SIGKILL' },
      (e, stdout) => (e ? reject(Object.assign(new Error('git failed'), { code: e.killed ? 'timeout' : 'git' }))
        : resolve({ stdout: String(stdout) })));
  });
}

/** pin(url, { lookup }) -> { host, address } after the SSRF check; throws blocked_url (422). */
async function pin(url, { lookup = lookupAll } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw fail(422, 'blocked_url', 'Only https Git addresses are supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host }] : await lookup(host); } catch {
    throw fail(502, 'repo_unreachable', 'That host could not be found.');
  }
  try { await search.net.checkUrl(url, { lookup: async () => addrs }); } catch {
    throw fail(422, 'blocked_url', 'That address isn’t a public https site.');
  }
  return { host: u.hostname, address: addrs[0].address };
}

/** The environment git runs with: pinned address, https only, no prompts, hooks or redirects; the token header. */
function gitEnv({ host, address }, token, home) {
  const ip = net.isIPv6(address) ? `[${address}]` : address;
  const cfg = [['http.curloptResolve', `${host}:443:${ip}`], ['http.followRedirects', 'false'],
    ['protocol.allow', 'never'], ['protocol.https.allow', 'always'], ['core.hooksPath', '/dev/null'],
    ['core.symlinks', 'false'], ['submodule.recurse', 'false'], ['credential.helper', '']];
  if (token) cfg.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${token}`)
    .toString('base64')}`]);
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home, GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_LFS_SKIP_SMUDGE: '1', GIT_ASKPASS: '/bin/false',
    GIT_CONFIG_COUNT: String(cfg.length) };
  cfg.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  return env;
}

async function checkVersion(bin, exec, timeoutMs) {
  const { stdout } = await exec(bin, ['--version'], { env: { PATH: process.env.PATH || '' }, timeoutMs })
    .catch(() => { throw fail(501, 'git_missing', 'Git URLs aren’t available on this server yet.'); });
  const [maj, min] = (stdout.match(/(\d+)\.(\d+)/) || []).slice(1).map(Number);
  if (!(maj > MIN_GIT[0] || (maj === MIN_GIT[0] && min >= MIN_GIT[1]))) {
    throw fail(501, 'git_missing', 'Git URLs need a newer git on this server.');
  }
}

/**
 * lsRemote({ url, token, lookup, exec, cfg }) -> { branches: [], default_branch }
 */
async function lsRemote({ url, token, lookup, exec = run, cfg }) {
  const p = await pin(url, { lookup });
  await checkVersion(cfg.gitBin, exec, cfg.timeoutMs);
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'colon-git-'));
  try {
    const { stdout } = await exec(cfg.gitBin, ['ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*'],
      { env: gitEnv(p, token, home), timeoutMs: cfg.timeoutMs }).catch(() => {
      throw fail(422, 'repo_not_found', 'We couldn’t read that Git repository. For a private one, add a token.');
    });
    const def = (stdout.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m) || [])[1] || null;
    const branches = [...stdout.matchAll(/^[0-9a-f]{40,64}\trefs\/heads\/(\S+)$/gm)].map((m) => m[1]).slice(0, 200);
    return { branches, default_branch: def };
  } finally { await fs.promises.rm(home, { recursive: true, force: true }).catch(() => {}); }
}

/**
 * clone({ url, branch, token, lookup, exec, cfg }) -> { dir, sha, branch, cleanup() }
 */
async function clone({ url, branch, token, lookup, exec = run, cfg }) {
  const p = await pin(url, { lookup });
  await checkVersion(cfg.gitBin, exec, cfg.timeoutMs);
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'colon-git-'));
  const dir = path.join(home, 'repo');
  const cleanup = () => fs.promises.rm(home, { recursive: true, force: true }).catch(() => {});
  try {
    const env = gitEnv(p, token, home);
    await exec(cfg.gitBin, ['clone', '--depth', '1', '--single-branch', '--no-tags', '--quiet',
      ...(branch ? ['--branch', branch] : []), '--', url, dir], { env, timeoutMs: cfg.timeoutMs }).catch((e) => {
      throw e.code === 'timeout' ? fail(502, 'repo_unreachable', 'The repository took too long to download.')
        : fail(422, 'repo_not_found', 'We couldn’t clone that repository or branch. For a private one, add a token.');
    });
    const { stdout } = await exec(cfg.gitBin, ['-C', dir, 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { env,
      timeoutMs: 10000 });
    const [sha, name] = stdout.trim().split('\n');
    if (!/^[0-9a-f]{40,64}$/.test(sha || '')) throw fail(422, 'repo_not_found', 'That repository has no commits.');
    return { dir, sha, branch: name && name !== 'HEAD' ? name.slice(0, 255) : null, cleanup };
  } catch (e) { await cleanup(); throw e; }
}

/** walk(dir, { maxEntries }) -> [{ name, size, read(max) }]: regular files only (no symlinks), .git skipped. */
async function walk(dir, { maxEntries = 20000 } = {}) {
  const out = [];
  async function visit(rel) {
    const list = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of list) {
      if (out.length >= maxEntries) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink() || e.name === '.git') continue;
      if (e.isDirectory()) await visit(r);
      else if (e.isFile()) {
        const full = path.join(dir, r);
        const { size } = await fs.promises.lstat(full);
        out.push({ name: r, size, read: (max) => (size > max ? null : fs.readFileSync(full)) });
      }
    }
  }
  await visit('');
  return out;
}

module.exports = { clone, lsRemote, walk, pin, gitEnv, run };
