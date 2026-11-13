package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Phase 10 (v0.10.0): one browser per chat (profile names, LRU, drafts), modes and handoff (ControlState). */
class ChatSessionsTest {
    @Test fun eachConversationHasItsOwnProfileName() {
        assertEquals("c_8Fh2kQ", ChatSessionRules.keyOf("c_8Fh2kQ"))
        assertEquals("colon-chat-c_8Fh2kQ", ChatSessionRules.profileName("c_8Fh2kQ"))
        // Ids that are not plain letters, digits, _ or - (or too long) never become profile names as they are.
        assertNull(ChatSessionRules.keyOf("../etc"))
        assertNull(ChatSessionRules.keyOf(""))
        assertNull(ChatSessionRules.keyOf(null))
        assertNull(ChatSessionRules.keyOf("x".repeat(65)))
        val hashed = ChatSessionRules.profileName("a b/c")
        assertTrue(hashed.startsWith("colon-chat-"))
        assertEquals(11 + 32, hashed.length)
        // A conversation id can never pose as a draft.
        assertNull(ChatSessionRules.keyOf("draft-abc"))
    }

    @Test fun aNewChatIsADraftThatTheConversationAdopts() {
        val draft = ChatSessionRules.draftKey(1_700_000_000_000L)
        assertTrue(ChatSessionRules.isDraft(draft))
        assertFalse(ChatSessionRules.isDraft("c1"))
        assertEquals(listOf("c9", "c1", "c2"), ChatSessionRules.adopt(listOf(draft, "c1", "c2"), draft, "c9"))
        assertEquals(listOf("c1", "c2"), ChatSessionRules.adopt(listOf(draft, "c1", "c2"), draft, "c1"))
    }

    @Test fun leastRecentlyUsedChatsLoseTheirBrowserBeyondTheCap() {
        var order = emptyList<String>()
        for (k in listOf("a", "b", "c")) order = ChatSessionRules.touch(order, k, 3).first
        assertEquals(listOf("c", "b", "a"), order)
        val (next, evicted) = ChatSessionRules.touch(order, "d", 3)
        assertEquals(listOf("d", "c", "b"), next)
        assertEquals(listOf("a"), evicted)
        // Using a chat again moves it to the front without evicting anything.
        assertEquals(listOf("b", "d", "c") to emptyList<String>(), ChatSessionRules.touch(next, "b", 3))
        assertEquals(listOf("x") to listOf("b", "d", "c"), ChatSessionRules.touch(listOf("b", "d", "c"), "x", 1))
    }

    @Test fun staleProfilesAreOnlyChatProfilesNoKeptChatUses() {
        val all = listOf("Default", "colon-private-k3", "colon-chat-a", "colon-chat-b", "colon-chat-old")
        assertEquals(listOf("colon-chat-old"), ChatSessionRules.staleProfiles(all, listOf("colon-chat-a",
            "colon-chat-b")))
    }

    @Test fun theSharedProfileFallbackNeverClearsColonsOwnSites() {
        val urls = listOf("https://www.jumia.com.ng/x", "https://jumia.com.ng/y", "https://www.jumia.com.ng/z",
            "https://chat.apparatus.name.ng/#/c/1", "https://api.apparatus.name.ng/", "colon:home")
        assertEquals(listOf("https://www.jumia.com.ng", "https://jumia.com.ng"),
            ChatSessionRules.originsToClear(urls))
    }

    @Test fun chatModeIsAiOnlyOrAiPlusMe() {
        assertEquals("shared", ChatSessionRules.mode("shared"))
        assertEquals("ai", ChatSessionRules.mode("ai", "shared"))
        assertEquals("ai", ChatSessionRules.mode(null))
        assertEquals("shared", ChatSessionRules.mode("nonsense", "shared"))
    }

    @Test fun switchingModesNeverGivesSagaControl() {
        val c = ControlState()
        assertNull(c.switchMode(ControlState.Mode.SHARED)) // manual, no task: nothing to send
        assertEquals(ControlState.Mode.MANUAL, c.mode)
        assertEquals("consent", c.grant(ControlState.Mode.AI, "find fuel prices"))
        assertEquals("mode", c.switchMode(ControlState.Mode.SHARED))
        assertEquals(ControlState.Mode.SHARED, c.mode)
        assertNull(c.switchMode(ControlState.Mode.SHARED))
        assertNull(c.switchMode(ControlState.Mode.MANUAL))
        assertEquals("take_control", c.takeControl())
        // In manual it only changes what Return to AI goes back to.
        assertNull(c.switchMode(ControlState.Mode.AI))
        assertEquals("return_to_ai", c.returnToAi())
        assertEquals(ControlState.Mode.AI, c.mode)
    }

