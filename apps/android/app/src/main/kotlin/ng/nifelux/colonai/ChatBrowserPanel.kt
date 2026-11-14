package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.view.Gravity
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
 * MainActivity, driven by the chat page through window.ColonNative.browser(...) and by the user. In the chat thread
 * (inline, v0.9.1: over the card the page draws, InlineGeometry / InlineLayer), embedded, split or full screen
 * (PanelLayout); switching moves or resizes the same views, so the page never reloads. Back / forward / reload /
 * close; "Open in Colon Browser" hands the page to the standalone app (or offers its download). Saga's AI / Manual /
 * Shared control and consent work here exactly as in Colon Browser (BrowserSaga). Every change is sent to the page as the "browser" event (state()).
 *
 * Phase 10: one browser per chat. The chat page says which conversation it shows (browser('chat')); the panel then
 * shows that chat's browser: its own tabs and history (ChatSessionStore) and, where the WebView supports profiles,
 * its own cookies, site storage and logins (WebView profile "colon-chat-<id>", ChatProfiles). A new chat starts
 * with a clean browser (a draft that the conversation adopts once it exists); deleting a chat deletes its browser
 * (browser('forget')); at most BuildConfig.CHAT_PROFILES_MAX chats keep one (least recently used go first). Without
 * MULTI_PROFILE every chat shares one cookie jar, cleared (except Colon's own cookies) when the chat changes.
 */
class ChatBrowserPanel(private val a: MainActivity) : BrowserHost, TabManager.Host {
    override val activity: AppCompatActivity get() = a
    override val fileChooser: FileChooser get() = a.fileChooser
    private val chats = ChatSessionStore(a)
    /** The chat whose browser the panel shows: a conversation id, or a draft key for a new chat. */
    private var chatKey: String = chats.current?.takeIf { it.isNotBlank() }
        ?: ChatSessionRules.draftKey(System.currentTimeMillis())
    private var chatStore = BrowserStore(a, BrowserStore.PANEL, chats.historyName(chatKey))
    override val store: BrowserStore get() = chatStore
    override val tabs = TabManager(this, 2, MAX_TABS)
    private var sharedNoticeShown = false
    val saga = BrowserSaga(this, ColonApplication.of(a).bridge)

    private val box: LinearLayout = a.findViewById(R.id.split_box)
    private val panel: View = a.findViewById(R.id.browser_panel)
    private val divider: View = a.findViewById(R.id.panel_divider)
    private val web: FrameLayout = a.findViewById(R.id.web_container)
    private val header: View = panel.findViewById(R.id.panel_header)
    /** Inline layout: the layer over the chat WebView that holds the panel (added after the WebView, so on top). */
    private val layer = InlineLayer(a).also {
        it.visibility = View.INVISIBLE
        web.addView(it, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT))
    }
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
            // Saga asked for another chat's browser than the one shown: no.
            val wanted = request.conversationId
            if (wanted != null && wanted != conversationOf(chatKey)) {
                bridge.reportControl(saga.control.mode, saga.control.paused, "declined"); return
            }
            open(null)
            saga.onControlRequest(request)
        }
    }

    var isOpen = false
        private set
    /** The layout asked for (saved under "layout"; on phones every open from closed starts inline since 0.9.2,
     *  PanelLayout.openMode); what is shown is [effectiveMode] (inline needs a chat page that draws the card). */
    var mode: PanelLayout.Mode = PanelLayout.openMode(PanelLayout.Mode.from(prefs.getString(PREF_LAYOUT, null)),
        a.resources.configuration.screenWidthDp)
        private set
    private var beforeFull = PanelLayout.defaultMode(a.resources.configuration.screenWidthDp)
    /** The chat page can draw the inline card: true (it said so), false (it didn't say within [INLINE_GRACE_MS] of
     *  the panel opening or the page loading: an older page, or not the chat), null (not known yet: inline, hidden
     *  until the page reports the card). Before 0.9.2 this started false, so an open the app made by itself (Saga's
     *  auto-open, a link the shell routed, openTab) before the page's first browser call showed embedded. */
    private var webInline: Boolean? = null
    private var graceArmed = false
    /** The page's last report of the card's body box (inline); null until it reports after the panel docks. */
    private var anchor: InlineGeometry.Anchor? = null
    /** True while the panel lives in [layer] (inline) rather than in the stacked box. */
    private var docked = false
    private val inlineGrace = Runnable {
        graceArmed = false
        if (webInline == null) { webInline = false; if (isOpen) applyLayout(); changed() }
    }
    var collapsed = false
        private set
    private var share = PanelLayout.clampShare(prefs.getFloat("share", PanelLayout.EMBEDDED_SHARE))
    private var reloadOnReturn = false
    private var restored = false

    init {
        chats.current = chatKey
        // Chat profiles no kept chat uses (an app killed mid-delete, chats deleted elsewhere) go at launch.
        ChatProfiles.deleteStale(chats.profiles(), null)
        bridge.setConversation(conversationOf(chatKey))
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
        // The chat area changed size (keyboard, rotation): the clip follows (posted: never re-lay out mid-layout).
        layer.addOnLayoutChangeListener { _, l, t, r, b, oldL, oldT, oldR, oldB ->
            if (r - l != oldR - oldL || b - t != oldB - oldT) layer.post { placeInline() }
        }
    }

    /* ---------- the page's commands (NativeBridge "browser") ---------- */

    /** Opens the panel (in [layout] when given) and loads [url] in a new tab, or shows the current tab. */
    fun open(url: String?, layout: String? = null) {
        if (!restored) { restored = true; tabs.restore(chats.tabs(chatKey))?.let { if (url == null) tabs.switchTo(it) } }
        val asked = PanelLayout.Mode.from(layout)
        if (asked != null) {
            if (asked == PanelLayout.Mode.FULL && mode != PanelLayout.Mode.FULL) beforeFull = mode
            mode = asked
        } else if (!isOpen) {
            // Every open from closed, whoever asks (Browser button, AI Browse, Saga, a routed link), starts in the
            // phone's thread; a layout left from last time (full screen, a menu choice) doesn't stick.
            mode = PanelLayout.openMode(PanelLayout.Mode.from(prefs.getString(PREF_LAYOUT, null)),
                a.resources.configuration.screenWidthDp)
            beforeFull = PanelLayout.defaultMode(a.resources.configuration.screenWidthDp)
        }
        if (!isOpen) { isOpen = true; saga.attach() }
        armGrace()
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
        chats.setTabs(chatKey, tabs.toJson())
        applyLayout()
        changed()
    }

    fun setMode(m: PanelLayout.Mode) {
        if (m == PanelLayout.Mode.FULL && mode != PanelLayout.Mode.FULL) beforeFull = mode
        mode = m
        collapsed = false
        if (m != PanelLayout.Mode.FULL) prefs.edit().putString(PREF_LAYOUT, m.wire).apply()
        if (isOpen) applyLayout()
        changed()
    }

    fun setCollapsed(c: Boolean) {
        val m = effectiveMode()
        // The layout asked for, never the fallback shown now: 0.9.1 saved "embedded" here whenever the page hadn't
        // said yet that it draws the card, and every later open then stayed above the chat.
        if (c && m != PanelLayout.Mode.EMBEDDED && m != PanelLayout.Mode.INLINE) {
            setMode(PanelLayout.collapseTarget(mode, beforeFull))
        }
        collapsed = c
        applyLayout()
        changed()
    }

    /** The layout shown now (inline falls back to embedded with a page that can't draw the card). */
    fun effectiveMode(): PanelLayout.Mode = PanelLayout.effective(mode, webInline)

    /** The chat page said it draws the inline card ({inline: true} on its browser calls). */
    fun setWebInline() {
        main.removeCallbacks(inlineGrace)
        graceArmed = false
        if (webInline == true) return
        webInline = true
        if (isOpen) { applyLayout(); changed() }
    }

    /** browser('anchor'): where the card's body box is now. Called up to once a frame while the thread scrolls, so
     *  it only moves the panel (translation; a relayout only when the box's size changed). */
    fun setAnchor(next: InlineGeometry.Anchor) {
        anchor = next
        placeInline()
    }

    /** The chat page is reloading: its card is gone until the new page reports. Inline stays (hidden) while it loads;
     *  if the new page never says it can draw the card, the panel falls back to embedded. */
    fun onShellPageStarted() {
        anchor = null
        // Whatever the old page said (or didn't), the new page answers for itself.
        webInline = null
        main.removeCallbacks(inlineGrace)
        graceArmed = false
        if (isOpen) { armGrace(); applyLayout(); changed() } else placeInline()
    }

    /** The page has [INLINE_GRACE_MS] to say it draws the card (any browser call with inline: true, or an anchor). */
    private fun armGrace() {
        if (webInline != null || graceArmed) return
        graceArmed = true
        main.postDelayed(inlineGrace, INLINE_GRACE_MS)
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
            .put("layout", effectiveMode().wire)
            // v0.9.2: false/null tells a page that draws the card to say so (browser call with inline: true).
            .put("inlineReady", webInline == true)
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
            // Phase 10: whose browser this is, its mode, and Saga's request to the user for a secret field.
            .put("chat", conversationOf(chatKey) ?: JSONObject.NULL)
            .put("chatMode", ChatSessionRules.mode(chats.mode(chatKey)))
            .put("resumable", saga.control.resumable?.wire ?: JSONObject.NULL)
            .put("handoff", saga.control.handoff?.let { JSONObject().put("kind", it.kind).put("message", it.message) }
                ?: JSONObject.NULL)
            .put("profiles", if (ChatProfiles.supported()) "separate" else "shared")
    }

    /* ---------- Phase 10: one browser per chat ---------- */

    private fun conversationOf(key: String): String? = key.takeIf { !ChatSessionRules.isDraft(it) }

    override fun tabProfile(): String? = if (ChatProfiles.supported()) chats.profileOf(chatKey) else null

    override fun onControlChanged() = changed()

    override fun userInputBlocked(): Boolean = saga.blocksUser()

    override fun sharedMode(): Boolean = ChatSessionRules.mode(chats.mode(chatKey)) == "shared"

    /** browser('chat'): the chat page now shows [conversationId] (null: a new chat). [adopt]: the new chat just got
     *  its id, so the browser it already has becomes the conversation's (nothing reloads). */
    fun showChat(conversationId: String?, adopt: Boolean) {
        val key = ChatSessionRules.keyOf(conversationId)
        if (key == chatKey) { bridge.setConversation(key); return }
        if (key != null && adopt && ChatSessionRules.isDraft(chatKey)) {
            val draft = chatKey
            chats.setTabs(draft, if (restored) tabs.toJson() else chats.tabs(draft))
            chats.adopt(draft, key)
            chatKey = key
            chats.current = key
            chatStore = BrowserStore(a, BrowserStore.PANEL, chats.historyName(key))
            touch(key)
            bridge.setConversation(key)
            changed()
            return
        }
        // A new chat keeps a draft nobody used yet; otherwise it gets a clean one.
        if (key == null && ChatSessionRules.isDraft(chatKey) && tabs.tabs.none { UrlRules.isWebUrl(it.url) }
            && chats.tabs(chatKey).isNullOrBlank()) { bridge.setConversation(null); return }
        switchTo(key ?: ChatSessionRules.draftKey(System.currentTimeMillis()))
    }

    /** browser('forget'): the conversation was deleted; its browser (profile, tabs, history) goes too. */
    fun forgetChat(conversationId: String?) {
        val key = ChatSessionRules.keyOf(conversationId) ?: return
        if (key == chatKey) switchTo(ChatSessionRules.draftKey(System.currentTimeMillis()))
        val profile = chats.forget(key)
        // Its WebViews were just destroyed; the profile is deleted once WebView lets go of it (else at next launch).
        main.postDelayed({ ChatProfiles.delete(profile) }, 1500)
    }

    /** browser('forget', {all: true}): every conversation was deleted; so is every chat's browser. */
    fun forgetAllChats() {
        if (!ChatSessionRules.isDraft(chatKey)) switchTo(ChatSessionRules.draftKey(System.currentTimeMillis()))
        val profiles = chats.order().filter { it != chatKey }.mapNotNull { chats.forget(it) }
        main.postDelayed({ profiles.forEach { ChatProfiles.delete(it) } }, 1500)
    }

    /** browser('mode'): this chat's "AI only" (ai) or "AI + me" (shared); a running Saga task switches too. */
    fun setChatMode(mode: String) {
        val m = ChatSessionRules.mode(mode)
        chats.setMode(chatKey, m)
        saga.switchMode(if (m == "shared") ControlState.Mode.SHARED else ControlState.Mode.AI)
        changed()
    }

    /** browser('control'): Take control / Return to AI / Pause / Resume / Stop from the chat page. */
    fun userControl(op: String): Boolean = saga.userControl(op).also { changed() }

    private fun touch(key: String) {
        val (order, evicted) = ChatSessionRules.touch(chats.order(), key,
            BuildConfig.CHAT_PROFILES_MAX.takeIf { it > 0 } ?: ChatSessionRules.DEFAULT_MAX)
        chats.setOrder(order)
        evicted.filter { it != chatKey }.forEach { ChatProfiles.delete(chats.forget(it)) }
    }

    /** Puts the current chat's browser away and shows [next]'s: same panel and layout, other tabs and profile. */
    private fun switchTo(next: String) {
        val old = chatKey
        saga.endForChatSwitch()
        val visited = store.history().map { it.url } + tabs.tabs.map { it.url }
        if (restored) chats.setTabs(old, tabs.toJson())
        fullscreen.exit()
        hideKeyboard()
        for (i in content.childCount - 1 downTo 0) if (content.getChildAt(i) is WebView) content.removeViewAt(i)
        tabs.clearSilently()
        // A new chat left behind without a conversation is gone for good.
        if (ChatSessionRules.isDraft(old)) { val p = chats.forget(old); main.postDelayed({ ChatProfiles.delete(p) }, 1500) }
        chatKey = next
        chats.current = next
        chatStore = BrowserStore(a, BrowserStore.PANEL, chats.historyName(next))
        touch(next)
        restored = false
        bridge.setConversation(conversationOf(next))
        val show = Runnable {
            if (chatKey != next) return@Runnable
            if (isOpen) {
                restored = true
                tabs.restore(chats.tabs(next))?.let { tabs.switchTo(it) } ?: tabs.open(UrlRules.HOME)
            }
            refresh()
            changed()
        }
        if (ChatProfiles.supported()) show.run()
        else {
            // One shared cookie jar: the old chat's sign-ins go before the next chat's pages load.
            if (!sharedNoticeShown && visited.any { UrlRules.isWebUrl(it) }) {
                sharedNoticeShown = true
                Toast.makeText(a, R.string.chat_profiles_shared, Toast.LENGTH_LONG).show()
            }
            ChatProfiles.clearShared(visited) { main.post(show) }
        }
        changed()
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
        if (!isOpen) return false
        if (docked) return layer.hits(ev.rawX, ev.rawY, panel)
        if (panel.visibility != View.VISIBLE) return false
        val loc = IntArray(2)
        panel.getLocationOnScreen(loc)
        return ev.rawX >= loc[0] && ev.rawX < loc[0] + panel.width && ev.rawY >= loc[1] && ev.rawY < loc[1] + panel.height
    }

    fun onResume() {
        if (!isOpen) return
        tabs.active?.webView?.onResume()
        if (reloadOnReturn) { reloadOnReturn = false; tabs.active?.webView?.reload() }
    }

    fun onPause() { tabs.active?.webView?.onPause(); if (restored) chats.setTabs(chatKey, tabs.toJson()) }
    fun onConfigurationChanged() { if (isOpen) applyLayout() }
    fun onTrimMemory() { tabs.trim(1) }

    fun destroy() {
        bridge.removeListener(opener)
        main.removeCallbacks(inlineGrace)
        if (isOpen) saga.detach()
        tabs.tabs.forEach { t -> t.webView?.let { ShellWeb.destroy(it) }; t.webView = null }
    }

    /* ---------- layout ---------- */

    private fun applyLayout() {
        val m = effectiveMode()
        dock(m == PanelLayout.Mode.INLINE)
        val cfg = a.resources.configuration
        val side = PanelLayout.sideBySide(m, cfg.screenWidthDp, cfg.screenHeightDp)
        box.orientation = if (side) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        // Side by side, the panel goes on the right: the box is laid out right-to-left, its children left-to-right.
        box.layoutDirection = if (side) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        listOf(panel, divider, web).forEach { it.layoutDirection = View.LAYOUT_DIRECTION_LOCALE }
        // Inline: the chat page draws the header (status, address, collapse, full screen, close) in its card.
        header.visibility = if (docked) View.GONE else View.VISIBLE
        panel.visibility = if (isOpen) View.VISIBLE else View.GONE
        divider.visibility = if (isOpen && m == PanelLayout.Mode.SPLIT) View.VISIBLE else View.GONE
        web.visibility = if (isOpen && m == PanelLayout.Mode.FULL) View.GONE else View.VISIBLE
        // Inline and collapsed, the whole layer hides (placeInline); the content stays ready for the expand.
        content.visibility = if (collapsed && !docked) View.GONE else View.VISIBLE
        progress.visibility = if (collapsed) View.GONE else progress.visibility
        val s = PanelLayout.panelShare(m, collapsed, share)
        fun lp(weight: Float, wrap: Boolean = false) = LinearLayout.LayoutParams(
            if (side) (if (wrap) ViewGroup.LayoutParams.WRAP_CONTENT else 0) else ViewGroup.LayoutParams.MATCH_PARENT,
            if (side) ViewGroup.LayoutParams.MATCH_PARENT else (if (wrap) ViewGroup.LayoutParams.WRAP_CONTENT else 0),
            weight)
        if (!docked) panel.layoutParams = if (collapsed) lp(0f, wrap = true) else lp(s)
        web.layoutParams = lp(if (m == PanelLayout.Mode.FULL) 0f else 1f - s.coerceAtMost(.99f))
        val d = (16 * a.resources.displayMetrics.density).toInt()
        divider.layoutParams = LinearLayout.LayoutParams(if (side) d else ViewGroup.LayoutParams.MATCH_PARENT,
            if (side) ViewGroup.LayoutParams.MATCH_PARENT else d)
        expand.setImageResource(if (mode == PanelLayout.Mode.FULL) R.drawable.ic_fullscreen_exit else R.drawable.ic_fullscreen)
        expand.contentDescription = a.getString(if (mode == PanelLayout.Mode.FULL) R.string.panel_exit_full
            else R.string.panel_full)
        box.requestLayout()
        placeInline()
    }

    /** Moves the panel (the same view, with the same WebViews: nothing reloads) into the inline layer or back into
     *  the stacked box. Entering the layer forgets the old anchor: the page reports the new card's box. */
    private fun dock(inline: Boolean) {
        if (inline == docked) return
        docked = inline
        (panel.parent as? ViewGroup)?.removeView(panel)
        if (inline) {
            anchor = null
            layer.addView(panel, FrameLayout.LayoutParams(0, 0, Gravity.TOP or Gravity.START))
        } else {
            panel.translationX = 0f
            panel.translationY = 0f
            layer.clearClip()
            layer.visibility = View.INVISIBLE
            box.addView(panel, 0, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0,
                PanelLayout.EMBEDDED_SHARE))
        }
    }

    /** Inline: lays the panel over the card's body box, clipped to the visible thread; hidden when the card is off
     *  screen, collapsed, not reported yet, or the panel is closed. Scrolling only changes translation and clip. */
    private fun placeInline() {
        if (!docked) return
        val p = if (isOpen && !collapsed) InlineGeometry.place(anchor, a.resources.displayMetrics.density,
            a.webView.left, a.webView.top, layer.width, layer.height, a.webView.height) else InlineGeometry.NOWHERE
        if (!p.visible) {
            if (layer.visibility != View.INVISIBLE) layer.visibility = View.INVISIBLE
            return
        }
        val lp = panel.layoutParams as FrameLayout.LayoutParams
        if (lp.width != p.width || lp.height != p.height) {
            lp.width = p.width
            lp.height = p.height
            panel.layoutParams = lp
        }
        panel.translationX = p.left.toFloat()
        panel.translationY = p.top.toFloat()
        layer.setClip(p.clipTop, p.clipBottom)
        if (layer.visibility != View.VISIBLE) layer.visibility = View.VISIBLE
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
        val shown = effectiveMode()
        if (shown != PanelLayout.Mode.INLINE && webInline == true) add(14, R.string.panel_inline)
        if (shown != PanelLayout.Mode.EMBEDDED) add(3, R.string.panel_embedded)
        if (shown != PanelLayout.Mode.SPLIT) add(4, R.string.panel_split)
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
                14 -> setMode(PanelLayout.Mode.INLINE)
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
        private const val PREF_LAYOUT = "layout"
        /** How long the chat page (loading, or slow on a cheap phone) has to say it draws the inline card before
         *  the panel shows embedded; a later browser call from the page still moves it into the thread. */
        private const val INLINE_GRACE_MS = 6000L
    }
}
