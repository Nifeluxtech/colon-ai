package ng.nifelux.colonai

import android.app.ActivityManager
import android.app.SearchManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
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
import androidx.core.view.WindowInsetsCompat

/**
 * Colon Browser (the standalone app, ng.nifelux.colonbrowser) on Android System WebView: one WebView per tab
 * (TabManager), native address bar, back / forward / reload / home, tabs and private tabs, bookmarks, history,
 * downloads, desktop site, clear browsing data, Google and bank sign-in in a Custom Tab, and the Saga control bar
 * (BrowserSaga). Tabs and history survive restarts; private tabs never do. Menus live in BrowserMenu.
 */
class BrowserActivity : AppCompatActivity(), TabManager.Host, BrowserHost {
    override val activity: AppCompatActivity get() = this
    override lateinit var tabs: TabManager
        private set
    override lateinit var fileChooser: FileChooser
        private set
    override lateinit var store: BrowserStore
        private set
    lateinit var saga: BrowserSaga
        private set

    private lateinit var content: FrameLayout
    private lateinit var topBar: View
    private lateinit var address: EditText
    private lateinit var progress: ProgressBar
    private lateinit var tabCount: TextView
    private lateinit var back: ImageButton
    private lateinit var forward: ImageButton
    private lateinit var reload: ImageButton
    private lateinit var fullscreen: Fullscreen
    private lateinit var permissions: PermissionAsker
    private val main = Handler(Looper.getMainLooper())
    private var reloadOnReturn = false
    private val saveTabs = Runnable { store.tabsJson = tabs.toJson() }

