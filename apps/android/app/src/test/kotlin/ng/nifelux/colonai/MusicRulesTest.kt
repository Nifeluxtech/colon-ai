package ng.nifelux.colonai

import io.github.hitenpatel.songprint.SignatureGenerator
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

/** OS Assistant Step 3: the Colon Music allowlist, song matching, and the vendored songprint generator. */
class MusicRulesTest {
    private fun j(s: String) = JSONObject(s)

    @Test fun onlyKnownActionsWithGoodArgumentsPass() {
        assertNull(MusicRules.check(j("""{"action":"play","query":"last last","source":"any"}""")))
        assertNull(MusicRules.check(j("""{"action":"play","query":"*","source":"phone"}""")))
        assertNull(MusicRules.check(j("""{"action":"open","service":"youtube","query":"calm down"}""")))
        assertNull(MusicRules.check(j("""{"action":"identify"}""")))
        assertNull(MusicRules.check(j("""{"action":"play_url","url":"https://prod-1.storage.jamendo.com/?trackid=1",
            "title":"Song","artist":"Band"}""")))
        assertEquals("unknown_action", MusicRules.check(j("""{"action":"delete_all"}""")))
        assertEquals("bad_args", MusicRules.check(j("""{"action":"play","query":""}""")))
        assertEquals("bad_args", MusicRules.check(j("""{"action":"open","service":"spotify","query":"x"}""")))
        assertEquals("bad_args", MusicRules.check(j("""{"action":"play_url","url":"https://evil.example/a.mp3",
            "title":"x"}""")))
        assertEquals("bad_args", MusicRules.check(j("""{"action":"play_url","url":"http://jamendo.com/a",
            "title":"x"}""")))
    }

    @Test fun jamendoHostsOnly() {
        assertTrue(MusicRules.jamendoUrl("https://jamendo.com/track/1"))
        assertTrue(MusicRules.jamendoUrl("https://prod-1.storage.jamendo.com/?trackid=1&format=mp32"))
        assertFalse(MusicRules.jamendoUrl("https://jamendo.com.evil.example/x"))
        assertFalse(MusicRules.jamendoUrl("https://notjamendo.com/x"))
    }

    @Test fun everyWordMustMatchAndTheWholeTitleWins() {
        assertEquals(0, MusicRules.score("last last", "Kilometre", "Burna Boy", "Love, Damini"))
        val exact = MusicRules.score("Last Last", "Last Last", "Burna Boy", "Love, Damini")
        val loose = MusicRules.score("last", "Last Last", "Burna Boy", "")
        assertTrue(exact > loose)
        assertTrue(MusicRules.score("last last by burna boy", "Last Last", "Burna Boy", "") > 0)
        assertTrue(MusicRules.score("burna boy", "Last Last", "Burna Boy", "") > 0)
        assertTrue(MusicRules.score("Beyonce", "Halo", "Beyoncé", "") > 0)
    }

    @Test fun libraryAndTags() {
        assertTrue(MusicRules.wantsAll("*"))
        assertTrue(MusicRules.wantsAll("my music"))
        assertFalse(MusicRules.wantsAll("burna boy"))
        assertFalse(MusicRules.tagged("track01", "<unknown>", "track01.mp3"))
        assertFalse(MusicRules.tagged("AUD-2024", "Someone", "AUD-2024.mp3"))
        assertTrue(MusicRules.tagged("Essence", "Wizkid", "essence.mp3"))
        assertEquals("Essence by Wizkid", MusicRules.describe("Essence", "Wizkid"))
        assertEquals("https://www.youtube.com/results?search_query=calm+down",
            MusicRules.serviceUrl("youtube", "calm down") { it.replace(' ', '+') })
    }

    @Test fun songprintMakesASignature() {
        val tone = ShortArray(16000 * 4) { i -> (8000 * sin(2 * PI * 880 * i / 16000.0)).toInt().toShort() }
        val sig = SignatureGenerator().generateSignature(tone)
        assertTrue(sig.size >= 48)
    }
}
