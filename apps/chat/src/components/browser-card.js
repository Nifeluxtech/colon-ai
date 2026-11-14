/* Colon AI · Saga's task cards in the thread (0.10.3, docs/decisions/0006-inline-ai-browser.md). Each task is a
   landscape card under the message that asked for it. In the Android app the newest one is live: it is the box the
   app lays its real WebView over (with its own status pill, expand button and Take control); finished ones show the
   picture the app kept when the task ended, the result, and a tap that brings the live browser back. On the web the
   cards come from the server's task list: same shape, the status, and a note to open the Colon AI app.
   Placement and sizes are lib/saga-card.js (pure, tested); this module only draws and moves elements.
   0.11.2: the card's chrome (header, status line, summary row) is components/browser-chrome.js; every past run keeps
   its card (summary row and last picture) under its message for good. */

import { sessionKey } from '../lib/browser-modes.js';
import { openerStore } from '../lib/browser-opener.js';
import { cardHeight, layout, liveSpot, webCard } from '../lib/saga-card.js';
import { fillShots, liveHtml, paintLive, snapHtml } from './browser-chrome.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, S } from '../core/state.js';

var C = Colon;
var drawn = {};            // card id + state -> its element (a picture is decoded once, not on every redraw)

// A finished task (app: its picture; web: the status and the note about the app).
function snapEl(card) {
  var key = card.id + '|' + card.state + '|' + (card.result || '') + '|' + (card.snapshot ? 1 : 0);
  if (drawn[key]) return drawn[key];
  var el = document.createElement('figure');
  el.className = 'cw-saga-card snap' + (card.web ? ' web' : '');
  el.setAttribute('data-card', card.id);
  el.setAttribute('data-title', String(card.goal || '').slice(0, 120));
  // 0.11.2: the summary row and the run's last picture; a tap opens that run's steps.
  el.innerHTML = snapHtml(card);
  el.setAttribute('data-a', 'saga-card'); el.setAttribute('data-op', 'run');
  el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
  drawn[key] = el;
  return el;
}

// The live card: the host the app's WebView sits over (its body box is .cw-native-body, measured by the anchor).
function liveEl() {
  var host = S.browser.host;
  if (!host) return null;
  if (!host.querySelector('.cw-saga-card.live')) host.innerHTML = liveHtml();
  paintLive(host, S.browser.nativeState || {});
  return host;
}

/** 0.11.1: which reply opened each chat's browser, kept in the page's storage. */
function openers() {
  if (!S.browser.openers) {
    var ls = null;
    try { ls = window.localStorage; } catch (e) { ls = null; }
    S.browser.openers = openerStore(ls);
  }
  return S.browser.openers;
}

function byMid(thread, id) {
  var list = thread.children;
  for (var i = 0; i < list.length; i++) if (list[i].getAttribute('data-mid') === String(id)) return list[i];
  return null;
}

function size(el) {
  var body = el.querySelector('.cw-saga-body, img.cw-saga-shot, .cw-saga-blank'), w = el.clientWidth;
  if (!body || !(w > 0)) return;
  var band = window.visualViewport && window.visualViewport.height > 0 ? window.visualViewport.height
    : window.innerHeight;
  var header = $('.cw-head'), comp = $('.cw-composer');
  band -= (header ? header.offsetHeight : 56) + (comp ? comp.offsetHeight : 132);
  // 0.11.2: the card's own header and status line fit in the band too.
  Array.prototype.forEach.call(el.querySelectorAll('.cw-saga-head, .cw-saga-line'), function (x) {
    band -= x.offsetHeight || 0; });
  body.style.height = cardHeight(w, band) + 'px';
}

/** Puts every card where it belongs: after its message in the thread, else at the end. live: whether the app's
 *  live card is shown now (state.layout inline), with its task (state.run). Called after every redraw. */
