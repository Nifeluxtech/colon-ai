/* Colon AI · the one phrase matcher for watch, play and player commands (0.22.1). Typed in the chat or spoken (the
   Android app's voice input, voice mode over other apps and, from 0.23.0, "Hey Colon" all reach the same chat page),
   a message goes through normalize() and then matchCommand(). Case-insensitive; filler words ("um", "please", "for
   me"…) and punctuation are removed first, so "Um, can you play Essence, please?" is "can you play essence".
   Narrow on purpose: chat stays chat ("watch out", "what should I watch", "I watched it yesterday").
   Pure and DOM-free: table-driven tests in packages/ui/test/command-phrases.test.js.

   matchCommand(text) -> null or one of
     { action: 'identify' }                       what song is this?
     { action: 'watch', query }                   any YouTube video in Colon's card (never the phone's songs)
     { action: 'play', query, source }            source: any · phone · youtube · audiomack; query '*' = all
   dockWord(text): 'pause' · 'resume' · 'forward' · 'back' · 'stop' (only used while a video card plays)
   playLast(text): "play it" / "play that song" (the song Colon just named) */

var WAKE = /^(?:(?:hey|hi|hello|ok|okay|yo)\s+)?colon\s+/;
var LEAD = /^(?:(?:um+|uh+|erm+|hmm+|ah+|so|okay|ok|well|hey|yo|please|just|now|alright|right)\s+)+/;
var TAIL = /(?:\s+(?:please|for me|now|right now|thanks|thank you|pls|abeg|sharp sharp))+$/;
var FILLER = /\b(?:um+|uh+|erm+|hmm+)\b/g;

