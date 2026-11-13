/* Colon AI · keeping the chat frame still (v0.10.1). Only the message thread (#cw-scroll) scrolls; the header stays
   at the top and the composer with its "Synced" line at the bottom of the visible viewport.
   Before 0.10.1 the browser card was brought into view with element.scrollIntoView(), which scrolls EVERY scrollable
   ancestor: the thread, but also the fixed frame (.cw, overflow hidden yet still scrollable by script), the page and,
   in Android's WebView, the visual viewport, so on a phone the whole frame (composer included) could slide.
   reveal() scrolls the thread alone, to the band between the header and the composer; pinFrame() puts the frame and
   the window back at 0 if anything else (a focus scroll, an old scrollIntoView) moved them.
   No imports beyond native-anchor's band and every dependency injected: unit-tested in packages/ui/test. */

import { viewOf } from './native-anchor.js';

// The thread's new scrollTop so the box shows in the band ("nearest": no move when it already fits; a box taller
// than the band shows its top). box and band are client rects (top/bottom); cur is the thread's scrollTop now.
function revealTop(cur, box, band, max) {
  var t = Number(cur) || 0;
  if (!box || !band || !(band.bottom > band.top)) return t;
  var h = box.bottom - box.top, room = band.bottom - band.top, next = t;
  if (box.top < band.top || h > room) next = t + (box.top - band.top);
  else if (box.bottom > band.bottom) next = t + (box.bottom - band.bottom);
  if (next < 0) next = 0;
  if (max >= 0 && next > max) next = max;
  return Math.round(next);
}

/**
 * Scrolls the thread (and nothing else) so el shows between the header and the composer.
 * o: { cover (the composer), win (window), smooth }. Returns the scrollTop it set, or null when nothing moved.
 */
function reveal(scroller, el, o) {
  o = o || {};
  if (!scroller || !el || typeof el.getBoundingClientRect !== 'function') return null;
  var win = o.win || window, band = viewOf(scroller, win, o.cover), cur = scroller.scrollTop || 0;
  var max = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
  var next = revealTop(cur, el.getBoundingClientRect(), band, scroller.scrollHeight ? max : -1);
  if (next === Math.round(cur)) return null;
  if (o.smooth && typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: next, behavior: 'smooth' });
  else scroller.scrollTop = next;
  return next;
}

/**
 * Keeps the fixed chat frame and the window at scroll 0 while the chat is mounted. win: window; frame: .cw.
 * Returns stop().
 */
function pinFrame(win, frame) {
  var on = { passive: true };
  function fixWin() {
    if ((win.scrollY || win.pageYOffset || 0) !== 0 || (win.scrollX || win.pageXOffset || 0) !== 0) {
      win.scrollTo(0, 0);
    }
  }
  function fixFrame() {
    if (!frame) return;
    if (frame.scrollTop) frame.scrollTop = 0;
    if (frame.scrollLeft) frame.scrollLeft = 0;
  }
  win.addEventListener('scroll', fixWin, on);
  if (frame) frame.addEventListener('scroll', fixFrame, on);
  fixWin(); fixFrame();
  return function stop() {
    win.removeEventListener('scroll', fixWin, on);
    if (frame) frame.removeEventListener('scroll', fixFrame, on);
  };
}

export { pinFrame, reveal, revealTop };
