/* Colon AI · Saga's task cards in the thread (0.10.3, docs/decisions/0006-inline-ai-browser.md). Each task is a
   landscape card under the message that asked for it. In the Android app the newest one is live: it is the box the
   app lays its real WebView over (with its own status pill, expand button and Take control); finished ones show the
   picture the app kept when the task ended, the result, and a tap that brings the live browser back. On the web the
   cards come from the server's task list: same shape, the status, and a note to open the Colon AI app.
   Placement and sizes are lib/saga-card.js (pure, tested); this module only draws and moves elements. */

import { cardHeight, layout, snapPill, webCard } from '../lib/saga-card.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { $, S } from '../core/state.js';

var C = Colon, icon = C.icon;
var drawn = {};            // card id + state -> its element (a picture is decoded once, not on every redraw)

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function pillHtml(p) {
  var mark = p.icon === 'spinner' ? '<span class="cw-saga-spin" aria-hidden="true"></span>'
    : '<span class="cw-saga-mark" aria-hidden="true">' + icon(p.icon === 'check' ? 'check' : 'alert') + '</span>';
  return '<div class="cw-saga-pill" data-icon="' + esc(p.icon) + '" role="status">' + mark + '<span>'
    + esc(p.text) + '</span></div>';
}

// A finished task (app: its picture; web: the status and the note about the app).
function snapEl(card) {
  var key = card.id + '|' + card.state + '|' + (card.result || '') + '|' + (card.snapshot ? 1 : 0);
  if (drawn[key]) return drawn[key];
  var p = snapPill(card), el = document.createElement('figure');
  el.className = 'cw-saga-card snap' + (card.web ? ' web' : '');
  el.setAttribute('data-card', card.id);
  var img = card.snapshot && /^data:image\/jpeg;base64,/.test(card.snapshot)
    ? '<img alt="" src="' + card.snapshot + '">' : '<div class="cw-saga-blank" aria-hidden="true">' + icon('globe')
      + '</div>';
  el.innerHTML = img + pillHtml(p) + (card.web
    ? '<figcaption class="cw-saga-note">Open in the Colon AI app for the live browser.</figcaption>'
    : '<button type="button" class="cw-saga-open" data-a="saga-card-open" aria-label="Open Saga’s browser: '
      + esc(card.goal || p.text) + '">' + icon('expand') + '</button>');
  if (!card.web) el.setAttribute('data-a', 'saga-card-open');
  drawn[key] = el;
  return el;
}

// The live card: the host the app's WebView sits over (its body box is .cw-native-body, measured by the anchor).
function liveEl() {
  var host = S.browser.host;
  if (!host) return null;
  if (!host.querySelector('.cw-saga-card.live')) {
    host.innerHTML = '<div class="cw-saga-card live" role="region" aria-label="Saga’s browser">'
      + '<div class="cw-native-body cw-saga-body"><span class="tiny muted">Loading the page…</span></div></div>';
  }
  return host;
}

function byMid(thread, id) {
  var list = thread.children;
  for (var i = 0; i < list.length; i++) if (list[i].getAttribute('data-mid') === String(id)) return list[i];
  return null;
}

function size(el) {
  var body = el.querySelector('.cw-saga-body, img, .cw-saga-blank'), w = el.clientWidth;
  if (!body || !(w > 0)) return;
  var band = window.visualViewport && window.visualViewport.height > 0 ? window.visualViewport.height
    : window.innerHeight;
  var header = $('.cw-head'), comp = $('.cw-composer');
  band -= (header ? header.offsetHeight : 56) + (comp ? comp.offsetHeight : 132);
  body.style.height = cardHeight(w, band) + 'px';
}

/** Puts every card where it belongs: after its message in the thread, else at the end. live: whether the app's
 *  live card is shown now (state.layout inline), with its task (state.run). Called after every redraw. */
function placeCards() {
  var page = $('#cw-page'), host = S.browser.host;
  if (!page) return;
  var st = S.browser.nativeState || {}, run = st.run || {};
  var showLive = !!S.browser.liveShown, thread = page.querySelector('.cw-thread');
  var live = showLive ? { anchor: run.anchor || null, at: run.since || Date.now() } : null;
  var groups = layout(S.messages || [], S.browser.cards || [], live, showLive ? run.task : null);
  // Called on every state event from the app (page loads, Saga's steps): moving nothing that is already in place
  // keeps the live card's box (and the WebView over it) still.
  var sig = JSON.stringify(groups.map(function (g) { return [g.after, g.items.map(function (i) {
    return i.kind === 'live' ? 'live' : [i.card.id, i.card.state, i.card.result, !!i.card.snapshot]; })]; }));
  var placed = page.querySelectorAll('.cw-saga-group');
  if (sig === S.browser.cardsSig && S.browser.cardsThread === thread && placed.length === groups.length
    && (!showLive || (host && host.isConnected && host.querySelector('.cw-saga-body')))) {
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
  }, function () {});
}

function resized() { var page = $('#cw-page'); if (!page) return;
  Array.prototype.forEach.call(page.querySelectorAll('.cw-saga-card'), size); }

export { loadCards, placeCards, resized };
