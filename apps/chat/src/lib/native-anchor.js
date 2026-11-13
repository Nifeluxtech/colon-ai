/* Colon AI · where the app's native browser panel sits in the thread (v0.9.1, "inline" layout). In the Android app
   the chat draws the Colon Browser card (header, buttons) and an empty body box; the app lays its real WebView over
   that box. This module measures the box and tells the app through browser('anchor', ...): on open, when the thread
   scrolls, when anything resizes (ResizeObserver, window and visualViewport for the keyboard), at most once per
   animation frame, and only when something changed. Off screen or collapsed it sends { visible: false }.
   No imports and every dependency injected, so it is unit-tested with a fake DOM (packages/ui/test). */

function round(n) { return Math.round(Number(n) * 100) / 100; }

// The message for the app. box: the body's client rect; view: { top, bottom } of the visible thread (CSS px of the
// shell page). Visible only when part of the box is inside the thread's viewport.
function anchorRect(box, view, dpr, collapsed) {
  if (collapsed || !box || !view || !(box.width > 0) || !(box.height > 0) || !(view.bottom > view.top)) {
    return { visible: false };
  }
  var top = box.top, bottom = box.top + box.height;
  if (bottom <= view.top || top >= view.bottom) return { visible: false };
  return { visible: true, x: round(box.left), y: round(top), width: round(box.width), height: round(box.height),
    viewportTop: round(view.top), viewportBottom: round(view.bottom), dpr: dpr > 0 ? Math.round(dpr * 1e4) / 1e4 : 1 };
}

function same(a, b) {
  if (!a || !b) return false;
  for (var k in a) if (a[k] !== b[k]) return false;
  for (var j in b) if (!(j in a)) return false;
  return true;
}

// The part of the thread the user sees: the scroller's box, cut by the window and the visual viewport (keyboard).
function viewOf(scroller, win) {
  var r = scroller.getBoundingClientRect(), bottom = r.bottom, vv = win.visualViewport;
  if (win.innerHeight > 0) bottom = Math.min(bottom, win.innerHeight);
  if (vv && vv.height > 0) bottom = Math.min(bottom, (vv.offsetTop || 0) + vv.height);
  return { top: Math.max(r.top, 0), bottom: bottom };
}

/**
 * opts: { el (the body box), scroller (the thread), watch (more elements whose size moves the box), send(payload),
 * collapsed() -> bool, onKeyboard() (the keyboard opened: the visual viewport lost more than KEYBOARD_PX), win
 * (window), raf, caf }. Returns { update(), stop(), last() }.
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
    var p = shown ? anchorRect(el.getBoundingClientRect(), viewOf(opts.scroller, win), win.devicePixelRatio,
      false) : { visible: false };
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
    [opts.el, opts.scroller].concat(opts.watch || []).forEach(function (e) { if (e) ro.observe(e); });
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

export { anchorRect, createAnchor, viewOf };
