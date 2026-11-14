/* Colon AI · the chat's web overlays and the app's native browser card (0.11.0). The card in the thread is a real
   Android WebView laid OVER the chat page, so a web overlay (the sidebar drawer, a menu, a sheet or dialog, the
   model picker, a toast-free scrim) would be drawn under it: the owner saw the card covering the open menu. One
   watcher for every overlay kind: whenever any is open the page tells the app (browser('suspend', { on: true }))
   and the app hides the card; when the last one closes it comes back. It watches the body's children (sheets and
   menus are added there) and the class of the app root and the drawer's scrim, at most once per animation frame.
   No imports and every dependency injected: unit-tested in packages/ui/test/overlay-watch.test.js. */

// What counts as an open overlay. Anything modal or floating over the thread belongs here.
var SELECTORS = ['.sheet-back', '.sheet', '.menu', '[role="dialog"][aria-modal="true"]', '.drawer-back.open',
  '.cw-drawer-back.open', '.modal.open', '.cw-overlay', '[data-overlay]:not([hidden])'];

function shown(el) {
  if (!el || el.hidden) return false;
  if (typeof el.getBoundingClientRect !== 'function') return true;
  var r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Is any overlay open now? root: the chat app's element (its class "drawer-open" counts too). */
function anyOverlay(doc, root) {
  if (root && root.classList && root.classList.contains('drawer-open')) return true;
  for (var i = 0; i < SELECTORS.length; i++) {
    var list = doc.querySelectorAll(SELECTORS[i]);
    for (var j = 0; j < list.length; j++) if (shown(list[j])) return true;
  }
  return false;
}

/**
 * opts: { doc, root, MutationObserver, raf, onChange(open) }. Calls onChange only when the answer changes (first
 * with the current state when it is open). Returns { check(), stop(), open() }.
 */
function createOverlayWatch(opts) {
  var doc = opts.doc, raf = opts.raf || function (f) { return setTimeout(f, 16); };
  var open = false, frame = null, stopped = false, mo = null;
  function measure() {
    frame = null;
    if (stopped) return;
    var now = anyOverlay(doc, opts.root);
    if (now === open) return;
    open = now;
    opts.onChange(open);
  }
  function check() { if (!stopped && frame === null) frame = raf(measure); }
  if (typeof opts.MutationObserver === 'function') {
    mo = new opts.MutationObserver(check);
    mo.observe(doc.body, { childList: true });
    if (opts.root) mo.observe(opts.root, { attributes: true, attributeFilter: ['class'], childList: true });
    var scrim = opts.root && opts.root.querySelector ? opts.root.querySelector('.cw-drawer-back') : null;
    if (scrim) mo.observe(scrim, { attributes: true, attributeFilter: ['class'] });
  }
  check();
  return {
    check: check,
    open: function () { return open; },
    stop: function () { stopped = true; if (mo) mo.disconnect(); if (open) { open = false; opts.onChange(false); } }
  };
}

export { SELECTORS, anyOverlay, createOverlayWatch };
