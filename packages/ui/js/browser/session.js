/* ColonBrowser · session basics on the shared context: change events, the active tab, new tab objects. */

import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';

var C = Colon, U = ColonURL;

export function installSession(ctx) {
  function emit(ev) { (ctx.subs[ev] || []).forEach(function (f) { try { f(ctx.api.state()); } catch (e) {} }); }
  function on(ev, f) { (ctx.subs[ev] = ctx.subs[ev] || []).push(f); }
  function active() { return ctx.session.tabs.filter(function (t) { return t.id === ctx.session.active_id;
    })[0] || ctx.session.tabs[0]; }
  function newTabObj(url) { return { id: C.uid('t'), url: url || 'colon://newtab', title: url ? U.displayUrl(
    url) : 'New tab', back: [], fwd: [] }; }
  function changed() { ctx.persist(); ctx.renderTabs(); ctx.renderToolbar(); ctx.renderMode(); ctx.renderSide();
    ctx.renderStatus();
    emit('change'); }
  ctx.emit = emit; ctx.on = on; ctx.active = active; ctx.newTabObj = newTabObj; ctx.changed = changed;
}
