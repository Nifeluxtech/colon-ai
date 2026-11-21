/* Colon AI · Colon Music from the chat (Colon OS Assistant, Step 3; docs/os-assistant/step-3.md). Inside the
   Android app, "play Last Last by Burna Boy", "play my music", "play Calm Down on YouTube" and "what song is this?"
   run on the phone through ColonNative.call('music', cmd); the app checks every command (MusicRules.kt). This file
   only decides what a message asks; it never acts. Narrow like phone-intent.js: "play music", "pause", "next song"
   stay Step 2 media keys (parsePhone), and anything that reads like chat stays chat.
   Pure and DOM-free: unit-tested in packages/ui/test/music-intent.test.js; the phrases themselves are
   lib/command-phrases.js (0.22.1, shared by typed and spoken commands).

   parseMusic(text) -> null or one of
     { action: 'identify' }                          what song is this? (Colon's player first, then the mic)
     { action: 'play', query, source }               source: any (phone, then Colon's YouTube player) · phone ·
                                                     youtube · audiomack (open there directly); query '*' = all
     { action: 'watch', query }                      0.22.0: any YouTube video in Colon's card (never the phone)
   playLast(text): "play it" / "play that song" (the song Colon just named; music-chat.js checks the time). */

import { dockWord, matchCommand, playLast } from './command-phrases.js';
import { parsePhone } from './phone-intent.js';

function mediaKey(raw) { var p = parsePhone(raw); return !!(p && p.action === 'media'); }

/** 0.22.1: the phrases live in command-phrases.js (one matcher for typed and spoken commands). */
function parseMusic(text) { return matchCommand(text, mediaKey); }

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

export { dockWord, musicError, parseMusic, playLast };
