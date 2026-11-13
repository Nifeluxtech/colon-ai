/* ColonBrowser · the viewport: reader-preview pages, the new tab page, search results and error pages. */

import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';
import { appPromptHtml, bindAppPrompt } from './app-prompt.js';
import { QUICK, siteLetter } from './shared.js';

var C = Colon, U = ColonURL, icon = C.icon, esc = C.esc;

export function installViewport(ctx) {
  function renderViewport() {
    var t = ctx.active(), pg = ctx.pages[t.id];
    ctx.vp.setAttribute('aria-busy', pg && pg.status === 'loading' ? 'true' : 'false');
    if (!pg || pg.status === 'loading') {
      if (/^colon:/.test(t.url)) { ctx.vp.innerHTML = newTabPage(); bindNewTab(); return; }
      ctx.vp.innerHTML = (
        '<div class="cb-loading"><div class="skel" style="height:34px;width:60%"></div><div class="skel" '
        + 'style="height:14px;margin-top:18px"></div><div class="skel" '
        + 'style="height:14px;margin-top:10px;width:92%"></div><div class="skel" '
        + 'style="height:14px;margin-top:10px;width:80%"></div><div class="skel" '
        + 'style="height:180px;margin-top:22px"></div><p class="tiny muted" style="margin-top:14px">') + (pg
        && pg.by === 'ai' ? 'Saga is opening ' : 'Opening ') + esc(U.displayUrl(t.url)) + '…</p></div>';
      return;
    }
    if (pg.status === 'error') { ctx.vp.innerHTML = errorPage(t.url, pg.error); bindAppPrompt(ctx.vp); return; }
    var p = pg.page;
    if (p.internal) { ctx.vp.innerHTML = newTabPage(); bindNewTab(); return; }
    if (p.search) { ctx.vp.innerHTML = searchPage(p.search); return; }
    // Web light mode: the app prompt above the page; a mocked server-reader page says "Preview".
    ctx.vp.innerHTML = appPromptHtml(false) + '<article class="cb-reader" data-size="' + esc(ctx.settings.readerFont)
      + '"><header class="cb-reader-head"><span class="badge' + (p.preview ? ' warn' : '') + '">' + icon('reader')
      + (p.preview ? 'Preview' : 'Reader preview') + '</span><span class="tiny muted">'
      + esc(p.source || U.hostOf(p.url)) + '</span>' +
      '<a class="btn xs ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + icon('external')
        + 'Original</a></header>' +
      '<h1>' + esc(p.title) + '</h1><div class="cb-reader-body">' + p.html + '</div></article>';
    bindAppPrompt(ctx.vp, renderViewport);
  }
  function newTabPage() {
    var recent = ctx.recentHist.slice(0, 5);
    return '<div class="cb-home"><div class="cb-home-logo">' + C.logo('COLON', 'BROWSER', 'lg') + '</div>' +
      '<form class="cb-home-search" role="search">' + icon('search')
        + ('<input type="search" enterkeyhint="search" aria-label="Search or enter address" placeholder="Search or '
        + 'enter URL…"><button class="btn primary sm pill" type="submit">Go</button></form>') +
      '<div class="cb-quick">' + QUICK.map(function (q) { return '<button type="button" data-go="' + esc(q.u)
        + '"><span class="cb-fav lg" style="background:' + q.c + '">' + esc(q.t[0]) + '</span><span>' + esc(q.t)
        + '</span></button>'; }).join('') + '</div>' +
      (recent.length ? '<div class="cb-sub">Recently visited</div><div class="cb-recent">' + recent.map(function (h) {
        return '<button type="button" data-go="' + esc(h.url) + '"><span class="cb-fav" style="background:'
          + ctx.favColor(
        h.url) + '">' + esc(siteLetter(h.url)) + '</span><span class="cb-ellipsis">' + esc(h.title)
        + '</span></button>'; }).join('') + '</div>' : '') +
      '<div class="banner info cb-engine-note">' + icon('info')
        + ('<span><b>Light mode (web reader).</b> Pages open here as clean, script-free text. Full browsing with '
        + 'logins, video and downloads runs in the Colon Browser app.</span></div>') + appPromptHtml(false)
        + '</div>';
  }
  function bindNewTab() {
    bindAppPrompt(ctx.vp, renderViewport);
    var f = ctx.vp.querySelector('.cb-home-search');
    if (f) f.addEventListener('submit', function (e) { e.preventDefault(); ctx.navigate(f.querySelector(
      'input').value); });
  }
  function searchPage(s) {
    return '<div class="cb-results"><div class="cb-results-head"><div><div class="tiny muted">Results for</div><h1>'
      + esc(s.query) + '</h1></div>' +
      '<a class="btn sm" href="' + esc(s.external) + '" target="_blank" rel="noopener noreferrer">' + icon('external')
        + 'Search on ' + esc((U.ENGINES[s.engine] || U.ENGINES.google).name) + '</a></div>' +
      '<p class="tiny muted">Reader preview searches ' + esc(s.provider)
        + ', which allows web apps to read its results. Full ' + esc((U.ENGINES[s.engine] || U.ENGINES.google).name)
        + ' results open in a new tab.</p>' +
      (s.results.length ? s.results.map(function (r) { return '<a class="cb-result" href="' + esc(r.url)
        + '" data-nav="' + esc(r.url) + '"><span class="tiny muted">' + esc(U.displayUrl(r.url)) + '</span><b>'
        + esc(r.title) + '</b><span class="small">' + esc(r.snippet) + '</span></a>'; }).join('')
        : '<div class="empty">' + icon('search')
          + '<div class="h3">No results</div><p class="small">Try different words, or search on ' + esc((U.ENGINES[
          s.engine] || U.ENGINES.google).name) + '.</p></div>') + '</div>';
  }
  function errorPage(url, e) {
    var code = (e && e.code) || '', blocked = /^blocked/.test(code), proxy = code === 'needs_proxy',
      file = code === 'not_html';
    var title = blocked ? 'This address is blocked' : proxy ? 'Can’t open this site in reader preview' : file
      ? 'This link is a file' : code === 'timeout' ? 'The page took too long' : code === 'not_found'
      ? 'Page not found' : 'This page didn’t load';
    return (proxy ? appPromptHtml(true) : '') + '<div class="cb-error"><span class="cb-error-ico">'
      + icon(blocked ? 'shield' : proxy ? 'reader' : file
      ? 'download' : 'wifiOff') + '</span><h1>' + esc(title) + '</h1>' +
      '<p class="muted">' + esc((e && e.message) || 'Something went wrong.') + '</p><div class="cb-url mono">'
        + esc(U.displayUrl(url)) + '</div><div class="cb-error-acts">' +
      (!blocked ? '<button class="btn sm" data-a="reload">' + icon('refresh') + 'Try again</button>' : '') +
      (!blocked ? '<a class="btn sm primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + icon(
        'external') + (file ? 'Download file' : 'Open in new tab') + '</a>' : '') +
      (proxy && ctx.opts.onAsk ? '<button class="btn sm" data-a="ask">' + icon('sparkles')
        + 'Ask Saga about it</button>' :
        '') +
      '</div>' + (proxy
        ? ('<p class="tiny muted" style="margin-top:16px">Full browsing of every site comes with the Colon Browser '
        + 'app for Android (Android System WebView engine).</p>') : '') + '</div>';
  }
  ctx.renderViewport = renderViewport; ctx.newTabPage = newTabPage; ctx.bindNewTab = bindNewTab;
    ctx.searchPage = searchPage; ctx.errorPage = errorPage;
}
