package ng.nifelux.colonai

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * The phone's WebSocket link to the Colon backend (docs/android-bridge.md).
 *
 * - Connects to BuildConfig.BRIDGE_URL (default wss://api.apparatus.name.ng/ws, the API's existing gateway) while
 *   any Colon screen is open (acquire/release), and lets go 30 s after the last one closes.
 * - Reconnects with jittered exponential backoff, at once when the network comes back, and treats 70 s of
 *   silence as a dead link (mobile data often drops a socket without closing it).
 * - Signs in with the web session: the colon_sid cookie from the WebView's cookie store, sent only to the Colon API
 *   host, or a token the web app hands over through window.ColonNative.setSession.
 * - Degrades quietly: a server that only says hello (no bridge support) leaves the status at CONNECTED and
 *   page state is simply not acted on. Every listener call happens on the main thread.
 */
class BridgeClient(private val context: Context, val http: OkHttpClient) {
    enum class Status { OFF, OFFLINE, CONNECTING, CONNECTED, BRIDGE_READY, UNAVAILABLE }

    interface Listener {
        fun onStatus(status: Status) {}
        fun onControlRequest(request: BridgeProtocol.Incoming.Control) {}
    }

    /** Runs Saga's commands. Set by the open Colon Browser screen; null when no browser is open. */
    fun interface CommandHandler {
        fun handle(command: BridgeProtocol.Incoming.Command, reply: (ok: Boolean, result: JSONObject?, error: String?) -> Unit)
    }

    private val main = Handler(Looper.getMainLooper())
    private val listeners = linkedSetOf<Listener>()
    private val backoff = Backoff()
    private val wsClient = http.newBuilder().pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS).build()
    private val prefs = context.getSharedPreferences("colon.bridge", Context.MODE_PRIVATE)
    private val deviceId: String = prefs.getString("device_id", null)
        ?: UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }

    private var socket: WebSocket? = null
    private var generation = 0
    private var refs = 0
    private var token: String? = null
    private var lastMessageAt = 0L
    private var cookieUsed: String? = null
    var online = true
        private set
    var status = Status.OFF
        private set
    var commandHandler: CommandHandler? = null
    /** Current control mode, reported in hello so the backend knows whether Saga may send commands. */
    var controlMode: ControlState.Mode = ControlState.Mode.MANUAL

    private val reconnect = Runnable { connect() }
    private val idleClose = Runnable { if (refs == 0) disconnect(Status.OFF) }
    private val heartbeat = object : Runnable {
        override fun run() {
            val ws = socket ?: return
            if (System.currentTimeMillis() - lastMessageAt > 70_000) {
                Log.i(TAG, "bridge silent for 70 s, reconnecting")
                ws.cancel() // onFailure schedules the reconnect
                return
            }
            ws.send(BridgeProtocol.ping())
            main.postDelayed(this, 25_000)
        }
    }

    fun addListener(l: Listener) { listeners += l; l.onStatus(status) }
    fun removeListener(l: Listener) { listeners -= l }

    /** A screen that wants the bridge calls acquire() in onStart and release() in onStop. */
    fun acquire() {
        refs++
        main.removeCallbacks(idleClose)
        if (socket == null && status != Status.CONNECTING) connect()
    }

    fun release() {
        refs = (refs - 1).coerceAtLeast(0)
        if (refs == 0) main.postDelayed(idleClose, 30_000)
    }

    /** Called by the web app after sign-in (token) or sign-out (null): reconnect with the new identity. */
    fun setToken(value: String?) {
        val clean = value?.takeIf { it.length in 16..512 && it.all { c -> c.isLetterOrDigit() || c in "-_.~" } }
        if (clean == token) return
        token = clean
        if (refs > 0) restart()
    }

    /** After sign-in or sign-out in the web app: reconnect only if the session cookie actually changed. */
    fun refreshSession() {
        if (refs > 0 && UrlRules.isColonApi(BuildConfig.BRIDGE_URL) && sessionCookie() != cookieUsed) restart()
    }

    fun restart() {
        disconnect(Status.CONNECTING)
        backoff.reset()
        connect()
    }

    fun onNetwork(available: Boolean) {
        online = available
        if (!available) { setStatus(Status.OFFLINE); return }
        if (refs > 0 && socket == null) { main.removeCallbacks(reconnect); backoff.reset(); connect() }
    }

    /** Sends a frame if connected; returns false otherwise (callers never queue: page state is only "now"). */
    fun send(text: String): Boolean = socket?.send(text) ?: false

    fun reportControl(mode: ControlState.Mode, paused: Boolean, reason: String) {
        controlMode = mode
        send(BridgeProtocol.control(mode, paused, reason))
    }

    private fun connect() {
        main.removeCallbacks(reconnect)
        if (refs == 0) return
        if (!online) { setStatus(Status.OFFLINE); return }
        val url = BuildConfig.BRIDGE_URL
        val req = Request.Builder().url("$url${if ('?' in url) '&' else '?'}client=android&v=${BridgeProtocol.VERSION}")
            .header("User-Agent", "ColonAndroid/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")
            .header("X-Colon-Client", "android")
        // The session goes only to the Colon API host, never to a configured third-party URL.
        cookieUsed = null
        if (UrlRules.isColonApi(url)) {
            cookieUsed = sessionCookie()
            cookieUsed?.let { req.header("Cookie", it) }
            token?.let { req.header("Authorization", "Bearer $it") }
        }
        val gen = ++generation
        setStatus(Status.CONNECTING)
        socket = wsClient.newWebSocket(req.build(), Callbacks(gen))
    }

    private fun sessionCookie(): String? = try {
        CookieManager.getInstance().getCookie(BuildConfig.API_URL)
            ?.split(';')?.map { it.trim() }?.firstOrNull { it.startsWith("colon_sid=") }
    } catch (_: Exception) {
        null // WebView not available (being updated): connect without a session
    }

    private fun disconnect(next: Status) {
        main.removeCallbacks(heartbeat)
        main.removeCallbacks(reconnect)
        generation++
        socket?.close(1000, "bye")
        socket = null
        setStatus(next)
    }

    private fun scheduleReconnect(minDelay: Long = 0) {
        socket = null
        main.removeCallbacks(heartbeat)
        if (refs == 0) { setStatus(Status.OFF); return }
        if (!online) { setStatus(Status.OFFLINE); return }
        val delay = maxOf(backoff.next(), minDelay)
        main.postDelayed(reconnect, delay)
    }

    private fun setStatus(s: Status) {
        if (s == status) return
        status = s
        listeners.toList().forEach { it.onStatus(s) }
    }

    private fun lowRam(): Boolean =
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice

    private inner class Callbacks(private val gen: Int) : WebSocketListener() {
        private fun current() = gen == generation

        override fun onOpen(webSocket: WebSocket, response: Response) { main.post {
            if (!current()) return@post
            lastMessageAt = System.currentTimeMillis()
            backoff.reset()
            setStatus(Status.CONNECTED)
            webSocket.send(BridgeProtocol.hello(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, deviceId,
                Build.VERSION.SDK_INT, lowRam(), controlMode))
            main.removeCallbacks(heartbeat)
            main.postDelayed(heartbeat, 25_000)
        } }

        override fun onMessage(webSocket: WebSocket, text: String) { main.post {
            if (!current()) return@post
            lastMessageAt = System.currentTimeMillis()
            when (val msg = BridgeProtocol.parse(text)) {
                is BridgeProtocol.Incoming.Hello -> setStatus(if (msg.bridge) Status.BRIDGE_READY else Status.CONNECTED)
                is BridgeProtocol.Incoming.Command -> runCommand(webSocket, msg)
                is BridgeProtocol.Incoming.Control -> listeners.toList().forEach { it.onControlRequest(msg) }
                is BridgeProtocol.Incoming.Error -> Log.w(TAG, "bridge error ${msg.code}")
                else -> Unit
            }
        } }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { main.post {
            if (current()) scheduleReconnect()
        } }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { main.post {
            if (!current()) return@post
            val code = response?.code ?: 0
            Log.i(TAG, "bridge failed (${code.takeIf { it > 0 } ?: t.javaClass.simpleName})")
            // 401/403/404: the server has no bridge for us (yet). Keep trying, but only every few minutes.
            if (code == 401 || code == 403 || code == 404) {
                setStatus(Status.UNAVAILABLE)
                scheduleReconnect(5 * 60_000L)
            } else {
                scheduleReconnect()
            }
        } }
    }

    private fun runCommand(ws: WebSocket, cmd: BridgeProtocol.Incoming.Command) {
        val handler = commandHandler
        if (handler == null) {
            ws.send(BridgeProtocol.ack(cmd.id, false, error = "browser_not_open"))
            return
        }
        var answered = false
        handler.handle(cmd) { ok, result, error ->
            if (!answered) { answered = true; ws.send(BridgeProtocol.ack(cmd.id, ok, result, error)) }
        }
    }

    private companion object {
        const val TAG = "ColonBridge"
    }
}
