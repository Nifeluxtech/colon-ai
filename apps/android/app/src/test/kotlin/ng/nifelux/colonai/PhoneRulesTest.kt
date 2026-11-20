package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** OS Assistant Step 2: the phone-control allowlist and app-name matching. */
class PhoneRulesTest {
    private fun j(s: String) = JSONObject(s)

    @Test fun onlyKnownActionsWithGoodArgumentsPass() {
        assertNull(PhoneRules.check(j("""{"action":"open_app","name":"WhatsApp"}""")))
        assertNull(PhoneRules.check(j("""{"action":"settings","page":"wifi","toggle":"on"}""")))
        assertNull(PhoneRules.check(j("""{"action":"torch","on":true}""")))
        assertNull(PhoneRules.check(j("""{"action":"volume","op":"set","level":40}""")))
        assertNull(PhoneRules.check(j("""{"action":"media","op":"next"}""")))
        assertNull(PhoneRules.check(j("""{"action":"dial","number":"+234 803 123-4567"}""")))
        assertNull(PhoneRules.check(j("""{"action":"sms","number":"08031234567","body":"on my way"}""")))
        assertNull(PhoneRules.check(j("""{"action":"alarm","hour":6,"minute":30}""")))
        assertNull(PhoneRules.check(j("""{"action":"timer","seconds":300}""")))
        assertNull(PhoneRules.check(j("""{"action":"navigate","place":"Ikeja City Mall"}""")))
        assertNull(PhoneRules.check(j("""{"action":"camera"}""")))
    }

    @Test fun anythingElseIsRefused() {
        assertEquals("unknown_action", PhoneRules.check(j("""{"action":"call_now","number":"112"}""")))
        assertEquals("unknown_action", PhoneRules.check(j("""{"action":"uninstall","name":"x"}""")))
        assertEquals("unknown_action", PhoneRules.check(j("""{}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"settings","page":"developer"}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"torch","on":"yes"}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"volume","op":"set","level":400}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"dial","number":"*#06#"}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"alarm","hour":24,"minute":0}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"timer","seconds":0}""")))
        assertEquals("bad_args", PhoneRules.check(j("""{"action":"open_app","name":"<script>"}""")))
    }

    @Test fun appsMatchByLabelThenWordThenContains() {
        val apps = listOf("WhatsApp" to "com.whatsapp", "WhatsApp Business" to "com.whatsapp.w4b",
            "X" to "com.twitter.android", "Google Play Store" to "com.android.vending", "OPay" to "team.opay",
            "Phone" to "com.android.dialer", "Calculator" to "com.transsion.calculator")
        assertEquals("com.whatsapp", PhoneRules.matchApp("whatsapp", apps))
        assertEquals("com.whatsapp.w4b", PhoneRules.matchApp("WhatsApp business", apps))
        assertEquals("com.twitter.android", PhoneRules.matchApp("twitter", apps))
        assertEquals("com.android.vending", PhoneRules.matchApp("play store", apps))
        assertEquals("team.opay", PhoneRules.matchApp("opay", apps))
        assertEquals("com.android.dialer", PhoneRules.matchApp("dialler", apps))
        assertEquals("com.transsion.calculator", PhoneRules.matchApp("calc", apps))
        assertNull(PhoneRules.matchApp("telegram", apps))
        assertNull(PhoneRules.matchApp("p", apps))
    }

    @Test fun spokenAnswers() {
        assertEquals("6:30 AM", PhoneRules.clock(6, 30))
        assertEquals("12:05 PM", PhoneRules.clock(12, 5))
        assertEquals("12:00 AM", PhoneRules.clock(0, 0))
        assertEquals("1 hour 30 minutes", PhoneRules.duration(5400))
        assertEquals("45 seconds", PhoneRules.duration(45))
        assertEquals("08031234567", PhoneRules.number("0803 123-4567"))
    }
}
