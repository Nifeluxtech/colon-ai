package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class BackoffTest {
    @Test fun growsWithJitterAndCaps() {
        val b = Backoff(1_000, 60_000, Random(7))
        val delays = List(10) { b.next() }
        assertTrue(delays[0] in 500..1_000)
        assertTrue(delays[1] in 1_000..2_000)
        assertTrue(delays[3] in 4_000..8_000)
        assertTrue(delays.drop(6).all { it in 30_000..60_000 })
        b.reset()
        assertTrue(b.next() <= 1_000)
    }
}

class VersionManifestTest {
    private val ok = """{"versionName":"0.7.2","versionCode":702,
        "apkUrl":"https://github.com/Nifeluxtech/colon-ai/releases/download/v0.7.2/colon-ai-0.7.2.apk",
        "releaseUrl":"https://github.com/Nifeluxtech/colon-ai/releases/tag/v0.7.2","notes":"Fixes",
        "minSupportedVersionCode":0}"""

    @Test fun parsesAndCompares() {
        val m = VersionManifest.parse(ok)!!
        assertEquals(702, m.versionCode)
        assertTrue(m.isNewerThan(701))
        assertFalse(m.isNewerThan(702))
        assertFalse(m.isRequired(701))
    }

    @Test fun rejectsUnsafeOrBroken() {
        assertNull(VersionManifest.parse(ok.replace("https://github.com", "https://evil.example")))
        assertNull(VersionManifest.parse(ok.replace("0.7.2\"", "latest\"")))
        assertNull(VersionManifest.parse("not json"))
        assertNull(VersionManifest.parse("{}"))
    }

    @Test fun versionCodeRule() {
        assertEquals(701, VersionManifest.codeFor("0.7.1"))
        assertEquals(10000, VersionManifest.codeFor("1.0.0"))
        assertEquals(10203, VersionManifest.codeFor("1.2.3"))
    }
}

class BridgeProtocolTest {
    @Test fun parsesServerMessages() {
        val basic = BridgeProtocol.parse("""{"type":"hello","service":"colon-ai","ts":1}""")
        assertEquals(BridgeProtocol.Incoming.Hello(false, "colon-ai"), basic)
        val full = BridgeProtocol.parse("""{"type":"hello","service":"colon-ai","bridge":1}""")
        assertEquals(true, (full as BridgeProtocol.Incoming.Hello).bridge)
        val cmd = BridgeProtocol.parse("""{"type":"command","id":"c1","name":"open_url","args":{"url":"https://x.ng"}}""")
        assertTrue(cmd is BridgeProtocol.Incoming.Command)
        assertEquals("https://x.ng", (cmd as BridgeProtocol.Incoming.Command).args.getString("url"))
        val ctl = BridgeProtocol.parse("""{"type":"control","mode":"ai","task":"Find JAMB dates"}""")
        assertEquals(ControlState.Mode.AI, (ctl as BridgeProtocol.Incoming.Control).mode)
        assertEquals(BridgeProtocol.Incoming.Unknown, BridgeProtocol.parse("""{"type":"command","name":"x"}"""))
        assertEquals(BridgeProtocol.Incoming.Unknown, BridgeProtocol.parse("""{"type":"control","mode":"root"}"""))
        assertEquals(BridgeProtocol.Incoming.Unknown, BridgeProtocol.parse("garbage"))
        assertEquals(BridgeProtocol.Incoming.Pong, BridgeProtocol.parse("""{"type":"pong"}"""))
    }

    @Test fun buildsClientMessages() {
        val hello = org.json.JSONObject(BridgeProtocol.hello("0.7.1", 701, "d", 34, false, ControlState.Mode.MANUAL))
        assertEquals("hello", hello.getString("type"))
        assertEquals("android", hello.getString("client"))
        assertEquals("manual", hello.getString("control"))
        assertEquals(1, hello.getInt("v"))
        val ack = org.json.JSONObject(BridgeProtocol.ack("c1", false, error = "manual_control"))
        assertEquals("c1", ack.getString("ref"))
        assertEquals("manual_control", ack.getString("error"))
        val ping = org.json.JSONObject(BridgeProtocol.ping())
        assertEquals("ping", ping.getString("type"))  // the existing /ws gateway answers this with pong
        val st = org.json.JSONObject(BridgeProtocol.pageState(org.json.JSONObject().put("url", "https://a.ng")
            .put("type", "spoofed")))
        assertEquals("page_state", st.getString("type"))
    }
}

class ControlStateTest {
    @Test fun takeControlAndReturn() {
        val c = ControlState()
        assertFalse(c.canRunCommands())
        assertEquals("consent", c.grant(ControlState.Mode.AI, "task"))
        assertTrue(c.canRunCommands())
        assertEquals("pause", c.pause())
        assertFalse(c.canRunCommands())
        assertEquals("take_control", c.takeControl())
        assertEquals(ControlState.Mode.MANUAL, c.mode)
        assertFalse(c.paused)
        assertEquals("return_to_ai", c.returnToAi())
        assertEquals(ControlState.Mode.AI, c.mode)
        assertEquals("stop", c.stop())
        assertNull(c.returnToAi())
        assertNull(c.stop())
    }

    @Test fun sharedModeAndNoops() {
        val c = ControlState()
        assertNull(c.takeControl())
        assertNull(c.pause())
        assertEquals("consent", c.grant(ControlState.Mode.SHARED, null))
        assertNull(c.grant(ControlState.Mode.SHARED, null))
        assertEquals("stop", c.grant(ControlState.Mode.MANUAL, null))
    }
}

class TabPolicyTest {
    @Test fun discardsOldestBackgroundTabs() {
        val tabs = listOf(TabPolicy.Info("a", 1, true), TabPolicy.Info("b", 5, true),
            TabPolicy.Info("c", 3, true), TabPolicy.Info("d", 9, false))
        assertEquals(listOf("a"), TabPolicy.discards(tabs, "b", 2))
        assertEquals(listOf("c"), TabPolicy.discards(tabs, "a", 2))
        assertEquals(emptyList<String>(), TabPolicy.discards(tabs, "a", 3))
        assertEquals(listOf("a", "c"), TabPolicy.discards(tabs, "b", 1))
        assertEquals(2, TabPolicy.maxLiveFor(true, 512))
        assertEquals(5, TabPolicy.maxLiveFor(false, 512))
    }
}

class BrowserStoreTest {
    @Test fun historyMovesRevisitsToTopAndCaps() {
        var list = emptyList<BrowserStore.Entry>()
        list = BrowserStore.Lists.addHistory(list, BrowserStore.Entry("https://a", "A", 1), 2)
        list = BrowserStore.Lists.addHistory(list, BrowserStore.Entry("https://b", "B", 2), 2)
        list = BrowserStore.Lists.addHistory(list, BrowserStore.Entry("https://a", "A2", 3), 2)
        assertEquals(listOf("https://a", "https://b"), list.map { it.url })
        list = BrowserStore.Lists.addHistory(list, BrowserStore.Entry("https://c", "C", 4), 2)
        assertEquals(listOf("https://c", "https://a"), list.map { it.url })
    }
}

class HomePageTest {
    @Test fun escapesBookmarks() {
        val html = HomePage.html(listOf(BrowserStore.Entry("https://x.ng/?a=1&b=\"2\"", "<script>", 0)), true)
        assertFalse(html.contains("<script>"))
        assertTrue(html.contains("&lt;script&gt;"))
        assertTrue(html.contains("https://x.ng/?a=1&amp;b=&quot;2&quot;"))
        assertNotNull(Regex("<form action=\"https://www.google.com/search\"").find(html))
    }
}
