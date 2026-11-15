package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.11.6: a saved login matches its domain family (VaultRules, pure; no Keystore, no Android). Owner's report: a
 *  login for yolotask.com.ng didn't match sign_in for reviewer.yolotask.com.ng (exact host match only). */
class VaultRulesTest {
    private fun e(site: String, at: Long = 0L) = VaultRules.Entry(site, "u@$site", "p", trusted = true, savedAt = at)

    @Test fun registrableDomainWithCountrySecondLevels() {
        assertEquals("yolotask.com.ng", VaultRules.registrable("reviewer.yolotask.com.ng"))
        assertEquals("yolotask.com.ng", VaultRules.registrable("yolotask.com.ng"))
        assertEquals("github.com", VaultRules.registrable("accounts.github.com"))
        assertEquals("bbc.co.uk", VaultRules.registrable("www.bbc.co.uk"))
        assertEquals("jumia.ng", VaultRules.registrable("my.jumia.ng"))
        assertNull(VaultRules.registrable("com.ng"))
        assertNull(VaultRules.registrable("com"))
    }

    @Test fun exactThenLongestParentThenSubdomain() {
        val parent = e("yolotask.com.ng")
        val child = e("reviewer.yolotask.com.ng")
        // The site's own entry first.
        assertEquals(child, VaultRules.match(listOf(parent, child), "reviewer.yolotask.com.ng"))
        assertEquals(parent, VaultRules.match(listOf(child, parent), "yolotask.com.ng"))
        // A parent's login serves its subdomain (the bug), the longest parent winning.
        assertEquals(parent, VaultRules.match(listOf(parent), "reviewer.yolotask.com.ng"))
        val mid = e("a.yolotask.com.ng")
        assertEquals(mid, VaultRules.match(listOf(parent, mid), "x.a.yolotask.com.ng"))
        // The other way round: a subdomain's login when the parent is asked for (shortest, then newest).
        assertEquals(child, VaultRules.match(listOf(child), "yolotask.com.ng"))
        val deep = e("x.reviewer.yolotask.com.ng")
        assertEquals(child, VaultRules.match(listOf(deep, child), "yolotask.com.ng"))
        val newer = e("admin.yolotask.com.ng", 2L)
        assertEquals(newer, VaultRules.match(listOf(newer, child), "yolotask.com.ng"))
    }

    @Test fun neverAcrossDomainsSiblingsOrSuffixes() {
        assertNull(VaultRules.match(listOf(e("reviewer.yolotask.com.ng")), "admin.yolotask.com.ng")) // a sibling
        assertNull(VaultRules.match(listOf(e("yolotask.com.ng")), "evilyolotask.com.ng"))
        assertNull(VaultRules.match(listOf(e("yolotask.com.ng")), "yolotask.com.ng.evil.ng"))
        assertNull(VaultRules.match(listOf(e("com.ng")), "yolotask.com.ng"))           // a public suffix
        assertNull(VaultRules.match(listOf(e("github.com")), "gitlab.com"))
        assertNull(VaultRules.match(emptyList(), "github.com"))
    }

    @Test fun pageMatchesStaysHttpsAndOnTheSameRegistrableDomain() {
        assertTrue(VaultRules.pageMatches("https://reviewer.yolotask.com.ng/login", "yolotask.com.ng"))
        assertTrue(VaultRules.pageMatches("https://yolotask.com.ng/login", "reviewer.yolotask.com.ng"))
        assertTrue(VaultRules.pageMatches("https://accounts.github.com/", "github.com"))
        assertFalse(VaultRules.pageMatches("http://reviewer.yolotask.com.ng/login", "yolotask.com.ng"))
        assertFalse(VaultRules.pageMatches("https://admin.yolotask.com.ng/", "reviewer.yolotask.com.ng"))
        assertFalse(VaultRules.pageMatches("https://evil.com.ng/", "com.ng"))
        assertFalse(VaultRules.pageMatches("https://github.com.evil.ng/login", "github.com"))
        assertFalse(VaultRules.pageMatches("https://evilgithub.com/", "github.com"))
    }

    @Test fun useFollowsTheFamilyMatch() {
        val entry = VaultRules.match(listOf(e("yolotask.com.ng").copy(approved = true)), "reviewer.yolotask.com.ng")
        assertEquals(VaultRules.Use.FILL, VaultRules.use(entry, "reviewer.yolotask.com.ng",
            "https://reviewer.yolotask.com.ng/login"))
        assertEquals(VaultRules.Use.WRONG_PAGE, VaultRules.use(entry, "reviewer.yolotask.com.ng",
            "https://jumia.com.ng/login"))
        assertEquals(VaultRules.Use.NO_LOGIN, VaultRules.use(null, "reviewer.yolotask.com.ng", null))
    }
}
