package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX (0.34.0, Crash Predictor step 2): modes, layouts, the divider, site addresses and the bridge status. */
class JetxRulesTest {
    @Test fun modesAndLayoutsReadTheirWireNames() {
        assertEquals(JetxRules.Mode.MANUAL, JetxRules.Mode.from("manual"))
        assertEquals(JetxRules.Mode.AI, JetxRules.Mode.from(" AI "))
        assertEquals(JetxRules.Mode.SHARED, JetxRules.Mode.from("shared"))
        assertNull(JetxRules.Mode.from("auto"))
        assertNull(JetxRules.Mode.from(null))
        assertEquals(JetxRules.Layout.SPLIT, JetxRules.Layout.from("split"))
        assertEquals(JetxRules.Layout.GAME, JetxRules.Layout.from("game"))
        assertEquals(JetxRules.Layout.PREDICTOR, JetxRules.Layout.from("Predictor"))
        assertEquals(JetxRules.Layout.SIDE, JetxRules.Layout.from("side"))
        assertNull(JetxRules.Layout.from("float"))
    }

    @Test fun theLayoutButtonCyclesThroughAllFour() {
        var l = JetxRules.Layout.SPLIT
        val seen = mutableListOf<JetxRules.Layout>()
        repeat(4) { l = JetxRules.nextLayout(l); seen += l }
        assertEquals(listOf(JetxRules.Layout.SIDE, JetxRules.Layout.GAME, JetxRules.Layout.PREDICTOR,
            JetxRules.Layout.SPLIT), seen)
    }

    @Test fun theBubbleShowsOnlyInFullScreenGameAndStaysInside() {
        assertTrue(JetxRules.showsBubble(JetxRules.Layout.GAME))
        assertFalse(JetxRules.showsBubble(JetxRules.Layout.SIDE))
        assertFalse(JetxRules.showsBubble(JetxRules.Layout.SPLIT))
        assertTrue(JetxRules.gameVisible(JetxRules.Layout.GAME))
        assertFalse(JetxRules.gameVisible(JetxRules.Layout.PREDICTOR))
        assertEquals(JetxRules.BUBBLE_X to JetxRules.BUBBLE_Y, JetxRules.bubbleSpot(-1f, -1f))
        assertEquals(JetxRules.BUBBLE_X to JetxRules.BUBBLE_Y, JetxRules.bubbleSpot(0.5f, 1.5f))
        assertEquals(0.7f to 0.2f, JetxRules.bubbleSpot(0.7f, 0.2f))
    }

    @Test fun theDividerStopsShortOfTheEdges() {
        assertEquals(0.2f, JetxRules.clampSplit(0.01f), 0f)
        assertEquals(0.8f, JetxRules.clampSplit(1.5f), 0f)
        assertEquals(0.5f, JetxRules.clampSplit(0.5f), 0f)
        assertEquals(JetxRules.SPLIT_DEFAULT, JetxRules.clampSplit(Float.NaN), 0f)
        assertEquals(0.25f, JetxRules.splitAt(250f, 1000f), 0.0001f)
        assertEquals(0.8f, JetxRules.splitAt(990f, 1000f), 0f)
        assertEquals(JetxRules.SPLIT_DEFAULT, JetxRules.splitAt(10f, 0f), 0f)
    }

    @Test fun siteAddressesAreCleanedLikeTheApiDoes() {
        assertEquals("https://example.com", JetxRules.siteUrl("example.com"))
        assertEquals("https://bet.example.ng/jetx?x=1", JetxRules.siteUrl("  https://bet.example.ng/jetx?x=1 "))
        assertEquals("http://bet.example.com", JetxRules.siteUrl("http://bet.example.com"))
        assertEquals("https://bet.example.com:8443/a", JetxRules.siteUrl("bet.example.com:8443/a"))
        assertNull(JetxRules.siteUrl(""))
        assertNull(JetxRules.siteUrl(null))
        assertNull(JetxRules.siteUrl("javascript:alert(1)"))
        assertNull(JetxRules.siteUrl("file:///sdcard/x.html"))
        assertNull(JetxRules.siteUrl("intent://x#Intent;end"))
        assertNull(JetxRules.siteUrl("localhost"))
        assertNull(JetxRules.siteUrl("two words.com"))
        assertNull(JetxRules.siteUrl("https://user:secret@bet.example.com/")) // never a login in the address
        assertNull(JetxRules.siteUrl("https://bet.example.com/" + "a".repeat(500)))
    }

