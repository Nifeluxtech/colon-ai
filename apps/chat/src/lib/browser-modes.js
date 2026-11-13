/* Colon AI · who drives a chat's browser, as the chat shows it (Phase 10). Each conversation has a mode, set in the
   chat (the browser card's chip, or saying "let me help") with a default in Settings:
     "ai"     AI only: Saga drives and the user watches (Take control still pauses Saga);
     "shared" AI + me: both act on the same page at once and Saga sees what the user changed.
   "Manual" is not a mode the user picks: it is the state while the user has taken control, or while Saga waits for
   them to type a password, a code or card details (a handoff) before they tap Return to AI.
   Also: which browser session belongs to which chat, and what the chat page tells the Android app when the chat
   changes. Pure and DOM-free: unit-tested in packages/ui/test/browser-modes.test.js. */

var MODES = ['ai', 'shared'];
var LABELS = { ai: 'AI only', shared: 'AI + me', manual: 'Manual' };

/** The chat's mode: its own (conversation.browser_mode), else the Settings default, else AI only. */
function chatMode(conv, settings) {
  if (conv && MODES.indexOf(conv.browser_mode) >= 0) return conv.browser_mode;
  if (settings && MODES.indexOf(settings.browserMode) >= 0) return settings.browserMode;
  return 'ai';
}

function modeLabel(m) { return LABELS[m] || LABELS.ai; }

/**
 * The chip on the browser card. st: the app's panel state ({ control, paused, resumable, handoff, chatMode });
 * mode: the chat's mode. -> { state: 'ai'|'shared'|'manual'|'idle', label, paused, prompt, canReturn }
 */
function chip(st, mode) {
  st = st || {};
  var m = MODES.indexOf(st.chatMode) >= 0 ? st.chatMode : mode;
  if (st.control === 'ai' || st.control === 'shared') {
    return { state: st.control, label: modeLabel(st.control) + (st.paused ? ' · paused' : ''), paused: !!st.paused,
      prompt: '', canReturn: false };
  }
  if (st.handoff && st.handoff.message) {
    return { state: 'manual', label: 'Your turn', paused: false, prompt: String(st.handoff.message),
      canReturn: true };
  }
  if (st.resumable) return { state: 'manual', label: LABELS.manual, paused: false, prompt: '', canReturn: true };
  return { state: 'idle', label: modeLabel(m), paused: false, prompt: '', canReturn: false };
}

/** The chip's menu: the two modes (the current one checked), then Take control or Return to AI when they apply. */
function menu(st, mode) {
  var c = chip(st, mode), cur = c.state === 'ai' || c.state === 'shared' ? c.state : mode;
  var items = MODES.map(function (m) { return { op: 'mode', mode: m, label: modeLabel(m), checked: m === cur }; });
  if (c.state === 'ai' || c.state === 'shared') items.push({ op: 'take_control', label: 'Take control' });
  if (c.canReturn) items.push({ op: 'return_to_ai', label: 'Return to AI' });
  return items;
}

/** The browser session of a chat: its conversation id; null for a new chat (a fresh, clean browser). */
function sessionKey(conv) {
  return conv && conv.id && !conv.loading && !/^tmp/.test(String(conv.id)) ? String(conv.id) : null;
}

/**
 * What to tell the app when the chat changes: null when it already knows (sent === next), else the browser('chat')
 * arguments. adopt: the new chat just got its conversation (the first message, or a browser instruction), so the
 * browser the user already has becomes the conversation's instead of a clean one.
 */
function chatCall(sent, next, o) {
  var n = next || null;
  if (sent !== undefined && sent === n) return null;
  return { conversation_id: n || '', adopt: !!(o && o.created && n && sent === null) };
}

export { LABELS, MODES, chatCall, chatMode, chip, menu, modeLabel, sessionKey };
