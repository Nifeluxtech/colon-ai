/* Colon AI · Colon Music from the chat (Colon OS Assistant, Step 3; docs/os-assistant/step-3.md). "play X" plays the
   best match from the phone's own songs (Android app, feature "music"); with none (or on the web), Colon finds it on
   YouTube (GET /music/search) and plays it in its own video card in the chat (components/music-dock.js). "watch X"
   plays any YouTube video there (never the phone's songs); "on Audiomack" opens Audiomack. "pause", "forward",
   "back", "stop the music" control the card while it plays. "What song is this?" answers from that card when it is
   playing; otherwise the phone answers from Colon's own player first and listens with the mic only when the player
   is idle (Step 4: songprint, then the Shazam app). "play it" within 10 minutes plays the song Colon just named.
   0.22.1: every command and its reply go in the thread and its history (actions/command-thread.js; phrases in
   lib/command-phrases.js, wordings in lib/command-replies.js). Each watch or play request gets its own card under
   its reply; older cards collapse to a row with Play again (replayVideo). Music that starts ends voice mode after
   the reply is said, so Colon doesn't listen over it. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { closeMusicDock, controlMusicDock, musicDockError, musicDockNow, musicDockOpen, playOnYouTube }
  from '../components/music-dock.js';
import { videoOf } from '../components/video-row.js';
import { S } from '../core/state.js';
import { reply } from '../lib/command-replies.js';
import { dockWord, musicError, parseMusic, playLast } from '../lib/music-intent.js';
import { answer, commandLine } from './command-thread.js';

var RECENT_MS = 10 * 60 * 1000;
var named = null;   // the last song Colon named: { query, at }

function onPhone() { return Colon.native.can('music'); }
function music(args) { return Colon.native.call('music', args); }
function fail(say) { return answer(say, { ok: false }); }

/** The song's page on YouTube or Audiomack: the app on the phone, a new tab on the web. */
function openOn(service, query) {
  var name = service === 'audiomack' ? 'Audiomack' : 'YouTube';
  if (!onPhone()) {
    var url = service === 'audiomack' ? 'https://audiomack.com/search?q=' + encodeURIComponent(query)
      : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    window.open(url, '_blank', 'noopener');
    answer(reply('open_service', { service: name }), { ends: true });
    return;
  }
  music({ action: 'open', service: service, query: query }).then(function () {
    answer(reply('open_service', { service: name }), { ends: true });
  }, function (e) { fail(musicError(e && e.code)); });
}

/** Plays a track in a new card under its reply (the reply is written first: the card sits under it). */
function playCard(tracks, say, quiet) {
  return answer(say, { ends: true, video: tracks[0], quiet: quiet }).then(function (m) {
    return playOnYouTube(tracks, { anchor: m && m.id }).then(function (ok) {
      // On failure the card stays with its YouTube button; Colon doesn't leave the app by itself (0.21.1).
      if (!ok) fail(reply('embed_blocked') + (musicDockError() ? ' (' + musicDockError() + ')' : ''));
      return ok;
    });
  });
}

/** Find it on YouTube and play it in a new card; kind 'video' for "watch X". */
function youtube(query, kind) {
  // 0.22.1: in voice mode the search (a server round trip) doesn't hold the reply: Colon says it is on it at once.
  var hf = S.hf && S.hf.active(), quiet = !!hf;
  if (hf) { S.hf.localReply(); S.hf.finalReply(reply('finding', { query: query })); }
  var url = '/music/search?q=' + encodeURIComponent(query) + (kind === 'video' ? '&kind=video' : '');
  Colon.api(url).then(function (d) {
    var tracks = (d && d.tracks) || [];
    if (!tracks.length) {
      answer(reply(kind === 'video' ? 'not_found_video' : 'not_found_song'), { ok: false, quiet: quiet }); return; }
    if (onPhone()) music({ action: 'stop' }).catch(function () { /* nothing was playing */ });
    playCard(tracks, reply(kind === 'video' ? 'watch' : 'play', { title: tracks[0].title }), quiet);
  }, function (e) {
    var why = (e && (e.message || e.code)) || 'no answer';
    answer('I couldn’t search YouTube: ' + why, { ok: false, quiet: quiet });
  });
}

function play(cmd) {
  if (cmd.source === 'audiomack') { openOn('audiomack', cmd.query); return; }
  if (cmd.source === 'youtube' || !onPhone()) {
    if (cmd.source === 'phone' || cmd.query === '*') { fail(musicError('no_library')); return; }
    youtube(cmd.query); return;
  }
  music({ action: 'play', query: cmd.query, source: cmd.source === 'phone' ? 'phone' : 'any' }).then(function (r) {
    closeMusicDock();
    var what = r && r.title && cmd.query !== '*' ? [r.title, r.artist].filter(Boolean).join(' by ') : '';
    answer(what ? reply('play', { title: what }) : (r && r.say) || 'Playing.', { ends: true });
  }, function (e) {
    var code = e && e.code;
    if (code !== 'not_found' && code !== 'no_library') { fail(musicError(code)); return; }
    if (cmd.source === 'phone' || cmd.query === '*') { fail(musicError(code)); return; }
    youtube(cmd.query);
  });
}

function remember(title, artist) {
  var q = [title, artist].filter(Boolean).join(' ').trim();
  named = q ? { query: q.slice(0, 120), at: Date.now() } : null;
}

/** Colon's video card first (no mic), then the phone (its player, then the mic; Step 4 may hand off to Shazam). */
function identify(text) {
  var now = musicDockNow();
  if (now && now.playing) {
    commandLine(text); remember(now.title, now.channel);
    answer(reply('identified', { what: now.title + (now.channel ? ', from ' + now.channel : '') }));
    return true;
  }
  if (!onPhone()) return false;
  commandLine(text);
  music({ action: 'identify' }).then(function (r) {
    if (r && r.code === 'handed_off') { answer(reply('handed_off'), { ends: true }); return; }
    if (r && r.title) remember(r.title, r.artist);
    answer(r && r.title ? reply('identified', { what: [r.title, r.artist].filter(Boolean).join(' by ') })
      : (r && r.say) || 'Got it.');
  }, function (e) { fail(musicError(e && e.code)); });
  return true;
}

/** Play again on a past video card: that video, in its own card again (the playing one collapses). */
function replayVideo(m) {
  var v = videoOf(m);
  if (!v) return;
  playOnYouTube([v], { anchor: m.id }).then(function (ok) {
    if (!ok) Colon.toast(reply('embed_blocked'), 'bad');
  });
}

/** The composer's text before it is sent: true when it was a music command (handled here), false otherwise. */
function handleMusicText(text) {
  var word = musicDockOpen() && dockWord(text);
  if (word && controlMusicDock(word)) { commandLine(text); answer(reply(word)); return true; }
  if (named && Date.now() - named.at < RECENT_MS && playLast(text)) {
    commandLine(text); youtube(named.query); return true;
  }
  var cmd = parseMusic(text);
  if (!cmd) return false;
  if (cmd.action === 'identify') return identify(text);
  commandLine(text);
  if (cmd.action === 'watch') youtube(cmd.query, 'video'); else play(cmd);
  return true;
}

export { handleMusicText, replayVideo };
