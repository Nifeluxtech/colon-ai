package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** v0.9.1: the "inline" layout. The page's anchor (CSS px) -> the panel's place and clip in device px. */
class InlineGeometryTest {
    private val g = InlineGeometry

    // A 412 x 892 dp phone at 2.625: the thread is the band 56..700 CSS px (header above, composer below).
    private fun anchor(y: Float, height: Float = 480f, dpr: Float = 2.625f) =
        g.anchorOf(16f, y, 380f, height, 56f, 700f, dpr)

    @Test fun cssPxBecomeDevicePxAtTheReportedRatio() {
        val p = g.place(anchor(300f), 3f, 0, 0, 1080, 2000)
        assertTrue(p.visible)
        assertEquals(42, p.left)          // 16 * 2.625
        assertEquals(788, p.top)          // 300 * 2.625 = 787.5, rounded
        assertEquals(998, p.width)        // 380 * 2.625 = 997.5
        assertEquals(1260, p.height)      // 480 * 2.625
        assertEquals(147, p.clipTop)      // 56 * 2.625
        assertEquals(1838, p.clipBottom)  // 700 * 2.625 = 1837.5
    }

    @Test fun theShellWebViewsOffsetMovesPanelAndClip() {
        val p = g.place(g.anchorOf(0f, 100f, 200f, 100f, 0f, 400f, 2f), 2f, 10, 24, 1080, 2000)
        assertEquals(10, p.left)
        assertEquals(224, p.top)
        assertEquals(24, p.clipTop)
        assertEquals(824, p.clipBottom)
    }

    /** 0.10.2, the owner's report: the panel slid over the composer. The keyboard (or a taller composer) shrank
     *  the chat before the page's next report; the composer's gap is kept from the WebView's bottom as it is now. */
    @Test fun aStaleReportKeepsTheComposersGapFromTheBottom() {
        // Measured with an 800 CSS px page: the composer's top at 700, so 100 CSS px (300 px) of composer below.
        val a = g.anchorOf(16f, 300f, 380f, 480f, 56f, 700f, 3f, 800f)
        assertEquals(800f, a.pageHeight)
        // Up to date (the WebView is 2400 px = 800 CSS px): nothing changes.
        assertEquals(2100, g.place(a, 3f, 0, 0, 1080, 2400, 2400).clipBottom)
        // The keyboard took 1100 px and the page hasn't reported yet: the clip ends 300 px above the new bottom,
        // where the composer now is, not at the layer's bottom over it.
        assertEquals(1000, g.place(a, 3f, 0, 0, 1080, 1300, 1300).clipBottom)
        // With the shell WebView lower in the layer, its offset counts too.
        assertEquals(1024, g.place(a, 3f, 0, 24, 1080, 1324, 1300).clipBottom)
        // An older page (no pageHeight) or an unknown height: as before.
        assertEquals(1300, g.place(g.anchorOf(16f, 300f, 380f, 480f, 56f, 700f, 3f), 3f, 0, 0, 1080, 1300, 1300)
            .clipBottom)
        assertEquals(1300, g.place(a, 3f, 0, 0, 1080, 1300).clipBottom)
        // Nonsense heights are ignored.
        assertEquals(0f, g.anchorOf(16f, 300f, 380f, 480f, 56f, 700f, 3f, Float.NaN).pageHeight)
        assertEquals(0f, g.anchorOf(16f, 300f, 380f, 480f, 56f, 700f, 3f, -5f).pageHeight)
        assertEquals(640f, g.anchorOf(JSONObject().put("visible", true).put("x", 0).put("y", 0).put("width", 10)
            .put("height", 10).put("viewportTop", 0).put("viewportBottom", 600).put("dpr", 2)
            .put("pageHeight", 640)).pageHeight)
    }

    @Test fun theClipNeverLeavesTheLayer() {
        // The keyboard shrank the layer below the reported viewport: the clip stops at the layer's bottom.
        val p = g.place(anchor(300f), 3f, 0, 0, 1080, 1200)
        assertEquals(1200, p.clipBottom)
        // A viewport reported above the top of the screen starts at 0.
        val q = g.place(g.anchorOf(0f, 10f, 100f, 100f, -40f, 300f, 1f), 1f, 0, 0, 500, 500)
        assertEquals(0, q.clipTop)
    }

