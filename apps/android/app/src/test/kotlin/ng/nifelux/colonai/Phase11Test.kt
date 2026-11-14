package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.11.0: Colon Secured Login rules, the step timeline, scheduled-run consent and the new bridge fields. */
class Phase11Test {
    @Test fun vaultSiteAndPageMatching() {
        assertEquals("github.com", VaultRules.site("https://www.GitHub.com/login?x=1"))
        assertEquals("github.com", VaultRules.site("github.com"))
        assertNull(VaultRules.site("not a site"))
        assertNull(VaultRules.site("javascript:alert(1)"))
        assertTrue(VaultRules.pageMatches("https://github.com/login", "github.com"))
        assertTrue(VaultRules.pageMatches("https://accounts.github.com/", "github.com"))
        assertFalse(VaultRules.pageMatches("https://github.com.evil.ng/login", "github.com"))
        assertFalse(VaultRules.pageMatches("https://evilgithub.com/", "github.com"))
        assertFalse(VaultRules.pageMatches("http://github.com/login", "github.com")) // never over plain http
    }

    @Test fun vaultUseNeedsTrustThenOneApprovalPerSite() {
        val e = VaultRules.entryOf("github.com", "ada@example.com", "s3cret!", false, 1L)!!
        assertEquals(VaultRules.Use.NO_LOGIN, VaultRules.use(null, "github.com", "https://github.com/login"))
        assertEquals(VaultRules.Use.NOT_TRUSTED, VaultRules.use(e, "github.com", "https://github.com/login"))
        val t = e.copy(trusted = true)
        assertEquals(VaultRules.Use.WRONG_PAGE, VaultRules.use(t, "github.com", "https://gitlab.com/login"))
        assertEquals(VaultRules.Use.ASK, VaultRules.use(t, "github.com", "https://github.com/login"))
        assertEquals(VaultRules.Use.FILL, VaultRules.use(t.copy(approved = true), "github.com",
            "https://github.com/login"))
        assertEquals("no_login", VaultRules.errorOf(VaultRules.Use.NO_LOGIN))
        assertNull(VaultRules.errorOf(VaultRules.Use.FILL))
    }

    @Test fun vaultMasksAndRoundTripsWithoutLeakingInErrors() {
        assertEquals("ad•••@example.com", VaultRules.mask("ada.lovelace@example.com"))
        assertEquals("n•••", VaultRules.mask("nife"))
        assertNull(VaultRules.entryOf("github.com", "", "x", true, 0L))
        assertNull(VaultRules.entryOf("github.com", "me", "", true, 0L))
        val a = VaultRules.entryOf("github.com", "me", "pw1", true, 1L)!!
        val b = VaultRules.entryOf("gitlab.com", "me", "pw2", false, 2L)!!
        val list = VaultRules.upsert(VaultRules.upsert(emptyList(), a), b)
        val back = VaultRules.fromJson(VaultRules.toJson(VaultRules.upsert(list, a.copy(pass = "pw3"))))
        assertEquals(listOf("github.com", "gitlab.com"), back.map { it.site })
        assertEquals("pw3", back[0].pass)
        assertEquals(emptyList<VaultRules.Entry>(), VaultRules.fromJson("garbage"))
    }

    @Test fun timelineHidesSecretTypedValues() {
        assertEquals("typed", StepLog.kindOf("fill"))
        assertEquals("opened", StepLog.kindOf("open_url"))
        assertEquals("\"rice\"", StepLog.typed("rice", false, null))
        assertEquals("•••• (7 characters)", StepLog.typed("hunter2", true, null))
        assertTrue(StepLog.typed("ada@example.com", false, null).startsWith("••••"))
        assertTrue(StepLog.typed("08031234567", false, null).startsWith("••••"))
        assertTrue(StepLog.typed("Tr0ub4dor&3", false, null).startsWith("••••"))
        assertTrue(StepLog.typed("lagos rice price", false, "personal_data").startsWith("••••"))
        val label = StepLog.label("fill", "Typing your password", JSONObject().put("value", "S3cret!pw"), true)
        assertFalse(label.contains("S3cret"))
        assertTrue(StepLog.looksLikePassword("Passw0rd!"))
        assertFalse(StepLog.looksLikePassword("https://jumia.com.ng/rice"))
        assertFalse(StepLog.looksLikePassword("hello world"))
        var list = emptyList<StepLog.Step>()
        repeat(StepLog.MAX + 5) { list = StepLog.add(list, StepLog.Step(it + 1, "read", "x", "")) }
        assertEquals(StepLog.MAX, list.size)
        assertEquals(StepLog.fromJson(StepLog.toJson(list)), list)
    }

    @Test fun scheduledRunsSwitchOnlyWhenIdleAndAllowed() {
        assertTrue(ScheduleConsent.switches(allowed = true, liveHere = false, sameChat = false))
        assertFalse(ScheduleConsent.switches(allowed = false, liveHere = false, sameChat = false))
        assertFalse(ScheduleConsent.switches(allowed = true, liveHere = true, sameChat = false))
        assertFalse(ScheduleConsent.switches(allowed = true, liveHere = false, sameChat = true))
    }

    @Test fun bridgeCarriesStepAndScheduledAndNewCommands() {
        val c = BridgeProtocol.parse("""{"type":"command","id":"c1","name":"sign_in","args":{"site":"github.com"},"step":4}""")
            as BridgeProtocol.Incoming.Command
        assertEquals(4, c.step)
        val k = BridgeProtocol.parse("""{"type":"control","mode":"ai","task":"x","scheduled":{"id":3,"name":"yolotask"}}""")
            as BridgeProtocol.Incoming.Control
        assertEquals(3L, k.scheduled?.id)
        assertEquals("yolotask", k.scheduled?.name)
        assertTrue("sign_in" in BridgeProtocol.COMMANDS && "extract" in BridgeProtocol.COMMANDS)
        assertTrue(SagaApproval.KINDS.indexOf("delete") < SagaApproval.KINDS.indexOf("send_message"))
    }
}
