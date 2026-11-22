// Workspace publishing (v0.28.0, Workspace step 4; plan: docs/workspace/plan.md). Writes a workspace's current
// files as a static site to <root>/<name>/, served at https://apparatus.name.ng/<name>/.
//
//   root       WORKSPACE_PUBLISH_ROOT, else ~/public_html (the main domain's document root on cPanel).
//   names      lowercase a-z, 0-9 and hyphens, 3 to 30 characters, not reserved, not an existing folder or file
//              in the root unless Colon wrote it for this same workspace (its .colon-site marker says so).
//   atomic     files go to a hidden temp folder first, then one rename swaps it in, so a site is never half-written.
//   safety     static only: paths.js already refuses server-side files; hidden files are skipped; every site gets a
//              Colon-written .htaccess that turns off script handlers and folder listings.
//   badge      every HTML page gets a small "Made with Colon" footer badge with a Report link.
const fs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

const SITE = 'https://apparatus.name.ng/';
const MARKER = '.colon-site';
const NAME = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
const RESERVED = new Set(['chat', 'browser', 'admin', 'api', 'www', 'mail', 'cpanel', 'webmail', 'ftp', 'cgi-bin',
  'well-known', 'assets', 'static', 'v', 'colon', 'apparatus', 'index', 'public', 'private', 'tmp', 'logs']);
const HTACCESS = [
  '# Written by Colon. Published Workspace sites are static files only.',
  'Options -Indexes -ExecCGI',
  'RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8 .phar .cgi .pl .py .sh',
  'RemoveType .php .phtml .php3 .php4 .php5 .php7 .php8 .phar',
  '<IfModule mod_php.c>', '  php_flag engine off', '</IfModule>',
  '<IfModule mod_php7.c>', '  php_flag engine off', '</IfModule>',
  '<FilesMatch "^\\.">', '  Require all denied', '</FilesMatch>', ''].join('\n');

const defaultRoot = () => process.env.WORKSPACE_PUBLISH_ROOT || nodePath.join(require('os').homedir(), 'public_html');
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

function badge(name) {
  const report = 'mailto:contact@nifelux.com?subject=' + encodeURIComponent('Report site ' + SITE + name + '/');
  return '\n<div style="position:fixed;right:8px;bottom:8px;z-index:2147483647;font:12px/1.2 system-ui,sans-serif;'
    + 'background:rgba(20,20,20,.82);color:#fff;border-radius:999px;padding:5px 10px">'
    + '<a href="https://chat.apparatus.name.ng/" style="color:#fff;text-decoration:none">Made with Colon</a>'
    + ' · <a href="' + report + '" style="color:#bbb;text-decoration:none">Report</a></div>\n';
}
function withBadge(html, name) {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i < 0 ? html + badge(name) : html.slice(0, i) + badge(name) + html.slice(i);
}

function createPublisher({ store, root = defaultRoot(), fsx = fs } = {}) {
  const p = fsx.promises;
  const ready = () => {
    if (!root || !fsx.existsSync(root)) {
      throw err(503, 'not_set_up', 'Publishing isn’t set up on this server yet.');
    }
  };
  const dir = (name) => nodePath.join(root, name);
  async function markerOf(name) {
    try { return (await p.readFile(nodePath.join(dir(name), MARKER), 'utf8')).trim(); } catch { return null; }
  }
  // -> { name, ok, reason?, url }
  async function check(w, raw) {
    const name = String(raw == null ? '' : raw).trim().toLowerCase();
    const out = (ok, reason) => ({ name, ok, url: SITE + name + '/', ...(reason ? { reason } : {}) });
    if (!NAME.test(name) || name.includes('--')) {
      return out(false, 'Use 3 to 30 lowercase letters, numbers or single hyphens, starting and ending with a '
        + 'letter or number.');
    }
    if (RESERVED.has(name)) return out(false, 'That name is reserved.');
    ready();
    const owner = await store.bySlug(name);
    if (owner && owner.id !== w.id) return out(false, 'That name is taken.');
    if (fsx.existsSync(dir(name)) && (await markerOf(name)) !== w.id) return out(false, 'That name is taken.');
    return out(true);
  }
  async function writeSite(w, name, files) {
    const tmp = dir('.colon-tmp-' + crypto.randomBytes(6).toString('hex'));
    await p.mkdir(tmp, { recursive: true });
    try {
      for (const f of files) {
        if (f.path.split('/').some((s) => !s || s.startsWith('.') || s === '..')) continue;
        const target = nodePath.join(tmp, f.path);
        if (!target.startsWith(tmp + nodePath.sep)) continue;
        await p.mkdir(nodePath.dirname(target), { recursive: true });
        const html = /\.html?$/i.test(f.path);
        await p.writeFile(target, html ? withBadge(Buffer.from(f.content).toString('utf8'), name) : f.content);
      }
      await p.writeFile(nodePath.join(tmp, '.htaccess'), HTACCESS);
      await p.writeFile(nodePath.join(tmp, MARKER), w.id + '\n');
      let old = null;
      if (fsx.existsSync(dir(name))) {
        old = dir('.colon-old-' + crypto.randomBytes(6).toString('hex'));
        await p.rename(dir(name), old);
      }
      await p.rename(tmp, dir(name));
      if (old) await p.rm(old, { recursive: true, force: true });
    } catch (e) {
      await p.rm(tmp, { recursive: true, force: true });
      throw e;
    }
  }
  async function removeSite(w, name) {
    if (!name || !root || !fsx.existsSync(dir(name)) || (await markerOf(name)) !== w.id) return;
    await p.rm(dir(name), { recursive: true, force: true });
  }
  // -> { name, url, version, at }
  async function publish(u, w, raw) {
    const c = await check(w, raw == null || raw === '' ? w.slug : raw);
    if (!c.ok) throw err(422, 'invalid', c.reason, { field: 'name' });
    const files = await store.allFiles(w.id);
    if (!files.some((f) => f.path === 'index.html')) {
      throw err(422, 'no_index', 'Add an index.html first: it’s the page people see at your link.');
    }
    await writeSite(w, c.name, files);
    if (w.slug && w.slug !== c.name) await removeSite(w, w.slug);
    const at = new Date();
    try {
      await store.update(u.id, w.id, { slug: c.name, published_version: Number(w.version) || 0, published_at: at });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        await removeSite(w, c.name);
        throw err(422, 'invalid', 'That name is taken.', { field: 'name' });
      }
      throw e;
    }
    return { name: c.name, url: c.url, version: Number(w.version) || 0, at };
  }
  async function unpublish(u, w) {
    await removeSite(w, w.slug);
    await store.update(u.id, w.id, { slug: null, published_version: null, published_at: null });
    return { ok: true };
  }
  return { check, publish, unpublish, removeSite, SITE };
}

module.exports = { createPublisher, RESERVED, HTACCESS, withBadge, SITE };
