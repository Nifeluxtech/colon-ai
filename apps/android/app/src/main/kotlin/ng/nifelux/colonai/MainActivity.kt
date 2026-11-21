package ng.nifelux.colonai

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

/**
 * The Colon AI shell: the chat web app in one WebView with native extras (window.ColonNative), the splash,
 * edge-to-edge insets, back handling, file and mic permissions, share-to-Colon, downloads and update prompts.
 * Web pages open in the in-chat browser panel (ChatBrowserPanel, a native WebView beside the chat); Colon AI has
 * no standalone browser screen since v0.8.0 (that is the Colon Browser app). WebView set-up lives in ShellWeb.kt.
 */
class MainActivity : AppCompatActivity() {
    lateinit var webView: WebView
        private set
    lateinit var nativeBridge: NativeBridge
        private set
    lateinit var fileChooser: FileChooser
        private set
    lateinit var browserPanel: ChatBrowserPanel
        private set
    val permissions = PermissionAsker(this)
    @Volatile var currentUrl: String? = null
    /** 0.10.3: the chat is on screen (started); "Saga needs you" is a notification only when it isn't. */
    var foreground = false
        private set
    private var lastTouchInPanel = false

    private lateinit var container: FrameLayout
    private var splashOverlay: SplashOverlay? = null
    private lateinit var offline: View
    private var firstPaint = false
    private var pendingShare: JSONObject? = null
    /** Colon OS Assistant (Step 1): opened as the phone's assistant; the chat starts hands-free once it asks. */
    private var pendingAssist = false
    private var webTheme = "dark"
    private val permissionCallbacks = ArrayDeque<(Boolean) -> Unit>()
    private val onNetwork: (Boolean) -> Unit = { online -> if (online && offline.visibility == View.VISIBLE) retry() }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        permissionCallbacks.removeFirstOrNull()?.invoke(ok)
    }

    /** 0.11.0: the Colon Secured Login form's answer: the site and the masked user name, never the password. */
    private var vaultCallback: ((String?, String?) -> Unit)? = null
    private val vaultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val i = r.data
        val saved = if (r.resultCode == RESULT_OK && i != null) i.getStringExtra(LoginFormActivity.EXTRA_SITE) else null
        val cb = vaultCallback.also { vaultCallback = null }
        val panel = if (::browserPanel.isInitialized) browserPanel else null
        // 0.11.6: a form whose callback was lost (this screen was rebuilt while it was open) still resumes a Saga
        // that waits for a login; a login saved from another form (the chat's card) resumes it too.
        if (cb == null) { panel?.onLoginFormLost(saved); return@registerForActivityResult }
        if (saved != null) cb(saved, i?.getStringExtra(LoginFormActivity.RESULT_MASKED)) else cb(null, null)
        if (saved != null) panel?.onLoginSaved(saved)
    }

    /** Opens the Colon Secured Login form for [site]; [done] gets (site saved, masked user) or (null, null). */
    fun openLoginForm(site: String?, user: String?, trust: Boolean, done: (String?, String?) -> Unit) {
        vaultCallback?.invoke(null, null)
        vaultCallback = done
        try { vaultLauncher.launch(LoginFormActivity.intent(this, site, user, trust)) }
        catch (_: Exception) { vaultCallback = null; done(null, null) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        setContentView(R.layout.activity_main)
        // Splash with the "from Nifelux" footer until the page paints (at most 2.5 s, so a slow network never traps
        // the user on it); no load bar.
        splashOverlay = SplashOverlay.start(this, splash, savedInstanceState == null, 2500) { firstPaint }
        container = findViewById(R.id.web_container)
        offline = findViewById(R.id.offline)
        findViewById<Button>(R.id.offline_retry).setOnClickListener { retry() }
        applyInsets(findViewById(R.id.root))
        fileChooser = FileChooser(this)
        AssistShortcut.publish(this) // "Talk to Colon" launcher shortcut (colonai only)

        val wv = ShellWeb.create(this)
        if (wv == null) { showOffline(getString(R.string.webview_missing)); firstPaint = true; return }
        webView = wv
        container.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT))
        nativeBridge = NativeBridge(this, webView)
        nativeBridge.install()
        VoiceMode.attach(this) // 0.20.0: voice mode's pill and notification (VoiceService)
        NativeListen.prewarm(this) // 0.22.1: the first "Listening…" doesn't wait for the speech service to bind
        browserPanel = ChatBrowserPanel(this)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (browserPanel.handleBack(lastTouchInPanel)) return
                if (offline.visibility != View.VISIBLE && webView.canGoBack()) webView.goBack()
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
            }
        })

        val restored = savedInstanceState?.let { webView.restoreState(it) } != null
        val opened = handleIntent(intent)
        if (!restored && !opened) webView.loadUrl(BuildConfig.WEB_URL)
        if (!ColonApplication.of(this).online) showOffline(null)
        UpdateChecker.onIntent(intent) // 0.24.0: opened from an update notification
        UpdateChecker.checkOnStart(this)
        CrashGuard.showIfAny(this) // 0.24.1: what made the last run stop, once
    }

    override fun onStart() {
        super.onStart()
        foreground = true
        VoiceMode.setAppVisible(true)
        WakeWord.ensure(this) // 0.23.0: "Hey Colon" back on after a reboot or when Android stopped it
        ColonApplication.of(this).bridge.acquire()
        ColonApplication.of(this).addNetworkListener(onNetwork)
        // 0.24.0: a running update download reopens its sheet, a finished one offers Install, an installed one is
        // cleaned up; back from "Install unknown apps" the install goes on.
        UpdateChecker.resume(this)
    }

    override fun onStop() {
        foreground = false
        VoiceMode.setAppVisible(false)
        ColonApplication.of(this).bridge.release()
        ColonApplication.of(this).removeNetworkListener(onNetwork)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) { webView.onResume(); nativeBridge.emit("resume", null) }
        if (::browserPanel.isInitialized) browserPanel.onResume()
    }

    override fun onPause() {
        // 0.20.0: voice mode keeps listening and speaking in the background, so the chat page is not paused.
        if (::webView.isInitialized && !VoiceMode.active) webView.onPause()
        if (::browserPanel.isInitialized) browserPanel.onPause()
        super.onPause()
    }

    /** Remembers whether the last touch was in the browser panel (the back button then goes back there). */
    override fun dispatchTouchEvent(ev: android.view.MotionEvent): Boolean {
        if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN && ::browserPanel.isInitialized) {
            lastTouchInPanel = browserPanel.contains(ev)
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::browserPanel.isInitialized) browserPanel.onConfigurationChanged()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        @Suppress("DEPRECATION")
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW && ::browserPanel.isInitialized) {
            browserPanel.onTrimMemory()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) webView.saveState(outState)
    }

    override fun onDestroy() {
        VoiceMode.detach(this)
        if (::browserPanel.isInitialized) browserPanel.destroy()
        if (::webView.isInitialized) ShellWeb.destroy(webView)
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (UpdateChecker.onIntent(intent)) UpdateChecker.resume(this) // 0.24.0: tap on an update notification
        handleIntent(intent)
    }

    /* ---------- called by ShellWeb's clients ---------- */

    fun onPageVisible() {
        firstPaint = true
        splashOverlay?.hide()
        if (offline.visibility == View.VISIBLE && ColonApplication.of(this).online) offline.visibility = View.GONE
    }

    /** The chat page is (re)loading: the in-thread browser card it drew is gone until the new page reports one. */
    fun onShellPageStarted() {
        if (::browserPanel.isInitialized) browserPanel.onShellPageStarted()
    }

    fun showOffline(detail: String?) {
        firstPaint = true
        splashOverlay?.hide()
        findViewById<TextView>(R.id.offline_detail).text = detail ?: getString(R.string.offline_text)
        offline.visibility = View.VISIBLE
    }

    private fun retry() {
        offline.visibility = View.GONE
        if (!::webView.isInitialized) { recreate(); return }
        val url = webView.url
        if (url == null || url.startsWith("about:") || url.startsWith("data:")) webView.loadUrl(BuildConfig.WEB_URL)
        else webView.reload()
    }

    /** The renderer died (low memory on cheap phones): build a fresh WebView instead of crashing. */
    fun onRendererGone() {
        container.removeView(webView)
        ShellWeb.destroy(webView)
        recreate()
    }

    /* ---------- called by NativeBridge ---------- */

    fun onBridgeReady() {
        nativeBridge.emit("bridge", JSONObject().put("status",
            ColonApplication.of(this).bridge.status.name.lowercase()))
    }

    /** A web page from the chat (a link, "Open browser", Saga): it opens in the in-chat browser panel. */
    fun openBrowserTab(url: String?) {
        if (::browserPanel.isInitialized) browserPanel.open(url)
    }

    fun shareText(title: String, text: String, url: String): Boolean {
        val body = listOf(text, url).filter { it.isNotBlank() }.joinToString("\n")
        if (body.isBlank()) return false
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, body)
        if (title.isNotBlank()) send.putExtra(Intent.EXTRA_SUBJECT, title)
        return try { startActivity(Intent.createChooser(send, title.ifBlank { null })); true } catch (_: Exception) { false }
    }

    fun requestNamedPermission(name: String, cb: (Boolean) -> Unit) {
        val perm = when (name) {
            "microphone" -> Manifest.permission.RECORD_AUDIO
            "camera" -> Manifest.permission.CAMERA
            "notifications" -> if (android.os.Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS
                else { cb(Notifications.canPost(this)); return }
            else -> { cb(false); return }
        }
        requestPermission(perm, cb)
    }

    fun requestPermission(perm: String, cb: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED) { cb(true); return }
        permissionCallbacks.addLast(cb)
        permissionLauncher.launch(perm)
    }

    /** The web app's theme (dark/light) colours the area behind the system bars and their icons. */
    fun applyWebTheme(theme: String) {
        webTheme = if (theme == "light") "light" else "dark"
        val light = webTheme == "light"
        window.setBackgroundDrawable(ColorDrawable(if (light) Color.WHITE
            else ContextCompat.getColor(this, R.color.colon_dark)))
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    /** Sends an event to the chat page; false when there is no page to receive it. */
    fun emitToPage(event: String, data: Any?): Boolean {
        if (!::nativeBridge.isInitialized || !nativeBridge.pageReady) return false
        nativeBridge.emit(event, data); return true
    }

    fun takeShare(): JSONObject? = pendingShare.also { pendingShare = null }

    /** True once after AssistActivity opened the app (long-press Home, voice button); the chat then starts hands-free. */
    fun takeAssist(): Boolean = pendingAssist.also { pendingAssist = false }

    fun isLowRam(): Boolean = (getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice

    fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()

    /* ---------- intents: share-to-Colon and links ---------- */

    /** Returns true when the intent loaded a page (a chat link opened from another app). */
    private fun handleIntent(intent: Intent?): Boolean {
        intent ?: return false
        var opened = false
        intent.getStringExtra(EXTRA_OPEN_URL)?.let { url ->
            intent.removeExtra(EXTRA_OPEN_URL)
            if (UrlRules.isShellUrl(url) && ::webView.isInitialized) { webView.loadUrl(url); opened = true }
        }
        if (intent.getBooleanExtra(EXTRA_ASSIST, false)) {
            intent.removeExtra(EXTRA_ASSIST) // handled once, even after rotation
            pendingAssist = true
            // 0.20.0: from the tile or the shortcut Colon steps back behind its pill once voice mode runs.
            if (intent.getBooleanExtra(EXTRA_VOICE_COMPACT, false)) VoiceMode.startCompact()
            intent.removeExtra(EXTRA_VOICE_COMPACT)
            if (::nativeBridge.isInitialized) nativeBridge.emit("assist", JSONObject().put("pending", true))
        }
        if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
            val sharedIntent = Intent(intent)
            intent.action = Intent.ACTION_MAIN // handled once, even after rotation
            ShareIntake.read(this, sharedIntent) { payload ->
                if (payload == null) { toast(getString(R.string.share_nothing)); return@read }
                pendingShare = payload
                nativeBridge.emit("share", JSONObject().put("pending", true))
            }
        }
        return opened
    }

    private fun applyInsets(root: View) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    companion object {
        const val EXTRA_OPEN_URL = "ng.nifelux.colonai.OPEN_URL"
        const val EXTRA_ASSIST = "ng.nifelux.colonai.ASSIST"
        const val EXTRA_VOICE_COMPACT = "ng.nifelux.colonai.VOICE_COMPACT"
    }
}
