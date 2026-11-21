/* Colon AI · Colon Music's YouTube player (v0.21.0). "play Last Last" finds the song (GET /music/search, the YouTube
   Data API on the server) and plays it here: a small dock above the composer holding YouTube's official embedded
   player (IFrame API), with the title, Next (the next search result), Open in YouTube and Close. YouTube's rules:
   the player stays visible and stops when Colon is in the background; videos whose owner blocks embedding are skipped.
   play(tracks) -> Promise<boolean> (false when none of them would play). */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, esc = C.esc;
var ERR_SKIP = { 2: 1, 5: 1, 100: 1, 101: 1, 150: 1, 152: 1, 153: 1 };
// 15x = the embedder was refused (Android WebView, no-cookie host): try the regular youtube.com player once.
var ERR_HOST = { 150: 1, 152: 1, 153: 1 };
var HOSTS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
var api = null, el = null, player = null, list = [], at = 0, done = null, hostAt = 0, lastErr = '';

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

function mount() {
  if (el && el.isConnected) return el;
  var host = document.querySelector('.cw-composer-in');
  if (!host) return null;
  el = document.createElement('div');
  el.className = 'cm-dock'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Music player');
  el.innerHTML = '<div class="cm-video"><div class="cm-frame"></div></div><div class="cm-row"><div class="cm-meta">'
    + '<div class="cm-title"></div><div class="cm-artist"></div></div><div class="cm-acts">'
    + '<button type="button" class="btn sm cm-next" aria-label="Play the next result">Next</button>'
    + '<a class="icon-btn cm-yt" target="_blank" rel="noopener" aria-label="Open in YouTube" data-tip="YouTube">'
    + C.icon('external') + '</a>'
    + '<button type="button" class="icon-btn cm-close" aria-label="Close player" data-tip="Close">'
    + C.icon('x') + '</button></div></div>';
  host.insertBefore(el, host.firstChild);
  el.querySelector('.cm-close').addEventListener('click', close);
  el.querySelector('.cm-next').addEventListener('click', function () { next(); });
  return el;
}

function paint(t) {
  el.querySelector('.cm-title').innerHTML = esc(t.title);
  el.querySelector('.cm-artist').innerHTML = esc(t.channel || 'YouTube');
  el.querySelector('.cm-yt').href = t.link;
  el.querySelector('.cm-next').hidden = at >= list.length - 1;
}

function settle(v) { if (done) { var d = done; done = null; d(v); } }

function next() {
  if (at >= list.length - 1) return false;
  at++; paint(list[at]);
  if (player && player.loadVideoById) player.loadVideoById(list[at].id);
  return true;
}

function onState(e) { if (e.data === 1) settle(true); }   // 1 = playing

function build(YT) {
  var box = el.querySelector('.cm-video');
  box.innerHTML = '<div class="cm-frame"></div>';
  player = new YT.Player(box.firstChild, { videoId: list[at].id, width: '100%', height: '100%', host: HOSTS[hostAt],
    playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
    events: { onReady: function (e) { e.target.playVideo(); }, onStateChange: onState, onError: onError } });
}

/** Nothing would play: keep the card (its YouTube button still works) and say why. */
function fail(why) {
  lastErr = why;
  if (!el) { settle(false); return; }
  el.querySelector('.cm-artist').innerHTML = esc('Can’t play here: ' + why);
  el.querySelector('.cm-next').hidden = true;
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
  if (!list.length || !mount()) return Promise.resolve(false);
  settle(false);
  var p = new Promise(function (ok) { done = ok; });
  paint(list[0]); el.hidden = false;
  lastErr = '';
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
  if (player && player.destroy) { try { player.destroy(); } catch (e) { /* already gone */ } }
  player = null;
  if (el) { el.remove(); el = null; }
}

/** "pause", "resume", "next", "stop the music" while the dock is open: true when handled. */
function control(word) {
  if (!el || !player || !player.pauseVideo) return false;
  if (word === 'pause') player.pauseVideo();
  else if (word === 'resume') player.playVideo();
  else if (word === 'next') { if (!next()) return true; }
  else if (word === 'stop') close();
  else return false;
  return true;
}

function isOpen() { return !!(el && el.isConnected); }

/** Why the last play failed ('' when it didn't). */
function lastError() { return lastErr; }

export { close as closeMusicDock, control as controlMusicDock, isOpen as musicDockOpen, play as playOnYouTube,
  lastError as musicDockError };
