package ng.nifelux.colonai

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
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
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Colon Browser on Android System WebView: one WebView per tab (TabManager), native address bar, back / forward /
 * reload / home, tabs, bookmarks, history and downloads, plus the Saga control bar (BrowserSaga) wired to the bridge.
 */
class BrowserActivity : AppCompatActivity(), TabManager.Host {
    lateinit var tabs: TabManager
        private set
    lateinit var fileChooser: FileChooser
        private set
    lateinit var store: BrowserStore
        private set
    lateinit var saga: BrowserSaga
        private set

    private lateinit var content: FrameLayout
    private lateinit var address: EditText
    private lateinit var progress: ProgressBar
    private lateinit var tabCount: TextView
    private lateinit var back: ImageButton
    private lateinit var forward: ImageButton
    private lateinit var reload: ImageButton
    private var fullscreen: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var permissionCallback: ((Map<String, Boolean>) -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            permissionCallback?.invoke(result); permissionCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
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
        address = findViewById(R.id.address)
        progress = findViewById(R.id.progress)
        tabCount = findViewById(R.id.tab_count)
        back = findViewById(R.id.btn_back)
        forward = findViewById(R.id.btn_forward)
        reload = findViewById(R.id.btn_reload)
        fileChooser = FileChooser(this)
        store = BrowserStore(this)

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
                    fullscreen != null -> exitFullscreen()
                    wv != null && wv.canGoBack() -> wv.goBack()
                    else -> { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
                }
            }
        })
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
        tabCount.setOnClickListener { showTabs() }
        findViewById<View>(R.id.btn_menu).setOnClickListener { showMenu(it) }
        saga.bind(findViewById(R.id.browser_root))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Opens the intent's link (from Colon AI, Saga or another app) in a new tab. */
    private fun handleIntent(intent: Intent?): Boolean {
        val url = intent?.dataString ?: return false
        if (!UrlRules.isWebUrl(url)) return false
        intent.data = null
        if (tabs.open(url) == null) tabLimitReached()
        return true
    }

    override fun onStart() {
        super.onStart()
        saga.attach()
    }

    override fun onStop() {
        saga.detach()
        store.tabsJson = tabs.toJson()
        super.onStop()
    }

    override fun onResume() { super.onResume(); tabs.active?.webView?.onResume() }
    override fun onPause() { tabs.active?.webView?.onPause(); super.onPause() }

    override fun onDestroy() {
        tabs.tabs.forEach { t -> t.webView?.let { ShellWeb.destroy(it) }; t.webView = null }
        super.onDestroy()
    }

    /** Low memory: keep only the active tab's WebView. */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        @Suppress("DEPRECATION")
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) tabs.trim(1)
    }

    override fun onLowMemory() { super.onLowMemory(); tabs.trim(1) }

    /* ---------- navigation ---------- */

    fun navigate(input: String) {
        val url = UrlRules.addressToUrl(input) ?: return
        hideKeyboard()
        val tab = tabs.active
        if (tab == null) { if (tabs.open(url) == null) tabLimitReached(); return }
        tab.url = url
        loadInto(tabs.ensureLive(tab), url)
        refreshChrome()
    }

    override fun loadInto(webView: WebView, url: String) {
        when {
            url == UrlRules.HOME -> webView.loadDataWithBaseURL(null, HomePage.html(store.bookmarks(), isDark()),
                "text/html", "utf-8", null)
            UrlRules.isWebUrl(url) -> webView.loadUrl(url)
            else -> Unit // a blank pop-up tab, filled by its opener
        }
    }

    /* ---------- TabManager.Host ---------- */

    override fun createTabWebView(tab: BrowserTab): WebView = BrowserWeb.create(this, tab)

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
        tabCount.text = String.format(java.util.Locale.getDefault(), "%d", tabs.tabs.size.coerceAtMost(99))
        tabCount.contentDescription = getString(R.string.tabs_open, tabs.tabs.size)
    }

    fun onTabUpdated(tab: BrowserTab) {
        if (tab === tabs.active) { refreshChrome(); saga.reportState() }
    }

    fun onPageLoaded(tab: BrowserTab) = store.addHistory(tab.url, tab.title)

    fun onTabRendererGone(tab: BrowserTab) {
        tab.webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        tab.webView = null
        if (tab === tabs.active) { tabs.switchTo(tab); toast(getString(R.string.tab_crashed)) }
    }

    fun tabLimitReached() = toast(getString(R.string.tab_limit, tabs.maxTabs))

    private fun refreshChrome() {
        val tab = tabs.active
        val wv = tab?.webView
        if (!address.hasFocus()) address.setText(UrlRules.displayUrl(tab?.url))
        val secure = tab?.url?.startsWith("https://") == true
        address.setCompoundDrawablesRelativeWithIntrinsicBounds(
            if (tab == null || tab.url == UrlRules.HOME || tab.url.isEmpty()) R.drawable.ic_search
            else if (secure) R.drawable.ic_lock else R.drawable.ic_info, 0, 0, 0)
        back.isEnabled = wv?.canGoBack() == true
        forward.isEnabled = wv?.canGoForward() == true
        back.alpha = if (back.isEnabled) 1f else .38f
        forward.alpha = if (forward.isEnabled) 1f else .38f
        val loading = tab != null && tab.progress in 0..99
        progress.visibility = if (loading) View.VISIBLE else View.GONE
        progress.progress = tab?.progress ?: 100
        reload.setImageResource(if (loading) R.drawable.ic_close else R.drawable.ic_refresh)
        reload.contentDescription = getString(if (loading) R.string.stop_loading else R.string.reload)
    }

    /* ---------- tabs, menu, lists ---------- */

    private fun showTabs() {
        EntryList.show(this, getString(R.string.tabs_title, tabs.tabs.size),
            tabs.tabs.map { EntryList.Item(it.id, it.label(), UrlRules.displayUrl(it.url), it === tabs.active) },
            getString(R.string.no_tabs),
            onPick = { item -> tabs.find(item.key)?.let { tabs.switchTo(it) } },
            onRemove = { item -> tabs.find(item.key)?.let { tabs.close(it) } },
            action = getString(R.string.new_tab) to { if (tabs.open(UrlRules.HOME) == null) tabLimitReached() })
    }

    private fun showMenu(anchor: View) {
        val tab = tabs.active
        val pageUrl = tab?.url?.takeIf { UrlRules.isWebUrl(it) }
        val menu = PopupMenu(this, anchor)
        val m = menu.menu
        m.add(0, 1, 0, R.string.new_tab)
        if (pageUrl != null) m.add(0, 2, 1, if (store.isBookmarked(pageUrl)) R.string.remove_bookmark
            else R.string.add_bookmark)
        m.add(0, 3, 2, R.string.bookmarks)
        m.add(0, 4, 3, R.string.history)
        m.add(0, 5, 4, R.string.downloads)
        if (pageUrl != null) { m.add(0, 6, 5, R.string.share_page); m.add(0, 7, 6, R.string.open_in_app) }
        m.add(0, 8, 7, R.string.saga_status)
        m.add(0, 9, 8, R.string.clear_data)
        m.add(0, 10, 9, R.string.back_to_chat)
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> if (tabs.open(UrlRules.HOME) == null) tabLimitReached()
                2 -> pageUrl?.let { toast(getString(if (store.toggleBookmark(it, tab.title)) R.string.bookmarked
                    else R.string.bookmark_removed)) }
                3 -> showEntries(R.string.bookmarks, store.bookmarks(), R.string.no_bookmarks) { store.removeBookmark(it) }
                4 -> showEntries(R.string.history, store.history(), R.string.no_history) { store.removeHistory(it) }
                5 -> openDownloads()
                6 -> pageUrl?.let { share(it, tab.title) }
                7 -> pageUrl?.let { UpdateChecker.openExternal(this, it) }
                8 -> saga.showStatus()
                9 -> BrowserData.confirmClear(this) { refreshChrome() }
                10 -> startActivity(Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            }
            true
        }
        menu.show()
    }

    private fun showEntries(titleRes: Int, list: List<BrowserStore.Entry>, emptyRes: Int, remove: (String) -> Unit) {
        EntryList.show(this, getString(titleRes),
            list.map { EntryList.Item(it.url, it.title.ifBlank { it.url }, it.url) }, getString(emptyRes),
            onPick = { navigate(it.key) }, onRemove = { remove(it.key) })
    }

    private fun openDownloads() {
        try { startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS)) }
        catch (_: Exception) { toast(getString(R.string.no_app_to_open)) }
    }

    private fun share(url: String, title: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
            .putExtra(Intent.EXTRA_SUBJECT, title)
        try { startActivity(Intent.createChooser(send, null)) } catch (_: Exception) {}
    }

    /* ---------- full-screen video ---------- */

    fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (fullscreen != null) { callback.onCustomViewHidden(); return }
        fullscreen = view
        fullscreenCallback = callback
        (window.decorView as FrameLayout).addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT))
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    fun exitFullscreen() {
        val v = fullscreen ?: return
        (window.decorView as FrameLayout).removeView(v)
        fullscreen = null
        WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
    }

    /* ---------- helpers ---------- */

    fun askPermissions(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit) {
        val missing = perms.filter { ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager
            .PERMISSION_GRANTED }
        if (missing.isEmpty()) { cb(perms.associateWith { true }); return }
        permissionCallback?.invoke(emptyMap())
        permissionCallback = { r -> cb(perms.associateWith { it !in missing || r[it] == true }) }
        permissionLauncher.launch(missing.toTypedArray())
    }

    fun isDark(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_NO

    fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun hideKeyboard() {
        address.clearFocus()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
    }

    companion object {
        const val ACTION_OPEN_TAB = "ng.nifelux.colonai.OPEN_TAB"
    }
}