/** Lower case, no punctuation, no wake word or filler words, single spaces. */
function normalize(text) {
  var t = String(text || '').toLowerCase().replace(/[’‘`]/g, '\'')
    .replace(/[.,!?;:"“”…()[\]{}]+/g, ' ').replace(/\s+-\s+/g, ' ').replace(/'/g, '').replace(FILLER, ' ')
    .replace(/\s+/g, ' ').trim();
  for (var i = 0; i < 3; i++) t = t.replace(WAKE, '').replace(LEAD, '').replace(TAIL, '').trim();
  return t;
}

var SONG = '(?:song|track|music|tune|tune playing|sound)';
var IDENTIFY = new RegExp('^(?:' + [
  'whats?\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+(?:playing|called|now|playing now))?',
  'what is\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+(?:playing|called|now|playing now))?',
  'what\\s+(?:song|track|music)\\s+is\\s+(?:this|that|playing)(?:\\s+(?:now|right now))?',
  '(?:whats|what is)\\s+playing(?:\\s+(?:now|right now))?',
  '(?:name|identify|recogni[sz]e|shazam|find)\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+(?:playing|for me))?',
  'shazam (?:this|that)',
  '(?:who\\s+(?:sings|sang|is singing)|whos singing)\\s+(?:this|that)(?:\\s+song)?',
  '(?:whats|what is)\\s+the\\s+(?:name|title)\\s+of\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+playing)?'
].join('|') + ')$');

// "can you", "I want to", "let's"… in front of the verb.
var POLITE = '(?:(?:can|could|would|will) you |(?:can|could|may) i |i (?:want|need|would like) to |i wanna |'
  + 'id like to |i would love to |let me |lets |let us |go ahead and |i feel like )?';
var VIDEO_OF = '(?:the |a |some )?(?:music |full )?videos? (?:of|for|about|on)\\s+';
var WATCH = [
  // watch X · let's watch X · I wanna watch X · watch the video of X
  new RegExp('^' + POLITE + 'watch (?:' + VIDEO_OF + ')?(.+?)(?: (?:on|from) youtube)?$'),
  // show me / play / find / put on the video of X
  new RegExp('^' + POLITE + '(?:show(?: me)?|play(?: me)?|find(?: me)?|put on|pull up|get me|open) ' + VIDEO_OF
    + '(.+?)(?: (?:on|from) youtube)?$'),
  // show me X video · play X video · put on X music video
  new RegExp('^' + POLITE + '(?:show me|play(?: me)?|put on|pull up|find(?: me)?|get me) (?:the |a )?(.+?) '
    + '(?:music |official )?video$'),
  // open / find / show me / search X on YouTube
  new RegExp('^' + POLITE + '(?:open|find|show me|search(?: for)?|look up|pull up|bring up|get me) (.+?) '
    + '(?:on|in|from) youtube$'),
  // search youtube for X · youtube X
  new RegExp('^' + POLITE + '(?:search|check) youtube for (.+)$'),
  // can you show me X (only with "can you": a bare "show me X" stays chat)
  /^(?:can|could|would|will) you show me (.+)$/,
  // put on X (but "put on X song" is music)
  new RegExp('^' + POLITE + 'put on (?!' + '(?:it|that|this)\\b)(.+?)(?<! song| track| music| tune| playlist)$')
];
var NOT_WATCH = new RegExp('^(?:out|it|this|that|these|those|me|us|you|him|her|them|over|yourself|myself|my|your|'
  + 'his|our|their|the kids|the baby|the time|the clock|something|anything|a movie|movies|tv|television|netflix|'
  + 'the news later|where|what|when|why|which|who|whether|if|your step|the way|directions|the route|'
  + 'some ?thing|the settings|settings|around)\\b|\\b(?:settings|later|tomorrow|tonight|yesterday)$|'
  + '^(?:the|a|an|some|video|videos|music|youtube)$');

var ALL = new RegExp('^(?:play|shuffle)\\s+(?:(?:all\\s+)?(?:my|some|all)\\s+(?:music|songs|tracks)|'
  + '(?:music|songs)\\s+(?:from|on)\\s+my\\s+phone|all\\s+(?:my\\s+)?songs)$');
var PLAY = new RegExp('^' + POLITE + '(?:play(?: me| us)?|put on|listen to|hear|play the song|blast|bump)\\s+(.+?)'
  + '(?:\\s+(?:on|from|in|with)\\s+(youtube|audiomack|my phone|the phone|this phone))?$');
var NOT_MUSIC = new RegExp('\\b(?:game|games|chess|football|ball|cards|a role|with me|along|dead|fair|it safe|'
  + 'it cool|smart|the fool|a trick|tricks|a joke|jokes|guitar|piano|drums?|violin|keyboard|saxophone|trumpet|'
  + 'flute|an instrument|instruments?|outside|hide and seek|ludo|whot|draughts|scrabble|monopoly|me out)\\b|'
  + '^(?:me|us|him|her|them|myself|yourself|reason|your heart)$');
var MEDIA_WORDS = /^(?:it|this|that|again|something|anything|music|a song|songs?|the (?:song|music|track))$/;
var PLAY_IT = new RegExp('^(?:play|put on)\\s+(?:it|that|this|that song|this song|the song|it for me|that for me)'
  + '(?:\\s+(?:on youtube|again))?$');

function watchQuery(t) {
  for (var i = 0; i < WATCH.length; i++) {
    var w = WATCH[i].exec(t);
    if (!w) continue;
    var what = w[1].replace(new RegExp('^' + VIDEO_OF), '').replace(/^some /, '')
      .replace(/\s+(?:on|from) youtube$/, '').trim();
    if (!what || what.length > 120 || NOT_WATCH.test(what)) return null;   // "watch out", "watch your words"
    return what;
  }
  return null;
}

/** media(t): true when the message is a Step 2 media key ("play music", "next song"); phone-intent decides. */
function matchCommand(text, media) {
  var raw = String(text || '');
  if (!raw.trim() || raw.length > 200) return null;
  var t = normalize(raw), m;
  if (!t) return null;
  if (IDENTIFY.test(t)) return { action: 'identify' };
  var w = watchQuery(t);
  if (w) return { action: 'watch', query: w };
  if (ALL.test(t)) return { action: 'play', query: '*', source: 'phone' };
  if (media && media(raw)) return null;   // "play music", "next song": Step 2 media keys
  if (!(m = PLAY.exec(t))) return null;
  var query = m[1].replace(/^(?:me\s+|the\s+song\s+|the\s+track\s+|a\s+song\s+called\s+|song\s+|some\s+)/, '')
    .replace(/\s+(?:song|track|tune)$/, '').trim();
  if (!query || query.length > 120 || MEDIA_WORDS.test(query) || NOT_MUSIC.test(query)) return null;
  var where = m[2] || '';
  var source = /youtube/.test(where) ? 'youtube' : /audiomack/.test(where) ? 'audiomack' : where ? 'phone' : 'any';
  return { action: 'play', query: query, source: source };
}

var DOCK = [
  ['pause', /^(?:pause|hold on|wait|pause (?:it|this|that|the (?:music|song|video|player))|pause music)$/],
  ['resume', /^(?:resume|continue|unpause|play|play it|keep playing|resume (?:it|the (?:music|song|video)))$/],
  ['forward', new RegExp('^(?:forward|fast forward|fast-forward|skip ahead|skip forward|go forward|jump ahead|'
    + 'forward (?:it|10|ten)(?: seconds)?)$')],
  ['back', new RegExp('^(?:back|rewind|go back|skip back|jump back|rewind (?:it|a bit|5|five)(?: seconds)?|'
    + 'back (?:a bit|5|five)(?: seconds)?)$')],
  ['stop', /^(?:stop|stop (?:it|this|music|the (?:music|song|video|player))|close (?:the )?(?:player|music|video))$/]
];

/** While Colon's video card plays: 'pause' · 'resume' · 'forward' (+10 s) · 'back' (-5 s) · 'stop', else null. */
function dockWord(text) {
  var raw = String(text || '');
  if (raw.length > 60) return null;
  var t = normalize(raw);
  for (var i = 0; i < DOCK.length; i++) if (DOCK[i][1].test(t)) return DOCK[i][0];
  return null;
}

/** "play it" / "play that song": true when the message asks to play the song Colon just named. */
function playLast(text) {
  var raw = String(text || '');
  if (raw.length > 60 || /\?\s*$/.test(raw)) return false;
  return PLAY_IT.test(normalize(raw));
}

export { dockWord, matchCommand, normalize, playLast };
