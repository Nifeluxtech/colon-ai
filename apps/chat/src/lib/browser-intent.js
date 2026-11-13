/* Colon AI · what a chat message asks of this chat's browser (Phase 10, "chat-driven browsing"). The user can type
   "open the browser", "open google.com", "go to my bank site", and, while the browser is open, "search for X",
   "click the second result", "scroll down", "what does this page say": the chat opens the browser in the thread
   and Saga does it there, replying in the thread. Everything else stays an ordinary chat message, so the rules are
   narrow on purpose: a command at the start of a short message, never a question about browsers.
   Pure and DOM-free: unit-tested in packages/ui/test/browser-intent.test.js.

   parseIntent(text, { open, waiting, resumable }) -> null or one of
     { kind: 'open' }                    open the browser (this chat's own)
     { kind: 'open', url }               open a page in it
     { kind: 'close' }
     { kind: 'task', goal, open: true }  Saga does it in the browser (opening it first when it is closed)
     { kind: 'mode', mode }              'shared' ("let me help": AI + me) or 'ai' ("you do it": AI only)
     { kind: 'control', op }             take_control · return_to_ai · stop
   ctx.open: the browser is open in this chat; ctx.waiting: Saga waits for the user (a password, a code);
   ctx.resumable: the user took control of a running task. */

var SITES = {
  google: 'https://www.google.com/', youtube: 'https://www.youtube.com/', gmail: 'https://mail.google.com/',
  jumia: 'https://www.jumia.com.ng/', konga: 'https://www.konga.com/', nairaland: 'https://www.nairaland.com/',
  punch: 'https://punchng.com/', wikipedia: 'https://www.wikipedia.org/', bbc: 'https://www.bbc.com/',
  facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', twitter: 'https://x.com/',
  x: 'https://x.com/', linkedin: 'https://www.linkedin.com/', github: 'https://github.com/',
  jamb: 'https://www.jamb.gov.ng/', waec: 'https://www.waecdirect.org/', cbn: 'https://www.cbn.gov.ng/'
};
// ^(?:a|b|c)$ from phrases (each phrase is a regular expression).
function whole(list) { return new RegExp('^(?:' + list.join('|') + ')$'); }
var LEAD = new RegExp('^(?:(?:hey|hi|ok(?:ay)?|so|now|and|then)[\\s,]+)*(?:saga[\\s,:]+)?(?:(?:please|pls|kindly)\\s+)?'
  + '(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?');
var TAIL = /(?:\s+(?:please|pls|for me|now|thanks|thank you))+$/;
var BROWSER = new RegExp('^(?:the\\s+|my\\s+|a\\s+)?(?:colon\\s+)?(?:browser|web ?browser|in-?chat browser)'
  + '(?:\\s+(?:here|again|in (?:the |this )?chat))?$');
var OPEN = /^(?:open|show|launch|start|bring up|pull up)\s+(.+)$/;
var CLOSE = /^(?:close|hide|shut)\s+(?:the\s+)?(?:colon\s+)?browser$/;
var GO = /^(?:open|go to|goto|visit|navigate to|browse to|take me to|load|head to|open up)\s+(.+)$/;
var DOMAIN = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;
var PLACE = /\b(?:site|website|web ?site|portal|page|homepage|login|account|dashboard|app)\b/;
// Things done IN the browser (only while it is open in this chat).
var ACTIONS = new RegExp('^(?:search(?:\\s+for)?|look up|find|click|tap|press|select|choose|pick|scroll|swipe|'
  + 'go back|go forward|back|forward|refresh|reload|type|enter|fill(?: in)?|add (?:it |this )?to (?:cart|bag)|'
  + 'sign in|log ?in|sign up|open the (?:first|second|third|fourth|fifth|last|next|top|\\d+(?:st|nd|rd|th)) |'
  + 'read (?:this|the|that) page|summari[sz]e (?:this|the|that) page|what does (?:this|the|that) page say|'
  + 'what(?:\'s| is) on (?:this|the|that) (?:page|screen)|which (?:result|link)|'
  + 'compare (?:the )?(?:prices|results)|check (?:the )?(?:price|prices|availability|results)|copy|download|'
  + 'play|watch|zoom)\\b');
