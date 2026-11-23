/* Colon AI · Workspace preview builder (v0.27.0, Workspace step 3; plan: docs/workspace/plan.md).
   Turns a workspace's files (GET /workspaces/:id/bundle) into ONE self-contained HTML document for the preview
   iframe (srcdoc, sandbox="allow-scripts", so nothing runs on the server and the page can't reach Colon):
   local stylesheets and scripts are inlined, images, fonts and other assets become data: URLs, CSS url(...)
   references are resolved from the stylesheet's own folder. A small bridge script is injected first: it reports
   errors and console.error to the app (postMessage), and turns clicks on links to other pages of the site into
   "nav" messages, because a srcdoc page can't follow relative links by itself.
   Paths resolve exactly as they will once published at apparatus.name.ng/<name>/: a link starting with "/" would
   point outside the site there, so it is reported as a warning instead of being followed.
   v0.31.0: a srcdoc page resolves anything left relative or "/"-rooted against COLON's own address, so a reference
   that isn't one of the site's files is now blanked (with its warning) instead of loading Colon's app files; JS
   modules' relative imports (folders: import x from './lib/a.js') are inlined as data: modules; and a page that is a
   copy of Colon's own app page (it showed "Please refresh") is replaced by a notice saying so.
   Pure and DOM-free: unit-tested in packages/ui/test/ws-site.test.js. */
import { importMap, withImportMap } from './ws-pkg.js';

var REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|blob:)/i;   // absolute URLs, anchors: left alone
// v0.29.0: code, not a file: template placeholders (${x}, {{x}}, <%= x %>), "+" concatenation, an encoded "#" (an
// SVG's url(%23id) inside a data: URL)
var CODE = /\$\{|\{\{|<%|^\s*\+|\+\s*$|^%23/;

/** "css/site.css" + "../img/a.png" -> "img/a.png"; "" when it climbs out of the site; null for external refs. */
function resolvePath(from, ref) {
  var r = String(ref || '').trim();
  if (!r || REF.test(r) || CODE.test(r)) return null;
  r = r.split('#')[0].split('?')[0];
  if (!r) return null;
  if (r.charAt(0) === '/') return '';
  var parts = String(from || '').split('/'); parts.pop();
  r.split('/').forEach(function (s) {
    if (s === '..') { if (parts.length) parts.pop(); else parts.push('\u0000'); }
    else if (s && s !== '.') parts.push(s);
  });
  if (parts.indexOf('\u0000') > -1) return '';
  var p = parts.join('/');
  try { p = decodeURIComponent(p); } catch (e) { /* keep as written */ }
  return p;
}

/** The page a link opens: "about" / "about/" / "about.html" -> the matching .html file path, or null. */
function pagePath(files, p) {
  if (p == null) return null;
  var tries = p === '' || /\/$/.test(p) ? [p + 'index.html'] : [p, p + '.html', p + '/index.html'];
  for (var i = 0; i < tries.length; i++) {
    var f = files[tries[i]];
    if (f && /\.html?$/i.test(f.path)) return f.path;
  }
  return null;
}

function b64(s) {   // utf-8 text -> base64, in the browser and in node
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(s)));
}
function dataUrl(f) {
  return 'data:' + (f.type || 'application/octet-stream') + ';base64,' + (f.encoding === 'base64' ? f.content
    : b64(f.content));
}

function index(list) {
  var m = {};
  (list || []).forEach(function (f) { m[f.path] = f; });
  return m;
}

function cssUrls(css, from, files, warn) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (all, q, ref) {
    var p = resolvePath(from, ref);
    if (p === null) return all;
    if (p === '' || !files[p]) { warn(from, ref, p === ''); return all; }
    return 'url("' + dataUrl(files[p]) + '")';
  });
}

// v0.31.0: relative imports in JS modules -> data: modules (recursively, so folders of modules work)
var IMPORT = new RegExp('(\\bimport\\s*(?:[\\w$*{}\\s,]+?\\s*from\\s*)?|\\bexport\\s*[\\w$*{}\\s,]+?\\s*from\\s*|'
  + '\\bimport\\s*\\(\\s*)([\'"])([^\'"\\n]+)\\2', 'g');
function inlineImports(code, from, files, warn, seen) {
  return String(code).replace(IMPORT, function (all, head, q, spec) {
    if (!/^(\.{1,2}\/|\/)/.test(spec)) return all;   // bare names (import map) and URLs stay
    var p = resolvePath(from, spec);
    if (p === null) return all;
    if (p === '' || !files[p]) { warn(from, spec, p === ''); return head + q + 'data:text/javascript,' + q; }
    if ((seen || []).indexOf(p) > -1 || (seen || []).length > 8) return all;
    var f = files[p], body = /\.m?js$/i.test(p) ? inlineImports(f.content, p, files, warn, (seen || []).concat(p))
      : f.content;
    return head + q + dataUrl({ type: /\.json$/i.test(p) ? 'application/json' : 'text/javascript', content: body,
      encoding: f.encoding }) + q;
  });
}
var COLON_PAGE = /\/v\d+\.\d+\.\d+\/apps\/(chat|browser|admin)\/|window\.colonKitReady\s*=/;
var COLON_NOTE = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="'
  + 'font:15px/1.5 system-ui,sans-serif;padding:24px;color:#0f172a"><h2 style="margin:0 0 8px">This page is a copy of '
  + 'Colon AI’s own app</h2><p>It loads Colon’s app files, which can’t run inside your site (that is why it showed '
  + '“Please refresh”). Replace this file with your own page, or ask Colon in Chat to build your home page.</p>';

