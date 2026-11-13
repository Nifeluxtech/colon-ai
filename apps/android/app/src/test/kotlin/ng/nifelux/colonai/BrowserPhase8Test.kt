package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Phase 8 (v0.8.0): tab persistence, private tabs, Custom Tab sign-in hosts, desktop site, panel layouts. */
class TabSnapshotTest {
    private val tabs = listOf(
        TabSnapshot.Tab("a", "https://punchng.com/", "Punch"),
        TabSnapshot.Tab("p", "https://bank.example/", "Private", incognito = true),
        TabSnapshot.Tab("h", UrlRules.HOME, ""),
        TabSnapshot.Tab("d", "https://www.bbc.com/pidgin", "BBC Pidgin", desktop = true),
    )

    @Test fun roundTripKeepsUrlsTitlesAndOrderButNeverPrivateTabs() {
        val json = TabSnapshot.encode(tabs, "d")
        assertFalse(json.contains("bank.example"))
        val back = TabSnapshot.decode(json, 30)
        assertEquals(listOf("a", "h", "d"), back.tabs.map { it.id })
        assertEquals("Punch", back.tabs[0].title)
        assertTrue(back.tabs[2].desktop)
        assertEquals("d", back.activeId)
        assertTrue(back.tabs.none { it.incognito })
    }

    @Test fun activePrivateTabFallsBackToLastSavedTab() {
        val back = TabSnapshot.decode(TabSnapshot.encode(tabs, "p"), 30)
        assertEquals("d", back.activeId)
    }

    @Test fun readsV07FormatAndDropsUnsafeOrBrokenEntries() {
        val v07 = """{"active":"t2","tabs":[{"id":"t1","url":"https://a.ng","title":"A"},
            {"id":"t2","url":"javascript:alert(1)","title":"x"},{"id":"t3","url":"file:///sdcard/x","title":"f"},
            {"id":"t1","url":"https://b.ng","title":"dup id"},{"url":"https://c.ng","incognito":true}]}"""
        val s = TabSnapshot.decode(v07, 30)
        assertEquals(listOf("https://a.ng", "https://b.ng"), s.tabs.map { it.url })
        assertEquals(2, s.tabs.map { it.id }.toSet().size) // a duplicate id gets a fresh one
        assertEquals(s.tabs.last().id, s.activeId)          // the saved active tab was dropped
        assertTrue(TabSnapshot.decode("not json", 30).tabs.isEmpty())
        assertTrue(TabSnapshot.decode(null, 30).tabs.isEmpty())
        assertNull(TabSnapshot.decode("{}", 30).activeId)
    }

    @Test fun capsTabsAndTitles() {
        val many = (1..40).map { TabSnapshot.Tab("t$it", "https://x$it.ng", "T".repeat(500)) }
        val s = TabSnapshot.decode(TabSnapshot.encode(many, null), 10)
        assertEquals(10, s.tabs.size)
        assertEquals(200, s.tabs[0].title.length)
    }
}

class PrivateBrowsingTest {
    @Test fun privateTabsRecordNoHistory() {
        assertFalse(PrivateBrowsing.recordsHistory(true, "https://a.ng"))
        assertTrue(PrivateBrowsing.recordsHistory(false, "https://a.ng"))
        assertFalse(PrivateBrowsing.recordsHistory(false, UrlRules.HOME))
    }

    @Test fun sessionEndsWithTheLastPrivateTab() {
        assertFalse(PrivateBrowsing.sessionEnded(listOf(false, true)))
        assertTrue(PrivateBrowsing.sessionEnded(listOf(false, false)))
        assertTrue(PrivateBrowsing.sessionEnded(emptyList()))
    }

    @Test fun staleProfilesAreOnlyOldPrivateOnes() {
        val now = PrivateBrowsing.profileName(1000)
        val old = PrivateBrowsing.profileName(999)
        assertTrue(now.startsWith(PrivateBrowsing.PROFILE_PREFIX))
        assertEquals(listOf(old), PrivateBrowsing.staleProfiles(listOf("Default", now, old), now))
        assertEquals(listOf(now, old), PrivateBrowsing.staleProfiles(listOf("Default", now, old), null))
    }

    @Test fun privateTabFooterIsHonestAboutOldWebViews() {
        assertTrue(HomePage.footer(true, true).contains("deleted"))
        assertTrue(HomePage.footer(true, false).contains("can't keep"))
        assertFalse(HomePage.html(emptyList(), true, private = true, separateCookies = false).contains("deleted"))
    }
}

