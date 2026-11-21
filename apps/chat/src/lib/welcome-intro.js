/* Colon AI · the new chat's intro animation (0.24.0): a drop falls into water, ripples, clouds and the orbit ring
   form, then the COLON wordmark. It plays once when a new chat opens and then holds on its last frame (the poster);
   a re-render of the same new chat never replays it, and reduced motion shows only the poster.
   The poster paints first; the animation loads after it, so it never slows the first paint.
   Pure: no DOM, unit-tested in packages/ui/test/newchat.test.js. */

var SRC = 'assets/img/colon-intro.webp';
var POSTER = 'assets/img/colon-intro-poster.webp';
var PLAY_MS = 3600;   // 16 frames × 200 ms + the last frame's 400 ms (the WebP itself plays once, loop count 1)

/** 'play' or 'poster'. o: { reducedMotion, played (this new chat already played it), saveData (data saver) }. */
function introMode(o) {
  o = o || {};
  if (o.reducedMotion || o.played || o.saveData) return 'poster';
  return 'play';
}

export var WelcomeIntro = { SRC: SRC, POSTER: POSTER, PLAY_MS: PLAY_MS, introMode: introMode };
