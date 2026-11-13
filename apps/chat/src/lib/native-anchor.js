/* Colon AI · where the app's native browser panel sits in the thread (v0.9.1, "inline" layout). In the Android app
   the chat draws the Colon Browser card (header, buttons) and an empty body box; the app lays its real WebView over
   that box. This module measures the box and tells the app through browser('anchor', ...): on open, when the thread
   scrolls, when anything resizes (ResizeObserver, window and visualViewport for the keyboard), at most once per
   animation frame, and only when something changed. Off screen or collapsed it sends { visible: false }.
   0.10.2: every number is measured from the visual viewport's corner (what the app's WebView shows on screen; the
   frame follows it with --vvt), and pageHeight (the visible page's height) lets the app keep the composer's gap
   when its WebView resized before the next report (the keyboard), so the panel never slides over the composer.
   No imports and every dependency injected, so it is unit-tested with a fake DOM (packages/ui/test). */

function round(n) { return Math.round(Number(n) * 100) / 100; }

// The message for the app. box: the body's client rect; view: { top, bottom } of the visible thread (CSS px of the
// shell page). Visible only when part of the box is inside the thread's viewport. screen (0.10.2, optional): the
// visual viewport { x, y, height, scale }; the numbers become relative to its corner (client rects are relative to
// the layout viewport, which the keyboard or a focus scroll can move away from what is on screen) and pageHeight
// says how tall the visible page was, so the app can keep the gap under viewportBottom (the composer) if its
// WebView changed size since.
function anchorRect(box, view, dpr, collapsed, screen) {
  if (collapsed || !box || !view || !(box.width > 0) || !(box.height > 0) || !(view.bottom > view.top)) {
    return { visible: false };
  }
  var top = box.top, bottom = box.top + box.height;
  if (bottom <= view.top || top >= view.bottom) return { visible: false };
  var sx = screen ? Number(screen.x) || 0 : 0, sy = screen ? Number(screen.y) || 0 : 0;
  var scale = screen && screen.scale > 0 ? screen.scale : 1, d = dpr > 0 ? dpr * scale : 1;
  var p = { visible: true, x: round(box.left - sx), y: round(top - sy), width: round(box.width),
    height: round(box.height), viewportTop: round(view.top - sy), viewportBottom: round(view.bottom - sy),
    dpr: Math.round(d * 1e4) / 1e4 };
  if (screen && screen.height > 0) p.pageHeight = round(screen.height);
  return p;
}

// The visual viewport (what is on screen) in layout-viewport CSS px; the window when there is none.
function screenOf(win) {
  var vv = win.visualViewport;
  if (vv && vv.height > 0) {
    return { x: vv.offsetLeft || 0, y: vv.offsetTop || 0, height: vv.height, scale: vv.scale > 0 ? vv.scale : 1 };
  }
  return { x: 0, y: 0, height: win.innerHeight > 0 ? win.innerHeight : 0, scale: 1 };
}

function same(a, b) {
  if (!a || !b) return false;
  for (var k in a) if (a[k] !== b[k]) return false;
  for (var j in b) if (!(j in a)) return false;
  return true;
}

// The top of the floating composer (v0.10.1): the thread scrolls UNDER it (.cw-scroll is padded by its height), so
// the band the user sees ends where the composer starts. A hidden composer (pages, height 0) cuts nothing. The
// composer's "Latest" button floats above it (0.10.2): when shown, the band ends above it too. cover may be a
// function (0.10.2): the composer is looked up on every measure, so a re-drawn composer is never missed.
function coverTop(cover) {
  if (typeof cover === 'function') cover = cover();
  if (!cover || cover.hidden || cover.isConnected === false || typeof cover.getBoundingClientRect !== 'function') {
    return Infinity;
  }
  var c = cover.getBoundingClientRect(), top = c && c.height > 0 ? c.top : Infinity;
  var jump = typeof cover.querySelector === 'function' ? cover.querySelector('.cw-jump:not([hidden])') : null;
  var j = jump && jump.getBoundingClientRect ? jump.getBoundingClientRect() : null;
  return j && j.height > 0 && j.top < top ? j.top : top;
}

// The part of the thread the user sees: the scroller's box, cut by the window, the visual viewport (keyboard) and,
// since 0.10.1, the floating composer (cover). Before 0.10.1 the band ran to the scroller's bottom, which is under
// the composer, so the app's WebView was clipped only at the screen's edge and slid over the message box and its
// "Synced" line whenever the card was near the bottom of the thread.
function viewOf(scroller, win, cover) {
  var r = scroller.getBoundingClientRect(), bottom = r.bottom, vv = win.visualViewport;
  if (win.innerHeight > 0) bottom = Math.min(bottom, win.innerHeight);
  if (vv && vv.height > 0) bottom = Math.min(bottom, (vv.offsetTop || 0) + vv.height);
  bottom = Math.min(bottom, coverTop(cover));
  return { top: Math.max(r.top, 0), bottom: bottom };
}

/**
 * opts: { el (the body box), scroller (the thread), cover (the floating composer over the thread's bottom),
 * watch (more elements whose size moves the box), send(payload), collapsed() -> bool, onKeyboard() (the keyboard
 * opened: the visual viewport lost more than KEYBOARD_PX), win (window), raf, caf }.
 * Returns { update(), stop(), last() }.
 */
var KEYBOARD_PX = 120;
function createAnchor(opts) {
  var win = opts.win || window, raf = opts.raf || win.requestAnimationFrame.bind(win);
  var caf = opts.caf || (win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : function () {});
  var frame = null, last = null, stopped = false, ro = null, vv = win.visualViewport, vvh = vv ? vv.height : 0;
  function onViewport() {
    if (vv && opts.onKeyboard && vvh - vv.height > KEYBOARD_PX) opts.onKeyboard();
    if (vv) vvh = vv.height;
    update();
  }
  function measure() {
    frame = null;
    if (stopped) return;
    var el = opts.el, shown = el && el.isConnected !== false && !(opts.collapsed && opts.collapsed());
    var p = shown ? anchorRect(el.getBoundingClientRect(), viewOf(opts.scroller, win, opts.cover), win.devicePixelRatio,
      false, screenOf(win)) : { visible: false };
    if (same(p, last)) return; // nothing moved (and a second "hidden" says nothing new)
    last = p;
    opts.send(p);
  }
  function update() { if (!stopped && frame === null) frame = raf(measure); }
  var on = { passive: true };
  opts.scroller.addEventListener('scroll', update, on);
  win.addEventListener('resize', update, on);
  if (vv) { vv.addEventListener('resize', onViewport, on); vv.addEventListener('scroll', update, on); }
  if (typeof win.ResizeObserver === 'function') {
    ro = new win.ResizeObserver(update);
    var cov = typeof opts.cover === 'function' ? opts.cover() : opts.cover;
    [opts.el, opts.scroller, cov].concat(opts.watch || []).forEach(function (e) { if (e) ro.observe(e); });
  }
  update();
  return {
    update: update,
    last: function () { return last; },
    stop: function () {
      if (stopped) return;
      stopped = true;
      if (frame !== null) caf(frame);
      frame = null;
      opts.scroller.removeEventListener('scroll', update, on);
      win.removeEventListener('resize', update, on);
      if (vv) { vv.removeEventListener('resize', onViewport, on); vv.removeEventListener('scroll', update, on); }
      if (ro) ro.disconnect();
      if (last && last.visible) opts.send({ visible: false });
    }
  };
}

export { anchorRect, coverTop, createAnchor, screenOf, viewOf };
