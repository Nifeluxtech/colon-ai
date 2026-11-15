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
     { kind: 'continue' }                0.10.4: Saga carries on with the chat's last task (it ended or was cut off)
   ctx.open: the browser is open in this chat; ctx.waiting: Saga waits for the user (a password, a code);
   ctx.resumable: the user took control of a running task; ctx.ended (0.10.4): the chat's last Saga task ended
   (its card offers Continue); ctx.busy: a Saga task is running now.
   0.10.4: "reshow / show / reopen / bring back the browser", "where is the browser", "I can't see the browser"
   open (show) this chat's browser; "continue", "carry on", "I've logged in, continue"… after a task ended continue
   it. These never reach the chat model as plain chat.
   0.11.2 (owner): a message that needs the browser opens it by itself, no "open the browser" first (needsBrowser):
   a live web search ("search for…", "google…", "look … up online"), checking or visiting a site ("check yolotask",
   "see what's new on nairaland", any message naming a domain with something to do there), signing in ("log in to
   github"), filling a form, comparing prices, buying / booking / finding on a named site, and a question about a
   named site's live data ("how much is rice on jumia?"). Ordinary questions stay chat.
   0.11.3 (owner): after a browser task in this chat, on any site (ctx.recent: the chat has a Saga run, or ctx.open), a
   message that plausibly continues it is a Saga task in the same browser session, whatever specialist the chat is in
   ({ follow: true }): open / go to / click / select / scroll / next / more, check / find / look for / read…, "that
   one", "the second result", "continue", or a fragment like "in the logged in account" (read with the user's
   previous message, ctx.prev). "open the browser and check…" is a task anywhere. Code and explain requests stay chat.
   */

var SITES = {
  google: 'https://www.google.com/', youtube: 'https://www.youtube.com/', gmail: 'https://mail.google.com/',
  jumia: 'https://www.jumia.com.ng/', konga: 'https://www.konga.com/', nairaland: 'https://www.nairaland.com/',
  punch: 'https://punchng.com/', wikipedia: 'https://www.wikipedia.org/', bbc: 'https://www.bbc.com/',
  facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', twitter: 'https://x.com/',
  x: 'https://x.com/', linkedin: 'https://www.linkedin.com/', github: 'https://github.com/',
  jamb: 'https://www.jamb.gov.ng/', waec: 'https://www.waecdirect.org/', cbn: 'https://www.cbn.gov.ng/',
  yolotask: 'https://yolotask.com.ng/'
};
// ^(?:a|b|c)$ from phrases (each phrase is a regular expression).
function whole(list) { return new RegExp('^(?:' + list.join('|') + ')$'); }
var LEAD = new RegExp('^(?:(?:hey|hi|ok(?:ay)?|so|now|and|then)[\\s,]+)*(?:saga[\\s,:]+)?(?:(?:please|pls|kindly)\\s+)?'
  + '(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?');
var TAIL = /(?:\s+(?:please|pls|for me|now|thanks|thank you))+$/;
var BROWSER = new RegExp('^(?:the\\s+|my\\s+|a\\s+|this chat\'?s\\s+|that\\s+)?(?:colon\\s+)?(?:saga\'?s\\s+)?'
  + '(?:browser|web ?browser|in-?chat browser|browser card)'
  + '(?:\\s+(?:here|again|back|up|for me|in (?:the |this )?chat))*$');
// 0.10.4: "where is the browser?", "I can't see the browser": show it.
var LOST = new RegExp('^(?:where(?:\'s| is| did)|i (?:can\'?t|cannot|don\'?t) see|i lost)\\s+(?:the |my )?(?:colon )?'
  + '(?:in-?chat )?browser(?:\\s+(?:go|gone|again|card))*$');
// 0.10.4: carrying on with the chat's last task once it ended (a wait for the user is a hand-back instead, BACK).
var CONTINUE = whole(['continue', 'carry on', 'go on', 'keep going', 'resume', 'proceed', 'try again', 'retry',
  'continue (?:the task|browsing|in the browser|where you stopped|where you left off|from where you stopped)',
  'pick up where you left off', 'finish (?:it|the task)']);
var CONTINUE_IN = /\b(?:continue|carry on|go on|keep going|resume|proceed|pick up where)\b/;
var OPEN = new RegExp('^(?:open|show(?: me)?|launch|start|bring up|pull up|bring back|bring|re-?show|re-?open|display|'
  + 'unhide|open up|give me)\\s+(.+)$');
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
// 0.11.2: things that need the live web, with the browser closed or open.
var LIVE = new RegExp('^(?:' + [
  '(?:search|browse)(?:\\s+(?:the web|the internet|online|google|the net))?(?:\\s+for)?',
  'google', 'look (?:\\S+ )*up (?:online|on the web|on google)',
  '(?:sign|log) ?(?:in|on)(?:to)?(?: to| into| on| at)?', 'login(?: to| into| on| at)?',
  'sign up(?: on| at| for| with)?', 'register (?:on|at|with)',
  'compare (?:the )?(?:prices?|deals|offers|rates)',
  'check (?:the )?(?:price|prices|availability|stock|status) (?:of|for|on)'].join('|') + ')\\s+\\S');
