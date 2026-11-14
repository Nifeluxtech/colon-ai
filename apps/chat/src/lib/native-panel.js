/* Colon AI · the chat page's side of the app's "can this page draw the inline card?" handshake (v0.9.2).
   The Android app shows its browser panel in the thread (layout "inline") only after the chat page says it draws
   the Colon Browser card: any browser(...) call with { inline: true }, or an anchor report. 0.9.1 relied on the page
   saying it once, early; an open the app made by itself (Saga's auto-open, a link it routed) before that, or after
   a slow reload let its 4 s grace run out, stayed above the chat. Since 0.9.2 the app's state carries inlineReady,
   and the page answers every state that says "not yet" (and, with a 0.9.1 app that doesn't send it, an embedded
   open once per page). Pure and DOM-free: unit-tested in packages/ui/test/native-panel.test.js. */

// The browser(...) arguments: { inline: true } added when this page can draw the card in this app.
function withInline(o, canInline) {
  return canInline ? Object.assign({ inline: true }, o || {}) : (o || {});
}

/**
 * Should the page tell the app now that it draws the card? st: the app's panel state; o: { canInline (the app has
 * feature browserInline), pending (an announcement is on its way), announced (this page already announced once) }.
 */
function needsAnnounce(st, o) {
  o = o || {};
  if (!o.canInline || o.pending || !st || typeof st !== 'object') return false;
  if (st.inlineReady === false || st.inlineReady === null) return true; // 0.9.2+ app: "not yet" -> say it
  // A 0.9.1 app (no inlineReady): it may have fallen back to embedded before this page said anything.
  return st.inlineReady === undefined && !o.announced && !!st.open && st.layout === 'embedded';
}

// The card is drawn (and its box reported) only while the app shows the panel in the thread.
function showsCard(st, canInline) {
  return !!(canInline && st && st.open && st.layout === 'inline');
}

var BUSY = ['running', 'paused', 'needs_user', 'user_control'];

/**
 * 0.10.6: does the app's live card belong to the chat on screen? st: the app's panel state (st.chat: whose browser
 * it shows, null for a new chat's draft; absent in apps before 0.10.3); o: { chat (sessionKey of the chat on screen,
 * null for a new chat), messages (how many the thread has), opened (the user opened the browser on this chat's screen,
 * with the Browser button) }. A new or empty chat shows no card unless a task of its own is under way or the user
 * opened its browser; a state that still names another chat (the app hasn't switched yet) shows none.
 */
function liveHere(st, o) {
  o = o || {};
  if (!st || typeof st !== 'object') return false;
  var mine = o.chat || null;
  if (Object.prototype.hasOwnProperty.call(st, 'chat') && (st.chat || null) !== mine) return false;
  var run = st.run || {}, busy = BUSY.indexOf(run.state) >= 0;
  if (busy || o.opened) return true;
  return !!mine && Number(o.messages) > 0;
}

export { liveHere, needsAnnounce, showsCard, withInline };