var ATTR = new RegExp('(<(?:img|source|audio|video|track|embed|input|link|script|iframe)\\b[^>]*?\\s)'
  + '(src|href|poster)=(["\'])([^"\']*)\\3', 'gi');

/** -> { html, warnings[] }: the page at `path`, self-contained. `bridge` is the script text injected first. */
function buildPage(fileList, path, bridge) {
  var files = index(fileList), page = files[path], warnings = [];
  if (!page) return { html: '<p>This page doesn’t exist.</p>', warnings: ['Missing page: ' + path] };
  function warn(from, ref, outside) {
    var w = outside ? from + ': “' + ref + '” points outside your site. Use a relative link like “'
      + String(ref).replace(/^\/+/, '') + '” so it still works once published.' : from + ': “' + ref
      + '” wasn’t found in your files.';
    if (warnings.indexOf(w) < 0) warnings.push(w);
  }
  var html = String(page.content);
  if (COLON_PAGE.test(html)) {
    warnings.push(path + ' is a copy of Colon AI’s own app page, not a page of your site. Replace it with your own.');
    return { html: COLON_NOTE, warnings: warnings, colonCopy: true };
  }
  // <link rel="stylesheet" href="local.css"> -> <style>
  html = html.replace(/<link\b[^>]*>/gi, function (tag) {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag;
    var m = tag.match(/href=(["'])([^"']*)\1/i), p = m && resolvePath(path, m[2]);
    if (!m || p === null) return tag;
    if (p === '' || !files[p]) { warn(path, m[2], p === ''); return tag.replace(m[0], 'href="about:blank"'); }
    return '<style data-from="' + p + '">' + cssUrls(String(files[p].content), p, files, warn) + '</style>';
  });
  // <script src="local.js"></script> -> inline
  html = html.replace(/<script\b([^>]*)\bsrc=(["'])([^"']*)\2([^>]*)>\s*<\/script>/gi, function (all, a, q, ref, b) {
    var p = resolvePath(path, ref);
    if (p === null) return all;
    if (p === '' || !files[p]) { warn(path, ref, p === ''); return '<script' + a + b + ' data-missing></script>'; }
    return '<script data-from="' + p + '"' + a + b + '>' + inlineImports(files[p].content, p, files, warn)
      .replace(/<\/script/gi, '<\\/script') + '\n</script>';
  });
  html = html.replace(ATTR, function (all, head, attr, q, ref) {
    var p = resolvePath(path, ref);
    if (p === null || /^<link\b/i.test(head) && /stylesheet/i.test(head)) return all;
    if (p === '' || !files[p]) { warn(path, ref, p === ''); return head + attr + '=' + q + 'about:blank' + q; }
    return head + attr + '=' + q + dataUrl(files[p]) + q;
  });
  var INLINE = /(<script\b(?![^>]*\b(?:src|data-from)=)[^>]*>)([\s\S]*?)(<\/script>)/gi;
  html = html.replace(INLINE, function (all, a, js, b) {
    return /type=["']?module/i.test(a) ? a + inlineImports(js, path, files, warn) + b : all;
  });
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, function (all, a, css, b) {
    return /data-from=/.test(a) ? all : a + cssUrls(css, path, files, warn) + b;
  });
  html = html.replace(/\sstyle=(["'])([^"']*url\([^"']*)\1/gi, function (all, q, css) {
    return ' style=' + q + cssUrls(css, path, files, warn) + q;
  });
  // check <a href> targets (navigation itself is done by the bridge)
  html.replace(/<a\b[^>]*\bhref=(["'])([^"']*)\1/gi, function (all, q, ref) {
    var p = resolvePath(path, ref);
    if (p === '') warn(path, ref, true);
    else if (p !== null && !pagePath(files, p) && !files[p]) warn(path, ref, false);
    return all;
  });
  // v0.30.1: packages from `npm install` (package.json) load from esm.sh through an import map.
  html = withImportMap(html, importMap(files['package.json'] && String(files['package.json'].content)));
  var inject = '<script>' + String(bridge || '') + '\n</script>';
  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, function (h) { return h + inject; })
    : inject + html;
  return { html: html, warnings: warnings };
}

/** The script injected into every preview page. `page` is the page's own path (links resolve from it). */
function bridgeScript(page) {
  return '(function(){var P=' + JSON.stringify(page) + ';function send(m){try{parent.postMessage(Object.assign('
    + '{colonPreview:1},m),"*")}catch(e){}}'
    + 'addEventListener("error",function(e){send({type:"error",message:String(e.message||"Error"),line:e.lineno||0})});'
    + 'addEventListener("unhandledrejection",function(e){var r=e.reason;'
    + 'send({type:"error",message:"Unhandled promise: "'
    + '+(r&&r.message||String(r))})});var ce=console.error;console.error=function(){send({type:"console",message:'
    + '[].map.call(arguments,function(a){try{return typeof a==="string"?a:JSON.stringify(a)}catch(x){return String(a)'
    + '}}).join(" ")});return ce.apply(console,arguments)};'
    + 'document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;'
    + 'var h=a.getAttribute("href");if(!h||h.charAt(0)==="#")return;e.preventDefault();'
    + 'if(/^(mailto:|tel:)/i.test(h))return;send({type:"nav",href:h,from:P})},true);'
    + 'document.addEventListener("submit",function(e){e.preventDefault();send({type:"form"})},true);'
    // v0.30.0: the sandboxed preview has no storage, so sign-in libraries (Supabase, Appwrite...) get an in-memory
    // one; a session then lasts until the preview reloads.
    + 'function mem(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]='
    + 'String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]'
    + '||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){'
    + 'try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}'
    + 'catch(x){}}})})();';
}

export { buildPage, bridgeScript, dataUrl, pagePath, resolvePath };
