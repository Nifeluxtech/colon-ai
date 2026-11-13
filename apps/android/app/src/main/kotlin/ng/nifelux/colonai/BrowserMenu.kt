package ng.nifelux.colonai

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.PopupMenu
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** Colon Browser's menu, tab list and the bookmarks / history / downloads lists. */
object BrowserMenu {
    private const val NEW_TAB = 1
    private const val NEW_PRIVATE = 2
    private const val BOOKMARK = 3
    private const val BOOKMARKS = 4
    private const val HISTORY = 5
    private const val DOWNLOADS = 6
    private const val DESKTOP = 7
    private const val SHARE = 8
    private const val OPEN_OTHER = 9
    private const val ASK_COLON = 10
    private const val SAGA = 11
    private const val CLEAR = 12
    private const val CLOSE_PRIVATE = 13
    private const val COLON_AI = 14

    fun show(a: BrowserActivity, anchor: View) {
        val tab = a.tabs.active
        val pageUrl = tab?.url?.takeIf { UrlRules.isWebUrl(it) }
        val menu = PopupMenu(a, anchor)
        val m = menu.menu
        var order = 0
        fun add(id: Int, res: Int) = m.add(0, id, order++, res)
        add(NEW_TAB, R.string.new_tab)
        add(NEW_PRIVATE, R.string.new_private_tab)
        if (pageUrl != null && tab.incognito.not()) {
            add(BOOKMARK, if (a.store.isBookmarked(pageUrl)) R.string.remove_bookmark else R.string.add_bookmark)
        }
        add(BOOKMARKS, R.string.bookmarks)
        add(HISTORY, R.string.history)
        add(DOWNLOADS, R.string.downloads)
        if (tab != null) add(DESKTOP, R.string.desktop_site).apply { isCheckable = true; isChecked = tab.desktop }
        if (pageUrl != null) {
            add(SHARE, R.string.share_page)
            add(OPEN_OTHER, R.string.open_in_app)
            if (!tab.incognito) add(ASK_COLON, R.string.ask_colon_ai)
        }
        add(SAGA, R.string.saga_status)
        add(CLEAR, R.string.clear_data)
        if (a.tabs.tabs.any { it.incognito }) add(CLOSE_PRIVATE, R.string.close_private_tabs)
        add(COLON_AI, R.string.back_to_chat)
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                NEW_TAB -> if (a.tabs.open(UrlRules.HOME) == null) a.tabLimitReached()
                NEW_PRIVATE -> a.openPrivateTab()
                BOOKMARK -> pageUrl?.let {
                    a.toast(a.getString(if (a.store.toggleBookmark(it, tab.title)) R.string.bookmarked
                    else R.string.bookmark_removed))
                }
                BOOKMARKS -> entries(a, R.string.bookmarks, a.store.bookmarks(), R.string.no_bookmarks) {
                    a.store.removeBookmark(it)
                }
                HISTORY -> entries(a, R.string.history, a.store.history(), R.string.no_history) {
                    a.store.removeHistory(it)
                }
                DOWNLOADS -> showDownloads(a, a.store)
                DESKTOP -> a.toggleDesktop()
                SHARE -> pageUrl?.let { share(a, it, tab.title) }
                OPEN_OTHER -> pageUrl?.let { UpdateChecker.openExternal(a, it) }
                ASK_COLON -> pageUrl?.let { askColonAi(a, it, tab.title) }
                SAGA -> a.saga.showStatus()
                CLEAR -> a.clearData.launch(Intent(a, ClearDataActivity::class.java))
                CLOSE_PRIVATE -> a.tabs.closePrivate()
                COLON_AI -> openColonAi(a)
            }
            true
        }
        menu.show()
    }

    fun showTabs(a: BrowserActivity) {
        val privateLabel = a.getString(R.string.private_label)
        EntryList.show(a, a.getString(R.string.tabs_title, a.tabs.tabs.size),
            a.tabs.tabs.map {
                EntryList.Item(it.id, (if (it.incognito) "$privateLabel · " else "") + it.label(),
                    UrlRules.displayUrl(it.url), it === a.tabs.active)
            },
            a.getString(R.string.no_tabs),
            onPick = { item -> a.tabs.find(item.key)?.let { a.tabs.switchTo(it) } },
            onRemove = { item -> a.tabs.find(item.key)?.let { a.tabs.close(it) } },
            action = a.getString(R.string.new_tab) to { if (a.tabs.open(UrlRules.HOME) == null) a.tabLimitReached() },
            neutral = a.getString(R.string.new_private_tab) to { a.openPrivateTab() })
    }

    private fun entries(a: BrowserActivity, titleRes: Int, list: List<BrowserStore.Entry>, emptyRes: Int,
                        remove: (String) -> Unit) {
        EntryList.show(a, a.getString(titleRes),
            list.map { EntryList.Item(it.url, it.title.ifBlank { it.url }, it.url) }, a.getString(emptyRes),
            onPick = { a.navigate(it.key) }, onRemove = { remove(it.key) })
    }

    /** The in-app downloads list: tap opens the file, × removes it from the list (the file stays). */
    fun showDownloads(host: BrowserHost, store: BrowserStore) {
        val c = host.activity
        EntryList.show(c, c.getString(R.string.downloads),
            store.downloads().map { EntryList.Item(it.id.toString(), it.name, UrlRules.displayUrl(it.url)) },
            c.getString(R.string.no_downloads),
            onPick = { openDownload(host, it.key.toLongOrNull() ?: -1) },
            onRemove = { it.key.toLongOrNull()?.let { id -> store.removeDownload(id) } },
            action = c.getString(R.string.all_downloads) to { openSystemDownloads(host) })
    }

    private fun openDownload(host: BrowserHost, id: Long) {
        val c = host.activity
        val dm = c.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val uri = try { dm.getUriForDownloadedFile(id) } catch (_: Exception) { null }
        if (uri == null) { host.toast(c.getString(R.string.download_not_ready)); return }
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, dm.getMimeTypeForDownloadedFile(id))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { c.startActivity(view) } catch (_: Exception) { host.toast(c.getString(R.string.no_app_to_open)) }
    }

    fun openSystemDownloads(host: BrowserHost) {
        try { host.activity.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }
        catch (_: Exception) { host.toast(host.activity.getString(R.string.no_app_to_open)) }
    }

    private fun share(a: BrowserActivity, url: String, title: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
            .putExtra(Intent.EXTRA_SUBJECT, title)
        try { a.startActivity(Intent.createChooser(send, null)) } catch (_: Exception) {}
    }

    private fun askColonAi(a: BrowserActivity, url: String, title: String) {
        if (!Handoff.askColonAi(a, a.getString(R.string.ask_colon_ai_text, url), title)) offerPartner(a)
    }

    private fun openColonAi(a: BrowserActivity) {
        if (BuildConfig.IS_BROWSER_APP) { if (!Handoff.launch(a)) offerPartner(a); return }
        a.startActivity(Intent(a, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }

    /** The other Colon app isn't installed: offer its download page. */
    fun offerPartner(host: BrowserHost) {
        val c = host.activity
        val toBrowser = Handoff.partnerKey() == "colonbrowser"
        MaterialAlertDialogBuilder(c)
            .setTitle(if (toBrowser) R.string.get_browser_title else R.string.get_colon_ai_title)
            .setMessage(if (toBrowser) R.string.get_browser_text else R.string.get_colon_ai_text)
            .setPositiveButton(R.string.get_app) { _, _ -> UpdateChecker.openExternal(c, Handoff.RELEASES) }
            .setNegativeButton(R.string.not_now, null)
            .show()
    }
}
