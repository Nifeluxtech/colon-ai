package ng.nifelux.colonai

import java.net.URI

/**
 * Secret forms Saga never fills (ROADMAP Phase 10). Pure, unit-tested in ChatSessionsTest (SecretFieldsTest).
 * Passwords, one-time / 2FA codes, card numbers, CVV and expiry, and PINs are the user's to type; so is everything
 * on a sign-in page (UrlRules' Custom Tab sign-in hosts, or a login / 2FA path) or a hosted payment page. When Saga's
 * next step targets one, BrowserSaga does not run it: the panel switches to Manual and asks the user to type it
 * ("Enter your password here, then tap Return to AI"), and the ack says `secret_field` so the server waits too.
 * Mirrors assets/saga/tools.js secretKind and services/api/src/modules/saga/secrets.js (the server's test keeps
 * the three in step on the same cases).
 */
object SecretFields {
    const val PASSWORD = "password"
    const val ONE_TIME_CODE = "one_time_code"
    const val CARD = "card"
    const val PIN = "pin"
    const val SIGN_IN = "sign_in"
    const val PAYMENT = "payment"

    private val AUTOCOMPLETE = mapOf(
        "current-password" to PASSWORD, "new-password" to PASSWORD, "one-time-code" to ONE_TIME_CODE,
        "cc-number" to CARD, "cc-csc" to CARD, "cc-exp" to CARD, "cc-exp-month" to CARD, "cc-exp-year" to CARD,
    )
    private val WORDS = listOf(
        PASSWORD to Regex("\\b(?:password|passwd|pwd|passphrase|secret)\\b"),
        ONE_TIME_CODE to Regex("\\b(?:otp|totp|2fa|mfa|one ?time(?: pass(?:word|code))?|onetime|verification code|" +
            "verify code|auth(?:entication)? code|access code|token code|sms code)\\b"),
        CARD to Regex("\\b(?:cvv2?|cvc2?|csc|security code|card ?(?:number|no|num)|cardnumber|ccnum|cc ?num|pan|" +
            "expiry|exp(?:iry)? date|card)\\b"),
        PIN to Regex("\\b(?:pin|passcode|transaction pin|atm pin)\\b"),
    )
    private val NOT_CARD = Regex("\\b(?:card ?holder|name on (?:the )?card|gift card|id card|card ?type)\\b")
    private val NOT_TYPED = setOf("submit", "button", "reset", "image", "checkbox", "radio", "hidden", "file")
    private val CODE = Regex("\\bcode\\b")

    private val PAYMENT_HOSTS = listOf("checkout.paystack.com", "paystack.shop", "checkout.flutterwave.com",
        "ravemodal.flwv.io", "webpay.interswitchng.com", "newwebpay.interswitchng.com", "pay.remita.net",
        "checkout.stripe.com", "www.paypal.com/checkoutnow", "checkout.opaycheckout.com", "pay.squadco.com",
        "checkout.monnify.com")
    private val SIGN_IN_PATH = Regex("(?:^|/)(?:log-?in|sign-?in|signin|sign_in|logon|auth(?:enticate)?|sso|" +
        "oauth2?/authorize|2fa|mfa|otp|verify-otp)(?:/|$|\\.)", RegexOption.IGNORE_CASE)
    private val PAYMENT_PATH = Regex("(?:^|/)(?:checkout|pay(?:ment)?s?)/(?:card|details|pay|confirm)(?:/|$)",
        RegexOption.IGNORE_CASE)

    /** One element as tools.js describes it (only the fields the rules read). */
    data class Field(
        val tag: String = "", val type: String = "", val autocomplete: String = "", val name: String = "",
        val id: String = "", val label: String = "", val placeholder: String = "", val inputmode: String = "",
        val maxlength: Int = 0, val contenteditable: Boolean = false,
    )

    /** "cardNumber" -> "card number", "otp_code" -> "otp code". */
    fun words(s: String): String = s.replace(Regex("([a-z])([A-Z])"), "$1 $2")
        .replace(Regex("[_\\-./\\[\\]:]+"), " ").lowercase().replace(Regex("\\s+"), " ").trim()

    /** password · one_time_code · card · pin, or null for an ordinary field. */
    fun kindOf(f: Field): String? {
        val type = f.type.lowercase()
        if (type == "password") return PASSWORD
        val tag = f.tag.lowercase()
        if (tag.isNotEmpty() && tag !in setOf("input", "textarea", "select") && !f.contenteditable) return null
        if (type in NOT_TYPED) return null
        f.autocomplete.lowercase().split(Regex("\\s+")).firstNotNullOfOrNull { AUTOCOMPLETE[it] }?.let { return it }
        val w = words(listOf(f.name, f.id, f.label, f.placeholder).filter { it.isNotBlank() }.joinToString(" "))
        for ((kind, re) in WORDS) {
            if (!re.containsMatchIn(w)) continue
            if (kind == CARD && NOT_CARD.containsMatchIn(w)) continue
            return kind
        }
        if (CODE.containsMatchIn(w) && (f.inputmode == "numeric" || f.maxlength in 1..8)) return ONE_TIME_CODE
        return null
    }

    /** sign_in · payment, or null. [extraSignIn]: BuildConfig.EXTRA_CUSTOM_TAB_HOSTS. */
    fun pageKind(url: String?, extraSignIn: String = ""): String? {
        if (url.isNullOrBlank()) return null
        val u = try { URI(url.trim()) } catch (_: Exception) { return null }
        val scheme = u.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        val host = u.host?.lowercase() ?: return null
        if (UrlRules.needsCustomTab(url, extraSignIn)) return SIGN_IN
        val path = (u.rawPath ?: "").lowercase()
        if (PAYMENT_HOSTS.any { rule ->
                val h = rule.substringBefore('/')
                val p = rule.substringAfter('/', "")
                UrlRules.hostMatches(host, h) && (p.isEmpty() || path.startsWith("/$p"))
            }) return PAYMENT
        if (PAYMENT_PATH.containsMatchIn(path)) return PAYMENT
        if (SIGN_IN_PATH.containsMatchIn(path)) return SIGN_IN
        return null
    }

    /**
     * The secret a Saga step would touch, or null: [field] for click / fill (the real element, from tools.js
     * inspect), [formSecret] the secret its form holds (fill only), [pageUrl] the page it is on (fill only: nothing
     * is typed on a sign-in or payment page), [openUrl] for open_url / new_tab (the app's sign-in hosts only).
     */
    fun forStep(command: String, field: Field?, formSecret: String?, pageUrl: String?, openUrl: String?,
                extraSignIn: String = ""): String? = when (command) {
        "open_url", "new_tab" -> if (openUrl != null && UrlRules.needsCustomTab(openUrl, extraSignIn)) SIGN_IN else null
        "click" -> field?.let { kindOf(it) }
        "fill" -> field?.let { kindOf(it) } ?: formSecret?.takeIf { it.isNotBlank() }
            ?: pageKind(pageUrl, extraSignIn)
        else -> null
    }
}