    @Test fun aHandoffPutsTheUserInControlAndReturnToAiResumes() {
        val c = ControlState()
        assertNull(c.handOff("password", "Enter your password here, then tap Return to AI."))
        c.grant(ControlState.Mode.AI, "sign in")
        assertEquals("handoff", c.handOff("password", "Enter your password here, then tap Return to AI."))
        assertEquals(ControlState.Mode.MANUAL, c.mode)
        assertFalse(c.canRunCommands())
        assertEquals("password", c.handoff?.kind)
        assertEquals("return_to_ai", c.returnToAi())
        assertEquals(ControlState.Mode.AI, c.mode)
        assertNull(c.handoff)
        c.handOff("one_time_code", "Enter the code you received here, then tap Return to AI.")
        assertEquals("stop", c.stop())
        assertNull(c.handoff)
        assertNull(c.returnToAi())
    }
}

/** Phase 10: the fields and pages Saga never fills (SecretFields; same cases as the server's saga-secrets test). */
class SecretFieldsTest {
    private fun f(tag: String = "input", type: String = "", autocomplete: String = "", name: String = "",
                  label: String = "", placeholder: String = "", inputmode: String = "", maxlength: Int = 0) =
        SecretFields.Field(tag = tag, type = type, autocomplete = autocomplete, name = name, label = label,
            placeholder = placeholder, inputmode = inputmode, maxlength = maxlength)

    @Test fun secretFields() {
        assertEquals("password", SecretFields.kindOf(f(type = "password")))
        assertEquals("password", SecretFields.kindOf(f(autocomplete = "current-password")))
        assertEquals("one_time_code", SecretFields.kindOf(f(autocomplete = "one-time-code")))
        assertEquals("one_time_code", SecretFields.kindOf(f(name = "otpCode")))
        assertEquals("one_time_code", SecretFields.kindOf(f(label = "Enter code", maxlength = 6)))
        assertEquals("card", SecretFields.kindOf(f(autocomplete = "billing cc-csc")))
        assertEquals("card", SecretFields.kindOf(f(name = "cardNumber")))
        assertEquals("card", SecretFields.kindOf(f(placeholder = "CVC")))
        assertEquals("pin", SecretFields.kindOf(f(name = "transactionPin")))
    }

    @Test fun ordinaryFields() {
        assertNull(SecretFields.kindOf(f(name = "q", label = "Search")))
        assertNull(SecretFields.kindOf(f(type = "email", name = "email")))
        assertNull(SecretFields.kindOf(f(name = "shipping_address")))
        assertNull(SecretFields.kindOf(f(label = "Name on card")))
        assertNull(SecretFields.kindOf(f(label = "Promo code")))
        assertNull(SecretFields.kindOf(f(tag = "a", label = "Forgot password?")))
        assertNull(SecretFields.kindOf(f(tag = "button", type = "submit", name = "password_submit")))
    }

    @Test fun pages() {
        assertEquals("sign_in", SecretFields.pageKind("https://accounts.google.com/v3/signin"))
        assertEquals("sign_in", SecretFields.pageKind("https://ibank.gtbank.com/"))
        assertEquals("sign_in", SecretFields.pageKind("https://www.jumia.com.ng/customer/account/login/"))
        assertEquals("payment", SecretFields.pageKind("https://checkout.paystack.com/abc123"))
        assertEquals("payment", SecretFields.pageKind("https://www.paypal.com/checkoutnow?token=x"))
        assertNull(SecretFields.pageKind("https://punchng.com/how-to-login-safely/"))
        assertNull(SecretFields.pageKind("https://www.paypal.com/ng/home"))
        assertEquals("sign_in", SecretFields.pageKind("https://ibank.example.ng/", "ibank.example.ng"))
    }

    @Test fun steps() {
        val search = f(name = "q", label = "Search")
        assertNull(SecretFields.forStep("fill", search, null, "https://shop.ng/", null))
        assertEquals("password", SecretFields.forStep("fill", search, "password", "https://shop.ng/", null))
        assertEquals("payment", SecretFields.forStep("fill", search, null, "https://checkout.paystack.com/x", null))
        assertEquals("password", SecretFields.forStep("click", f(type = "password"), null, null, null))
        assertNull(SecretFields.forStep("click", f(tag = "button", type = "submit"), "password", null, null))
        assertEquals("sign_in", SecretFields.forStep("open_url", null, null, null, "https://accounts.google.com/"))
        assertNull(SecretFields.forStep("open_url", null, null, null, "https://checkout.paystack.com/x"))
        assertNull(SecretFields.forStep("scroll", null, null, null, null))
    }
}
