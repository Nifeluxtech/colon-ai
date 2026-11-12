/* ColonBrowser · drawing the tab strip, toolbar, control-mode bar and status line. */

import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';
import { MODES, siteLetter } from './shared.js';

var C = Colon, U = ColonURL, icon = C.icon, esc = C.esc;

export function installTabs(ctx) {
  /* ---------- Rendering ---------- */
  function renderTabs() {
    var box = ctx.$('.cb-tabs');
    box.innerHTML = ctx.session.tabs.map(function (t) {
      var on = t.id === ctx.session.active_id, pg = ctx.pages[t.id];
      return '<div class="cb-tab' + (on ? ' on' : '') + '" role="tab" aria-selected="' + on + '" tabindex="' + (on
        ? 0 : -1) + '" data-tab="' + t.id + '">' +
        (pg && pg.status === 'loading' ? '<span class="spin dark" style="width:14px;height:14px"></span>' :
          '<span class="cb-fav" style="background:' + favColor(t.url) + '">' + esc(favLetter(t)) + '</span>') +
        '<span class="cb-tab-t">' + esc(t.title || 'New tab') + '</span><button class="cb-tab-x" data-close-tab="'
          + t.id + '" aria-label="Close tab ' + esc(t.title) + '">' + icon('x') + '</button></div>';
    }).join('') + '<button class="icon-btn sm cb-newtab" data-a="newtab" aria-label="New tab" data-tip="New tab">'
      + icon('plus') + '</button>';
    ctx.$('.cb-tabcount span').textContent = ctx.session.tabs.length;
  }
  function favLetter(t) { if (/^colon:/.test(t.url)) return 'C'; return siteLetter(t.url); }
  function favColor(u) { if (/^colon:/.test(u)) return 'var(--primary)'; var h = U.hostOf(u), n = 0; for (var i = 0;
    i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0; return 'hsl(' + (n % 360) + ' 62% 46%)'; }
  function renderToolbar() {
    var t = ctx.active(), pg = ctx.pages[t.id];
    if (document.activeElement !== ctx.input) ctx.input.value = /^colon:\/\/newtab/.test(t.url) ? '' : (U.queryFrom(
      t.url)
      || t.url);
    ctx.$('[data-a=back]').disabled = !t.back.length; ctx.$('[data-a=forward]').disabled = !t.fwd.length;
    var lock = ctx.$('.cb-lock');
    lock.innerHTML = /^colon:/.test(t.url) ? icon('search') : U.isSecure(t.url) ? icon('lock') : icon('alert');
    lock.className = 'cb-lock ' + (/^colon:/.test(t.url) ? '' : U.isSecure(t.url) ? 'secure' : 'insecure');
    var bm = ctx.bookmarks.filter(function (b) { return b.url === t.url; })[0];
    var bb = ctx.$('[data-a=bookmark]'); bb.innerHTML = icon(bm ? 'bookmarkFill' : 'bookmark');
      bb.setAttribute('aria-pressed', !!bm); bb.disabled = /^colon:/.test(t.url);
    ctx.$('[data-a=download]').disabled = !(pg && pg.status === 'ready' && pg.page && pg.page.html);
    ctx.$('[data-a=side]').setAttribute('aria-pressed', ctx.sideOpen);
    var prog = ctx.$('.cb-progress'); prog.classList.toggle('on', !!(pg && pg.status === 'loading'));
  }
  function renderMode() {
    var m = ctx.session.control, t = ctx.runner.state(), bar = ctx.$('.cb-modebar');
    ctx.el.setAttribute('data-control', m);
    var activity = '';
    if (t && /planning|running|awaiting_approval|paused/.test(t.status)) {
      var cur = t.steps.filter(function (s) { return /running|awaiting/.test(s.status); })[0];
      activity = t.status === 'paused' ? 'Paused' + (t.pause_reason === 'handoff' ? ' · you have control' : '') :
        t.status === 'awaiting_approval' ? 'Waiting for your approval' : (cur ? cur.label : t.status === 'planning'
        ? 'Planning…' : 'Working… ' + t.progress + '%');
    }
    bar.innerHTML = '<span class="cb-mode-ico">' + icon(MODES[m].icon) + '</span><b>' + MODES[m].label
      + (m === 'manual' ? ' Mode' : m === 'shared' ? ' Mode' : '') + '</b>' +
      '<span class="cb-mode-desc">' + esc(activity || MODES[m].desc) + '</span>' +
      (t && /running|planning/.test(t.status)
        ? '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>' : '') +
      '<span class="cb-mode-acts">' +
      (m !== 'manual' ? '<button class="btn xs" data-a="take">' + icon('hand') + 'Take control</button>' : (t
        && t.status === 'paused' ? '<button class="btn xs primary" data-a="return">' + icon('sparkles')
        + 'Return to AI</button>' : '')) +
      '</span>';
  }
  function statusLabel(s) { return { planning: 'Planning', running: 'Running', paused: 'Paused',
    awaiting_approval: 'Needs approval', done: 'Done', stopped: 'Stopped', error: 'Ended' }[s] || s; }
  function statusBadge(s) { return { running: 'primary', planning: 'primary', paused: 'warn',
    awaiting_approval: 'cyan', done: 'ok', stopped: '', error: 'bad' }[s] || ''; }
  function stepIcon(s) { return s === 'done' ? icon('check') : s === 'running'
    ? '<span class="spin dark" style="width:14px;height:14px"></span>' : s === 'failed' ? icon('x') : s === 'skipped'
    ? icon('right') : s === 'awaiting' ? icon('hand') : '<i></i>'; }
  function renderStatus() {
    var t = ctx.active(), s = ctx.$('.cb-status'), task = ctx.runner.state();
    var secure = /^colon:/.test(t.url) || U.isSecure(t.url);
    s.innerHTML = '<span class="status-dot ' + (secure ? '' : 'warn') + '"></span><span>' + (secure
      ? 'Browsing securely' : 'Not secure (http)') + '</span>' +
      ('<span class="badge cb-engine" data-tip="Web reader preview: text and images only. Full browsing runs in the '
        + 'Colon Android app.">') + icon('reader') + 'Reader preview</span>' +
      (task && /running|planning/.test(task.status) ? '<span class="badge primary">' + icon('sparkles')
        + 'Saga active</span>' : '') +
      '<span class="cb-timer">' + icon('clock') + '<span data-timer>Session: ' + elapsed() + '</span></span>';
  }
  function elapsed() { var s = Math.max(0, Math.floor((Date.now() - new Date(ctx.session.started_at).getTime(
    )) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'h ' : '') + m + 'm ' + (s % 60)
    + 's'; }
  ctx.renderTabs = renderTabs; ctx.favLetter = favLetter; ctx.favColor = favColor; ctx.renderToolbar = renderToolbar;
    ctx.renderMode = renderMode; ctx.statusLabel = statusLabel; ctx.statusBadge = statusBadge; ctx.stepIcon = stepIcon;
    ctx.renderStatus = renderStatus; ctx.elapsed = elapsed;
}
