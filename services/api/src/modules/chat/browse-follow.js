// 0.11.3 (owner): browser follow-ups never reach the chat model. After a browser task in a chat (an AI Browse turn
// in the last few messages), a message that plausibly continues it ("go to Colon repo", "open the second result",
// "check", "in the logged in account", "open the browser and check") goes back to the app as event `browse`, and
// the app has Saga do it in the same browser session, its live card under the message. Any site, any specialist:
// the chat keeps its mode (Developer stays Developer + AI Browse). The app's own check (apps/chat/src/lib/
// browser-intent.js followUp) catches these first; this is the server's guard for when the page didn't (an older
// page, a reload). Same rules as the app's, kept narrow: code and explain requests stay chat.
//   followUp(text) -> boolean · goalFor(text, prev) -> the goal Saga gets · route(conv, userMsg, messages) -> goal | ''
const RECENT_MS = 6 * 60 * 60 * 1000;        // a browser turn this recent (and within WINDOW messages) counts
const WINDOW = 6;

const LEAD = new RegExp('^(?:(?:hey|hi|ok(?:ay)?|so|now|and|then)[\\s,]+)*(?:saga[\\s,:]+)?(?:(?:please|pls|kindly)'
  + '\\s+)?(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?');
const QUESTION = /^(?:how|why|when|where|who|is|are|do|does|did|should|what|which|can i|could i)\b/;
const BROWSER_AND = new RegExp("^(?:open|show|launch|use|bring up)\\s+(?:the |my |this chat'?s )?(?:colon )?browser"
  + '\\s+(?:and|to|then)\\s+\\S');
const GO_VERB = new RegExp('^(?:open|go(?! ahead| on\\b)|goto|visit|navigate|browse|take me|head|click|tap|'
  + 'press|select|choose|pick|scroll|swipe|sign out|log ?out|refresh|reload|switch to|add (?:it|this|that|one)|next|'
  + 'more)\\b');
const LOOK = /^(?:check|look|find|search|look for|look up|see|read|show me (?:the|my|that|this|what)|get me the)\b/;
const THAT_ONE = new RegExp('^(?:the |that |this )?(?:first|second|third|fourth|fifth|last|next|top|other|same|'
  + '\\d+(?:st|nd|rd|th))?\\s*(?:one|result|link|item|page|option|product|tab)s?(?:\\s+(?:please|instead|then))?$');
const FRAGMENT = /^(?:in|on|inside|from|at|into|with|under|for)\b/;
const CHAT_WORDS = new RegExp('\\b(?:code|function|error|bug|snippet|syntax|compile|explain|meaning|translate|'
  + 'write me|essay|new chat|conversation|sidebar)\\b');

const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?…]+$/, '')
  .replace(LEAD, '').trim();

function followUp(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 300 || /\n/.test(raw)) return false;
  const t = clean(raw);
  const n = t.split(' ').length;
  if (!t || n > 25) return false;
  if (BROWSER_AND.test(t)) return true;
  if (CHAT_WORDS.test(t)) return false;
  if (QUESTION.test(t)) return /\b(?:open|go to|navigate|click|tap)\b/.test(t) && n <= 15;
  if (GO_VERB.test(t) || THAT_ONE.test(t)) return true;
  return (LOOK.test(t) || FRAGMENT.test(t)) && n <= 12;
}

// "In the logged in GitHub account" (no verb) is read with the previous message: "Go to Colon repo (In the…)".
function goalFor(text, prev) {
  const original = String(text || '').trim();
  const p = String(prev || '').replace(/\s+/g, ' ').trim();
  if (!p || p.length > 200 || !FRAGMENT.test(clean(original))) return original;
  return `${p.replace(/[.!?…]+$/, '')} (${original.replace(/[.!?…]+$/, '')})`;
}

/** messages: the conversation's messages (store.messages), the user's new one included. now: for tests. */
function route(userMsg, messages, now = Date.now()) {
  if (!userMsg || !followUp(userMsg.content) || (userMsg.attachments || []).length) return '';
  const all = messages || [];
  const at = all.findIndex((m) => m.id === userMsg.id);
  const before = all.slice(Math.max(0, (at < 0 ? all.length : at) - WINDOW), at < 0 ? all.length : at);
  const recent = before.some((m) => m.origin === 'browse' && now - new Date(m.created_at).getTime() < RECENT_MS);
  if (!recent) return '';
  const prev = [...before].reverse().find((m) => m.role === 'user' && m.content);
  return goalFor(userMsg.content, prev ? prev.content : '');
}

module.exports = { followUp, goalFor, route, RECENT_MS, WINDOW };
