package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.10.1: where Saga taps (tools.js `point` fractions -> WebView px) and what it reports after a click. */
class SagaTapTest {
    private fun point(json: String) = JSONObject(json)

    @Test fun theCentreFractionTimesTheViewSizeIsTheTapPoint() {
        val p = SagaTap.plan(point("""{"cx":0.5,"cy":0.25,"in_view":true,"hit":true}"""), 1080, 1600, true)
        assertTrue(p.native)
        assertEquals(540f, p.x, 0.01f)
        assertEquals(400f, p.y, 0.01f)
        assertTrue(p.shown)
        assertNull(p.why)
    }

    @Test fun aPointOnTheEdgeStaysInsideTheView() {
        val p = SagaTap.plan(point("""{"cx":1,"cy":0,"in_view":true,"hit":true}"""), 720, 1280, true)
        assertEquals(719f, p.x, 0.01f)
        assertEquals(1f, p.y, 0.01f)
    }

    @Test fun offScreenCoveredOrNoViewFallsBackToTheScript() {
        assertEquals("off_screen", SagaTap.plan(point("""{"cx":0.5,"cy":1.4,"in_view":false,"hit":true}"""),
            720, 1280, true).why)
        val covered = SagaTap.plan(point("""{"cx":0.5,"cy":0.5,"in_view":true,"hit":false,"covered":"Accept"}"""),
            720, 1280, true)
        assertFalse(covered.native)
        assertEquals("covered", covered.why)
        assertTrue(covered.shown) // the pointer still shows where Saga clicks
        assertEquals("no_view", SagaTap.plan(point("""{"cx":0.5,"cy":0.5,"in_view":true}"""), 0, 0, true).why)
        assertEquals("no_view", SagaTap.plan(point("""{"cx":0.5,"cy":0.5,"in_view":true}"""), 720, 1280, false).why)
        // A page that lies about in_view can't send a tap outside the view.
        assertFalse(SagaTap.plan(point("""{"cx":3,"cy":0.5,"in_view":true,"hit":true}"""), 720, 1280, true).native)
        assertFalse(SagaTap.plan(point("""{"in_view":true,"hit":true}"""), 720, 1280, true).native)
    }

    @Test fun theResultSaysWhatTheClickChanged() {
        val r = SagaTap.result(JSONObject("""{"url":"https://a.ng/","title":"A","changed":"none"}"""), "tap", "",
            "https://a.ng/", "https://a.ng/", "A", false)
        assertEquals("none", r.getString("changed"))
        assertEquals("tap", r.getString("method"))
        assertFalse(r.has("covered"))
        assertFalse(r.has("before"))
        val nav = SagaTap.result(null, "script", "Cookie banner", "https://a.ng/", "https://a.ng/b", "B", false)
        assertEquals("navigated", nav.getString("changed"))
        assertEquals("https://a.ng/b", nav.getString("url"))
        assertEquals("Cookie banner", nav.getString("covered"))
        assertEquals("navigated", SagaTap.result(null, "tap", "", "https://a.ng/", "https://a.ng/", "A", true)
            .getString("changed"))
        assertEquals("unknown", SagaTap.result(null, "tap", "", "https://a.ng/", "https://a.ng/", "A", false)
            .getString("changed"))
    }

    @Test fun slowPagesGetASecondLook() {
        assertTrue(SagaTap.lookAgain("none"))
        assertTrue(SagaTap.lookAgain("focused"))
        assertTrue(SagaTap.lookAgain(null))
        assertFalse(SagaTap.lookAgain("navigated"))
        assertFalse(SagaTap.lookAgain("page_changed"))
    }

    /** 0.11.2: a tap's outcome is read early and often; the last quick look is where 0.11.1 looked first. */
    @Test fun quickLooksEndTheWaitEarly() {
        assertEquals(150L, SagaTap.lookGap(0)!!)
        assertEquals(200L, SagaTap.lookGap(1)!!)
        assertEquals(350L, SagaTap.lookGap(2)!!)
        assertNull(SagaTap.lookGap(3))
        assertEquals(700L, (0 until SagaTap.QUICK_LOOKS_MS.size).sumOf { SagaTap.lookGap(it)!! })
    }

    /** 0.11.2: the pointer stays on while Saga works and glides at a pace that fits the trip. */
    @Test fun pointerShowsWhileSagaWorksAndGlidesSmoothly() {
        assertTrue(SagaTap.pointerShows(canRun = true, handoff = false))
        assertFalse(SagaTap.pointerShows(canRun = true, handoff = true))      // a secret field is the user's
        assertFalse(SagaTap.pointerShows(canRun = false, handoff = false))    // Take control, Pause, Stop, ended
        assertEquals(SagaTap.GLIDE_MIN_MS, SagaTap.glideMs(0f, 2f))
        assertTrue(SagaTap.glideMs(10f, 2f) < SagaTap.glideMs(100f, 2f))       // longer trips take longer
        assertEquals(SagaTap.GLIDE_MAX_MS, SagaTap.glideMs(5000f, 2f))
        val mid = SagaTap.glideMs(400f, 2f)                                     // 200 dp
        assertTrue(mid in (SagaTap.GLIDE_MIN_MS + 1) until SagaTap.GLIDE_MAX_MS)
    }
}
