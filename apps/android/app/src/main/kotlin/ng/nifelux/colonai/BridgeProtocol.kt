package ng.nifelux.colonai

import org.json.JSONArray
import org.json.JSONObject

/**
 * Bridge message protocol v1 (docs/android-bridge.md). Every message is one JSON text frame with a "type".
 * Pure builders and parser, unit-tested in BridgeProtocolTest.
 */
object BridgeProtocol {
    const val VERSION = 1

    /** Commands this build can run on a browser tab. Anything else is answered with ack error "unsupported".
     *  Sent in hello as `capabilities`; the server only starts Saga tasks on apps that list get_page_content. */
    val COMMANDS = listOf(
        "open_url", "new_tab", "back", "forward", "reload", "stop",
        "switch_tab", "close_tab", "get_page_state", "get_tabs",
        // Phase 9 (v0.9.0): Saga's page tools (SagaTools), with approval on the phone for risky steps
        "get_page_content", "get_links", "click", "fill", "scroll", "screenshot",
    )

    sealed class Incoming {
        /** The server's greeting. bridge=false means the server only has the basic /ws gateway (no Saga commands). */
        data class Hello(val bridge: Boolean, val service: String) : Incoming()
        object Pong : Incoming()
        /** [conversationId] (Phase 10): the chat whose browser the command is for; null = whichever is shown.
         *  [say] (0.10.2): Saga's one-line explanation of this step ("Clicking Sign in"), shown on the page in
         *  "AI + me" (SagaNotice); never part of what the step does. */
        data class Command(val id: String, val name: String, val args: JSONObject, val tabId: String?,
                           val conversationId: String? = null, val say: String? = null) : Incoming()
        /** The backend asks to start (or end) AI or Shared control. Starting always needs the user's consent. */
        data class Control(val mode: ControlState.Mode, val task: String?, val conversationId: String? = null) :
            Incoming()
        /** Phase 10: Saga reached a secret field; the user types it ([message]) and taps Return to AI. */
        data class Handoff(val kind: String, val message: String, val conversationId: String?,
                           val timeoutMs: Long = 0L) : Incoming()
        /** 0.10.2: something Saga tells the user on the page ([kind] step · ask · done), e.g. its task finished. */
        data class Notice(val text: String, val kind: String, val conversationId: String?) : Incoming()
        data class Error(val code: String, val message: String) : Incoming()
        object Unknown : Incoming()
    }

    fun parse(text: String): Incoming {
        val o = try { JSONObject(text) } catch (_: Exception) { return Incoming.Unknown }
        return when (o.optString("type")) {
            "hello" -> Incoming.Hello(o.optInt("bridge", 0) >= 1 || o.optBoolean("bridge", false),
                o.optString("service"))
            "pong" -> Incoming.Pong
            "command" -> {
                val id = o.optString("id")
                val name = o.optString("name")
                if (id.isEmpty() || id.length > 64 || name.isEmpty()) Incoming.Unknown
                else Incoming.Command(id, name, o.optJSONObject("args") ?: JSONObject(),
                    o.optString("tab_id").ifEmpty { null }, conv(o), line(o.optString("say"), MAX_SAY))
            }
            "control" -> ControlState.Mode.from(o.optString("mode"))
                ?.let { Incoming.Control(it, o.optString("task").ifEmpty { null }?.take(200), conv(o)) }
                ?: Incoming.Unknown
            "handoff" -> Incoming.Handoff(o.optString("kind").ifEmpty { "password" }.take(20),
                o.optString("message").take(200), conv(o), o.optLong("timeout_ms").coerceIn(0L, MAX_WAIT_MS))
            "notice" -> line(o.optString("text"), MAX_SAY)?.let {
                Incoming.Notice(it, o.optString("kind").takeIf { k -> k in NOTICE_KINDS } ?: "step", conv(o))
            } ?: Incoming.Unknown
            "error" -> Incoming.Error(o.optString("code"), o.optString("message"))
            else -> Incoming.Unknown
        }
    }

    private fun conv(o: JSONObject): String? = o.optString("conversation_id").ifEmpty { null }?.take(64)

