package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlRulesTest {
    @Test fun originsAreNormalised() {
        assertEquals("https://chat.apparatus.name.ng", UrlRules.originOf("https://Chat.Apparatus.name.ng:443/c/1#x"))
        assertEquals("http://example.com:8080", UrlRules.originOf("http://example.com:8080/a"))
        assertNull(UrlRules.originOf("javascript:alert(1)"))
        assertNull(UrlRules.originOf("file:///sdcard/x"))
        assertNull(UrlRules.originOf(""))
    }

    @Test fun onlyColonPagesGetTheBridge() {
        assertTrue(UrlRules.isBridgeOrigin("https://chat.apparatus.name.ng/#/c/5"))
        assertTrue(UrlRules.isBridgeOrigin("https://browser.apparatus.name.ng/"))
        assertFalse(UrlRules.isBridgeOrigin("http://chat.apparatus.name.ng/"))          // not https
        assertFalse(UrlRules.isBridgeOrigin("https://chat.apparatus.name.ng.evil.com/"))
        assertFalse(UrlRules.isBridgeOrigin("https://evil.com/?u=https://chat.apparatus.name.ng"))
        assertFalse(UrlRules.isBridgeOrigin("https://api.apparatus.name.ng/"))         // shell yes, bridge no
        assertTrue(UrlRules.isShellUrl("https://api.apparatus.name.ng/auth/verify"))
    }

    @Test fun sessionCookieOnlyGoesToTheApi() {
        assertTrue(UrlRules.isColonApi("wss://api.apparatus.name.ng/ws"))
        assertFalse(UrlRules.isColonApi("wss://api.apparatus.name.ng.attacker.net/ws"))
        assertFalse(UrlRules.isColonApi("ws://api.apparatus.name.ng/ws"))
    }

    @Test fun addressBar() {
        assertEquals("https://punchng.com", UrlRules.addressToUrl("punchng.com"))
        assertEquals("https://www.bbc.com/pidgin", UrlRules.addressToUrl("www.bbc.com/pidgin"))
        assertEquals("http://example.com/x", UrlRules.addressToUrl("http://example.com/x"))
        assertEquals(UrlRules.SEARCH + "jollof%20rice", UrlRules.addressToUrl("jollof rice"))
        assertEquals(UrlRules.SEARCH + "javascript%3Aalert%281%29", UrlRules.addressToUrl("javascript:alert(1)"))
        assertTrue(UrlRules.addressToUrl("file:///etc/hosts")!!.startsWith(UrlRules.SEARCH))
        assertEquals("https://localhost:8080/a", UrlRules.addressToUrl("localhost:8080/a"))
        assertEquals(UrlRules.SEARCH + "file.txt1", UrlRules.addressToUrl("file.txt1"))
        assertNull(UrlRules.addressToUrl("   "))
        assertEquals(UrlRules.HOME, UrlRules.addressToUrl("colon:home"))
    }

    @Test fun updateApkHosts() {
        assertTrue(UrlRules.isAllowedApkUrl(
            "https://github.com/Nifeluxtech/colon-ai/releases/download/v0.7.1/colon-ai-0.7.1.apk"))
        assertFalse(UrlRules.isAllowedApkUrl("http://github.com/x.apk"))
        assertFalse(UrlRules.isAllowedApkUrl("https://evil.com/colon-ai.apk"))
        assertFalse(UrlRules.isAllowedApkUrl("https://github.com/x.zip"))
    }

    @Test fun htmlEscaping() {
        assertEquals("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;", UrlRules.html("<b>\"x\" & 'y'"))
        assertEquals("", UrlRules.displayUrl(UrlRules.HOME))
    }
}
