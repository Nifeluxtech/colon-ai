/* Colon App core · hash router with smooth transitions, the app shell, and start(). */

import { authRoutes } from './account.js';
import { api, refreshUser } from './api.js';
import { $, esc } from './dom.js';
import { icon, logo } from './icons.js';
import { hasRole, state } from './state.js';

/* ---------- Router (hash-based, smooth transitions, scroll memory) ---------- */
var routes = [], scrolls = {}, current = null;
function parse() {
  var h = location.hash.replace(/^#/, '') || '/';
  var q = h.indexOf('?'), path = q > -1 ? h.slice(0, q) : h;
  return { path: path, query: new URLSearchParams(q > -1 ? h.slice(q + 1) : '') };
}
function go(path, replace) {
  if (replace) { history.replaceState(null, '', '#' + path); render(); }
  else location.hash = path;
}
function findRoute(path) {
  for (var i = 0; i < routes.length; i++) {
    var m = path.match(routes[i].re); if (m) return { r: routes[i], params: m.slice(1) };
  }
  return null;
}
function render() {
  var loc = parse(), found = findRoute(loc.path) || findRoute('/');
  var r = found.r;
  if (r.auth === true && !state.user) return go('/login?next=' + encodeURIComponent(loc.path), true);
  if (r.auth === 'guest' && state.user) return go(loc.query.get('next') || '/', true);
  if (r.role && !hasRole(r.role)) return go('/', true);
  if (current) scrolls[current] = window.scrollY;
  current = loc.path;
  // App-style routes sharing one `app` key stay mounted; only update() runs (no flash, state kept).
  if (r.app && state.mounted === r.app && r.update && $('#app .view')) {
    document.title = (r.title ? r.title + ' · ' : '') + (state.title || 'Colon AI');
    r.update($('#app .view'), { params: found.params, query: loc.query, path: loc.path }); return;
  }
  if (state.unmount) { try { state.unmount(); } catch (e) {} state.unmount = null; }
  state.mounted = r.app || null;
  var swap = function () {
    var root = $('#app');
    root.innerHTML = r.bare ? '<div class="view' + (r.app ? ' app-view' : '') + '">' + '</div>' : shell(r, loc);
    var view = r.bare ? $('.view', root) : $('#view', root);
    document.title = (r.title ? r.title + ' · ' : '') + (state.title || 'Colon AI');
    try { var un = r.render(view, { params: found.params, query: loc.query, path: loc.path });
      if (typeof un === 'function') state.unmount = un; }
    catch (e) { if (window.console) console.error(e); view.innerHTML = renderError(); }
    window.scrollTo(0, scrolls[loc.path] || 0);
    var h = $('h1, .h1', view); if (h && !r.bare) h.setAttribute('tabindex', '-1');
  };
  if (!r.app && document.startViewTransition && !matchMedia(
    '(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
  else swap();
}

// A screen failed to draw: usually a stale cached file from an older release. Never show the raw error.
function renderError() {
  return '<div class="empty boot-error" role="alert">' + icon('refresh')
    + '<div class="h3" style="color:var(--text)">Please refresh</div>' +
    '<p class="small">Colon was updated and this screen needs the latest version.</p>' +
    '<button class="btn primary" type="button" onclick="location.reload()">' + icon('refresh')
      + 'Refresh</button></div>';
}

function shell(r, loc) {
  var nav = state.nav.filter(function (n) { return !n.role || hasRole(n.role); });
  var active = function (n) { return n.match ? n.match.test(loc.path) : loc.path === n.href; };
  // Nav items can stay out of the bottom tab bar (tab: false) or the sidebar (side: false), so a long
  // admin menu fits on phones: the tab bar keeps the main screens plus a "More" hub.
  var links = function (where) { return nav.filter(function (n) { return where === 'tab' ? n.tab !== false :
    n.side !== false; }).map(function (n) { return '<a href="#' + n.href + '" class="' + (active(n) ? 'active' : '')
    + '"' + (active(n) ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + esc(n.label) + '</span></a>';
    }).join(''); };
  var brand = '<a class="brand" href="#/" aria-label="' + esc(state.title) + ' home">' + logo(state.brand,
    state.subtitle) + '</a>';
  var back = r.back ? '<a class="icon-btn" href="#' + r.back + '" aria-label="Back">' + icon('back') + '</a>' : '';
  var tabbar = state.tabbar !== false;
  return '<div class="app has-nav' + (tabbar ? '' : ' no-tabbar') + '">' +
    '<aside class="sidebar">' + brand + '<nav>' + links()
      + '</nav><div class="foot small muted">Colon AI by Nifelux</div></aside>' +
    '<header class="topbar">' + (back || brand) + '<h1>' + (back ? esc(r.title || '') : '') + '</h1>' + (r.action
      ? r.action() : '') + '</header>' +
    '<main class="main' + (r.wide ? ' wide' : '') + (r.composer ? ' with-composer' : '')
      + '"><div id="view" class="view"></div></main>' +
    (tabbar ? '<nav class="tabbar" aria-label="Main">' + links('tab') + '</nav>' : '') + '</div>';
}

function start(opts) {
  state.app = opts.app; state.title = opts.title; state.subtitle = opts.subtitle || ''; state.nav = opts.nav || [];
  state.brand = opts.brand || (opts.title || 'Colon AI').toUpperCase();
  state.allowSignup = opts.allowSignup !== false;
  state.guestMode = opts.guestMode === true;  // usable signed out (Colon AI): sign in/out reloads the app
  state.tabbar = opts.tabbar !== false;  // false: no bottom tab bar on shared screens (Colon AI, Colon Browser)
  var all = (opts.routes || []).concat(authRoutes);
  routes = all.map(function (r) { return Object.assign({}, r, { re: new RegExp('^' + r.path.replace(/:[a-z]+/g,
    '([^/]+)') + '$') }); });
  var root = $('#app');
  root.innerHTML = '<div class="auth"><div class="inner" style="text-align:center"><div class="brand">' + logo(
    state.brand, 'by Nifelux',
    'lg') + '</div><div class="skel" style="height:8px;width:120px;margin:0 auto"></div></div></div>';
  Promise.all([refreshUser().catch(function () { return null; }), api('/auth/config').then(function (c) {
    state.config = c; state.online = true; }).catch(function () { state.online = false; })]).then(function () {
    // Phase 4: the brand name is a system setting in the Admin Dashboard.
    if (state.config && state.config.brand_name && !opts.keepBrand) state.brand = String(
      state.config.brand_name).toUpperCase();
    window.addEventListener('hashchange', render);
    render();
  });
}

export { go, start };