    val clearData = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == RESULT_OK) { tabs.active?.webView?.reload(); refreshChrome() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        if (BuildConfig.IS_BROWSER_APP) installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT))
        setContentView(R.layout.activity_browser)
        val root = findViewById<View>(R.id.browser_root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        content = findViewById(R.id.content)
        topBar = findViewById(R.id.top_bar)
        address = findViewById(R.id.address)
        progress = findViewById(R.id.progress)
        tabCount = findViewById(R.id.tab_count)
        back = findViewById(R.id.btn_back)
        forward = findViewById(R.id.btn_forward)
        reload = findViewById(R.id.btn_reload)
        fileChooser = FileChooser(this)
        permissions = PermissionAsker(this)
        fullscreen = Fullscreen(this)
        store = BrowserStore(this)
        PrivateProfiles.deleteStale() // a private session the app was killed in

        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        tabs = TabManager(this, TabPolicy.maxLiveFor(am.isLowRamDevice, am.memoryClass),
            TabPolicy.maxTabsFor(am.isLowRamDevice))
        saga = BrowserSaga(this, ColonApplication.of(this).bridge)
        wireControls()

        val restoredActive = tabs.restore(store.tabsJson)
        val opened = handleIntent(intent)
        if (!opened) restoredActive?.let { tabs.switchTo(it) } ?: tabs.open(UrlRules.HOME)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = tabs.active?.webView
                when {
                    fullscreen.active -> exitFullscreen()
                    wv != null && wv.canGoBack() -> wv.goBack()
                    tabs.active?.popup == true && tabs.tabs.size > 1 -> tabs.active?.let { tabs.close(it) }
                    else -> { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
                }
            }
        })
        if (BuildConfig.IS_BROWSER_APP) UpdateChecker.checkOnStart(this)
    }

    private fun wireControls() {
        address.setOnEditorActionListener { _, actionId, event ->
            val go = actionId == EditorInfo.IME_ACTION_GO ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (go) { navigate(address.text.toString()); true } else false
        }
        address.setOnFocusChangeListener { _, focused -> if (!focused) refreshChrome() }
        back.setOnClickListener { tabs.active?.webView?.takeIf { it.canGoBack() }?.goBack() }
        forward.setOnClickListener { tabs.active?.webView?.takeIf { it.canGoForward() }?.goForward() }
        reload.setOnClickListener {
            val t = tabs.active ?: return@setOnClickListener
            if (t.progress in 0..99) t.webView?.stopLoading() else t.webView?.reload()
        }
        findViewById<View>(R.id.btn_home).setOnClickListener { navigate(UrlRules.HOME) }
        tabCount.setOnClickListener { BrowserMenu.showTabs(this) }
        findViewById<View>(R.id.btn_menu).setOnClickListener { BrowserMenu.show(this, it) }
        saga.bind(findViewById(R.id.browser_root))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Opens the intent's link or search (from Colon AI, Saga or another app) in a new tab. */
    private fun handleIntent(intent: Intent?): Boolean {
        intent ?: return false
        val url = when (intent.action) {
            Intent.ACTION_WEB_SEARCH -> intent.getStringExtra(SearchManager.QUERY)?.let { UrlRules.addressToUrl(it) }
            else -> intent.dataString
        } ?: return false
        if (url != UrlRules.HOME && !UrlRules.isWebUrl(url)) return false
        intent.data = null
        intent.action = Intent.ACTION_MAIN // handled once, even after rotation
        if (UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS)) { openSignIn(url); return false }
        if (tabs.open(url) == null) tabLimitReached()
        return true
    }

    override fun onStart() {
        super.onStart()
        saga.attach()
    }

    override fun onStop() {
        saga.detach()
        main.removeCallbacks(saveTabs)
        store.tabsJson = tabs.toJson()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        tabs.active?.webView?.onResume()
        if (reloadOnReturn) { reloadOnReturn = false; tabs.active?.webView?.reload() }
    }

    override fun onPause() { tabs.active?.webView?.onPause(); super.onPause() }

    override fun onDestroy() {
        if (isFinishing && tabs.tabs.any { it.incognito }) {
            tabs.tabs.filter { it.incognito }.forEach { t -> t.webView?.let { ShellWeb.destroy(it) }; t.webView = null }
            onPrivateSessionEnded()
        }
        tabs.tabs.forEach { t -> t.webView?.let { ShellWeb.destroy(it) }; t.webView = null }
        super.onDestroy()
    }

    /** Low memory: keep only the active tab's WebView. */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        @Suppress("DEPRECATION")
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) tabs.trim(1)
    }

    @Deprecated("Deprecated in Java")
    override fun onLowMemory() { @Suppress("DEPRECATION") super.onLowMemory(); tabs.trim(1) }

    /* ---------- navigation ---------- */

    override fun navigate(input: String) {
        val url = UrlRules.addressToUrl(input) ?: return
        hideKeyboard()
        if (UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS)) { openSignIn(url); return }
        val tab = tabs.active
        if (tab == null) { if (tabs.open(url) == null) tabLimitReached(); return }
        tab.url = url
        loadInto(tabs.ensureLive(tab), url)
        refreshChrome()
    }

    override fun loadInto(webView: WebView, url: String) {
        val tab = tabs.tabs.firstOrNull { it.webView === webView }
        when {
            url == UrlRules.HOME -> webView.loadDataWithBaseURL(null,
                HomePage.html(if (tab?.incognito == true) emptyList() else store.bookmarks(), isDark(),
                    tab?.incognito == true, PrivateProfiles.supported()), "text/html", "utf-8", null)
            UrlRules.isWebUrl(url) -> webView.loadUrl(url)
            else -> Unit // a blank pop-up tab, filled by its opener
        }
    }

    /** Opens a new private tab, after a warning when this WebView can't keep its cookies separate. */
    fun openPrivateTab() {
        val open = { if (tabs.open(UrlRules.HOME, incognito = true) == null) tabLimitReached() }
        if (PrivateProfiles.supported()) open()
        else com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle(R.string.private_tab).setMessage(R.string.private_limited)
            .setPositiveButton(R.string.private_open_anyway) { _, _ -> open() }
            .setNegativeButton(R.string.cancel, null).show()
    }

    /** Desktop site on/off for the active tab (reloads it). */
    fun toggleDesktop() {
        val tab = tabs.active ?: return
        tab.desktop = !tab.desktop
        tab.webView?.let { BrowserWeb.applyUserAgent(it, tab.desktop); it.reload() }
        toast(getString(if (tab.desktop) R.string.desktop_on else R.string.desktop_off))
        scheduleSave()
    }

    override fun openSignIn(url: String) {
        if (SignInTabs.open(this, url, isDark())) { reloadOnReturn = true; toast(getString(R.string.signin_custom_tab)) }
        else toast(getString(R.string.signin_no_browser))
    }

    /* ---------- TabManager.Host ---------- */

    override fun createTabWebView(tab: BrowserTab): WebView = BrowserWeb.create(this, tab)

    override fun userInputBlocked(): Boolean = ::saga.isInitialized && saga.blocksUser()

    override fun destroyTabWebView(webView: WebView) = ShellWeb.destroy(webView)

    override fun onActiveTabChanged(tab: BrowserTab?) {
        // Only the active tab's WebView is in the layout; the shield (AI mode) stays on top.
        for (i in content.childCount - 1 downTo 0) {
            val c = content.getChildAt(i)
            if (c is WebView) content.removeView(c)
        }
        tab?.webView?.let { wv ->
            (wv.parent as? ViewGroup)?.removeView(wv)
            content.addView(wv, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT))
        }
        if (tab == null) tabs.open(UrlRules.HOME)
        refreshChrome()
        saga.reportState()
    }

    override fun onTabsChanged() {
        val n = tabs.tabs.size
        tabCount.text = String.format(java.util.Locale.getDefault(), "%d", n.coerceAtMost(99))
        tabCount.contentDescription = getString(R.string.tabs_open, n)
        scheduleSave()
    }

    override fun onPrivateSessionEnded() {
        PrivateProfiles.endSession()
        main.postDelayed({ PrivateProfiles.deleteStale() }, 1500) // once the WebViews have let go of the profile
    }

    private fun scheduleSave() { main.removeCallbacks(saveTabs); main.postDelayed(saveTabs, 800) }

    /* ---------- BrowserHost ---------- */

    override fun onTabUpdated(tab: BrowserTab) {
        if (tab === tabs.active) { refreshChrome(); saga.reportState() }
        if (!tab.incognito) scheduleSave()
    }

    override fun onTabRendererGone(tab: BrowserTab) {
        tab.webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        tab.webView = null
        if (tab === tabs.active) { tabs.switchTo(tab); toast(getString(R.string.tab_crashed)) }
    }

    override fun tabLimitReached() = toast(getString(R.string.tab_limit, tabs.maxTabs))

    override fun askPermissions(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit) = permissions.ask(perms, cb)

    override fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) =
        fullscreen.enter(view, callback)

    override fun exitFullscreen() = fullscreen.exit()

    override fun isDark(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_NO

    override fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    fun refreshChrome() {
        val tab = tabs.active
        val wv = tab?.webView
        val private = tab?.incognito == true
        if (!address.hasFocus()) address.setText(UrlRules.displayUrl(tab?.url))
        address.hint = getString(if (private) R.string.address_hint_private else R.string.address_hint)
        topBar.setBackgroundColor(ContextCompat.getColor(this, if (private) R.color.colon_private else R.color.colon_bg))
        address.backgroundTintList = if (private) ColorStateList.valueOf(ContextCompat.getColor(this,
            R.color.colon_private_field)) else null
        val secure = tab?.url?.startsWith("https://") == true
        address.setCompoundDrawablesRelativeWithIntrinsicBounds(when {
            private -> R.drawable.ic_private
            tab == null || tab.url == UrlRules.HOME || tab.url.isEmpty() -> R.drawable.ic_search
            secure -> R.drawable.ic_lock
            else -> R.drawable.ic_info
        }, 0, 0, 0)
        back.isEnabled = wv?.canGoBack() == true
        forward.isEnabled = wv?.canGoForward() == true
        back.alpha = if (back.isEnabled) 1f else .38f
        forward.alpha = if (forward.isEnabled) 1f else .38f
        val loading = tab != null && tab.progress in 0..99
        progress.visibility = if (loading) View.VISIBLE else View.GONE
        progress.progress = tab?.progress ?: 100
        reload.setImageResource(if (loading) R.drawable.ic_close else R.drawable.ic_refresh)
        reload.contentDescription = getString(if (loading) R.string.stop_loading else R.string.reload)
        tabCount.isActivated = private
    }

    private fun hideKeyboard() {
        address.clearFocus()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
    }

    companion object {
        const val ACTION_OPEN_TAB = "ng.nifelux.colonai.OPEN_TAB"
    }
}
