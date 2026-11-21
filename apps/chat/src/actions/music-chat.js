/* Colon AI · Colon Music from the chat (Colon OS Assistant, Step 3; docs/os-assistant/step-3.md). "play X" plays the
   best match from the phone's own songs (Android app, feature "music"); with none (or on the web), Colon finds it on
   YouTube (GET /music/search) and plays it in its own video card in the chat (components/music-dock.js, since
   v0.21.0). When that can't play it, the card stays and says why (0.21.1); "on Audiomack" opens Audiomack.
   "pause", "forward", "back", "stop the music" control that player while it is open. 0.22.0: the card sits in the
   chat; "watch X" plays any YouTube video there (never the phone's songs). "What song is this?" answers from that
   card when it is playing; otherwise the phone answers from Colon's own player first and listens with the mic only
   when the player is idle (Step 4: songprint, then the Shazam app). "play it" within 10 minutes plays the song
   Colon just named. Music that starts ends hands-free so Colon doesn't listen over it. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { closeMusicDock, controlMusicDock, musicDockError, musicDockNow, musicDockOpen, playOnYouTube }
  from '../components/music-dock.js';
import { S } from '../core/state.js';
import { dockWord, musicError, parseMusic, playLast } from '../lib/music-intent.js';

var RECENT_MS = 10 * 60 * 1000;
var named = null;   // the last song Colon named: { query, at }

function handsFree() { return !!(S.hf && S.hf.active()); }
function onPhone() { return Colon.native.can('music'); }

function finish(say, ok, stopsHandsFree) {
  Colon.toast(say, ok ? 'ok' : 'bad');
  Colon.native.haptic(ok ? 'confirm' : 'reject');
  if (!handsFree()) return;
  if (stopsHandsFree && ok) S.hf.stop();
  else S.hf.replyDone({ status: 'complete' }, say);
}

function music(args) { return Colon.native.call('music', args); }

/** The song's page on YouTube or Audiomack: the app on the phone, a new tab on the web. */
function openOn(service, query) {
  if (!onPhone()) {
    var url = service === 'audiomack' ? 'https://audiomack.com/search?q=' + encodeURIComponent(query)
      : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    window.open(url, '_blank', 'noopener');
    finish('Opening it on ' + (service === 'audiomack' ? 'Audiomack.' : 'YouTube.'), true, true);
    return;
  }
  music({ action: 'open', service: service, query: query }).then(function (r) {
    finish((r && r.say) || 'Opening it.', true, true);
  }, function (e) { finish(musicError(e && e.code), false, false); });
}

/** Find it on YouTube and play it in Colon's player; the YouTube app (or a tab) when that can't. */
function youtube(query, kind) {
  var url = '/music/search?q=' + encodeURIComponent(query) + (kind === 'video' ? '&kind=video' : '');
  Colon.api(url).then(function (d) {
    var tracks = (d && d.tracks) || [];
    if (!tracks.length) {
      finish(kind === 'video' ? 'I couldn’t find that video.' : musicError('not_found'), false, false); return; }
    if (onPhone()) music({ action: 'stop' }).catch(function () { /* nothing was playing */ });
    playOnYouTube(tracks).then(function (ok) {
      // On failure the card stays with its YouTube button; Colon doesn't leave the app by itself (0.21.1).
      if (ok) finish('Playing ' + tracks[0].title + '.', true, true);
      else finish('YouTube won’t play it inside Colon (' + musicDockError() + '). Tap the YouTube button to open it.',
        false, false);
    });
  }, function (e) {
    var why = (e && (e.message || e.code)) || 'no answer';
    finish('Couldn’t search YouTube: ' + why + (e && e.code ? ' (' + e.code + ')' : ''), false, false);
  });
}

function play(cmd) {
  if (cmd.source === 'audiomack') { openOn('audiomack', cmd.query); return; }
  if (cmd.source === 'youtube' || !onPhone()) {
    if (cmd.source === 'phone' || cmd.query === '*') { finish(musicError('no_library'), false, false); return; }
    youtube(cmd.query); return;
  }
  music({ action: 'play', query: cmd.query, source: cmd.source === 'phone' ? 'phone' : 'any' }).then(function (r) {
    closeMusicDock();
    finish((r && r.say) || 'Playing.', true, true);
  }, function (e) {
    var code = e && e.code;
    if (code !== 'not_found' && code !== 'no_library') { finish(musicError(code), false, false); return; }
    if (cmd.source === 'phone' || cmd.query === '*') { finish(musicError(code), false, false); return; }
    youtube(cmd.query);
  });
}

function remember(title, artist) {
  var q = [title, artist].filter(Boolean).join(' ').trim();
  named = q ? { query: q.slice(0, 120), at: Date.now() } : null;
}

/** Colon's video card first (no mic), then the phone (its player, then the mic; Step 4 may hand off to Shazam). */
function identify() {
  var now = musicDockNow();
  if (now && now.playing) {
    remember(now.title, now.channel);
    finish('That’s ' + now.title + (now.channel ? ', from ' + now.channel : '') + ', playing in Colon.', true, false);
    return true;
  }
  if (!onPhone()) return false;
  music({ action: 'identify' }).then(function (r) {
    if (r && r.title && r.code !== 'handed_off') remember(r.title, r.artist);
    finish((r && r.say) || 'Got it.', true, false);
  }, function (e) { finish(musicError(e && e.code), false, false); });
  return true;
}

/** The composer's text before it is sent: true when it was a music command (handled here), false otherwise. */
function handleMusicText(text) {
  var word = musicDockOpen() && dockWord(text);
  if (word && controlMusicDock(word)) { Colon.toast(word === 'stop' ? 'Stopped.' : 'Okay.', 'ok'); return true; }
  if (named && Date.now() - named.at < RECENT_MS && playLast(text)) { youtube(named.query); return true; }
  var cmd = parseMusic(text);
  if (!cmd) return false;
  if (cmd.action === 'identify') return identify();
  if (cmd.action === 'watch') youtube(cmd.query, 'video'); else play(cmd);
  return true;
}

export { handleMusicText };