function placeCards() {
  var page = $('#cw-page'), host = S.browser.host;
  if (!page) return;
  var st = S.browser.nativeState || {};
  var showLive = !!S.browser.liveShown, thread = page.querySelector('.cw-thread');
  // 0.11.1 (lib/saga-card.js liveSpot): a running task keeps its own message; an idle browser goes under the reply
  // that opened it (kept per chat, lib/browser-opener.js) or takes the place of the task that just ended.
  var key = sessionKey(S.current), store = openers();
  if (key && showLive) store.seen(key, Date.now()); else if (key && st.open === false) store.unseen(key);
  var op = key ? store.get(key) : null, spot = showLive ? liveSpot(st, op, op ? op.seenAt : 0) : null;
  var live = spot ? { anchor: spot.anchor, at: spot.at, replaces: !!spot.replaces } : null;
  // 0.10.6: a chat with no messages has no tasks: no finished card from anywhere else shows on it.
  var cards = (S.messages || []).length ? S.browser.cards || [] : [];
  var groups = layout(S.messages || [], cards, live, spot ? spot.hide : null);
  // Called on every state event from the app (page loads, Saga's steps): moving nothing that is already in place
  // keeps the live card's box (and the WebView over it) still.
  var sig = JSON.stringify(groups.map(function (g) { return [g.after, g.items.map(function (i) {
    return i.kind === 'live' ? 'live' : [i.card.id, i.card.state, i.card.result, !!i.card.snapshot]; })]; }));
  var placed = page.querySelectorAll('.cw-saga-group');
  if (sig === S.browser.cardsSig && S.browser.cardsThread === thread && placed.length === groups.length
    && (!showLive || (host && host.isConnected && host.querySelector('.cw-saga-body')))) {
    if (showLive && host) paintLive(host, st);
    if (S.browser.anchor) S.browser.anchor.update();
    return;
  }
  S.browser.cardsSig = sig; S.browser.cardsThread = thread;
  Array.prototype.forEach.call(placed, function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
  var parked = false;
  groups.forEach(function (g) {
    var box = document.createElement('div');
    box.className = 'cw-saga-group';
    g.items.forEach(function (it) {
      var el = it.kind === 'live' ? liveEl() : snapEl(it.card);
      if (it.kind === 'live') parked = true;
      if (el) box.appendChild(el);
    });
    var after = g.after && thread ? byMid(thread, g.after) : null;
    if (after && after.parentNode) after.parentNode.insertBefore(box, after.nextSibling);
    else (thread || page).appendChild(box);
    Array.prototype.forEach.call(box.children, size);
  });
  // No live card: the host goes back to its place after the thread (empty), where older code expects it.
  if (host && !parked) {
    host.innerHTML = '';
    if (host.parentNode !== page.parentNode && page.parentNode) page.parentNode.insertBefore(host, page.nextSibling);
  }
  if (S.browser.anchor) S.browser.anchor.update();
}

/** The chat's finished cards: from the app (pictures included) or, on the web, the server's tasks for this chat. */
function loadCards(conversationId, fromApp) {
  var want = conversationId || '';
  S.browser.cardsFor = want;
  var got = fromApp ? fromApp() : !want ? Promise.resolve([]) : C.api('/browser/agent?conversation_id='
    + encodeURIComponent(want)).then(function (d) {
    return (d.tasks || []).filter(function (t) { return String(t.conversation_id || '') === want; })
      .map(function (t) { return webCard(t, t.result); }); });
  return Promise.resolve(got).then(function (cards) {
    if (S.browser.cardsFor !== want) return;
    S.browser.cards = Array.isArray(cards) ? cards : [];
    placeCards();
    // 0.11.2: older runs' pictures, one at a time, then the thread is redrawn with them.
    fillShots(S.browser.cards, function () { if (S.browser.cardsFor === want) { S.browser.cardsSig = null;
      placeCards(); } });
  }, function () {});
}

function resized() { var page = $('#cw-page'); if (!page) return;
  Array.prototype.forEach.call(page.querySelectorAll('.cw-saga-card'), size); }

export { loadCards, openers, placeCards, resized };
