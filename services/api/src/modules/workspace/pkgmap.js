'use strict';
// Colon AI · Workspace import map (v0.30.1). Packages added with `npm install` in the Terminal are listed in the
// site's package.json "dependencies"; published pages load them from esm.sh (a free CDN that serves npm packages
// as browser modules) through a <script type="importmap"> added after <head>. Same rules as the chat app's
// apps/chat/src/lib/ws-pkg.js importMap()/withImportMap() so Preview and the published site match.

const ESM = 'https://esm.sh/';
const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

function importMap(pkgText) {
  let j = null;
  try { j = JSON.parse(pkgText || ''); } catch { return null; }
  const deps = j && typeof j === 'object' && j.dependencies;
  if (!deps || typeof deps !== 'object') return null;
  const imports = {};
  for (const name of Object.keys(deps)) {
    if (!NPM_NAME.test(name)) continue;
    let v = String(deps[name] || '').replace(/^[\^~=v\s]+/, '');
    if (!/^[0-9A-Za-z.+-]*$/.test(v)) v = '';
    const url = ESM + name + (v ? '@' + v : '');
    imports[name] = url; imports[name + '/'] = url + '/';
  }
  return Object.keys(imports).length ? { imports } : null;
}

function withImportMap(html, map) {
  if (!map || /<script\b[^>]*type=["']?importmap/i.test(html)) return html;
  const tag = '<script type="importmap">' + JSON.stringify(map).replace(/</g, '\\u003c') + '</script>';
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (h) => h + tag) : tag + html;
}

module.exports = { importMap, withImportMap };