class CustomTabRulesTest {
    @Test fun googleAndBankSignInLeaveTheWebView() {
        assertTrue(UrlRules.needsCustomTab("https://accounts.google.com/v3/signin/identifier?flowName=x"))
        assertTrue(UrlRules.needsCustomTab("https://ACCOUNTS.GOOGLE.COM/o/oauth2/auth"))
        assertTrue(UrlRules.needsCustomTab("https://ibank.zenithbank.com/InternetBanking/login"))
        assertFalse(UrlRules.needsCustomTab("http://accounts.google.com/"))          // https only
        assertFalse(UrlRules.needsCustomTab("https://www.google.com/search?q=jamb"))  // search stays in the tab
        assertFalse(UrlRules.needsCustomTab("https://accounts.google.com.evil.ng/"))
        assertFalse(UrlRules.needsCustomTab("https://evil.ng/?next=https://accounts.google.com"))
        assertFalse(UrlRules.needsCustomTab(null))
        assertFalse(UrlRules.needsCustomTab("javascript:alert(1)"))
    }

    @Test fun buildTimeHostsAndSubdomainRules() {
        assertFalse(UrlRules.needsCustomTab("https://login.mybank.ng/"))
        assertTrue(UrlRules.needsCustomTab("https://login.mybank.ng/", "ibank.other.ng, login.mybank.ng"))
        assertTrue(UrlRules.needsCustomTab("https://a.b.mybank.ng/", ".mybank.ng"))
        assertTrue(UrlRules.needsCustomTab("https://mybank.ng/", ".mybank.ng"))
        assertFalse(UrlRules.needsCustomTab("https://notmybank.ng/", ".mybank.ng"))
        assertTrue(UrlRules.hostMatches("Accounts.Google.com.", "accounts.google.com"))
        assertFalse(UrlRules.hostMatches("x.ng", ""))
    }
}

class UserAgentsTest {
    private val mobile = "Mozilla/5.0 (Linux; Android 14; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36"

    @Test fun desktopSiteDropsMobileMarkers() {
        val d = UserAgents.desktop(mobile)
        assertFalse(d.contains("Android"))
        assertFalse(d.contains("Mobile"))
        assertFalse(d.contains("; wv"))
        assertFalse(d.contains("Version/4.0"))
        assertTrue(d.contains("Chrome/131.0.6778.135"))
        assertTrue(d.contains("(X11; Linux x86_64)"))
        assertTrue(UserAgents.isDesktop(d))
        assertFalse(UserAgents.isDesktop(mobile))
    }
}

class PanelLayoutTest {
    @Test fun modesAndShares() {
        assertEquals(PanelLayout.Mode.INLINE, PanelLayout.defaultMode(360))  // v0.9.1: phones open in the thread
        assertEquals(PanelLayout.Mode.SPLIT, PanelLayout.defaultMode(800))
        assertEquals(PanelLayout.Mode.FULL, PanelLayout.Mode.from("full"))
        assertNull(PanelLayout.Mode.from("floating"))
        assertEquals(1f, PanelLayout.panelShare(PanelLayout.Mode.FULL, false, .5f))
        assertEquals(0f, PanelLayout.panelShare(PanelLayout.Mode.EMBEDDED, true, .5f))
        assertEquals(.75f, PanelLayout.panelShare(PanelLayout.Mode.SPLIT, false, .95f))
        assertEquals(PanelLayout.EMBEDDED_SHARE, PanelLayout.clampShare(Float.NaN))
    }

    @Test fun sideBySideOnlyOnWideLandscapeSplit() {
        assertTrue(PanelLayout.sideBySide(PanelLayout.Mode.SPLIT, 900, 600))
        assertFalse(PanelLayout.sideBySide(PanelLayout.Mode.SPLIT, 400, 800))
        assertFalse(PanelLayout.sideBySide(PanelLayout.Mode.SPLIT, 800, 1200))  // tall tablet: stacked
        assertFalse(PanelLayout.sideBySide(PanelLayout.Mode.EMBEDDED, 900, 600))
    }

    @Test fun dividerDrag() {
        assertEquals(.5f, PanelLayout.shareFromDrag(500f, 1000f, false), .001f)
        assertEquals(.3f, PanelLayout.shareFromDrag(700f, 1000f, true), .001f)    // panel on the right
        assertEquals(.25f, PanelLayout.shareFromDrag(10f, 1000f, false), .001f)   // clamped
    }
}

class BrowserDataTest {
    @Test fun onlyColonSessionCookiesAreKeptAndColonStorageStays() {
        assertEquals(listOf("colon_sid=abc", "colon_gid=g"),
            BrowserData.keptCookies("theme=dark; colon_sid=abc;colon_gid=g; colon_sidx=no"))
        assertTrue(BrowserData.keptCookies(null).isEmpty())
        assertEquals(listOf("https://punchng.com"), BrowserData.originsToClear(
            listOf("https://punchng.com", "https://chat.apparatus.name.ng", "https://api.apparatus.name.ng/")))
    }

