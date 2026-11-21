/* Colon AI · Colon Music's video card (0.22.0; was a dock above the composer in 0.21.x). "play Last Last" or "watch
   X" finds it (GET /music/search, the YouTube Data API on the server) and plays it in a card IN the chat thread
   (components/music-place.js keeps it there across redraws): YouTube's official embedded player (IFrame API), which
   can't be tapped (no YouTube controls, a clear shield over it), and Colon's own row under it: Back 5 s, Play/Pause,
   Forward 10 s, a progress bar with the time, Open in YouTube and Close. YouTube's rules: the player stays visible
   (at least 200x200, YouTube's branding uncovered) and stops when Colon is in the background. A video whose owner
   blocks embedding is skipped silently for the next search result (there is no Next button).
   play(tracks, { kind }) -> Promise<boolean> (false when none of them would play). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { attachMusicCard, detachMusicCard, revealMusicCard } from './music-place.js';
import { CW } from '../core/cw.js';
import { S } from '../core/state.js';

var C = Colon, esc = C.esc;
var ERR_SKIP = { 2: 1, 5: 1, 100: 1, 101: 1, 150: 1, 152: 1, 153: 1 };
// 15x = the embedder was refused (Android WebView, no-cookie host): try the regular youtube.com player once.
var ERR_HOST = { 150: 1, 152: 1, 153: 1 };
var HOSTS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
var VARS = { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1 };
var api = null, el = null, player = null, list = [], at = 0, done = null, hostAt = 0, lastErr = '', tick = 0;
var chatKey = null, playing = false;

function loadApi() {
  if (api) return api;
  api = new Promise(function (ok, bad) {
    if (window.YT && window.YT.Player) { ok(window.YT); return; }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () { if (prev) prev(); ok(window.YT); };
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = function () { api = null; bad(new Error('youtube_unreachable')); };
    document.head.appendChild(s);
  });
  return api;
}

function btn(cls, label, inner) {
  return '<button type="button" class="icon-btn cm-btn ' + cls + '" aria-label="' + label + '" data-tip="' + label
    + '">' + inner + '</button>';
}

function mount() {
  if (el && el.isConnected) return el;
  var msgs = S.messages || [], last = msgs[msgs.length - 1];
  el = document.createElement('div');
  el.className = 'cm-dock'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Video player');
  el.innerHTML = '<div class="cm-video"><div class="cm-fbox"><div class="cm-frame"></div></div>'
    + '<div class="cm-shield" aria-hidden="true"></div></div><div class="cm-bar" aria-hidden="true"><i></i></div>'
    + '<div class="cm-row"><div class="cm-meta">'
    + '<div class="cm-title"></div><div class="cm-artist"></div></div><span class="cm-time tiny">0:00</span></div>'
    + '<div class="cm-acts">' + btn('cm-back', 'Back 5 seconds', '−5s')
    + btn('cm-toggle', 'Pause', C.icon('pause')) + btn('cm-fwd', 'Forward 10 seconds', '+10s')
    + '<span class="cm-gap"></span><a class="icon-btn cm-yt" target="_blank" rel="noopener" aria-label="Open in '
    + 'YouTube" data-tip="YouTube">' + C.icon('external') + '</a>'
    + btn('cm-close', 'Close player', C.icon('x')) + '</div>';
  chatKey = S.current ? S.current.id : null;
  if (!attachMusicCard(el, last && !/^tmp/.test(last.id) ? last.id : '')) { el = null; return null; }
  el.querySelector('.cm-close').addEventListener('click', close);
  el.querySelector('.cm-toggle').addEventListener('click', toggle);
  el.querySelector('.cm-fwd').addEventListener('click', function () { seek(10); });
  el.querySelector('.cm-back').addEventListener('click', function () { seek(-5); });
  return el;
}

function paint(t) {
  el.querySelector('.cm-title').innerHTML = esc(t.title);
  el.querySelector('.cm-artist').innerHTML = esc(t.channel || 'YouTube');
  el.querySelector('.cm-yt').href = t.link;
}

function clock(s) {
  s = Math.max(0, Math.floor(s || 0));
  var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
}

function progress() {
  if (!el || !player || !player.getCurrentTime) return;
  var now = player.getCurrentTime() || 0, all = player.getDuration() || 0;
  el.querySelector('.cm-bar i').style.width = (all ? Math.min(100, now / all * 100) : 0) + '%';
  el.querySelector('.cm-time').textContent = clock(now) + (all ? ' / ' + clock(all) : '');
}

function setPlaying(on) {
  playing = on;
  if (!el) return;
  var b = el.querySelector('.cm-toggle');
  b.innerHTML = C.icon(on ? 'pause' : 'play');
  b.setAttribute('aria-label', on ? 'Pause' : 'Play'); b.setAttribute('data-tip', on ? 'Pause' : 'Play');
  clearInterval(tick); tick = 0;
  if (on) tick = setInterval(progress, 500);
  progress();
}

function settle(v) { if (done) { var d = done; done = null; d(v); } }

function toggle() {
  if (!player || !player.getPlayerState) return;
  if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo();
}

function seek(by) {
  if (!player || !player.getCurrentTime) return;
  var all = player.getDuration() || 0, to = Math.max(0, (player.getCurrentTime() || 0) + by);
  if (all && to > all - 1) to = Math.max(0, all - 1);
  player.seekTo(to, true); progress();
}

/** The next search result, only after an embed error (no Next button since 0.22.0). */
function next() {
  if (at >= list.length - 1) return false;
  at++; paint(list[at]);
  if (player && player.loadVideoById) player.loadVideoById(list[at].id);
  return true;
}

