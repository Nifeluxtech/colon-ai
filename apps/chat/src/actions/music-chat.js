/* Colon AI · Colon Music from the chat (Colon OS Assistant, Step 3; docs/os-assistant/step-3.md). "play X" plays the
   best match from the phone's own songs (Android app, feature "music"); with none (or on the web), Colon finds it on
   YouTube (GET /music/search) and plays it in its own YouTube player above the composer (components/music-dock.js,
   v0.21.0). When that can't play it, the song opens in the YouTube app (or Audiomack when asked). "pause", "next",
   "stop the music" control that player while it is open. "What song is this?" asks the phone, which answers from
   Colon's own player first and listens with the mic only when the player is idle. Music that starts ends
   hands-free so Colon doesn't listen over it. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { closeMusicDock, controlMusicDock, musicDockOpen, playOnYouTube } from '../components/music-dock.js';
import { S } from '../core/state.js';
import { dockWord, musicError, parseMusic } from '../lib/music-intent.js';

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
function youtube(query) {
  Colon.api('/music/search?q=' + encodeURIComponent(query)).then(function (d) {
    var tracks = (d && d.tracks) || [];
    if (!tracks.length) { finish(musicError('not_found'), false, false); return; }
    if (onPhone()) music({ action: 'stop' }).catch(function () { /* nothing was playing */ });
    playOnYouTube(tracks).then(function (ok) {
      if (ok) finish('Playing ' + tracks[0].title + '.', true, true); else openOn('youtube', query);
    });
  }, function (e) {
    if (e && e.code === 'music_busy') { finish(e.message, false, false); return; }
    openOn('youtube', query);   // not set up, signed out or offline: YouTube itself still has it
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

function identify() {
  music({ action: 'identify' }).then(function (r) {
    finish((r && r.say) || 'Got it.', true, false);
  }, function (e) { finish(musicError(e && e.code), false, false); });
}

/** The composer's text before it is sent: true when it was a music command (handled here), false otherwise. */
function handleMusicText(text) {
  var word = musicDockOpen() && dockWord(text);
  if (word && controlMusicDock(word)) { Colon.toast(word === 'stop' ? 'Stopped.' : 'Okay.', 'ok'); return true; }
  var cmd = parseMusic(text);
  if (!cmd) return false;
  if (cmd.action === 'identify') { if (!onPhone()) return false; identify(); } else play(cmd);
  return true;
}

export { handleMusicText };