    @Test fun downloadsListNewestFirstWithoutDuplicates() {
        var l = emptyList<BrowserStore.Download>()
        l = BrowserStore.Lists.addDownload(l, BrowserStore.Download(1, "a.pdf", "https://a", 1), 2)
        l = BrowserStore.Lists.addDownload(l, BrowserStore.Download(2, "b.pdf", "https://b", 2), 2)
        l = BrowserStore.Lists.addDownload(l, BrowserStore.Download(1, "a.pdf", "https://a", 3), 2)
        assertEquals(listOf(1L, 2L), l.map { it.id })
        l = BrowserStore.Lists.addDownload(l, BrowserStore.Download(3, "c.pdf", "https://c", 4), 2)
        assertEquals(listOf(3L, 1L), l.map { it.id })
    }
}

class FlavorUpdateTest {
    private val manifest = """{"versionName":"0.8.0","versionCode":800,
        "apkUrl":"https://github.com/Nifeluxtech/colon-ai/releases/download/v0.8.0/colon-ai-0.8.0.apk",
        "releaseUrl":"https://github.com/Nifeluxtech/colon-ai/releases/tag/v0.8.0","minSupportedVersionCode":0,
        "browser":{"versionName":"0.8.1","versionCode":801,
          "apkUrl":"https://github.com/Nifeluxtech/colon-ai/releases/download/v0.8.1/colon-browser-0.8.1.apk",
          "releaseUrl":"https://github.com/Nifeluxtech/colon-ai/releases/tag/v0.8.1","minSupportedVersionCode":0}}"""

    @Test fun eachAppReadsItsOwnEntry() {
        val ai = VersionManifest.forApp(manifest, VersionManifest.APP_COLON_AI)!!
        val br = VersionManifest.forApp(manifest, VersionManifest.APP_COLON_BROWSER)!!
        assertEquals(800, ai.versionCode)
        assertTrue(ai.apkUrl.endsWith("/colon-ai-0.8.0.apk"))
        assertEquals(801, br.versionCode)
        assertTrue(br.apkUrl.endsWith("/colon-browser-0.8.1.apk"))
        assertNull(VersionManifest.forApp(manifest, "other"))
    }

    @Test fun oldManifestWithoutBrowserEntryMeansNoBrowserUpdate() {
        val v07 = JSONObject(manifest).apply { remove("browser") }.toString()
        assertEquals(800, VersionManifest.forApp(v07, VersionManifest.APP_COLON_AI)!!.versionCode)
        assertNull(VersionManifest.forApp(v07, VersionManifest.APP_COLON_BROWSER))
    }

    @Test fun anAppIsNeverOfferedTheOtherAppsApk() {
        val swapped = manifest.replace("colon-ai-0.8.0.apk", "colon-browser-0.8.0.apk")
        assertNull(VersionManifest.forApp(swapped, VersionManifest.APP_COLON_AI))
        val swapped2 = manifest.replace("colon-browser-0.8.1.apk", "colon-ai-0.8.1.apk")
        assertNull(VersionManifest.forApp(swapped2, VersionManifest.APP_COLON_BROWSER))
        assertNull(VersionManifest.forApp("garbage", VersionManifest.APP_COLON_AI))
        val fixedName = manifest.replace("v0.8.1/colon-browser-0.8.1.apk", "v0.8.1/colon-browser.apk")
        assertEquals(801, VersionManifest.forApp(fixedName, VersionManifest.APP_COLON_BROWSER)!!.versionCode)
    }

    @Test fun handoffTargetsThePartnerApp() {
        assertEquals(listOf("ng.nifelux.colonbrowser.debug", "ng.nifelux.colonbrowser"),
            Handoff.candidates("ng.nifelux.colonbrowser", true))
        assertEquals(listOf("ng.nifelux.colonai"), Handoff.candidates("ng.nifelux.colonai", false))
        assertTrue(Handoff.apkUrl("colonbrowser").endsWith("/releases/latest/download/colon-browser.apk"))
        assertTrue(Handoff.apkUrl("colonai").endsWith("/releases/latest/download/colon-ai.apk"))
        val self = if (BuildConfig.IS_BROWSER_APP) "colonbrowser" else "colonai"
        assertEquals(self, BuildConfig.APP_KEY)
        assertFalse(Handoff.partnerKey() == self)
    }
}