    @Test fun onlyThePredictorIsThePredictor() {
        assertTrue(JetxRules.isPredictor("https://crash.apparatus.name.ng/#/settings"))
        assertTrue(JetxRules.isPredictor("https://Crash.Apparatus.name.ng:443/"))
        assertFalse(JetxRules.isPredictor("http://crash.apparatus.name.ng/"))
        assertFalse(JetxRules.isPredictor("https://crash.apparatus.name.ng.evil.com/"))
        assertFalse(JetxRules.isPredictor("https://evil.com/?u=https://crash.apparatus.name.ng"))
        assertFalse(JetxRules.isPredictor("https://chat.apparatus.name.ng/"))
        assertTrue(JetxRules.predictorKeeps("https://api.apparatus.name.ng/auth/verify"))
        assertFalse(JetxRules.predictorKeeps("https://bet.example.com/"))
    }

    @Test fun thePredictorOnlyLearnsTheSitesHost() {
        assertEquals("bet.example.com", JetxRules.hostOf("https://bet.example.com/game?token=abc#s"))
        assertNull(JetxRules.hostOf(null))
        val s = JetxRules.session(JetxRules.Site.LOADED, "https://bet.example.com/play?session=SECRET")
        assertEquals("loaded", s.getString("status"))
        assertEquals("bet.example.com", s.getString("host"))
        assertFalse(s.toString().contains("SECRET"))
        assertTrue(JetxRules.session(JetxRules.Site.NONE, null).isNull("host"))
    }

    @Test fun statusSaysNothingIsClickedYet() {
        val st = JetxRules.status("0.34.0", JetxRules.Mode.AI, JetxRules.Layout.GAME, JetxRules.Site.LOADING,
            "https://bet.example.com/x")
        assertEquals("colonjetx", st.getString("app"))
        assertEquals("ai", st.getString("mode"))
        assertEquals("game", st.getString("layout"))
        assertEquals("loading", st.getJSONObject("session").getString("status"))
        assertFalse(st.getBoolean("autoClick"))
        assertTrue("ready" in JetxRules.COMMANDS && "openSite" in JetxRules.COMMANDS)
        assertFalse("click" in JetxRules.COMMANDS || "readGame" in JetxRules.COMMANDS)
    }

    @Test fun onlyManualHasNoBanner() {
        assertNull(JetxRules.bannerFor(JetxRules.Mode.MANUAL))
        assertEquals("ai", JetxRules.bannerFor(JetxRules.Mode.AI))
        assertEquals("shared", JetxRules.bannerFor(JetxRules.Mode.SHARED))
    }

    @Test fun theSavedSiteComesFromCrashSettings() {
        val body = JSONObject().put("settings", JSONObject().put("site_url", "https://bet.example.com/")).toString()
        assertEquals("https://bet.example.com/", JetxRules.siteFromSettings(body))
        assertNull(JetxRules.siteFromSettings("""{"settings":{"site_url":null}}"""))
        assertNull(JetxRules.siteFromSettings("""{"settings":{"site_url":"javascript:alert(1)"}}"""))
        assertNull(JetxRules.siteFromSettings("""{"error":"auth_required"}"""))
        assertNull(JetxRules.siteFromSettings("not json"))
        assertNull(JetxRules.siteFromSettings(null))
    }

    @Test fun theUsersEditWinsUntilTheSavedSiteChanges() {
        val a = "https://a.example.com/"
        val b = "https://b.example.com/"
        val mine = "https://mine.example.com/"
        assertEquals(a, JetxRules.pickSite(null, null, a))          // first run: the saved site
        assertEquals(mine, JetxRules.pickSite(mine, a, a))          // edited on the phone: kept
        assertEquals(b, JetxRules.pickSite(mine, a, b))             // changed in Settings since: the new one
        assertEquals(mine, JetxRules.pickSite(mine, a, null))       // signed out or offline: kept
        assertNull(JetxRules.pickSite(null, null, null))
    }
}