var SHARED = whole(['let me help', 'i(?:\'ll| will| want to| can) help', 'let\'?s do (?:it|this) together',
  'we(?:\'ll| will)? do (?:it|this) together', 'ai \\+ me', 'ai and me', 'ai plus me', 'switch to ai \\+ me',
  'both of us']);
var AI_ONLY = whole(['ai only', 'you do it', 'you drive', 'do it yourself', 'you take it', 'you handle it',
  'switch to ai only', 'i\'ll (?:just )?watch']);
var TAKE = whole(['take control', 'let me take (?:over|control)', 'i(?:\'ll| will) take (?:over|it from here)',
  'my turn', 'let me do it', 'hands off', 'stop,? let me(?: do it)?']);
var BACK = whole(['return to ai', 'done', 'i\'?m done', 'all done', 'continue', 'go on', 'carry on',
  'you can continue', 'ok,? continue', 'go ahead', 'entered', 'signed in', 'i(?:\'m| am) signed in', 'logged in',
  'back to you', 'your turn',
  'i(?:\'ve| have) (?:entered|typed|filled) (?:it|them|the (?:code|password|pin|details))']);
var STOP = whole(['stop', 'stop browsing', 'stop saga', 'cancel(?: it| that| the task)?', 'stop the task']);
var QUESTION = /^(?:how|why|when|where|who|is|are|do|does|did|should|what|which|can i|could i)\b/;

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?…]+$/, '').replace(LEAD, '')
    .replace(TAIL, '').trim();
}

// "google.com" -> https://google.com/ ; "www.punchng.com/news" -> https://www.punchng.com/news ; "jumia" -> map.
function siteUrl(target, original) {
  var t = target.replace(/^(?:the\s+)?/, '').replace(/\s+(?:website|site|page|homepage)$/, '').trim();
  if (SITES[t]) return SITES[t];
  if (!DOMAIN.test(t) || /\s/.test(t)) return null;
  // Keep the user's own spelling of a path (only the host is lower-cased by URL).
  var raw = (String(original || '').match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) || [t])[0];
  try { var u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch (e) { return null; }
}

function parseIntent(text, ctx) {
  ctx = ctx || {};
  var original = String(text || '').trim();
  if (!original || original.length > 300 || /\n/.test(original)) return null;
  var t = clean(original);
  if (!t || (QUESTION.test(t) && !ACTIONS.test(t))) return null;
  if (CLOSE.test(t)) return { kind: 'close' };
  var m = OPEN.exec(t);
  if (m && BROWSER.test(m[1])) return { kind: 'open' };
  if (ctx.open || ctx.waiting || ctx.resumable) {
    if (ctx.waiting || ctx.resumable) { if (BACK.test(t)) return { kind: 'control', op: 'return_to_ai' }; }
    if (STOP.test(t)) return { kind: 'control', op: 'stop' };
    if (TAKE.test(t)) return { kind: 'control', op: 'take_control' };
    if (SHARED.test(t)) return { kind: 'mode', mode: 'shared' };
    if (AI_ONLY.test(t)) return { kind: 'mode', mode: 'ai' };
  }
  var g = GO.exec(t);
  if (g) {
    var url = siteUrl(g[1], original);
    if (url) return { kind: 'open', url: url };
    // "go to my bank site", "open the JAMB portal": Saga finds it (the user may need to sign in themselves).
    if (PLACE.test(g[1]) && g[1].split(' ').length <= 8) return { kind: 'task', goal: original, open: true };
  }
  if (ctx.open && ACTIONS.test(t) && t.split(' ').length <= 40) return { kind: 'task', goal: original, open: true };
  return null;
}

export { SITES, clean, parseIntent, siteUrl };
