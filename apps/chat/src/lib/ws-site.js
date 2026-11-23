/* Colon AI · Workspace preview builder (v0.27.0, Workspace step 3; plan: docs/workspace/plan.md).
   Turns a workspace's files (GET /workspaces/:id/bundle) into ONE self-contained HTML document for the preview
   iframe (srcdoc, sandbox="allow-scripts", so nothing runs on the server and the page can't reach Colon):
   local stylesheets and scripts are inlined, images, fonts and other assets become data: URLs, CSS url(...)
   references are resolved from the stylesheet's own folder. A small bridge script is injected first: it reports
   errors and console.error to the app (postMessage), and turns clicks on links to other pages of the site into
   "nav" messages, because a srcdoc page can't follow relative links by itself.
   Paths resolve exactly as they will once published at apparatus.name.ng/<name>/: a link starting with "/" would
   point outside the site there, so it is reported as a warning instead of being followed.
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
  // <link rel="stylesheet" href="local.css"> -> <style>
  html = html.replace(/<link\b[^>]*>/gi, function (tag) {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag;
    var m = tag.match(/href=(["'])([^"']*)\1/i), p = m && resolvePath(path, m[2]);
    if (!m || p === null) return tag;
    if (p === '' || !files[p]) { warn(path, m[2], p === ''); return tag; }
    return '<style data-from="' + p + '">' + cssUrls(String(files[p].content), p, files, warn) + '</style>';
  });
  // <script src="local.js"></script> -> inline
  html = html.replace(/<script\b([^>]*)\bsrc=(["'])([^"']*)\2([^>]*)>\s*<\/script>/gi, function (all, a, q, ref, b) {
    var p = resolvePath(path, ref);
    if (p === null) return all;
    if (p === '' || !files[p]) { warn(path, ref, p === ''); return all; }
    return '<script' + a + b + '>' + String(files[p].content).replace(/<\/script/gi, '<\\/script') + '\n</script>';
  });
  html = html.replace(ATTR, function (all, head, attr, q, ref) {
    var p = resolvePath(path, ref);
    if (p === null || /^<link\b/i.test(head) && /stylesheet/i.test(head)) return all;
    if (p === '' || !files[p]) { warn(path, ref, p === ''); return all; }
    return head + attr + '=' + q + dataUrl(files[p]) + q;
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
