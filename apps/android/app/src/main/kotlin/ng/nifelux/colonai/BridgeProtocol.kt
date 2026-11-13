package ng.nifelux.colonai

import org.json.JSONArray
import org.json.JSONObject

/**
 * Bridge message protocol v1 (docs/android-bridge.md). Every message is one JSON text frame with a "type".
 * Pure builders and parser, unit-tested in BridgeProtocolTest.
 */
object BridgeProtocol {
    const val VERSION = 1

    /** Commands this build can run on a browser tab. Anything else is answered with ack error "unsupported". */
    val COMMANDS = listOf(
        "open_url", "new_tab", "back", "forward", "reload", "stop",
        "switch_tab", "close_tab", "get_page_state", "get_tabs",
    )

    sealed class Incoming {
        /** The server's greeting. bridge=false means the server only has the basic /ws gateway (no Saga commands). */
        data class Hello(val bridge: Boolean, val service: String) : Incoming()
        object Pong : Incoming()
        data class Command(val id: String, val name: String, val args: JSONObject, val tabId: String?) : Incoming()
        /** The backend asks to start (or end) AI or Shared control. Starting always needs the user's consent. */
        data class Control(val mode: ControlState.Mode, val task: String?) : Incoming()
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
                    o.optString("tab_id").ifEmpty { null })
            }
            "control" -> ControlState.Mode.from(o.optString("mode"))
                ?.let { Incoming.Control(it, o.optString("task").ifEmpty { null }?.take(200)) } ?: Incoming.Unknown
            "error" -> Incoming.Error(o.optString("code"), o.optString("message"))
            else -> Incoming.Unknown
        }
    }

    private fun base(type: String) = JSONObject().put("v", VERSION).put("type", type)
        .put("ts", System.currentTimeMillis())

    fun hello(appVersion: String, versionCode: Int, deviceId: String, sdk: Int, lowRam: Boolean,
              mode: ControlState.Mode): String = base("hello")
        .put("client", "android").put("app_version", appVersion).put("version_code", versionCode)
        .put("device_id", deviceId).put("sdk", sdk).put("low_ram", lowRam).put("control", mode.wire)
        .put("capabilities", JSONArray(COMMANDS)).toString()

    fun ping(): String = base("ping").toString()

    fun ack(ref: String, ok: Boolean, result: JSONObject? = null, error: String? = null): String {
        val o = base("ack").put("ref", ref).put("ok", ok)
        if (result != null) o.put("result", result)
        if (error != null) o.put("error", error)
        return o.toString()
    }

    fun control(mode: ControlState.Mode, paused: Boolean, reason: String): String =
        base("control").put("mode", mode.wire).put("paused", paused).put("reason", reason).toString()

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
