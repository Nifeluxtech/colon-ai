package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Colon AI's in-chat browser (Phase 8 separation, Phase 10 layouts): a real Android System WebView panel inside
 * MainActivity, driven by the chat page through window.ColonNative.browser(...) and by the user. Embedded, split
 * or full screen (PanelLayout); back / forward / reload / close; "Open in Colon Browser" hands the page to the
 * standalone app (or offers its download). Saga's AI / Manual / Shared control and consent work here exactly as in
 * Colon Browser (BrowserSaga). Every change is sent to the page as the "browser" event (state()).
 */
class ChatBrowserPanel(private val a: MainActivity) : BrowserHost, TabManager.Host {
    override val activity: AppCompatActivity get() = a
    override val fileChooser: FileChooser get() = a.fileChooser
    override val store = BrowserStore(a, BrowserStore.PANEL)
    override val tabs = TabManager(this, 2, MAX_TABS)
    val saga = BrowserSaga(this, ColonApplication.of(a).bridge)

    private val box: LinearLayout = a.findViewById(R.id.split_box)
    private val panel: View = a.findViewById(R.id.browser_panel)
    private val divider: View = a.findViewById(R.id.panel_divider)
    private val web: View = a.findViewById(R.id.web_container)
    private val content: FrameLayout = panel.findViewById(R.id.content)
    private val address: EditText = panel.findViewById(R.id.address)
    private val progress: ProgressBar = panel.findViewById(R.id.progress)
    private val back: ImageButton = panel.findViewById(R.id.btn_back)
    private val reload: ImageButton = panel.findViewById(R.id.btn_reload)
    private val expand: ImageButton = panel.findViewById(R.id.btn_expand)
    private val prefs = a.getSharedPreferences("colon.panel.layout", Context.MODE_PRIVATE)
    private val fullscreen = Fullscreen(a)
    private val main = Handler(Looper.getMainLooper())
    private val emitState = Runnable { a.nativeBridge.emit("browser", state()) }
    private val bridge = ColonApplication.of(a).bridge
    /** Phase 10: the panel opens by itself when Saga asks to browse while it is closed (BrowserSaga only listens
     *  while the panel is open, so this request is handed to it once it is). */
    private val opener = object : BridgeClient.Listener {
        override fun onControlRequest(request: BridgeProtocol.Incoming.Control) {
            if (isOpen || request.mode == ControlState.Mode.MANUAL) return
            open(null)
            saga.onControlRequest(request)
        }
    }

    var isOpen = false
        private set
    var mode: PanelLayout.Mode = PanelLayout.Mode.from(prefs.getString("mode", null))
        ?: PanelLayout.defaultMode(a.resources.configuration.screenWidthDp)
        private set
    private var beforeFull = PanelLayout.Mode.EMBEDDED
    var collapsed = false
        private set
    private var share = PanelLayout.clampShare(prefs.getFloat("share", PanelLayout.EMBEDDED_SHARE))
    private var reloadOnReturn = false
    private var restored = false

    init {
        saga.bind(panel)
        address.setOnEditorActionListener { _, id, e ->
            val go = id == EditorInfo.IME_ACTION_GO || (e?.keyCode == KeyEvent.KEYCODE_ENTER &&
                e.action == KeyEvent.ACTION_DOWN)
            if (go) { navigate(address.text.toString()); true } else false
        }
        address.setOnFocusChangeListener { _, f -> if (!f) refresh() }
        back.setOnClickListener { tabs.active?.webView?.takeIf { it.canGoBack() }?.goBack() }
        reload.setOnClickListener {
            val t = tabs.active ?: return@setOnClickListener
            if (t.progress in 0..99) t.webView?.stopLoading() else t.webView?.reload()
        }
        expand.setOnClickListener { setMode(if (mode == PanelLayout.Mode.FULL) beforeFull else PanelLayout.Mode.FULL) }
        panel.findViewById<View>(R.id.btn_menu).setOnClickListener { showMenu(it) }
        panel.findViewById<View>(R.id.btn_close).setOnClickListener { close() }
        panel.findViewById<View>(R.id.panel_header).setOnClickListener { if (collapsed) setCollapsed(false) }
        wireDivider()
        bridge.addListener(opener)
    }

    /* ---------- the page's commands (NativeBridge "browser") ---------- */

