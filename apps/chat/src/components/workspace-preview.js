/* Colon AI · Workspace Preview tab (v0.27.0, Workspace step 3; docs/workspace/step-3.md). Shows the site as it
   will look once published, built on the phone from the workspace's files (lib/ws-site.js) inside an iframe with
   sandbox="allow-scripts": the site's own JavaScript runs, but it can't reach Colon, the user's session or the
   server. Phone / desktop width toggle (desktop is a 1280 px page scaled to fit), a page picker, Refresh, and
   links between pages work. Errors the page throws and broken or absolute links are listed under the preview with
   "Fix it", which hands them to the Chat tab.
   mount(el, { id, data, page?, onFix(text), onPage(path) }) -> { refresh() } */
import { Colon } from '../../../../packages/ui/js/colon.js';
import { buildPage, bridgeScript, pagePath, resolvePath } from '../lib/ws-site.js';

var C = Colon, icon = C.icon, esc = C.esc;
var DESKTOP = 1280;
var mode = 'phone';   // remembered while the app is open

function mount(el, o) {
  var files = [], page = o.page || 'index.html', issues = [], frame = null;
  el.innerHTML = '<div class="wk-pv"><div class="wk-pv-bar"><select class="input wk-pv-page" data-page '
    + 'aria-label="Page"></select><div class="wk-seg" role="group" aria-label="Width"><button type="button" '
    + 'data-w="phone" aria-label="Phone width">' + icon('phone') + '</button><button type="button" data-w="desktop" '
    + 'aria-label="Desktop width">' + icon('monitor') + '</button></div><button type="button" class="icon-btn" '
    + 'data-reload aria-label="Refresh preview">' + icon('refresh') + '</button></div><div class="wk-pv-stage" '
    + 'data-stage><div class="skel px-skel-c"></div></div><div class="wk-pv-issues" data-issues></div></div>';
  var sel = el.querySelector('[data-page]'), stage = el.querySelector('[data-stage]');
  var box = el.querySelector('[data-issues]');

  function setMode(m) {
    mode = m;
    el.querySelectorAll('[data-w]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.w === m));
    });
    fit();
  }
  function fit() {
    if (!frame) return;
    stage.classList.toggle('desk', mode === 'desktop');
    if (mode === 'desktop') {
      var s = Math.min(1, stage.clientWidth / DESKTOP), h = Math.max(stage.clientHeight, 300);
      frame.style.width = DESKTOP + 'px'; frame.style.height = Math.round(h / s) + 'px';
      frame.style.transform = 'scale(' + s + ')';
    } else { frame.style.width = ''; frame.style.height = ''; frame.style.transform = ''; }
  }
  function issuesHtml() {
    if (!issues.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="wk-iss"><b>' + icon('alert') + (issues.length === 1 ? '1 problem' : issues.length
      + ' problems') + ' on this page</b><ul>' + issues.slice(0, 8).map(function (t) { return '<li>' + esc(t)
      + '</li>'; }).join('') + '</ul><button type="button" class="btn sm primary" data-fix>' + icon('sparkles')
      + 'Fix it</button></div>';
    box.querySelector('[data-fix]').addEventListener('click', function () {
      o.onFix('The preview of ' + page + ' shows these problems. Please fix them:\n- ' + issues.slice(0, 8)
        .join('\n- '));
    });
  }
  function show() {
    var r = buildPage(files, page, bridgeScript(page));
    issues = r.warnings.slice();
    issuesHtml();
    stage.innerHTML = '';
    frame = document.createElement('iframe');
    frame.className = 'wk-pv-frame';
    frame.setAttribute('sandbox', 'allow-scripts allow-modals');
    frame.setAttribute('title', 'Preview of ' + page);
    frame.srcdoc = r.html;
    stage.appendChild(frame);
    fit();
  }
  function pages() {
    var list = files.filter(function (f) { return /\.html?$/i.test(f.path); }).map(function (f) { return f.path; })
      .sort(function (a, b) {
        return (a === 'index.html' ? -1 : 0) - (b === 'index.html' ? -1 : 0) || (a < b ? -1 : 1);
      });
    if (list.indexOf(page) < 0) page = list[0] || 'index.html';
    sel.innerHTML = list.map(function (p) { return '<option' + (p === page ? ' selected' : '') + '>' + esc(p)
      + '</option>'; }).join('');
  }
  function go(p) { page = p; if (o.onPage) o.onPage(p); pages(); show(); }
  function load() {
    return o.data.workspaceBundle(o.id).then(function (d) {
      if (!el.isConnected) return;
      files = d.files || [];
      if (!files.some(function (f) { return /\.html?$/i.test(f.path); })) {
        stage.innerHTML = '<p class="px-empty">No pages yet. Ask Colon in Chat to build your site.</p>';
        sel.innerHTML = ''; return;
      }
      pages(); show();
    }).catch(function (e) {
      stage.innerHTML = '<p class="px-empty">The preview didn’t load. ' + esc(e.message) + '</p>';
    });
  }
  function onMsg(e) {
    if (!el.isConnected) { window.removeEventListener('message', onMsg); return; }
    var d = e.data;
    if (!frame || e.source !== frame.contentWindow || !d || !d.colonPreview) return;
    if (d.type === 'error' || d.type === 'console') {
      var t = (d.type === 'error' ? 'Error' : 'console.error') + (d.line ? ' (line ' + d.line + ')' : '') + ': '
        + String(d.message).slice(0, 300);
      if (issues.indexOf(t) < 0 && issues.length < 20) { issues.push(t); issuesHtml(); }
    } else if (d.type === 'form') {
      C.toast('Forms don’t send anything in the preview.');
    } else if (d.type === 'nav') {
      var href = String(d.href || '');
      if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener'); return; }
      var p = resolvePath(d.from, href), target = p === null ? null : pagePath(index(), p);
      if (p === '') C.toast('That link starts with “/”, so it won’t work once published. Use a relative link.',
        'bad');
      else if (target) go(target);
      else C.toast('“' + href + '” isn’t a page in this site.', 'bad');
    }
  }
  function index() { var m = {}; files.forEach(function (f) { m[f.path] = f; }); return m; }
  window.addEventListener('message', onMsg);
  window.addEventListener('resize', fit);
  sel.addEventListener('change', function () { go(sel.value); });
  el.querySelectorAll('[data-w]').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.w); });
  });
  el.querySelector('[data-reload]').addEventListener('click', load);
  setMode(mode);
  load();
  return { refresh: load };
}

export { mount };
