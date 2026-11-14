package ng.nifelux.colonai

import android.view.View
import android.webkit.WebChromeClient
import androidx.appcompat.app.AppCompatActivity

/**
 * What a screen that shows browser tabs provides to them (BrowserWeb, BrowserSaga). Two screens implement it from
 * the same code (ROADMAP standing rule: one browser module, never duplicated): Colon Browser's BrowserActivity and
 * Colon AI's in-chat browser panel (ChatBrowserPanel inside MainActivity).
 */
interface BrowserHost {
    val activity: AppCompatActivity
    val tabs: TabManager
    val fileChooser: FileChooser
    val store: BrowserStore

    fun isDark(): Boolean
    fun toast(text: String)
    fun navigate(input: String)
    fun onTabUpdated(tab: BrowserTab)
    fun onTabRendererGone(tab: BrowserTab)
    fun tabLimitReached()
    fun askPermissions(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit)
    fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback)
    fun exitFullscreen()

    /** Google or bank sign-in: opens in a Chrome Custom Tab, and the tab reloads when the user comes back. */
    fun openSignIn(url: String)

    /** Saga's control changed (mode, pause, handoff): the chat page is told (ChatBrowserPanel). */
    fun onControlChanged() {}

    /** 0.10.2: the user may not drive the pages now (Saga has them in "AI only"; TabWebView). */
    fun userInputBlocked(): Boolean = false

    /** 0.10.2: this browser is in "AI + me" (the chat's mode): Saga's steps and requests show as notices on the page
     *  (SagaNotice). */
    fun sharedMode(): Boolean = false

    /** 0.10.3 (Colon AI's chat): Saga's words for the user ([kind] step · ask · done · error · stopped): the
     *  command's `say` and the server's `notice`. The chat's card shows them on its status pill. */
    fun onSagaWords(text: String, kind: String) {}

    /** 0.10.3: Saga handed the page to the user; it waits [timeoutMs] (0: the server didn't say) for it back. */
    fun onSagaHandoff(timeoutMs: Long) {}

    /** 0.10.4: one of Saga's steps finished on the phone (its answer went to the server): the chat's card keeps a
     *  picture of the page as it is now, so it never shows blank. */
    fun onSagaStepDone() {}

    /** 0.10.4: the link to the server is up ([ready]) or reconnecting. */
    fun onBridgeStatus(ready: Boolean) {}

    /** 0.10.3: the CSS width a new tab lays its pages out at, always as the desktop site (the chat's AI-only
     *  browser, DesktopView); null = the tab's own mobile / desktop setting (Colon Browser). */
    fun desktopLayoutWidth(): Int? = null

    /** The WebView profile a new normal tab uses (Phase 10: the chat's own, ChatSessions); null = the default. */
    fun tabProfile(): String? = null

    /** A page finished loading: history is recorded on the phone, never for private tabs. */
    fun onPageLoaded(tab: BrowserTab) {
        if (PrivateBrowsing.recordsHistory(tab.incognito, tab.url)) store.addHistory(tab.url, tab.title)
    }

    /** A download started from a tab (private tabs keep no downloads list). */
    fun onDownload(tab: BrowserTab, name: String, url: String, id: Long) {
        if (!tab.incognito) store.addDownload(BrowserStore.Download(id, name, url, System.currentTimeMillis()))
        toast(activity.getString(R.string.downloading, name))
    }
}