    /** Opens the panel (in [layout] when given) and loads [url] in a new tab, or shows the current tab. */
    fun open(url: String?, layout: String? = null) {
        if (!restored) { restored = true; tabs.restore(store.tabsJson)?.let { if (url == null) tabs.switchTo(it) } }
        PanelLayout.Mode.from(layout)?.let { mode = it }
        if (!isOpen) { isOpen = true; saga.attach() }
        collapsed = false
        applyLayout()
        when {
            url.isNullOrBlank() -> if (tabs.active == null) tabs.open(UrlRules.HOME)
            UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS) -> {
                if (tabs.active == null) tabs.open(UrlRules.HOME)
                openSignIn(url)
            }
            else -> {
                val reuse = tabs.active?.takeIf { it.url == UrlRules.HOME || it.url.isEmpty() }
                    ?: if (tabs.tabs.size >= MAX_TABS) tabs.active else null
                if (reuse != null) { if (reuse !== tabs.active) tabs.switchTo(reuse); navigate(url) }
                else tabs.open(url)
            }
        }
        tabs.active?.webView?.onResume()
        changed()
    }

    /** Hides the panel; its tabs, pages and Saga session stay for the next open. */
    fun close() {
        if (!isOpen) return
        isOpen = false
        fullscreen.exit()
        tabs.active?.webView?.onPause()
        tabs.trim(1)
        hideKeyboard()
        saga.detach()
        store.tabsJson = tabs.toJson()
        applyLayout()
        changed()
    }

    fun setMode(m: PanelLayout.Mode) {
        if (m == PanelLayout.Mode.FULL && mode != PanelLayout.Mode.FULL) beforeFull = mode
        mode = m
        collapsed = false
        if (m != PanelLayout.Mode.FULL) prefs.edit().putString("mode", m.wire).apply()
        if (isOpen) applyLayout()
        changed()
    }

    fun setCollapsed(c: Boolean) {
        if (mode != PanelLayout.Mode.EMBEDDED && c) setMode(PanelLayout.Mode.EMBEDDED)
        collapsed = c
        applyLayout()
        changed()
    }

    fun goBack(): Boolean = tabs.active?.webView?.takeIf { it.canGoBack() }?.let { it.goBack(); true } ?: false
    fun goForward(): Boolean = tabs.active?.webView?.takeIf { it.canGoForward() }?.let { it.goForward(); true } ?: false
    fun reloadPage() { tabs.active?.webView?.reload() }

    /** "Open in Colon Browser": the standalone app takes the page (or its download is offered). */
    fun handoff(): Boolean {
        val url = tabs.active?.url?.takeIf { UrlRules.isWebUrl(it) }
        val ok = if (url != null) Handoff.openUrl(a, url) else Handoff.launch(a)
        if (!ok) BrowserMenu.offerPartner(this)
        return ok
    }

    /** What the chat page sees (the "browser" event and the "state" action). */
    fun state(): JSONObject {
        val t = tabs.active
        val wv = t?.webView
        return JSONObject()
            .put("open", isOpen)
            .put("layout", mode.wire)
            .put("collapsed", collapsed)
            .put("url", t?.url?.takeIf { UrlRules.isWebUrl(it) } ?: "")
            .put("title", t?.title ?: "")
            .put("loading", (t?.progress ?: 100) < 100)
            .put("progress", t?.progress ?: 100)
            .put("canGoBack", wv?.canGoBack() == true)
            .put("canGoForward", wv?.canGoForward() == true)
            .put("tabs", tabs.tabs.size)
            .put("control", saga.control.mode.wire)
            .put("paused", saga.control.paused)
            .put("task", saga.control.task ?: JSONObject.NULL)
            .put("browserApp", Handoff.installedPartner(a) != null)
    }

    /* ---------- MainActivity hooks ---------- */

    /** Back button: leave full-screen video, then go back in the panel when it is full screen or was touched last. */
    fun handleBack(panelFocused: Boolean): Boolean {
        if (fullscreen.active) { exitFullscreen(); return true }
        if (!isOpen) return false
        if (mode == PanelLayout.Mode.FULL) { if (!goBack()) setMode(beforeFull); return true }
        return panelFocused && goBack()
    }

    fun contains(ev: MotionEvent): Boolean {
        if (!isOpen || panel.visibility != View.VISIBLE) return false
        val loc = IntArray(2)
        panel.getLocationOnScreen(loc)
        return ev.rawX >= loc[0] && ev.rawX < loc[0] + panel.width && ev.rawY >= loc[1] && ev.rawY < loc[1] + panel.height
    }

    fun onResume() {
        if (!isOpen) return
        tabs.active?.webView?.onResume()
        if (reloadOnReturn) { reloadOnReturn = false; tabs.active?.webView?.reload() }
    }

    fun onPause() { tabs.active?.webView?.onPause(); if (restored) store.tabsJson = tabs.toJson() }
    fun onConfigurationChanged() { if (isOpen) applyLayout() }
    fun onTrimMemory() { tabs.trim(1) }

    fun destroy() {
        bridge.removeListener(opener)
        if (isOpen) saga.detach()
        tabs.tabs.forEach { t -> t.webView?.let { ShellWeb.destroy(it) }; t.webView = null }
    }

    /* ---------- layout ---------- */

    private fun applyLayout() {
        val cfg = a.resources.configuration
        val side = PanelLayout.sideBySide(mode, cfg.screenWidthDp, cfg.screenHeightDp)
        box.orientation = if (side) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        // Side by side, the panel goes on the right: the box is laid out right-to-left, its children left-to-right.
        box.layoutDirection = if (side) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        listOf(panel, divider, web).forEach { it.layoutDirection = View.LAYOUT_DIRECTION_LOCALE }
        panel.visibility = if (isOpen) View.VISIBLE else View.GONE
        divider.visibility = if (isOpen && mode == PanelLayout.Mode.SPLIT) View.VISIBLE else View.GONE
        web.visibility = if (isOpen && mode == PanelLayout.Mode.FULL) View.GONE else View.VISIBLE
        content.visibility = if (collapsed) View.GONE else View.VISIBLE
        progress.visibility = if (collapsed) View.GONE else progress.visibility
        val s = PanelLayout.panelShare(mode, collapsed, share)
        fun lp(weight: Float, wrap: Boolean = false) = LinearLayout.LayoutParams(
            if (side) (if (wrap) ViewGroup.LayoutParams.WRAP_CONTENT else 0) else ViewGroup.LayoutParams.MATCH_PARENT,
            if (side) ViewGroup.LayoutParams.MATCH_PARENT else (if (wrap) ViewGroup.LayoutParams.WRAP_CONTENT else 0),
            weight)
        panel.layoutParams = if (collapsed) lp(0f, wrap = true) else lp(s)
        web.layoutParams = lp(if (mode == PanelLayout.Mode.FULL) 0f else 1f - s.coerceAtMost(.99f))
        val d = (16 * a.resources.displayMetrics.density).toInt()
        divider.layoutParams = LinearLayout.LayoutParams(if (side) d else ViewGroup.LayoutParams.MATCH_PARENT,
            if (side) ViewGroup.LayoutParams.MATCH_PARENT else d)
        expand.setImageResource(if (mode == PanelLayout.Mode.FULL) R.drawable.ic_fullscreen_exit else R.drawable.ic_fullscreen)
        expand.contentDescription = a.getString(if (mode == PanelLayout.Mode.FULL) R.string.panel_exit_full
            else R.string.panel_full)
        box.requestLayout()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun wireDivider() {
        divider.setOnTouchListener { _, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> true
                MotionEvent.ACTION_MOVE -> {
                    val loc = IntArray(2)
                    box.getLocationOnScreen(loc)
                    val side = box.orientation == LinearLayout.HORIZONTAL
                    share = if (side) PanelLayout.shareFromDrag(ev.rawX - loc[0], box.width.toFloat(), true)
                    else PanelLayout.shareFromDrag(ev.rawY - loc[1], box.height.toFloat(), false)
                    applyLayout(); true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    prefs.edit().putFloat("share", share).apply(); changed(); true
                }
                else -> false
            }
        }
    }

    private fun showMenu(anchor: View) {
        val t = tabs.active
        val page = t?.url?.takeIf { UrlRules.isWebUrl(it) }
        val menu = PopupMenu(a, anchor)
        val m = menu.menu
        var order = 0
        fun add(id: Int, res: Int) = m.add(0, id, order++, res)
        if (t?.webView?.canGoForward() == true) add(1, R.string.forward)
        add(2, R.string.open_in_browser_app)
        if (mode != PanelLayout.Mode.EMBEDDED) add(3, R.string.panel_embedded)
        if (mode != PanelLayout.Mode.SPLIT) add(4, R.string.panel_split)
        add(5, if (collapsed) R.string.panel_expand else R.string.panel_collapse)
        add(6, R.string.new_tab)
        if (tabs.tabs.size > 1) add(7, R.string.tabs_title_short)
        if (t != null) add(8, R.string.desktop_site).apply { isCheckable = true; isChecked = t.desktop }
        if (page != null) add(9, R.string.share_page)
        add(10, R.string.downloads)
        add(11, R.string.saga_status)
        add(12, R.string.clear_data)
        add(13, R.string.panel_close_tabs)
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> goForward()
                2 -> handoff()
                3 -> setMode(PanelLayout.Mode.EMBEDDED)
                4 -> setMode(PanelLayout.Mode.SPLIT)
                5 -> setCollapsed(!collapsed)
                6 -> if (tabs.open(UrlRules.HOME) == null) tabLimitReached()
                7 -> showTabs()
                8 -> t?.let { it.desktop = !it.desktop; it.webView?.let { wv -> BrowserWeb.applyUserAgent(wv, it.desktop); wv.reload() } }
                9 -> page?.let { a.shareText(t.title, "", it) }
                10 -> BrowserMenu.showDownloads(this, store)
                11 -> saga.showStatus()
                12 -> a.startActivity(Intent(a, ClearDataActivity::class.java)
                    .putExtra(ClearDataActivity.EXTRA_STORE, BrowserStore.PANEL))
                13 -> { tabs.closeAll(); close() }
            }
            true
        }
        menu.show()
    }

    private fun showTabs() {
        EntryList.show(a, a.getString(R.string.tabs_title, tabs.tabs.size),
            tabs.tabs.map { EntryList.Item(it.id, it.label(), UrlRules.displayUrl(it.url), it === tabs.active) },
            a.getString(R.string.no_tabs),
            onPick = { item -> tabs.find(item.key)?.let { tabs.switchTo(it) } },
            onRemove = { item -> tabs.find(item.key)?.let { tabs.close(it) } })
    }

    /* ---------- BrowserHost / TabManager.Host ---------- */

    override fun navigate(input: String) {
        val url = UrlRules.addressToUrl(input) ?: return
        hideKeyboard()
        if (UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS)) { openSignIn(url); return }
        val tab = tabs.active ?: run { if (tabs.open(url) == null) tabLimitReached(); return }
        tab.url = url
        loadInto(tabs.ensureLive(tab), url)
        refresh()
    }

    override fun loadInto(webView: WebView, url: String) {
        when {
            url == UrlRules.HOME -> webView.loadDataWithBaseURL(null, HomePage.html(store.bookmarks(), isDark()),
                "text/html", "utf-8", null)
            UrlRules.isWebUrl(url) -> webView.loadUrl(url)
            else -> Unit
        }
    }

    override fun createTabWebView(tab: BrowserTab): WebView = BrowserWeb.create(this, tab)
    override fun destroyTabWebView(webView: WebView) = ShellWeb.destroy(webView)

    override fun onActiveTabChanged(tab: BrowserTab?) {
        for (i in content.childCount - 1 downTo 0) if (content.getChildAt(i) is WebView) content.removeViewAt(i)
        tab?.webView?.let { wv ->
            (wv.parent as? ViewGroup)?.removeView(wv)
            content.addView(wv, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT))
        }
        if (tab == null && isOpen) tabs.open(UrlRules.HOME)
        refresh()
        saga.reportState()
        changed()
    }

    override fun onTabsChanged() = changed()

    override fun onTabUpdated(tab: BrowserTab) {
        if (tab === tabs.active) { refresh(); saga.reportState(); changed() }
    }

    override fun onTabRendererGone(tab: BrowserTab) {
        tab.webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        tab.webView = null
        if (tab === tabs.active) { tabs.switchTo(tab); toast(a.getString(R.string.tab_crashed)) }
    }

    override fun tabLimitReached() = toast(a.getString(R.string.tab_limit, tabs.maxTabs))
    override fun askPermissions(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit) = a.permissions.ask(perms, cb)
    override fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) =
        fullscreen.enter(view, callback)
    override fun exitFullscreen() = fullscreen.exit()

    override fun openSignIn(url: String) {
        if (SignInTabs.open(a, url, isDark())) { reloadOnReturn = true; toast(a.getString(R.string.signin_custom_tab)) }
        else toast(a.getString(R.string.signin_no_browser))
    }

    override fun isDark(): Boolean =
        (a.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_NO

    override fun toast(text: String) = Toast.makeText(a, text, Toast.LENGTH_SHORT).show()

    private fun refresh() {
        val t = tabs.active
        val wv = t?.webView
        if (!address.hasFocus()) address.setText(UrlRules.displayUrl(t?.url))
        address.setCompoundDrawablesRelativeWithIntrinsicBounds(when {
            t == null || t.url == UrlRules.HOME || t.url.isEmpty() -> R.drawable.ic_search
            t.url.startsWith("https://") -> R.drawable.ic_lock
            else -> R.drawable.ic_info
        }, 0, 0, 0)
        back.isEnabled = wv?.canGoBack() == true
        back.alpha = if (back.isEnabled) 1f else .38f
        val loading = t != null && t.progress in 0..99
        progress.visibility = if (loading && !collapsed) View.VISIBLE else View.GONE
        progress.progress = t?.progress ?: 100
        reload.setImageResource(if (loading) R.drawable.ic_close else R.drawable.ic_refresh)
        reload.contentDescription = a.getString(if (loading) R.string.stop_loading else R.string.reload)
    }

    private fun changed() { main.removeCallbacks(emitState); main.postDelayed(emitState, 120) }

    private fun hideKeyboard() {
        address.clearFocus()
        (a.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
    }

    companion object {
        const val MAX_TABS = 6
    }
}