    @Test fun offScreenAboveOrBelowTheThreadIsHidden() {
        assertFalse(g.place(anchor(-480f), 3f, 0, 0, 1080, 2000).visible)  // bottom edge at -0: above the band
        assertFalse(g.place(anchor(-430f), 3f, 0, 0, 1080, 2000).visible)  // bottom at 50 CSS px: under the header
        assertTrue(g.place(anchor(-420f), 3f, 0, 0, 1080, 2000).visible)   // bottom at 60: 4 px show
        assertFalse(g.place(anchor(700f), 3f, 0, 0, 1080, 2000).visible)   // starts where the composer starts
        assertTrue(g.place(anchor(699f), 3f, 0, 0, 1080, 2000).visible)
    }

    @Test fun badOrHiddenReportsHideThePanel() {
        assertFalse(g.place(null, 3f, 0, 0, 1080, 2000).visible)
        assertFalse(g.place(g.HIDDEN, 3f, 0, 0, 1080, 2000).visible)
        assertFalse(g.anchorOf(Float.NaN, 0f, 10f, 10f, 0f, 10f, 1f).visible)
        assertFalse(g.anchorOf(0f, 0f, 0f, 10f, 0f, 10f, 1f).visible)          // empty box
        assertFalse(g.anchorOf(0f, 0f, 10f, 10f, 50f, 50f, 1f).visible)        // empty viewport
        assertFalse(g.anchorOf(0f, 1e9f, 10f, 10f, 0f, 10f, 1f).visible)       // absurd
        assertFalse(g.place(anchor(300f), 3f, 0, 0, 0, 0).visible)              // layer not laid out yet
    }

    @Test fun aMissingOrSillyRatioUsesTheScreenDensity() {
        val a = anchor(300f, dpr = 0f)
        assertEquals(0f, a.dpr)
        assertEquals(900, g.place(a, 3f, 0, 0, 1080, 2000).top)
        assertEquals(900, g.place(anchor(300f, dpr = 40f), 3f, 0, 0, 1080, 2000).top)
    }

    @Test fun readsTheBridgeMessage() {
        val o = JSONObject().put("visible", true).put("x", 16).put("y", 300.5).put("width", 380).put("height", 480)
            .put("viewportTop", 56).put("viewportBottom", 700).put("dpr", 2.625)
        val a = g.anchorOf(o)
        assertTrue(a.visible)
        assertEquals(300.5f, a.y, .001f)
        assertEquals(2.625f, a.dpr, .0001f)
        assertFalse(g.anchorOf(JSONObject().put("visible", false)).visible)
        assertFalse(g.anchorOf(JSONObject().put("visible", true).put("x", 1)).visible)  // missing fields
    }
}

class PanelLayoutInlineTest {
    private val inline = PanelLayout.Mode.INLINE
    private val embedded = PanelLayout.Mode.EMBEDDED

    @Test fun inlineOnlyWithAPageThatDrawsTheCard() {
        assertEquals(inline, PanelLayout.Mode.from("inline"))
        assertEquals(inline, PanelLayout.effective(inline, true))
        assertEquals(embedded, PanelLayout.effective(inline, false))   // an older chat page
        assertEquals(inline, PanelLayout.effective(inline, null))      // the page is reloading: wait, hidden
        assertEquals(PanelLayout.Mode.SPLIT, PanelLayout.effective(PanelLayout.Mode.SPLIT, false))
        assertEquals(0f, PanelLayout.panelShare(inline, false, .5f))
        assertEquals(PanelLayout.Mode.SPLIT, PanelLayout.defaultMode(800))
    }

    @Test fun collapsingReturnsToALayoutThatCollapses() {
        assertEquals(inline, PanelLayout.collapseTarget(PanelLayout.Mode.FULL, inline))
        assertEquals(embedded, PanelLayout.collapseTarget(PanelLayout.Mode.FULL, PanelLayout.Mode.SPLIT))
        assertEquals(embedded, PanelLayout.collapseTarget(PanelLayout.Mode.SPLIT, inline))
        assertEquals(inline, PanelLayout.collapseTarget(inline, embedded))
    }
}