    const val MAX_SAY = 160
    /** 0.10.3: `error` and `stopped` end a task that didn't finish (the chat card's pill). */
    val NOTICE_KINDS = setOf("step", "ask", "done", "error", "stopped")
    /** The longest wait for the user a handoff may announce (an hour). */
    const val MAX_WAIT_MS = 3_600_000L
    /** 0.10.3: the user's hand-back message to Saga (HandoffNote), at most this long. */
    const val MAX_NOTE = 500

    /** One short line of text for the screen: control characters and runs of spaces collapsed, at most [max]. */
    fun line(s: String?, max: Int): String? =
        s?.replace(Regex("[\\u0000-\\u001f\\u007f\\s]+"), " ")?.trim()?.take(max)?.ifEmpty { null }

    private fun base(type: String) = JSONObject().put("v", VERSION).put("type", type)
        .put("ts", System.currentTimeMillis())

    /** [resumable] (0.10.4): in Manual, the AI mode a Saga task waits to get back (the user has the browser, or Saga
     *  asked for them): the server lets this new socket's Give back resume it without asking consent again. */
    fun hello(appVersion: String, versionCode: Int, deviceId: String, sdk: Int, lowRam: Boolean,
              mode: ControlState.Mode, conversationId: String? = null,
              resumable: ControlState.Mode? = null): String = base("hello")
        .put("client", "android").put("app_version", appVersion).put("version_code", versionCode)
        .put("device_id", deviceId).put("sdk", sdk).put("low_ram", lowRam).put("control", mode.wire)
        .put("capabilities", JSONArray(COMMANDS))
        .apply { if (conversationId != null) put("conversation_id", conversationId) }
        .apply {
            if (mode == ControlState.Mode.MANUAL && resumable != null && resumable != ControlState.Mode.MANUAL) {
                put("resumable", resumable.wire)
            }
        }.toString()

    /** Phase 10: the in-chat panel now shows this conversation's browser ("" = a new chat with no id yet). */
    fun chat(conversationId: String?): String = base("chat").put("conversation_id", conversationId ?: "").toString()

    fun ping(): String = base("ping").toString()

    fun ack(ref: String, ok: Boolean, result: JSONObject? = null, error: String? = null): String {
        val o = base("ack").put("ref", ref).put("ok", ok)
        if (result != null) o.put("result", result)
        if (error != null) o.put("error", error)
        return o.toString()
    }

    /** The server refuses frames over 64 KB (the ack would be lost and the step time out). */
    const val MAX_ACK_BYTES = 60_000

    /**
     * 0.10.2: an ack that fits the bridge's frame limit. A long page read (text, many long links) is trimmed instead
     * of being dropped by the server: the text is shortened (truncated: true), then the last elements and links go.
     * Anything still too large is answered as an error the server understands. Never mutates [result].
     */
    fun fitAck(ref: String, ok: Boolean, result: JSONObject? = null, error: String? = null,
               max: Int = MAX_ACK_BYTES): String {
        var frame = ack(ref, ok, result, error)
        if (result == null || bytes(frame) <= max) return frame
        val r = JSONObject(result.toString())
        var text = r.optString("text")
        while (text.isNotEmpty() && bytes(frame) > max) {
            text = text.take(text.length / 2)
            r.put("text", text).put("truncated", true)
            frame = ack(ref, ok, r, error)
        }
        for (key in listOf("elements", "links")) {
            val list = r.optJSONArray(key) ?: continue
            while (list.length() > 0 && bytes(frame) > max) {
                list.remove(list.length() - 1)
                frame = ack(ref, ok, r, error)
            }
        }
        return if (bytes(frame) <= max) frame else ack(ref, false, null, "too_large")
    }

    private fun bytes(s: String): Int = s.toByteArray(Charsets.UTF_8).size

    fun control(mode: ControlState.Mode, paused: Boolean, reason: String, note: String? = null): String =
        base("control").put("mode", mode.wire).put("paused", paused).put("reason", reason)
            .apply { note?.take(MAX_NOTE)?.takeIf { it.isNotBlank() }?.let { put("note", it) } }.toString()

    /** Page state of one tab. Only sent while Saga has AI or Shared control (privacy: manual browsing stays local). */
    fun pageState(state: JSONObject): String {
        val o = base("page_state")
        val keys = state.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (k != "type" && k != "v") o.put(k, state.get(k))
        }
        return o.toString()
    }
}
