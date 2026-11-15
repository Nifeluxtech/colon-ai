// 0.11.5: FALLBACK ONLY. The chat model now decides itself whether to browse (browser-tools.js, Gemini function
// calling); these keyword rules run only when the tool models fail (no key, quota, errors), so routing is never worse
// than 0.11.4. With a browser session in the chat (session) a follow-up counts even without a recent browser turn,
// and starts() (the app's 0.11.2 needsBrowser, moved here) opens the browser for a first "log in to github".
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

// 0.11.2's needsBrowser (from the app): a message that needs the live web, with or without a browser session.
const LIVE = new RegExp('^(?:(?:search|browse)(?:\\s+(?:the web|the internet|online|google|the net))?(?:\\s+for)?|'
  + 'google|look (?:\\S+ )*up (?:online|on the web|on google)|(?:sign|log) ?(?:in|on)(?:to)?(?: to| into| on| at)?|'
  + 'login(?: to| into| on| at)?|sign up(?: on| at| for| with)?|register (?:on|at|with)|compare (?:the )?(?:prices?|'
  + 'deals|offers|rates)|check (?:the )?(?:price|prices|availability|stock|status) (?:of|for|on))\\s+\\S');
const SITE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ng|org|net|io|gov|edu|co|app|dev|info|me)(?:\.[a-z]{2})?\b/;
const SITE_ACT = /^(?:open|go to|visit|check|check out|find|buy|order|book|search|look for|show me)\b/;
function starts(text) {
  const t = clean(text);
  if (!t || t.split(' ').length > 40 || CHAT_WORDS.test(t)) return false;
  return LIVE.test(t) || /^fill (?:in|out) (?:\S+ ){0,4}(?:form|application|registration)\b/.test(t)
    || (SITE_ACT.test(t) && SITE.test(t));
}

/** messages: the conversation's messages (store.messages), the user's new one included. now: for tests.
 *  session (0.11.5): the chat has a browser session now (a page open or a recent Saga task). */
function route(userMsg, messages, now = Date.now(), session = false) {
  if (!userMsg || (userMsg.attachments || []).length) return '';
  if (!followUp(userMsg.content)) return starts(userMsg.content) ? String(userMsg.content).trim() : '';
  const all = messages || [];
  const at = all.findIndex((m) => m.id === userMsg.id);
  const before = all.slice(Math.max(0, (at < 0 ? all.length : at) - WINDOW), at < 0 ? all.length : at);
  const recent = session || before.some((m) => m.origin === 'browse'
    && now - new Date(m.created_at).getTime() < RECENT_MS);
  if (!recent) return '';
  const prev = [...before].reverse().find((m) => m.role === 'user' && m.content);
  return goalFor(userMsg.content, prev ? prev.content : '');
}

module.exports = { followUp, goalFor, route, starts, RECENT_MS, WINDOW };
