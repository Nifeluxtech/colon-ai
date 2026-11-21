/* Colon AI · Colon Music from the chat (Colon OS Assistant, Step 3; docs/os-assistant/step-3.md). Inside the
   Android app, "play Last Last by Burna Boy", "play my music", "play Calm Down on YouTube" and "what song is this?"
   run on the phone through ColonNative.call('music', cmd); the app checks every command (MusicRules.kt). This file
   only decides what a message asks; it never acts. Narrow like phone-intent.js: "play music", "pause", "next song"
   stay Step 2 media keys (parsePhone), and anything that reads like chat stays chat.
   Pure and DOM-free: unit-tested in packages/ui/test/music-intent.test.js.

   parseMusic(text) -> null or one of
     { action: 'identify' }                          what song is this? (Colon's player first, then the mic)
     { action: 'play', query, source }               source: any (phone, then Colon's YouTube player) · phone ·
                                                     youtube · audiomack (open there directly); query '*' = all
     { action: 'watch', query }                      0.22.0: any YouTube video in Colon's card (never the phone)
   playLast(text): "play it" / "play that song" (the song Colon just named; music-chat.js checks the time). */

import { clean } from './browser-intent.js';
import { parsePhone } from './phone-intent.js';

var SONG = '(?:song|track|music|tune|tune playing|sound)';
var IDENTIFY = new RegExp('^(?:' + [
  'what(?:\'s|s| is)\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+(?:playing|called|now|playing now))?',
  'what\\s+(?:song|track|music)\\s+is\\s+(?:this|that|playing)(?:\\s+(?:now|right now))?',
  'what(?:\'s|s| is)\\s+playing(?:\\s+(?:now|right now))?',
  '(?:name|identify|recogni[sz]e|shazam|find)\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+(?:playing|for me))?',
  'who\\s+(?:sings|sang|is singing)\\s+(?:this|that)(?:\\s+song)?',
  'what(?:\'s|s| is)\\s+the\\s+(?:name|title)\\s+of\\s+(?:this|that|the)\\s+' + SONG + '(?:\\s+playing)?'
].join('|') + ')$');
var ALL = new RegExp('^(?:play|shuffle)\\s+(?:(?:all\\s+)?(?:my|some|all)\\s+(?:music|songs|tracks)|'
  + '(?:music|songs)\\s+(?:from|on)\\s+my\\s+phone|all\\s+(?:my\\s+)?songs)$');
var PLAY = new RegExp('^(?:play|put on|can you play|please play)\\s+(.+?)'
  + '(?:\\s+(?:on|from|in|with)\\s+(youtube|audiomack|my phone|the phone|this phone))?$');
var NOT_MUSIC = new RegExp('\\b(?:game|games|chess|football|ball|cards|a role|with me|along|dead|fair|it safe|'
  + 'it cool|smart|the fool|a trick|tricks|a joke|jokes)\\b');
// 0.22.0: "watch X", "show me the video of X", "play the video of X", "watch X on YouTube".
var WATCH = new RegExp('^(?:(?:can you |let me |i want to |i wanna )?watch|(?:show|play|find)(?: me)? '
  + '(?:the |a )?(?:music )?video (?:of|for))\\s+(.+?)(?:\\s+(?:on|from) youtube)?$');
var NOT_WATCH = new RegExp('^(?:out|it|this|that|me|us|you|him|her|them|over|yourself|myself|my|your|his|our|'
  + 'their|the kids|the baby|the time|the clock|something|anything|a movie|movies|tv|television|netflix)\\b');
var PLAY_IT = new RegExp('^(?:play|put on)\\s+(?:it|that|this|that song|this song|the song|it for me|that for me)'
  + '(?:\\s+(?:now|on youtube|again))?$');
var MEDIA_WORDS = /^(?:it|this|that|again|something|anything|music|a song|songs?|the (?:song|music|track))$/;

