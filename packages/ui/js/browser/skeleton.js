/* ColonBrowser · the module's DOM skeleton (tabs, toolbar, address bar, viewport, side panel, status). */

import { Colon } from '../colon.js';

var C = Colon, icon = C.icon;

export function buildSkeleton(ctx) {
  /* ---------- Skeleton ---------- */
  ctx.el = document.createElement('div');
  ctx.el.className = 'cb cb--' + ctx.variant;
  ctx.el.innerHTML =
    '<div class="cb-tabs no-scrollbar" role="tablist" aria-label="Tabs"></div>' +
    '<div class="cb-toolbar">' +
      '<div class="cb-nav"><button class="icon-btn sm" data-a="back" aria-label="Back" data-tip="Back">' + icon('left')
        + '</button>' +
      '<button class="icon-btn sm" data-a="forward" aria-label="Forward" data-tip="Forward">' + icon('right')
        + '</button>' +
      '<button class="icon-btn sm" data-a="reload" aria-label="Refresh" data-tip="Refresh">' + icon('refresh')
        + '</button>' +
      '<button class="icon-btn sm cb-hide-xs" data-a="home" aria-label="Home" data-tip="Home">' + icon('home')
        + '</button></div>' +
      '<form class="cb-address" role="search"><span class="cb-lock" aria-hidden="true"></span>' +
        ('<input type="text" inputmode="url" enterkeyhint="go" autocomplete="off" autocapitalize="off" '
          + 'spellcheck="false" aria-label="Search or enter address" placeholder="Search or enter URL…">') +
        '<button type="button" class="icon-btn sm cb-clear" data-a="clear" aria-label="Clear address">' + icon('x')
          + '</button>' +
        '<div class="cb-suggest menu" role="listbox" hidden></div></form>' +
      '<div class="cb-actions">' +
        '<button class="icon-btn sm" data-a="bookmark" aria-label="Bookmark this page" data-tip="Bookmark">' + icon(
          'bookmark') + '</button>' +
        '<button class="icon-btn sm cb-hide-sm" data-a="download" aria-label="Download page" data-tip="Download page">'
          + icon('download') + '</button>' +
        ('<button class="icon-btn sm cb-tabcount" data-a="tabs" aria-label="Tabs" '
          + 'data-tip="Tabs"><span>1</span></button>') +
        '<button class="icon-btn sm cb-hide-sm" data-a="fullscreen" aria-label="Full screen" data-tip="Full screen">'
          + icon('maximize') + '</button>' +
        ('<button class="icon-btn sm cb-side-btn" data-a="side" aria-label="Browser control and AI Browse" '
          + 'aria-pressed="false" data-tip="Browser control">') + icon('sparkles') + '</button>' +
        '<button class="icon-btn sm" data-a="more" aria-label="More" aria-haspopup="menu" data-tip="More">' + icon(
          'moreV') + '</button>' +
      '</div></div>' +
    '<div class="cb-modebar" role="status" aria-live="polite"></div>' +
    '<div class="cb-body"><div class="cb-viewport scroll-y" tabindex="-1"></div>' +
      '<aside class="cb-side scroll-y" aria-label="Browser control and AI Browse"></aside></div>' +
    '<div class="cb-status"></div>' +
    '<div class="cb-progress"><i></i></div>';
  ctx.$ = function (s) { return ctx.el.querySelector(s); };
  ctx.input = ctx.$('.cb-address input'); ctx.vp = ctx.$('.cb-viewport'); ctx.side = ctx.$('.cb-side');
  ctx.container.appendChild(ctx.el);
}
