/* ColonBrowser · address-bar suggestions and every event listener the module binds. */

import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';

var C = Colon, U = ColonURL, icon = C.icon, esc = C.esc;

export function bindEvents(ctx) {
  /* ---------- Suggestions ---------- */
  ctx.suggestBox = ctx.$('.cb-suggest');
  ctx.suggest = C.debounce(function () {
    var q = ctx.input.value.trim().toLowerCase(); if (!q) return ctx.hideSuggest();
    ctx.data.listHistory({ q: q, limit: 30 }).then(function (h) {
      var seen = {}, items = ctx.bookmarks.filter(function (b) { return (b.title + b.url).toLowerCase().indexOf(q) > -1;
        }).map(function (b) { return { url: b.url, title: b.title, k: 'bookmark' }; })
        .concat(h.map(function (x) { return { url: x.url, title: x.title, k: 'history' }; }))
        .filter(function (x) { if (seen[x.url]) return false; seen[x.url] = 1; return true; }).slice(0, 6);
      var p = U.parseInput(ctx.input.value, ctx.settings.engine);
      var first = p ? '<button type="button" class="mi" role="option" data-go-input>' + icon(p.type === 'url'
        ? 'globe' : 'search') + '<span class="mi-body">' + esc(p.type === 'url' ? U.displayUrl(p.url) : ctx.input.value)
        + '<span class="mi-sub">' + (p.type === 'url' ? 'Open address' : 'Search') + '</span></span></button>' : '';
      ctx.suggestBox.innerHTML = first + items.map(function (x) {
        return '<button type="button" class="mi" role="option" data-go="' + esc(x.url) + '">' + icon(x.k === 'bookmark'
        ? 'bookmark' : 'history') + '<span class="mi-body cb-ellipsis">' + esc(x.title)
        + '<span class="mi-sub cb-ellipsis">' + esc(U.displayUrl(x.url)) + '</span></span></button>'; }).join('');
      ctx.suggestBox.hidden = !ctx.suggestBox.innerHTML;
    });
  }, 120);

  /* ---------- Events ---------- */
  ctx.$('.cb-address').addEventListener('submit', function (e) { e.preventDefault(); ctx.navigate(ctx.input.value); });
  ctx.input.addEventListener('focus', function () { setTimeout(function () { ctx.input.select(); }, 0);
    ctx.el.classList.add('addr-focus'); });
  ctx.input.addEventListener('blur', function () { ctx.el.classList.remove('addr-focus'); setTimeout(ctx.hideSuggest,
    150);
    setTimeout(ctx.renderToolbar, 160); });
  ctx.input.addEventListener('input', ctx.suggest);
  ctx.input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { ctx.hideSuggest(); ctx.input.blur(); }
    if (e.key === 'ArrowDown' && !ctx.suggestBox.hidden) { e.preventDefault(); var f = ctx.suggestBox.querySelector(
      '.mi');
      if (f) f.focus(); }
  });
  ctx.suggestBox.addEventListener('keydown', function (e) {
    var b = Array.prototype.slice.call(ctx.suggestBox.querySelectorAll('.mi')), i = b.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (b[i + 1] || b[0]).focus(); } else if (e.key === 'ArrowUp') {
      e.preventDefault(); i <= 0 ? ctx.input.focus() : b[i - 1].focus(); } else if (e.key === 'Escape') {
        ctx.input.focus();
      ctx.hideSuggest(); }
  });
  ctx.suggestBox.addEventListener('mousedown', function (e) { e.preventDefault(); });

  ctx.el.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); ctx.navigate(go.getAttribute('data-go'));
      return;
      }
    if (e.target.closest('[data-go-input]')) { ctx.navigate(ctx.input.value); return; }
    var nav = e.target.closest('a[data-nav]');
    if (nav && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); ctx.navigate(nav.getAttribute(
      'data-nav'));
      return; }
    var x = e.target.closest('[data-close-tab]'); if (x) { e.stopPropagation(); ctx.closeTab(x.getAttribute(
      'data-close-tab')); return; }
    var tb = e.target.closest('[data-tab]'); if (tb) { ctx.switchTab(tb.getAttribute('data-tab')); return; }
    var md = e.target.closest('[data-mode]'); if (md) { ctx.setControl(md.getAttribute('data-mode')); return; }
    var a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
    var act = a.getAttribute('data-a');
    var acts = {
      back: ctx.back, forward: ctx.forward, reload: ctx.reload, home: ctx.home, newtab: function () { ctx.newTab(); },
      clear: function () { ctx.input.value = ''; ctx.input.focus(); ctx.hideSuggest(); },
      bookmark: ctx.bookmarkCurrent, download: ctx.downloadCurrent, fullscreen: ctx.toggleFullscreen,
      tabs: function () { if (ctx.opts.onNavigateApp && ctx.variant === 'full'
        && innerWidth < 900) ctx.opts.onNavigateApp('tabs');
        else ctx.tabsMenu(a); },
      side: function () { ctx.toggleSide(); }, 'side-close': function () { ctx.toggleSide(false); },
      more: function () { ctx.moreMenu(a); }, take: ctx.takeControl, 'return': ctx.returnToAI, pause: ctx.pauseAI,
        stop: ctx.stopTask,
      approve: function () { ctx.runner.approve(); }, skip: function () { ctx.runner.skip(); }, 'clear-task': function (
        ) {
        ctx.runner.reset(); ctx.session.task = null; ctx.persist(); },
      'send-summary': function () { var t = ctx.runner.state(); if (t && ctx.opts.onSummary) ctx.opts.onSummary(
        t.summary,
        t.sources, t.goal); },
      ask: function () { if (ctx.opts.onAsk) ctx.opts.onAsk(ctx.active().url); }
    };
    if (acts[act]) acts[act]();
  });
  ctx.side.addEventListener('submit', function (e) {
    if (!e.target.classList.contains('cb-task-form')) return;
    e.preventDefault(); var v = e.target.querySelector('textarea').value; if (!v.trim()) { e.target.querySelector(
      'textarea').focus(); return; }
    ctx.startTask(v);
  });
  ctx.side.addEventListener('keydown', function (e) { if (e.target.tagName === 'TEXTAREA' && e.key === 'Enter'
    && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); } });
  ctx.el.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); ctx.input.focus(); }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); ctx.back(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); ctx.forward(); }
    var tabs = e.target.closest && e.target.closest('[data-tab]');
    if (tabs && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { var i = ctx.session.tabs.findIndex(function (t) {
      return t.id === ctx.session.active_id; }); var n = ctx.session.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1)
      + ctx.session.tabs.length) % ctx.session.tabs.length]; ctx.switchTab(n.id); var f = ctx.el.querySelector(
        '[data-tab="' + n.id
      + '"]'); if (f) f.focus(); }
  });
  document.addEventListener('fullscreenchange', function () { ctx.el.classList.toggle('cb-fs',
    document.fullscreenElement === ctx.el); });
}
