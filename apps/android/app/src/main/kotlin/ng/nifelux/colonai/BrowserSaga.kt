package ng.nifelux.colonai

import android.content.res.ColorStateList
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Saga side of Colon Browser: the AI / Manual / Shared indicator, the control bar (Take control, Return to AI,
 * Pause, Stop), the consent prompt, and running the backend's commands on tabs (docs/android-bridge.md).
 * Page state leaves the phone only while Saga has AI or Shared control.
 */
class BrowserSaga(private val a: BrowserActivity, private val bridge: BridgeClient) :
    BridgeClient.Listener, BridgeClient.CommandHandler {
    val control = ControlState()
    private val main = Handler(Looper.getMainLooper())
    private var status = BridgeClient.Status.OFF
    private var stateQueued = false
    private lateinit var chip: TextView
    private lateinit var banner: View
    private lateinit var bannerText: TextView
    private lateinit var btnPause: Button
    private lateinit var btnControl: Button
    private lateinit var btnStop: Button
    private lateinit var shield: View

    fun bind(root: View) {
        chip = root.findViewById(R.id.mode_chip)
        banner = root.findViewById(R.id.control_banner)
        bannerText = root.findViewById(R.id.control_text)
        btnPause = root.findViewById(R.id.btn_pause)
        btnControl = root.findViewById(R.id.btn_control)
        btnStop = root.findViewById(R.id.btn_stop)
        shield = root.findViewById(R.id.ai_shield)
        chip.setOnClickListener { showStatus() }
        btnPause.setOnClickListener { apply(if (control.paused) control.resume() else control.pause()) }
        btnControl.setOnClickListener {
            apply(if (control.mode == ControlState.Mode.MANUAL) control.returnToAi() else control.takeControl())
        }
        btnStop.setOnClickListener { apply(control.stop()) }
        root.findViewById<View>(R.id.btn_take_control).setOnClickListener { apply(control.takeControl()) }
        render()
    }

    fun attach() {
        bridge.acquire()
        bridge.addListener(this)
        bridge.commandHandler = this
    }

    fun detach() {
        if (bridge.commandHandler === this) bridge.commandHandler = null
        bridge.removeListener(this)
        bridge.release()
    }

    override fun onStatus(status: BridgeClient.Status) {
        this.status = status
        if (::chip.isInitialized) render()
    }

    /** The backend asks for control. Saga never takes over without the user's yes on the phone. */
    override fun onControlRequest(request: BridgeProtocol.Incoming.Control) {
        if (request.mode == ControlState.Mode.MANUAL) { apply(control.stop()); return }
        val label = request.task ?: a.getString(R.string.saga_task_unknown)
        MaterialAlertDialogBuilder(a)
            .setTitle(R.string.saga_consent_title)
            .setMessage(a.getString(if (request.mode == ControlState.Mode.AI) R.string.saga_consent_ai
                else R.string.saga_consent_shared, label))
            .setPositiveButton(R.string.allow) { _, _ -> apply(control.grant(request.mode, request.task)) }
            .setNegativeButton(R.string.not_now) { _, _ ->
                bridge.reportControl(control.mode, control.paused, "declined")
            }
            .setCancelable(false)
            .show()
    }

    private fun apply(reason: String?) {
        reason ?: return
        bridge.reportControl(control.mode, control.paused, reason)
        render()
        reportState()
    }

    private fun render() {
        val mode = control.mode
        chip.text = a.getString(when (mode) {
            ControlState.Mode.MANUAL -> R.string.mode_manual
            ControlState.Mode.AI -> R.string.mode_ai
            ControlState.Mode.SHARED -> R.string.mode_shared
        })
        chip.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(a, when (mode) {
            ControlState.Mode.MANUAL -> R.color.colon_chip
            ControlState.Mode.AI -> R.color.colon_primary
            ControlState.Mode.SHARED -> R.color.colon_cyan_dark
        }))
        chip.setTextColor(ContextCompat.getColor(a, if (mode == ControlState.Mode.MANUAL) R.color.colon_text
            else android.R.color.white))
        chip.contentDescription = a.getString(R.string.mode_description, chip.text)
        val showBanner = mode != ControlState.Mode.MANUAL || control.resumable != null
        banner.visibility = if (showBanner) View.VISIBLE else View.GONE
        bannerText.text = when {
            mode == ControlState.Mode.MANUAL -> a.getString(R.string.saga_you_control)
            control.paused -> a.getString(R.string.saga_paused)
            mode == ControlState.Mode.AI -> a.getString(R.string.saga_browsing, control.task ?: "")
            else -> a.getString(R.string.saga_shared)
        }
        btnPause.visibility = if (mode == ControlState.Mode.MANUAL) View.GONE else View.VISIBLE
        btnPause.setText(if (control.paused) R.string.resume else R.string.pause)
        btnControl.setText(if (mode == ControlState.Mode.MANUAL) R.string.return_to_ai else R.string.take_control)
        shield.visibility = if (mode == ControlState.Mode.AI && !control.paused) View.VISIBLE else View.GONE
    }

    fun showStatus() {
        val link = a.getString(when (status) {
            BridgeClient.Status.BRIDGE_READY -> R.string.link_ready
            BridgeClient.Status.CONNECTED -> R.string.link_basic
            BridgeClient.Status.CONNECTING -> R.string.link_connecting
            BridgeClient.Status.OFFLINE -> R.string.link_offline
            BridgeClient.Status.UNAVAILABLE -> R.string.link_unavailable
            BridgeClient.Status.OFF -> R.string.link_off
        })
        MaterialAlertDialogBuilder(a)
            .setTitle(R.string.saga_status)
            .setMessage(a.getString(R.string.saga_status_text, chip.text, link))
            .setPositiveButton(R.string.close, null)
            .show()
    }

    /** Sends the active tab's state (throttled). Nothing is sent in Manual mode. */
    fun reportState() {
        if (control.mode == ControlState.Mode.MANUAL || stateQueued) return
        stateQueued = true
        main.postDelayed({
            stateQueued = false
            if (control.mode != ControlState.Mode.MANUAL) bridge.send(BridgeProtocol.pageState(pageState()))
        }, 400)
    }

    private fun pageState(): JSONObject {
        val t = a.tabs.active
        val wv = t?.webView
        return JSONObject()
            .put("tab_id", t?.id ?: JSONObject.NULL)
            .put("url", t?.url?.takeIf { UrlRules.isWebUrl(it) } ?: "")
            .put("title", t?.title ?: "")
            .put("loading", (t?.progress ?: 100) < 100)
            .put("progress", t?.progress ?: 100)
            .put("can_go_back", wv?.canGoBack() == true)
            .put("can_go_forward", wv?.canGoForward() == true)
            .put("tabs", a.tabs.tabs.size)
            .put("mode", control.mode.wire)
            .put("paused", control.paused)
    }

    override fun handle(command: BridgeProtocol.Incoming.Command,
                        reply: (ok: Boolean, result: JSONObject?, error: String?) -> Unit) {
        if (!control.canRunCommands()) {
            reply(false, null, if (control.paused) "paused" else "manual_control"); return
        }
        val args = command.args
        val tab = command.tabId?.let { a.tabs.find(it) } ?: a.tabs.active
        when (command.name) {
            "open_url", "new_tab" -> {
                val url = args.optString("url").ifEmpty { if (command.name == "new_tab") UrlRules.HOME else "" }
                if (url != UrlRules.HOME && !UrlRules.isWebUrl(url)) { reply(false, null, "bad_url"); return }
                if (command.name == "new_tab" || args.optBoolean("new_tab") || tab == null) {
                    val t = a.tabs.open(url) ?: run { reply(false, null, "tab_limit"); return }
                    reply(true, JSONObject().put("tab_id", t.id), null)
                } else {
                    if (tab !== a.tabs.active) a.tabs.switchTo(tab)
                    a.navigate(url)
                    reply(true, JSONObject().put("tab_id", tab.id), null)
                }
            }
            "back", "forward", "reload", "stop" -> {
                val wv = tab?.webView ?: run { reply(false, null, "no_tab"); return }
                when (command.name) {
                    "back" -> if (wv.canGoBack()) wv.goBack() else { reply(false, null, "no_history"); return }
                    "forward" -> if (wv.canGoForward()) wv.goForward() else { reply(false, null, "no_history"); return }
                    "reload" -> wv.reload()
                    else -> wv.stopLoading()
                }
                reply(true, null, null)
            }
            "switch_tab", "close_tab" -> {
                val t = a.tabs.find(args.optString("tab_id").ifEmpty { command.tabId })
                    ?: run { reply(false, null, "no_tab"); return }
                if (command.name == "switch_tab") a.tabs.switchTo(t) else a.tabs.close(t)
                reply(true, null, null)
            }
            "get_page_state" -> reply(true, pageState(), null)
            "get_tabs" -> reply(true, JSONObject().put("tabs", JSONArray().apply {
                a.tabs.tabs.forEach { t ->
                    put(JSONObject().put("id", t.id).put("url", t.url).put("title", t.title)
                        .put("active", t === a.tabs.active))
                }
            }), null)
            else -> reply(false, null, "unsupported")
        }
        reportState()
    }
}