var FORM = /^fill (?:in|out) (?:the |a |my |this )?(?:\S+ ){0,3}(?:form|application|registration)\b/;
var CHECK = new RegExp("^(?:check|check out|look at|browse|see what'?s (?:new |happening )?on|what'?s new on|"
  + "check what'?s (?:new )?on)\\s+(.+)$");
var SHOP = /^(?:find|buy|order|book|get|search|show me|look for)\b/;
var LIVE_Q = /\b(?:price|prices|cost|how much|in stock|available|availability|latest|today|right now|currently|new)\b/;
// 0.11.3: follow-ups to a browser task (only with ctx.open or ctx.recent). Generic: any site, nothing site-specific.
var BROWSER_AND = new RegExp("^(?:open|show|launch|use|bring up)\\s+(?:the |my |this chat'?s )?(?:colon )?browser"
  + '\\s+(?:and|to|then)\\s+\\S');
var GO_VERB = new RegExp('^(?:open|go(?! ahead| on\\b)|goto|visit|navigate|browse|take me|head|click|tap|press|select|'
  + 'choose|pick|scroll|swipe|sign out|log ?out|refresh|reload|switch to|add (?:it|this|that|one)|next|more)\\b');
var LOOK = /^(?:check|look|find|search|look for|look up|see|read|show me (?:the|my|that|this|what)|get me the)\b/;
var THAT_ONE = new RegExp('^(?:the |that |this )?(?:first|second|third|fourth|fifth|last|next|top|other|same|\\d+(?:st'
  + '|nd|rd|th))?\\s*(?:one|result|link|item|page|option|product|tab)s?(?:\\s+(?:please|instead|then))?$');
var FRAGMENT = /^(?:in|on|inside|from|at|into|with|under|for)\b/;
var CHAT_WORDS = new RegExp('\\b(?:code|function|error|bug|snippet|syntax|compile|explain|meaning|translate|'
  + 'write me|essay|new chat|conversation|sidebar)\\b');
var ONLINE = /\b(?:online|on the (?:web|internet)|live on|on google)\b/;

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

// A site the text names: a known one (SITES, a whole word) or a domain.
function namesSite(t) {
  return Object.keys(SITES).some(function (k) { return k.length > 1 && new RegExp('\\b' + k + '\\b').test(t); })
    || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ng|org|net|io|gov|edu|co|app|dev|info|me)(?:\.[a-z]{2})?\b/.test(t);
}

/** 0.11.2: does this message need the live browser (cleaned text t)? */
function needsBrowser(t) {
  if (t.split(' ').length > 40) return false;
  if (QUESTION.test(t)) return namesSite(t) && LIVE_Q.test(t) || ONLINE.test(t) && LIVE_Q.test(t);
  if (LIVE.test(t) || FORM.test(t)) return true;
  var c = CHECK.exec(t);
  if (c) return namesSite(c[1]) || PLACE.test(c[1]) || ONLINE.test(c[1]);
  return SHOP.test(t) && (namesSite(t) || ONLINE.test(t));
}

/** 0.11.3: a follow-up to this chat's browser task (cleaned text t; only asked with ctx.open or ctx.recent). */
function followUp(t) {
  var n = t.split(' ').length;
  if (n > 25 || CHAT_WORDS.test(t)) return false;
  if (QUESTION.test(t)) return /\b(?:open|go to|navigate|click|tap)\b/.test(t) && n <= 15;
  if (GO_VERB.test(t) || THAT_ONE.test(t)) return true;
  return (LOOK.test(t) || FRAGMENT.test(t)) && n <= 12;
}

function parseIntent(text, ctx) {
  ctx = ctx || {};
  var original = String(text || '').trim();
  if (!original || original.length > 300 || /\n/.test(original)) return null;
  var t = clean(original);
  if (!t) return null;
  if (QUESTION.test(t) && !ACTIONS.test(t) && !LOST.test(t)) return needsBrowser(t) ? { kind: 'task', goal: original,
    open: true } : null;
  if (CLOSE.test(t)) return { kind: 'close' };
  if (BROWSER_AND.test(t)) return { kind: 'task', goal: original, open: true, follow: true };
  var m = OPEN.exec(t);
  if ((m && BROWSER.test(m[1])) || LOST.test(t)) return { kind: 'open' };
  // 0.10.4: the chat's last task ended (or was cut off): "continue", "I've logged in, continue" carry it on.
  if (ctx.ended && !ctx.waiting && !ctx.resumable && !ctx.busy && (CONTINUE.test(t) || (CONTINUE_IN.test(t)
    && t.split(' ').length <= 12))) return { kind: 'continue' };
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
  if ((ctx.open || ctx.recent) && followUp(t)) return { kind: 'task', goal: withPrev(original, t, ctx.prev),
    open: true, follow: true };
  return needsBrowser(t) ? { kind: 'task', goal: original, open: true } : null;
}

// 0.11.3: "In the logged in GitHub account" (no verb) carries the previous message: "Go to Colon repo (in the…)".
function withPrev(original, t, prev) {
  var p = String(prev || '').replace(/\s+/g, ' ').trim();
  if (!p || p.length > 200 || !FRAGMENT.test(t)) return original;
  return p.replace(/[.!?…]+$/, '') + ' (' + original.replace(/[.!?…]+$/, '') + ')';
}

export { SITES, clean, followUp, needsBrowser, parseIntent, siteUrl };
