/* Colon AI · the in-chat browser card (0.10.3, docs/decisions/0006-inline-ai-browser.md). One card per Saga task,
   under the chat message that asked for it, scrolling with the thread: the newest task's card holds the app's live
   browser (the Android app lays its WebView over the card's box and draws the status pill and buttons on it);
   finished tasks show the picture the app kept of the page when the task ended, with the result, and a tap brings
   the live browser back. On the web (no app) the card has the same shape with the task's status and a note to open
   the Colon AI app for the live browser. The browser is AI-only: while the user has it (Take control), a message
   from the composer goes to Saga as their hand-back note instead of a chat message.
   Pure and DOM-free: unit-tested in packages/ui/test/saga-card.test.js. */

var RATIO = 10 / 16;          // the card is landscape: a desktop page scaled down
var MIN_HEIGHT = 150;         // CSS px: never a sliver, even with the keyboard open
var CARD_MARGIN = 24;         // room kept under the header and above the composer

/** The card's height in CSS px: 16:10 at its width, capped so the whole card fits the visible band of the thread
 *  (between the header and the composer, keyboard closed), never below MIN_HEIGHT. */
function cardHeight(width, band) {
  var w = Number(width) > 0 ? Number(width) : 0;
  var h = Math.round(w * RATIO);
  var room = Number(band) > 0 ? Number(band) - CARD_MARGIN : Infinity;
  return Math.max(MIN_HEIGHT, Math.min(h, room));
}

var LIVE = ['running', 'paused', 'needs_user', 'user_control'];

/** True when a message from the composer is the user's hand-back to Saga (run: the app's state.run). */
function givesBack(run) {
  return !!(run && (run.state === 'needs_user' || (run.state === 'user_control' && run.resumes)));
}

/** True when the user holds the browser with nothing to resume (they took it while Saga was idle). */
function holdsIdle(run) { return !!(run && run.state === 'user_control' && !run.resumes); }

/** Where a card goes: its anchor message when it is in the thread; else the last message at or before its time;
 *  else the end of the thread (null). messages: [{ id, created_at }]; card: { anchor, at (ms) }. */
function anchorFor(messages, card) {
  var list = messages || [];
  if (card && card.anchor) {
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(card.anchor)) return String(list[i].id);
  }
  var at = card && Number(card.at) > 0 ? Number(card.at) : 0, best = null;
  if (!at) return null;
  for (var j = 0; j < list.length; j++) {
    var t = Date.parse(list[j].created_at || '');
    if (t > 0 && t <= at) best = String(list[j].id);
  }
  return best;
}

/** The cards to draw, grouped by the message they follow ('' = the end of the thread), oldest first; the live card
 *  last in its group. cards: the app's finished cards (browser('cards')) or the server's tasks on the web; live:
 *  { anchor, at } of the card the app shows now, or null. A finished card of the live task is left out. */
function layout(messages, cards, live, liveId) {
  var groups = {}, order = [];
  function put(key, item) { if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(item); }
  (cards || []).slice().sort(function (a, b) { return (Number(a.at) || 0) - (Number(b.at) || 0); })
    .forEach(function (c) {
      if (liveId && String(c.id) === String(liveId)) return;
      put(anchorFor(messages, c) || '', { kind: 'snap', card: c });
    });
  if (live) put(anchorFor(messages, live) || '', { kind: 'live', card: live });
  return order.map(function (k) { return { after: k, items: groups[k] }; });
}

/** A finished card's pill: { icon: check · error · spinner · turn, text }. */
function snapPill(card) {
  var s = card && card.state, text = card && card.result ? String(card.result) : '';
  if (s === 'done') return { icon: 'check', text: text || 'Done' };
  if (s === 'stopped') return { icon: 'error', text: text || 'Saga stopped' };
  if (LIVE.indexOf(s) >= 0) return { icon: 'spinner', text: text || 'Saga is working…' };
  return { icon: 'error', text: text || 'Saga couldn’t finish' };
}

var WEB_STATUS = { queued: 'Waiting for your phone…', consent: 'Waiting for you to allow Saga on your phone…',
  running: 'Saga is browsing in the Colon AI app…', handoff: 'Saga needs you in the Colon AI app',
  user_control: 'You have the browser in the Colon AI app', paused: 'Saga is paused in the Colon AI app' };

/** On the web: a server task (GET /browser/agent) as a card { id, at, state, result, goal, note }. result: the
 *  task's short result line (its finish step's words) when known. */
function webCard(task, result) {
  var t = task || {}, st = String(t.status || '');
  var state = st === 'done' ? 'done' : st === 'stopped' ? 'stopped' : WEB_STATUS[st] ? 'running' : 'error';
  return { id: String(t.id), goal: String(t.goal || ''), at: Date.parse(t.created_at || '') || 0, state: state,
    result: state === 'running' ? WEB_STATUS[st] : String(result || ''), web: true };
}

/** The app's final word for a task the chat followed: { kind: done · stopped · error, result }. */
function endOf(task, finishSay) {
  var s = task && task.status;
  var kind = s === 'done' ? 'done' : s === 'stopped' || (s === 'interrupted' && task.error === 'stop') ? 'stopped'
    : 'error';
  return { kind: kind, result: kind === 'done' ? String(finishSay || '').slice(0, 80) : '' };
}

export { MIN_HEIGHT, RATIO, anchorFor, cardHeight, endOf, givesBack, holdsIdle, layout, snapPill, webCard };
