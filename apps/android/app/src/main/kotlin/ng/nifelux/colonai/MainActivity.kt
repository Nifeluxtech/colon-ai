package ng.nifelux.colonai

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
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
    private var lastTouchInPanel = false

    private lateinit var container: FrameLayout
    private lateinit var progress: ProgressBar
    private lateinit var offline: View
    private var firstPaint = false
    private var started = 0L
    private var pendingShare: JSONObject? = null
    private var webTheme = "dark"
    private val permissionCallbacks = ArrayDeque<(Boolean) -> Unit>()
    private val onNetwork: (Boolean) -> Unit = { online -> if (online && offline.visibility == View.VISIBLE) retry() }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        permissionCallbacks.removeFirstOrNull()?.invoke(ok)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        started = SystemClock.elapsedRealtime()
        // Keep the splash until the page paints (at most 2.5 s, so a slow network never traps the user on it).
        splash.setKeepOnScreenCondition { !firstPaint && SystemClock.elapsedRealtime() - started < 2500 }
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        setContentView(R.layout.activity_main)
        container = findViewById(R.id.web_container)
        progress = findViewById(R.id.shell_progress)
        offline = findViewById(R.id.offline)
        findViewById<Button>(R.id.offline_retry).setOnClickListener { retry() }
        applyInsets(findViewById(R.id.root))
        fileChooser = FileChooser(this)

        val wv = ShellWeb.create(this)
        if (wv == null) { showOffline(getString(R.string.webview_missing)); firstPaint = true; return }
        webView = wv
        container.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT))
        nativeBridge = NativeBridge(this, webView)
        nativeBridge.install()
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
        UpdateChecker.checkOnStart(this)
    }

    override fun onStart() {
        super.onStart()
        ColonApplication.of(this).bridge.acquire()
        ColonApplication.of(this).addNetworkListener(onNetwork)
    }

    override fun onStop() {
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
        if (::webView.isInitialized) webView.onPause()
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
        if (::browserPanel.isInitialized) browserPanel.destroy()
        if (::webView.isInitialized) ShellWeb.destroy(webView)
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /* ---------- called by ShellWeb's clients ---------- */

    fun onPageVisible() {
        firstPaint = true
        if (offline.visibility == View.VISIBLE && ColonApplication.of(this).online) offline.visibility = View.GONE
    }

    fun onProgress(p: Int) {
        progress.progress = p
        progress.visibility = if (p in 1..99) View.VISIBLE else View.GONE
    }

    fun showOffline(detail: String?) {
        firstPaint = true
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

    fun takeShare(): JSONObject? = pendingShare.also { pendingShare = null }

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
    }
}
