package ng.nifelux.colonai

import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

/**
 * Colon JetX (ng.nifelux.colonjetx, 0.34.0, Crash Predictor step 2): the user's betting site on top, the predictor
 * (https://crash.apparatus.name.ng) below, on the Colon Browser engine (JetxWeb). Draggable divider, or the game or
 * the predictor alone (JetxChrome). Control mode Manual (default), AI or Shared: in this step AI and Shared only
 * change the state and show a banner; nothing is clicked for the user (auto-bet is step 5, with its guardrails).
 * Step 3 (0.35.0): the round collector (JetxCollector) reads only JetX's finished multipliers from the game pane
 * and sends them to the Colon API; the site's passwords, cookies and tokens are never read or kept: the user signs
 * in there themselves. Docs: docs/crash-predictor/HANDOFF.md.
 */
class JetxActivity : AppCompatActivity(), JetxBridge.Host, JetxCollector.Host {
    lateinit var bridge: JetxBridge
        private set
    lateinit var fileChooser: FileChooser
        private set
    lateinit var fullscreen: Fullscreen
        private set
    private lateinit var prefs: JetxPrefs
    private lateinit var ui: JetxChrome
    private lateinit var collector: JetxCollector
    private var collectorView: WebView? = null
    private var game: TabWebView? = null
    private var predictor: WebView? = null
    private var site: String? = null
    private var siteState = JetxRules.Site.NONE
    private var reloadOnReturn = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        setContentView(R.layout.activity_jetx)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.jetx_root)) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        prefs = JetxPrefs(this)
        fileChooser = FileChooser(this)
        fullscreen = Fullscreen(this)
        ui = JetxChrome(this)
        collector = JetxCollector(this, ColonApplication.of(this).http, prefs)

        game = JetxWeb.game(this)?.also { ui.gamePane.addView(it, 0, match()) }
        installCollector()
        predictor = JetxWeb.predictor(this)?.also { ui.predictorPane.addView(it, match()) }
        bridge = JetxBridge(this, predictor)
        bridge.install(readAsset(JetxBridge.SHIM_ASSET))
        wireControls()
        ui.showMode(prefs.mode)
        ui.showLayout(prefs.layout, prefs.split)

        predictor?.loadUrl(JetxRules.PREDICTOR_URL)
        site = prefs.site
        site?.let { load(it) } ?: setSite(JetxRules.Site.NONE)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = if (prefs.layout == JetxRules.Layout.PREDICTOR) predictor else game
                when {
                    fullscreen.active -> fullscreen.exit()
                    view != null && view.canGoBack() -> view.goBack()
                    else -> { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
                }
            }
        })
    }

    private fun match() = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT)

    private fun readAsset(path: String): String? = try {
        assets.open(path).bufferedReader().use { it.readText() }
    } catch (_: Exception) { null } // only Colon JetX ships these (src/colonjetx/assets)

    /** The round collector goes into the game pane's WebView while it is on (it takes effect from the next page). */
    private fun installCollector() {
        val g = game ?: return
        if (!prefs.collector || collectorView === g) return
        collectorView = g
        collector.install(g, readAsset(JetxCollector.SCRIPT_ASSET))
    }

    private fun wireControls() {
        ui.address.setOnEditorActionListener { _, actionId, event ->
            val go = actionId == EditorInfo.IME_ACTION_GO ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (go) { submitAddress(); true } else false
        }
        findViewById<View>(R.id.jetx_back).setOnClickListener { game?.takeIf { it.canGoBack() }?.goBack() }
        findViewById<View>(R.id.jetx_reload).setOnClickListener {
            val url = site ?: return@setOnClickListener
            if (game?.url.isNullOrBlank()) load(url) else game?.reload()
        }
        ui.status.setOnClickListener { toast(ui.statusLabel) }
        ui.modeChips.forEach { (mode, v) -> v.setOnClickListener { setMode(mode) } }
        ui.layoutChip.setOnClickListener { setLayout(JetxRules.nextLayout(prefs.layout)) }
        ui.wireDivider({ prefs.layout == JetxRules.Layout.SPLIT }) { prefs.split = it }
    }

    private fun submitAddress() {
        val url = JetxRules.siteUrl(ui.address.text.toString())
        if (url == null) { toast(getString(R.string.jetx_bad_address)); return }
        (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)
            ?.hideSoftInputFromWindow(ui.address.windowToken, 0)
        ui.address.clearFocus()
        site = url
        prefs.site = url // the user's own edit wins until the saved site changes (JetxRules.pickSite)
        load(url)
    }

    private fun load(url: String) {
        ui.address.setText(url)
        game?.loadUrl(url)
    }

    /** settings.site_url from the API, once the predictor pane has a Colon session (JetxApi). */
    private fun refreshSavedSite() {
        JetxApi.siteUrl(ColonApplication.of(this).http) { saved ->
            if (isFinishing || isDestroyed) return@siteUrl
            val pick = JetxRules.pickSite(prefs.site, prefs.savedSite, saved)
            if (saved != null) prefs.savedSite = saved
            if (pick != null && pick != site) { site = pick; prefs.site = pick; load(pick) }
        }
    }

    /* ---------- pane events (JetxWeb) ---------- */

    fun onGamePage(url: String?, done: Boolean) {
        if (url != null && UrlRules.isWebUrl(url) && !ui.address.hasFocus()) ui.address.setText(url)
        setSite(if (done) JetxRules.Site.LOADED else JetxRules.Site.LOADING)
    }

    fun onGameProgress(p: Int) = ui.showProgress(p)

    fun onGameError() {
        setSite(if (ColonApplication.of(this).online) JetxRules.Site.ERROR else JetxRules.Site.OFFLINE)
    }

    /** Each full load of the predictor (a sign-in, a reload) picks up a betting site saved in its Settings. */
    fun onPredictorLoaded() = refreshSavedSite()

    /** A web page from the predictor (or a pop-up): opens in the game pane, which is shown if it was hidden. */
    fun openInGame(url: String) {
        if (site == null) site = url
        load(url)
        if (prefs.layout == JetxRules.Layout.PREDICTOR) setLayout(JetxRules.Layout.SPLIT)
    }

    fun openSignIn(url: String) {
        if (!SignInTabs.open(this, url, dark = true)) { toast(getString(R.string.signin_no_browser)); return }
        reloadOnReturn = true
        toast(getString(R.string.signin_custom_tab))
    }

    /** A renderer died (low memory): that pane gets a fresh WebView; the other keeps going. */
    fun onRendererGone(game: Boolean) {
        if (game) {
            this.game?.let { ShellWeb.destroy(it) }
            this.game = JetxWeb.game(this)?.also { ui.gamePane.addView(it, 0, match()) }
            installCollector()
            site?.let { load(it) }
        } else {
            predictor?.let { ShellWeb.destroy(it) }
            predictor = JetxWeb.predictor(this)?.also { ui.predictorPane.addView(it, match()) }
            bridge = JetxBridge(this, predictor)
            bridge.install(readAsset(JetxBridge.SHIM_ASSET))
            predictor?.loadUrl(JetxRules.PREDICTOR_URL)
        }
    }

    fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    /* ---------- state: site status, mode, layout (each change is told to the predictor) ---------- */

    private fun setSite(s: JetxRules.Site) {
        siteState = if (site == null && s != JetxRules.Site.OFFLINE) JetxRules.Site.NONE else s
        ui.showSite(siteState, site)
        bridge.emit("session", JetxRules.session(siteState, site))
    }

    private fun setMode(mode: JetxRules.Mode) {
        if (mode == prefs.mode) return
        prefs.mode = mode
        ui.showMode(mode)
        bridge.emit("mode", JSONObject().put("mode", mode.wire))
    }

    private fun setLayout(layout: JetxRules.Layout) {
        prefs.layout = layout
        ui.showLayout(layout, prefs.split)
        bridge.emit("layout", JSONObject().put("layout", layout.wire))
    }

    /* ---------- JetxBridge.Host ---------- */

    override fun bridgeStatus(): JSONObject =
        JetxRules.status(BuildConfig.VERSION_NAME, prefs.mode, prefs.layout, siteState, site)
            .put("collector", collector.status())

    override fun bridgeOpenSite(url: String?): String? {
        val target = url ?: site ?: return null
        site = target
        if (url != null) prefs.site = url
        openInGame(target)
        return target
    }

    override fun bridgeSetLayout(layout: JetxRules.Layout) = setLayout(layout)

    override fun bridgeSetCollector(on: Boolean): JSONObject {
        collector.setOn(on)
        if (on) installCollector()
        return collector.status()
    }

    /* ---------- JetxCollector.Host ---------- */

    override fun onCollector(status: JSONObject) {
        if (::bridge.isInitialized) bridge.emit("collector", status) // the collector is set up before the bridge
    }

    /* ---------- lifecycle ---------- */

    override fun onResume() {
        super.onResume()
        game?.onResume()
        predictor?.onResume()
        if (reloadOnReturn) { reloadOnReturn = false; game?.reload() }
    }

    override fun onPause() {
        game?.onPause()
        predictor?.onPause()
        try { CookieManager.getInstance().flush() } catch (_: Exception) { } // the site's own sign-in survives
        super.onPause()
    }

    override fun onDestroy() {
        collector.close()
        game?.let { ShellWeb.destroy(it) }
        predictor?.let { ShellWeb.destroy(it) }
        game = null
        predictor = null
        super.onDestroy()
    }
}
