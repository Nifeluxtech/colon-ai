/* Colon AI · the browser card's chrome in the thread (0.11.2, owner: "polished like Hark Pro's live browser card").
   The live card: a slim header (the site's icon and domain, a live status dot or spinner, a short task title, small
   icon buttons) over the app's live page, and one status line under it that crossfades between Saga's steps. The app
   is told (browser('chrome')) so it leaves the page clear in the thread: no floating pill or corner button. A
   finished run: a summary row ("Done · 5 steps") over its last picture; tapping it opens that run's steps (the
   server's step list in a sheet, or the app's timeline for the run it still holds). What to show is lib/card-chrome.js
   (pure, tested); this module draws it and answers its buttons (data-a="saga-card", data-op). */

import { liveChrome, stepsOf, summaryOf } from '../lib/card-chrome.js';
import { withInline } from '../lib/native-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';
import { S } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc;
var BUTTONS = {
  expand: ['expand', 'Full screen'], minimise: ['collapse', 'Back to the chat'], take: ['hand', 'Take control'],
  give: ['play', 'Give back to Saga'], pause: ['pause', 'Pause Saga'], resume: ['play', 'Resume Saga'],
  stop: ['stop', 'Stop Saga'], login: ['lock', 'Open the login form']
};

function browser(action, o) {
  return C.native.browser(action, withInline(o, C.native.can('browserInline'))).catch(function () {});
}
function fav(url, cls) {
  return url ? '<img class="' + cls + '" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer" '
    + 'src="' + esc(url) + '" onerror="this.replaceWith(document.createElement(\'i\'))">'
    : '<i class="' + cls + '"></i>';
}

/** The live card's skeleton: header, the body the app's WebView covers (.cw-native-body), the status line. */
function liveHtml() {
  return '<div class="cw-saga-card live" role="region" aria-label="Saga’s browser">'
    + '<div class="cw-saga-head"><span class="cw-saga-fav"></span><span class="cw-saga-dot" aria-hidden="true"></span>'
    + '<span class="cw-saga-where"><b class="cw-saga-domain"></b><span class="cw-saga-title"></span></span>'
    + '<span class="cw-saga-btns"></span></div>'
    + '<div class="cw-native-body cw-saga-body"><span class="tiny muted">Loading the page…</span></div>'
    + '<div class="cw-saga-line" role="status" aria-live="polite"><span class="on"></span><span></span></div></div>';
}

// One step line at a time: the new words fade in over the old ones (two spans, swapped).
function setLine(el, text) {
  if (!el || el.getAttribute('data-text') === text) return;
  el.setAttribute('data-text', text);
  var on = el.querySelector('span.on'), off = on && on.nextElementSibling ? on.nextElementSibling
    : el.querySelector('span:not(.on)');
  if (!on || !off) return;
  off.textContent = text; off.classList.add('on'); on.classList.remove('on');
  if (off !== el.lastElementChild) el.appendChild(off);
}

/** Paints the live card's header and status line from the app's state. Tells the app once that this page draws it. */
function paintLive(host, st) {
  var card = host && host.querySelector('.cw-saga-card.live');
  if (!card) return;
  var ch = liveChrome(st);
  card.setAttribute('data-status', ch.status);
  var f = card.querySelector('.cw-saga-fav');
  if (f.getAttribute('data-src') !== ch.favicon) { f.setAttribute('data-src', ch.favicon); f.innerHTML = fav(ch.favicon,
    'cw-saga-ico'); }
  card.querySelector('.cw-saga-domain').textContent = ch.domain || 'Saga’s browser';
  card.querySelector('.cw-saga-title').textContent = ch.title;
  var btns = card.querySelector('.cw-saga-btns'), sig = ch.controls.join(',');
  if (btns.getAttribute('data-sig') !== sig) {
    btns.setAttribute('data-sig', sig);
    btns.innerHTML = ch.controls.map(function (k) { var b = BUTTONS[k];
      return '<button type="button" class="cw-saga-btn" data-a="saga-card" data-op="' + k + '" aria-label="' + b[1]
        + '" title="' + b[1] + '">' + icon(b[0]) + '</button>'; }).join('');
  }
  setLine(card.querySelector('.cw-saga-line'), ch.line);
  if (!S.browser.chromeSaid && C.native.can('browserChrome')) { S.browser.chromeSaid = true;
    browser('chrome', { on: true }); }
}