function onState(e) {   // 1 playing, 2 paused, 0 ended, 3 buffering
  if (e.data === 1) settle(true);
  if (e.data === 1 || e.data === 2 || e.data === 0) setPlaying(e.data === 1);
}

function build(YT) {
  var box = el.querySelector('.cm-fbox');
  box.innerHTML = '<div class="cm-frame"></div>';
  player = new YT.Player(box.firstChild, { videoId: list[at].id, width: '100%', height: '100%', host: HOSTS[hostAt],
    playerVars: Object.assign({ origin: location.origin }, VARS),
    events: { onReady: function (e) { e.target.playVideo(); }, onStateChange: onState, onError: onError } });
}

/** Nothing would play: keep the card (its YouTube button still works) and say why. */
function fail(why) {
  lastErr = why;
  if (!el) { settle(false); return; }
  el.querySelector('.cm-artist').innerHTML = esc('Can’t play here: ' + why);
  setPlaying(false);
  settle(false);
}

function onError(e) {
  if (ERR_HOST[e.data] && hostAt < HOSTS.length - 1 && window.YT) {
    hostAt++; try { player.destroy(); } catch (x) { /* gone */ } build(window.YT); return;
  }
  if (ERR_SKIP[e.data] && next()) return;
  fail('YouTube error ' + e.data);
}

function play(tracks) {
  list = (tracks || []).filter(function (t) { return t && /^[\w-]{11}$/.test(t.id); });
  at = 0;
  lastErr = !list.length ? 'no playable videos' : 'no room for the player';
  if (!list.length) return Promise.resolve(false);
  if (el && chatKey !== (S.current ? S.current.id : null)) close();   // a card from another chat goes
  if (!mount()) return Promise.resolve(false);
  settle(false);
  var p = new Promise(function (ok) { done = ok; });
  paint(list[0]); el.hidden = false;
  lastErr = '';
  setTimeout(revealMusicCard, 60);
  loadApi().then(function (YT) {
    if (player && player.loadVideoById) { player.loadVideoById(list[0].id); return; }
    hostAt = 0; build(YT);
  }, function () { fail('the YouTube player didn’t load'); });
  // Autoplay can be held back (no tap yet on the web): the player is on screen, so it still counts as shown.
  setTimeout(function () { settle(true); }, 8000);
  return p;
}

function close() {
  settle(false);
  clearInterval(tick); tick = 0; playing = false;
  if (player && player.destroy) { try { player.destroy(); } catch (e) { /* already gone */ } }
  player = null;
  if (el) { detachMusicCard(); el = null; }
}

CW.closeMusic = close;   // pages/chat.js: a new chat, another chat or a page closes the card

/** "pause", "resume", "forward", "back", "stop the music" while the card is open: true when handled. */
function control(word) {
  if (!el || !player || !player.pauseVideo) return false;
  if (word === 'pause') player.pauseVideo();
  else if (word === 'resume') player.playVideo();
  else if (word === 'forward') seek(10);
  else if (word === 'back') seek(-5);
  else if (word === 'stop') close();
  else return false;
  return true;
}

function isOpen() { return !!(el && el.isConnected); }

/** What the card shows ({ title, channel, playing }), or null when it is closed or failed. */
function nowPlaying() {
  if (!isOpen() || lastErr || !list[at]) return null;
  return { title: list[at].title, channel: list[at].channel || '', playing: playing };
}

/** Why the last play failed ('' when it didn't). */
function lastError() { return lastErr; }

export { close as closeMusicDock, control as controlMusicDock, isOpen as musicDockOpen, play as playOnYouTube,
  lastError as musicDockError, nowPlaying as musicDockNow };
