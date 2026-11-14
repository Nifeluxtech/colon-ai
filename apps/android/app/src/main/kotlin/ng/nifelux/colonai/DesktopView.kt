package ng.nifelux.colonai

/**
 * 0.10.3: the chat's browser always shows the desktop site, laid out about 1280 CSS px wide and zoomed out to fit
 * its card (overview mode), like a screenshot of a desktop browser; full screen keeps the same layout and lets the
 * user pinch-zoom and pan. Pure, unit-tested in ChatRunTest.
 *
 * How: a desktop user agent (UserAgents.desktop), useWideViewPort + loadWithOverviewMode, and [script], injected at
 * document start into every page of the chat's tabs, which makes the page's viewport `width=<layoutWidth>` (a
 * responsive site's `width=device-width` would otherwise lay out at the card's few hundred CSS px and show its
 * phone layout). The script also drops `user-scalable=no` / `maximum-scale` so pinch zoom works in full screen.
 */
object DesktopView {
    const val LAYOUT_WIDTH = 1280
    const val MIN_LAYOUT_WIDTH = 980
    /** Chromium won't zoom a page out further than this, so the layout may be at most 4× the view's width. */
    const val MIN_SCALE = 0.25f

    /**
     * The layout width for a browser whose narrowest width (the card on this phone) is [viewWidthDp] dp:
     * [LAYOUT_WIDTH], or less when even fully zoomed out ([MIN_SCALE]) the page would not fit (very narrow phones),
     * never below [MIN_LAYOUT_WIDTH] (the classic desktop width).
     */
    fun layoutWidth(viewWidthDp: Int): Int {
        if (viewWidthDp <= 0) return LAYOUT_WIDTH
        val fits = (viewWidthDp / MIN_SCALE).toInt()
        return fits.coerceIn(MIN_LAYOUT_WIDTH, LAYOUT_WIDTH)
    }

    /** The zoom at which [layoutWidth] CSS px fill [viewWidthPx] device px at [density] (what overview mode picks). */
    fun fitScale(viewWidthPx: Int, density: Float, layoutWidth: Int): Float =
        if (viewWidthPx <= 0 || density <= 0f || layoutWidth <= 0) 1f else viewWidthPx / density / layoutWidth

    /** The page's viewport, as the script writes it. */
    fun viewport(width: Int): String = "width=$width"

    /**
     * Document-start script: keeps every `<meta name=viewport>` at [viewport] (adding one when the page has none)
     * while the page loads and for a few seconds after, then stops watching. Idempotent; never throws.
     */
    fun script(width: Int): String = """
(function () {
  try {
    if (window.__colonDesktop) return; window.__colonDesktop = 1;
    var want = '${viewport(width)}', doc = document;
    function fix(m) { if (m.getAttribute('content') !== want) m.setAttribute('content', want); }
    function isVp(n) { return n && n.nodeType === 1 && n.tagName === 'META' &&
      String(n.getAttribute('name') || '').toLowerCase() === 'viewport'; }
    function scan() {
      var all = doc.getElementsByTagName('meta'), found = false;
      for (var i = 0; i < all.length; i++) if (isVp(all[i])) { fix(all[i]); found = true; }
      if (!found && doc.head) { var m = doc.createElement('meta'); m.setAttribute('name', 'viewport');
        m.setAttribute('content', want); doc.head.appendChild(m); }
    }
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === 'attributes' && isVp(r.target)) fix(r.target);
        for (var j = 0; r.addedNodes && j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (isVp(n)) fix(n); else if (n.tagName === 'HEAD') scan();
        }
      }
    });
    mo.observe(doc.documentElement || doc, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['content', 'name'] });
    doc.addEventListener('DOMContentLoaded', scan);
    window.addEventListener('load', function () { scan(); setTimeout(function () { mo.disconnect(); }, 4000); });
    scan();
  } catch (e) { /* a page we can't adjust stays as it is */ }
})();
""".trimIndent()
}