function strip(text) {
  var t = clean(text).replace(/^(?:hey\s+|hi\s+|ok(?:ay)?\s+)?colon[\s,:]+/, '');
  return t.replace(/[.!?…]+$/, '').replace(/^(?:please\s+)/, '').replace(/\s+/g, ' ').trim();
}

function parseMusic(text) {
  var raw = String(text || '');
  if (!raw.trim() || raw.length > 160) return null;
  var t = strip(raw), m;
  if (!t) return null;
  if (IDENTIFY.test(t)) return { action: 'identify' };
  if (/\?\s*$/.test(raw)) return null;   // other questions are chat ("can you play the guitar?")
  var w = WATCH.exec(t);
  if (w) {
    var what = w[1].replace(/^(?:the\s+|a\s+)?(?:music\s+)?videos?\s+(?:of|for|about)\s+/, '').trim();
    if (!what || what.length > 120 || NOT_WATCH.test(what)) return null;   // "watch out", "watch my back"
    return { action: 'watch', query: what };
  }
  if (ALL.test(t)) return { action: 'play', query: '*', source: 'phone' };
  var phone = parsePhone(raw);
  if (phone && phone.action === 'media') return null;   // "play music", "next song": Step 2 media keys
  if (!(m = PLAY.exec(t))) return null;
  var query = m[1].replace(/^(?:me\s+|the\s+song\s+|the\s+track\s+|a\s+song\s+called\s+|song\s+)/, '').trim();
  if (!query || query.length > 120 || MEDIA_WORDS.test(query) || NOT_MUSIC.test(query)) return null;
  var where = m[2] || '';
  var source = /youtube/.test(where) ? 'youtube' : /audiomack/.test(where) ? 'audiomack' : where ? 'phone' : 'any';
  return { action: 'play', query: query, source: source };
}

var DOCK = [
  ['pause', /^(?:pause|hold on|pause (?:it|the (?:music|song|video))|pause music)$/],
  ['resume', /^(?:resume|continue|unpause|play|play it|resume (?:it|the (?:music|song)))$/],
  ['forward', /^(?:forward|fast forward|fast-forward|skip ahead|go forward|forward (?:it|10|ten)(?: seconds)?)$/],
  ['back', /^(?:back|rewind|go back|rewind (?:it|a bit|5|five)(?: seconds)?|back (?:a bit|5|five)(?: seconds)?)$/],
  ['stop', /^(?:stop|stop (?:it|music|the (?:music|song|video|player))|close (?:the )?(?:player|music))$/]
];

/** While Colon's video card is open: 'pause' · 'resume' · 'forward' (+10 s) · 'back' (-5 s) · 'stop' for a short
    command, else null. 0.22.0: no 'next' (the card has no Next button). */
function dockWord(text) {
  var t = strip(String(text || '').slice(0, 60));
  for (var i = 0; i < DOCK.length; i++) if (DOCK[i][1].test(t)) return DOCK[i][0];
  return null;
}

/** What the user hears or reads when the phone answers with an error code. */
function musicError(code) {
  switch (code) {
    case 'no_match': return 'I couldn’t recognise that song. Try again closer to the music.';
    case 'no_mic': return 'I couldn’t use the microphone just now.';
    case 'denied': return 'I need the microphone to hear the song.';
    case 'no_library': return 'I need permission to see the music on your phone.';
    case 'not_found': return 'I couldn’t find that song.';
    case 'no_app': return 'No app on this phone can open that.';
    case 'timeout': return 'That took too long. Try again.';
    case 'handed_off': return 'Opening Shazam to listen.';
    default: return 'That didn’t work on the phone.';
  }
}

/** "play it" / "play that song": true when the message asks to play the song Colon just named. */
function playLast(text) {
  var raw = String(text || '');
  if (raw.length > 60 || /\?\s*$/.test(raw)) return false;
  return PLAY_IT.test(strip(raw));
}

export { dockWord, musicError, parseMusic, playLast };