/** A finished run: its summary row over its last picture (or a blank), the whole card opens its steps. */
function snapHtml(card) {
  var s = summaryOf(card);
  var img = card.snapshot && /^data:image\/jpeg;base64,/.test(card.snapshot)
    ? '<img class="cw-saga-shot" alt="" src="' + card.snapshot + '">'
    : '<div class="cw-saga-blank" aria-hidden="true">' + icon('globe') + '</div>';
  return '<div class="cw-saga-head cw-saga-row" data-status="' + s.status + '">' + fav(s.favicon, 'cw-saga-ico')
    + '<span class="cw-saga-where"><b class="cw-saga-domain">' + esc(s.domain) + '</b><span class="cw-saga-title">'
    + esc(s.title) + '</span></span><span class="cw-saga-sum">' + esc(s.text) + '</span>'
    + (card.web ? '' : '<button type="button" class="cw-saga-btn" data-a="saga-card" data-op="reopen" aria-label='
      + '"Open Saga’s browser again" title="Open the browser">' + icon('expand') + '</button>') + '</div>' + img
    + (s.result ? '<div class="cw-saga-line done"><span class="on">' + esc(s.result) + '</span></div>' : '')
    + (card.web ? '<figcaption class="cw-saga-note">Open in the Colon AI app for the live browser.</figcaption>' : '');
}

// A run's steps from the server, in a sheet ("How Saga browsed").
function stepsSheet(id, title) {
  return C.api('/browser/agent/' + encodeURIComponent(id)).then(function (d) {
    var steps = stepsOf(d.actions);
    C.sheet('<div class="h3">' + esc(title || 'Saga’s steps') + '</div><ol class="cw-saga-steps">'
      + (steps.length ? steps.map(function (s) { return '<li' + (s.ok ? '' : ' class="bad"') + '><span>' + esc(s.text)
        + '</span>' + (s.host ? ' <span class="muted tiny">' + esc(s.host) + '</span>' : '') + '</li>'; }).join('')
        : '<li class="muted">No steps were recorded.</li>') + '</ol>', function () {});
  }, function () { C.toast('Couldn’t load this run’s steps.', 'bad'); });
}

/** The card's buttons and taps (data-a="saga-card"). */
function cardAction(el) {
  var op = el.getAttribute('data-op') || '', fig = el.closest ? el.closest('[data-card]') : null;
  var ctl = { take: 'take_control', give: 'return_to_ai', pause: 'pause', resume: 'resume', stop: 'stop' }[op];
  if (ctl) return browser('control', { op: ctl });
  if (op === 'expand' || op === 'minimise') return browser('layout', { layout: op === 'expand' ? 'full' : 'inline' });
  if (op === 'reopen') return browser('open');
  if (op === 'login' && CW.sagaWaitLink) return CW.sagaWaitLink('#colon-login');   // 0.11.6 (saga-wait.js)
  if (op === 'timeline') return browser('timeline');
  if (op === 'run' && fig) {
    var id = fig.getAttribute('data-card'), run = (S.browser.nativeState || {}).run || {};
    if (/^\d+$/.test(id) && !(C.native.hasPanel() && String(run.task) === id && C.native.can('sagaTimeline'))) {
      return stepsSheet(id, fig.getAttribute('data-title'));
    }
    if (C.native.can('sagaTimeline') && String(run.task) === id) return browser('timeline');
    return browser('open');
  }
  return null;
}

/** 0.11.2: older cards' pictures come from the app one at a time (they aren't sent with the card list). */
function fillShots(cards, redraw) {
  if (!C.native.can('cardShot')) return;
  var todo = (cards || []).filter(function (c) { return c.has_shot && !c.snapshot; });
  (function next(i) {
    if (i >= todo.length) { if (todo.length) redraw(); return; }
    browser('cardShot', { id: todo[i].id }).then(function (r) {
      if (r && r.snapshot) todo[i].snapshot = r.snapshot;
      todo[i].has_shot = false; next(i + 1);
    });
  })(0);
}

export { cardAction, fillShots, liveHtml, paintLive, snapHtml };
