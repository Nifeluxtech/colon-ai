/* ColonBrowser: the one reusable browser module (ROADMAP standing rule: never duplicated).
   Mounted full-size by Colon Browser and as the embedded/split panel inside Colon AI. Both use
   ColonBrowserData, so tabs, history, bookmarks and the control mode are one session.

   Engine honesty (docs/adr/0002): the full engine is the Android System WebView in the Colon app.
   On the web this module is a READER PREVIEW: pages are fetched as data, sanitised, and rendered as
   text and images. No scripts, logins or forms run. The UI says so wherever it matters.

   const b = ColonBrowser.create(container, { variant: 'full'|'panel', onNavigateApp(section), onSummary(md, sources)
   });
   b.navigate(input) · back() · forward() · reload() · home() · newTab(url) · closeTab(id) · switchTab(id)
   b.setControl('ai'|'manual'|'shared') · takeControl() · returnToAI() · pauseAI() · stopTask() · startTask(goal)
   b.toggleSide(force) · toggleFullscreen() · mount(newContainer) · state() · on('change', fn) · destroy() */

import { ColonBrowserData } from './data.js';
import { ColonSagaBrowse } from './saga-browse.js';
import { MODES, QUICK, saveBlob, siteLetter } from './shared.js';
import { Colon } from '../colon.js';
import { ColonMarkdown } from '../markdown/index.js';
import { ColonURL } from '../url.js';
import { installActions } from './actions.js';
import { buildApi } from './api.js';
import { bindEvents } from './events.js';
import { installNav } from './nav.js';
import { installSession } from './session.js';
import { installSide } from './side.js';
import { buildSkeleton } from './skeleton.js';
import { installTabs } from './tabs.js';
import { installViewport } from './viewport.js';

var C = Colon, U = ColonURL, icon = C.icon, esc = C.esc;

// One shared context object per instance: state (session, pages, settings, el, ...) and every part's
// functions live on ctx, so the parts in this folder can be separate modules. install*() attach functions;
// the statements below then run in their original order.
function create(container, opts) {
  var ctx = { container: container, opts: opts };
  installSession(ctx); installNav(ctx); installTabs(ctx); installSide(ctx); installViewport(ctx); installActions(ctx);
  ctx.opts = ctx.opts || {};
  ctx.data = ColonBrowserData.get();
  ctx.variant = ctx.opts.variant || 'full';
  ctx.subs = {}; ctx.pages = {}; ctx.session = null; ctx.settings = null; ctx.bookmarks = []; ctx.abortNav = null;
    ctx.sideOpen = ctx.variant === 'full' && innerWidth >= 1100; ctx.destroyed = false; ctx.recentHist = [];
  ctx.persist = C.debounce(function () { if (ctx.session && !ctx.destroyed) ctx.data.saveSession(ctx.session).catch(
    function () {});
    }, 400);

  /* ---------- Skeleton ---------- */
  buildSkeleton(ctx);

  /* ---------- Saga runner ---------- */
  ctx.runner = ColonSagaBrowse.create({
    data: ctx.data,
    driver: {
      navigate: function (url, o) { return ctx.load(url, { by: 'ai', signal: o.signal, push: true }); },
      search: function (q, o) {
        var url = U.searchUrl(q, ctx.settings.engine);
        return ctx.load(url, { by: 'ai', signal: o.signal, push: true }).then(function (p) { return p.search
          || { results: [
          ] }; });
      }
    },
    needsApproval: function () { return ctx.session.control === 'shared'; }
  });
  ctx.runner.on(function (t) {
    if (ctx.session) { ctx.session.task = t; ctx.persist(); }
    ctx.renderSide(); ctx.renderMode(); ctx.renderStatus(); ctx.emit('change'); ctx.emit('task');
  });

  /* ---------- Suggestions ---------- */
  bindEvents(ctx);

  /* ---------- Boot ---------- */
  ctx.ready = Promise.all([ctx.data.getSettings(), ctx.data.getSession().catch(function () { return null;
    }), ctx.refreshBookmarks(
    ).catch(function () {}), ctx.data.listHistory({ limit: 8 }).catch(function () { return []; })]).then(function (r) {
    ctx.settings = r[0];
    var s = r[1];
    if (s && ctx.settings.restoreSession && s.tabs && s.tabs.length) ctx.session = s;
    else ctx.session = { tabs: [ctx.newTabObj(ctx.settings.homepage !== 'colon://newtab' ? ctx.settings.homepage :
      null)],
      active_id: null, control: 'manual' };
    ctx.session.active_id = ctx.session.active_id || ctx.session.tabs[0].id;
    ctx.session.control = MODES[ctx.session.control] ? ctx.session.control : 'manual';
    ctx.session.started_at = ctx.session.started_at || new Date().toISOString();
    ctx.recentHist = r[3] || [];
    if (ctx.session.task) ctx.runner.restore(ctx.session.task);
    ctx.el.setAttribute('data-control', ctx.session.control);
    ctx.changed(); ctx.ensureLoaded();
    ctx.timer = setInterval(function () { var n = ctx.el.querySelector('[data-timer]');
      if (n) n.textContent = 'Session: '
      + ctx.elapsed(); }, 1000);
    return ctx.api;
  });

  buildApi(ctx);
  return ctx.api;
}

const ColonBrowser = { create: create, MODES: MODES, saveBlob: saveBlob };
window.ColonBrowser = ColonBrowser;

export { ColonBrowser };
