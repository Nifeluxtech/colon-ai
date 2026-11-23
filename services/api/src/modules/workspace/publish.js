// Workspace publishing (v0.28.0, Workspace step 4; plan: docs/workspace/plan.md). Writes a workspace's current
// files as a static site to <root>/<username>/<name>/, served at https://apparatus.name.ng/<username>/<name>/
// (v0.30.0: the user's publishing name comes first, so two users can both have a site called "shop").
//
//   username   picked once (changeable), same rules as names; its folder holds a .colon-user marker.
//   legacy     a site published before v0.30.0 at <root>/<name>/ becomes a redirect to its new link on republish.
//   root       WORKSPACE_PUBLISH_ROOT, else ~/public_html (the main domain's document root on cPanel).
//   names      lowercase a-z, 0-9 and hyphens, 3 to 30 characters; unique per user. Usernames also may not be
//              reserved or an existing folder or file in the root unless Colon wrote it for this same user.
//   atomic     files go to a hidden temp folder first, then one rename swaps it in, so a site is never half-written.
//   safety     static only: paths.js already refuses server-side files; hidden files are skipped; every site gets a
//              Colon-written .htaccess that turns off script handlers and folder listings.
//   badge      every HTML page gets a small "Made with Colon" footer badge with a Report link.
const fs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');
const { importMap, withImportMap } = require('./pkgmap');

const SITE = 'https://apparatus.name.ng/';
const MARKER = '.colon-site';
const UMARK = '.colon-user';
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

function badge(where) {
  const report = 'mailto:contact@nifelux.com?subject=' + encodeURIComponent('Report site ' + SITE + where + '/');
  return '\n<div style="position:fixed;right:8px;bottom:8px;z-index:2147483647;font:12px/1.2 system-ui,sans-serif;'
    + 'background:rgba(20,20,20,.82);color:#fff;border-radius:999px;padding:5px 10px">'
    + '<a href="https://chat.apparatus.name.ng/" style="color:#fff;text-decoration:none">Made with Colon</a>'
    + ' · <a href="' + report + '" style="color:#bbb;text-decoration:none">Report</a></div>\n';
}
function withBadge(html, where) {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i < 0 ? html + badge(where) : html.slice(0, i) + badge(where) + html.slice(i);
}
const NAME_RULE = 'Use 3 to 30 lowercase letters, numbers or single hyphens, starting and ending with a letter or '
  + 'number.';
const clean = (raw) => String(raw == null ? '' : raw).trim().toLowerCase();
const valid = (name) => NAME.test(name) && !name.includes('--');
// A pre-v0.30.0 link /<old>/ now forwards to /<user>/<name>/.
const redirect = (to) => ['# Written by Colon: this site moved.', 'Options -Indexes -ExecCGI', 'RewriteEngine On',
  `RewriteRule ^(.*)$ /${to}/$1 [R=301,L]`, ''].join('\n');

