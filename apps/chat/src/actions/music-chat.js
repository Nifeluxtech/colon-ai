/* Colon AI · Colon Music from the chat (Colon OS Assistant, Step 3; docs/os-assistant/step-3.md). In the Android app
   (feature "music"), "play X" plays the best match from the phone's own songs; with none, the best Jamendo match
   (free Creative Commons music, GET /music/search on the API); with none there either, the song opens on YouTube
   (or Audiomack when asked). "What song is this?" asks the phone, which answers from Colon's own player first and
   listens with the mic only when the player is idle. The answer is a toast, spoken in hands-free; music that starts
   ends hands-free so Colon doesn't listen over it. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { S } from '../core/state.js';
import { musicError, parseMusic } from '../lib/music-intent.js';

function handsFree() { return !!(S.hf && S.hf.active()); }

function finish(say, ok, stopsHandsFree) {
  Colon.toast(say, ok ? 'ok' : 'bad');
  Colon.native.haptic(ok ? 'confirm' : 'reject');
  if (!handsFree()) return;
  if (stopsHandsFree && ok) S.hf.stop();
  else S.hf.replyDone({ status: 'complete' }, say);
}

function music(args) { return Colon.native.call('music', args); }

/** The best Jamendo match for the query, or null (not set up, offline, or nothing that really matches). */
function jamendo(query) {
  return Colon.api('/music/search?q=' + encodeURIComponent(query)).then(function (d) {
    return (d && d.tracks && d.tracks[0]) || null;
  }, function () { return null; });
}

function openOn(service, query) {
  music({ action: 'open', service: service, query: query }).then(function (r) {
    finish((r && r.say) || 'Opening it.', true, true);
  }, function (e) { finish(musicError(e && e.code), false, false); });
}

function play(cmd) {
  if (cmd.source === 'youtube' || cmd.source === 'audiomack') { openOn(cmd.source, cmd.query); return; }
  music({ action: 'play', query: cmd.query, source: cmd.source === 'phone' ? 'phone' : 'any' }).then(function (r) {
    finish((r && r.say) || 'Playing.', true, true);
  }, function (e) {
    var code = e && e.code;
    if (code !== 'not_found' && code !== 'no_library') { finish(musicError(code), false, false); return; }
    if (cmd.source === 'phone' || cmd.query === '*') { finish(musicError(code), false, false); return; }
    jamendo(cmd.query).then(function (t) {
      if (!t) { openOn('youtube', cmd.query); return; }
      music({ action: 'play_url', url: t.audio, title: t.title, artist: t.artist, album: t.album || '' })
        .then(function (r) { finish((r && r.say) || 'Playing.', true, true); },
          function () { openOn('youtube', cmd.query); });
    });
  });
}

function identify() {
  music({ action: 'identify' }).then(function (r) {
    finish((r && r.say) || 'Got it.', true, false);
  }, function (e) { finish(musicError(e && e.code), false, false); });
}

/** The composer's text before it is sent: true when it was a music command (handled here), false otherwise. */
function handleMusicText(text) {
  if (!Colon.native.can('music')) return false;
  var cmd = parseMusic(text);
  if (!cmd) return false;
  if (cmd.action === 'identify') identify(); else play(cmd);
  return true;
}

export { handleMusicText };
