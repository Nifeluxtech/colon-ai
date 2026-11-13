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