function createPublisher({ store, root = defaultRoot(), fsx = fs } = {}) {
  const p = fsx.promises;
  const ready = () => {
    if (!root || !fsx.existsSync(root)) {
      throw err(503, 'not_set_up', 'Publishing isn’t set up on this server yet.');
    }
  };
  const dir = (...parts) => nodePath.join(root, ...parts);
  async function readMark(d, file = MARKER) {
    try { return (await p.readFile(nodePath.join(d, file), 'utf8')).trim(); } catch { return null; }
  }
  const urlOf = (user, name) => SITE + (user ? user + '/' : '') + name + '/';

  // ---- the user's publishing name ----
  // -> { name, ok, reason? }
  async function checkUser(u, raw) {
    const name = clean(raw);
    const out = (ok, reason) => ({ name, ok, ...(reason ? { reason } : {}) });
    if (!valid(name)) return out(false, NAME_RULE);
    if (RESERVED.has(name)) return out(false, 'That name is reserved.');
    ready();
    const owner = await store.ownerByName(name);
    if (owner && String(owner.user_id) !== String(u.id)) return out(false, 'That name is taken.');
    if (fsx.existsSync(dir(name)) && (await readMark(dir(name), UMARK)) !== String(u.id)) {
      return out(false, 'That name is taken.');
    }
    return out(true);
  }
  // -> { name } ; renames the folder when the user had another name, so their sites follow.
  async function setUser(u, raw) {
    const c = await checkUser(u, raw);
    if (!c.ok) throw err(422, 'invalid', c.reason, { field: 'username' });
    const old = await store.ownerName(u.id);
    if (old === c.name) return { name: c.name };
    try { await store.setOwnerName(u.id, c.name); } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') throw err(422, 'invalid', 'That name is taken.', { field: 'username' });
      throw e;
    }
    if (old && fsx.existsSync(dir(old)) && (await readMark(dir(old), UMARK)) === String(u.id)) {
      await p.rename(dir(old), dir(c.name));
    }
    return { name: c.name };
  }
  async function userDir(u, user) {
    const d = dir(user);
    await p.mkdir(d, { recursive: true });
    if ((await readMark(d, UMARK)) !== String(u.id)) {
      await p.writeFile(nodePath.join(d, UMARK), String(u.id) + '\n');
      await p.writeFile(nodePath.join(d, '.htaccess'), HTACCESS);
    }
    return d;
  }

  // ---- sites ----
  // -> { name, ok, reason?, url, username }
  async function check(w, raw) {
    const name = clean(raw);
    const user = await store.ownerName(w.user_id);
    const out = (ok, reason) => ({ name, ok, url: user ? urlOf(user, name) : null, username: user,
      ...(reason ? { reason } : {}) });
    if (!valid(name)) return out(false, NAME_RULE);
    ready();
    const owner = await store.bySlug(w.user_id, name);
    if (owner && owner.id !== w.id) return out(false, 'You already have a site with that name.');
    if (user && fsx.existsSync(dir(user, name)) && (await readMark(dir(user, name))) !== w.id) {
      return out(false, 'That name is taken.');
    }
    return out(true);
  }
  async function writeSite(w, base, name, files, where) {
    const tmp = nodePath.join(base, '.colon-tmp-' + crypto.randomBytes(6).toString('hex'));
    const target = nodePath.join(base, name);
    await p.mkdir(tmp, { recursive: true });
    const pkg = files.find((f) => f.path === 'package.json');
    const map = importMap(pkg ? Buffer.from(pkg.content).toString('utf8') : '');
    try {
      for (const f of files) {
        if (f.path.split('/').some((s) => !s || s.startsWith('.') || s === '..')) continue;
        const to = nodePath.join(tmp, f.path);
        if (!to.startsWith(tmp + nodePath.sep)) continue;
        await p.mkdir(nodePath.dirname(to), { recursive: true });
        const html = /\.html?$/i.test(f.path);
        const page = html && withImportMap(Buffer.from(f.content).toString('utf8'), map);
        await p.writeFile(to, html ? withBadge(page, where) : f.content);
      }
      await p.writeFile(nodePath.join(tmp, '.htaccess'), HTACCESS);
      await p.writeFile(nodePath.join(tmp, MARKER), w.id + '\n');
      let old = null;
      if (fsx.existsSync(target)) {
        old = nodePath.join(base, '.colon-old-' + crypto.randomBytes(6).toString('hex'));
        await p.rename(target, old);
      }
      await p.rename(tmp, target);
      if (old) await p.rm(old, { recursive: true, force: true });
    } catch (e) {
      await p.rm(tmp, { recursive: true, force: true });
      throw e;
    }
  }
  async function rmIfMine(d, w) {
    if (root && fsx.existsSync(d) && (await readMark(d)) === w.id) await p.rm(d, { recursive: true, force: true });
  }
  // A pre-v0.30.0 site at <root>/<slug>/: turn it into a redirect to the new link (or remove it when to is null).
  async function legacy(w, slug, to) {
    const d = slug && dir(slug);
    if (!d || !fsx.existsSync(d) || (await readMark(d)) !== w.id) return;
    if (!to) { await p.rm(d, { recursive: true, force: true }); return; }
    for (const n of await p.readdir(d)) {
      if (n !== MARKER) await p.rm(nodePath.join(d, n), { recursive: true, force: true });
    }
    await p.writeFile(nodePath.join(d, '.htaccess'), redirect(to));
    await p.writeFile(nodePath.join(d, 'index.html'), `<!doctype html><meta http-equiv="refresh" content="0;url=/${
      to}/"><a href="/${to}/">This site moved</a>`);
  }
  async function removeSite(w, name) {
    if (!name) return;
    const user = await store.ownerName(w.user_id);
    if (user) await rmIfMine(dir(user, name), w);
    await legacy(w, name, null);
  }
  // -> { name, url, version, at, username }
  async function publish(u, w, raw) {
    const user = await store.ownerName(u.id);
    if (!user) {
      throw err(422, 'no_username', 'Pick your publishing name first: it’s the first part of every site link.',
        { field: 'username' });
    }
    const c = await check(w, raw == null || raw === '' ? w.slug : raw);
    if (!c.ok) throw err(422, 'invalid', c.reason, { field: 'name' });
    const files = await store.allFiles(w.id);
    if (!files.some((f) => f.path === 'index.html')) {
      throw err(422, 'no_index', 'Add an index.html first: it’s the page people see at your link.');
    }
    await writeSite(w, await userDir(u, user), c.name, files, user + '/' + c.name);
    if (w.slug && w.slug !== c.name) await rmIfMine(dir(user, w.slug), w);
    await legacy(w, w.slug, user + '/' + c.name);
    const at = new Date();
    try {
      await store.update(u.id, w.id, { slug: c.name, published_version: Number(w.version) || 0, published_at: at });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        await rmIfMine(dir(user, c.name), w);
        throw err(422, 'invalid', 'You already have a site with that name.', { field: 'name' });
      }
      throw e;
    }
    return { name: c.name, url: c.url, version: Number(w.version) || 0, at, username: user };
  }
  async function unpublish(u, w) {
    await removeSite(w, w.slug);
    await store.update(u.id, w.id, { slug: null, published_version: null, published_at: null });
    return { ok: true };
  }
  return { check, checkUser, setUser, publish, unpublish, removeSite, urlOf, SITE };
}

module.exports = { createPublisher, RESERVED, HTACCESS, withBadge, SITE, siteUrl: (user, name) => SITE
  + (user ? user + '/' : '') + name + '/' };
