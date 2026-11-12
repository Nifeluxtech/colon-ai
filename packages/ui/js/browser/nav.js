/* ColonBrowser · navigation (load into the active tab, back/forward/reload/home, tabs) and the control mode
   (you, Saga, or shared) with AI Browse tasks. */

import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';
import { MODES } from './shared.js';

var C = Colon, U = ColonURL;

export function installNav(ctx) {
  /* ---------- Navigation ---------- */
  function navigate(raw, o) {
    o = o || {};
    if (ctx.session.control === 'ai' && ctx.runner.isActive() && o.by !== 'ai' && !o.force) {
      C.toast('Saga is in control. Tap Take control to browse yourself.', '', { label: 'Take control',
        fn: takeControl });
      return Promise.resolve(null);
    }
    var p = U.parseInput(raw, ctx.settings.engine); if (!p) return Promise.resolve(null);
    ctx.input.blur(); ctx.hideSuggest();
    return load(p.url, Object.assign({ push: true }, o)).catch(function () { return null; });
  }
  // Loads url into the active tab. Resolves with the page, rejects on error (AI driver needs that).
  function load(url, o) {
    o = o || {};
    var tab = ctx.active();
    if (o.push && tab.url && tab.url !== url) { tab.back.push(tab.url); if (tab.back.length > 50) tab.back.shift();
      tab.fwd = []; }
    tab.url = url; tab.title = /^colon:/.test(url) ? internalTitle(url) : U.displayUrl(url);
    if (ctx.abortNav) ctx.abortNav.abort();
    var ctl = new AbortController(); ctx.abortNav = ctl;
    if (o.signal) o.signal.addEventListener('abort', function () { ctl.abort(); });
    ctx.pages[tab.id] = { status: 'loading', url: url, by: o.by || 'user' };
    ctx.changed(); ctx.renderViewport();
    var q = U.queryFrom(url);
    var job;
    if (/^colon:/.test(url)) job = Promise.resolve({ internal: url, title: internalTitle(url), url: url });
    else if (q) job = ctx.data.search(q, ctx.settings.engine, { signal: ctl.signal }).then(function (s) { return {
      url: url,
      title: q + ' · Search', search: s }; });
    else job = ctx.data.fetchPage(url, { signal: ctl.signal });
    return job.then(function (page) {
      if (ctl.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (page.url && page.url !== url && !/^colon:/.test(url) && !q) tab.url = page.url;
      tab.title = page.title || tab.title;
      ctx.pages[tab.id] = { status: 'ready', url: tab.url, page: page, by: o.by || 'user' };
      if (!/^colon:/.test(tab.url)) ctx.data.addHistory({ url: tab.url, title: tab.title }).catch(function () {});
      ctx.changed(); ctx.renderViewport(); ctx.vp.scrollTop = 0;
      if (ctx.abortNav === ctl) ctx.abortNav = null;
      return page;
    }, function (e) {
      if (e.name === 'AbortError') { if (ctx.abortNav === ctl) ctx.abortNav = null; throw e; }
      ctx.pages[tab.id] = { status: 'error', url: url, error: e, by: o.by || 'user' };
      tab.title = U.displayUrl(url) || 'Page not available';
      if (!/^colon:/.test(url)) ctx.data.addHistory({ url: url, title: tab.title }).catch(function () {});
      ctx.changed(); ctx.renderViewport();
      if (ctx.abortNav === ctl) ctx.abortNav = null;
      throw e;
    });
  }
  function internalTitle(u) { return ({ 'colon://newtab': 'New tab', 'colon://home': 'Home' })[u] || 'Colon'; }
  function guardUser() { if (ctx.session.control === 'ai' && ctx.runner.isActive()) { C.toast(
    'Saga is in control. Take control to browse yourself.', '', { label: 'Take control', fn: takeControl });
    return false; } return true; }
  function back() { if (!guardUser()) return; var t = ctx.active(); if (!t.back.length) return; t.fwd.push(t.url);
    load(t.back.pop()).catch(function () {}); }
  function forward() { if (!guardUser()) return; var t = ctx.active(); if (!t.fwd.length) return; t.back.push(t.url);
    load(t.fwd.pop()).catch(function () {}); }
  function reload() { if (!guardUser()) return; load(ctx.active().url).catch(function () {}); }
  function home() { if (!guardUser()) return; navigate(ctx.settings.homepage || 'colon://newtab'); }
  function newTab(url) {
    var t = ctx.newTabObj(); ctx.session.tabs.push(t); ctx.session.active_id = t.id; ctx.changed();
    if (url) return navigate(url, { force: true }); ctx.renderViewport(); setTimeout(function () { ctx.input.focus();
      }, 30);
      return Promise.resolve(null);
  }
  function closeTab(id) {
    var i = ctx.session.tabs.findIndex(function (t) { return t.id === id; }); if (i < 0) return;
    ctx.session.tabs.splice(i, 1); delete ctx.pages[id];
    if (!ctx.session.tabs.length) ctx.session.tabs.push(ctx.newTabObj());
    if (ctx.session.active_id === id) ctx.session.active_id = (ctx.session.tabs[i] || ctx.session.tabs[i - 1]
      || ctx.session.tabs[0]).id;
    ctx.changed(); ensureLoaded();
  }
  function switchTab(id) { if (!ctx.session.tabs.some(function (t) { return t.id === id; })) return;
    ctx.session.active_id = id; ctx.changed(); ensureLoaded(); }
  function ensureLoaded() { var t = ctx.active(); if (!ctx.pages[t.id]) load(t.url).catch(function () {});
    else ctx.renderViewport(
    ); }
  /* ---------- Control modes & handoff ---------- */
  function setControl(m) {
    if (!MODES[m] || ctx.session.control === m) return;
    var prev = ctx.session.control; ctx.session.control = m;
    if (m === 'manual' && ctx.runner.isActive()) ctx.runner.pause('handoff');
    else if (m !== 'manual' && prev === 'manual' && ctx.runner.state() && ctx.runner.state(
      ).status === 'paused') ctx.runner.resume(
      );
    ctx.el.setAttribute('data-control', m); ctx.changed();
    C.toast(m === 'manual' ? 'Manual mode. You have control.' : m === 'ai' ? 'AI mode. Saga can browse for you.' :
      'Shared mode. Saga will ask before each action.');
  }
  function takeControl() {
    // Safe handoff: pause pending automation FIRST, then hand over.
    if (ctx.runner.isActive()) ctx.runner.pause('handoff');
    if (ctx.abortNav && ctx.pages[ctx.active().id] && ctx.pages[ctx.active().id].by === 'ai') ctx.abortNav.abort();
    if (ctx.session.control !== 'manual') { ctx.session.control = 'manual'; ctx.el.setAttribute('data-control',
      'manual');
      ctx.changed(); }
    C.toast('You have control. Saga paused all pending actions.', 'ok');
  }
  function returnToAI() { ctx.session.control = 'ai'; ctx.el.setAttribute('data-control', 'ai');
    var s = ctx.runner.state();
    if (s && s.status === 'paused') ctx.runner.resume(); ctx.changed(); C.toast('Control returned to Saga.'); }
  function pauseAI() { var s = ctx.runner.state(); if (s && s.status === 'paused') ctx.runner.resume();
    else ctx.runner.pause('user'); }
  function stopTask() { ctx.runner.stop(); }
  function startTask(goal) {
    goal = String(goal || '').trim(); if (!goal) return;
    if (ctx.session.control === 'manual') { ctx.session.control = 'ai'; ctx.el.setAttribute('data-control', 'ai'); }
    ctx.toggleSide(true); ctx.runner.start(goal); ctx.changed();
  }
  ctx.navigate = navigate; ctx.load = load; ctx.internalTitle = internalTitle; ctx.guardUser = guardUser;
    ctx.back = back; ctx.forward = forward; ctx.reload = reload; ctx.home = home; ctx.newTab = newTab;
    ctx.closeTab = closeTab; ctx.switchTab = switchTab; ctx.ensureLoaded = ensureLoaded; ctx.setControl = setControl;
    ctx.takeControl = takeControl; ctx.returnToAI = returnToAI; ctx.pauseAI = pauseAI; ctx.stopTask = stopTask;
    ctx.startTask = startTask;
}
