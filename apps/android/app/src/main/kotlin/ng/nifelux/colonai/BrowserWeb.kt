package ng.nifelux.colonai

import android.Manifest
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Message
import android.util.Base64
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.Uri
import android.util.Log
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/**
 * WebView set-up and clients for browser tabs, shared by Colon Browser and Colon AI's in-chat panel (BrowserHost).
 * Tabs are ordinary web pages: they never get window.ColonNative, can't read local files, can't load mixed content,
 * and ask before using the camera or microphone. Private tabs use their own WebView profile and no cache; Google
 * and bank sign-in pages leave for a Chrome Custom Tab (UrlRules.needsCustomTab).
 */
object BrowserWeb {
    fun create(a: BrowserHost, tab: BrowserTab): WebView {
        val wv = WebView(a.activity)
        if (tab.incognito) PrivateProfiles.apply(wv) // before anything else touches the WebView
        wv.setBackgroundColor(if (a.isDark()) 0xFF080F24.toInt() else 0xFFFFFFFF.toInt())
        ShellWeb.secureDefaults(wv.settings)
        wv.settings.apply {
            setSupportMultipleWindows(true)
            builtInZoomControls = true
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            if (tab.incognito) cacheMode = WebSettings.LOAD_NO_CACHE
        }
        applyUserAgent(wv, tab.desktop)
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, false) // privacy default for tabs
        wv.webViewClient = TabClient(a, tab)
        wv.webChromeClient = TabChrome(a, tab)
        wv.setDownloadListener { url, ua, disposition, mime, _ ->
            val ctx = a.activity
            when {
                url.startsWith("data:") -> try {
                    val bytes = Base64.decode(url.substringAfter("base64,"), Base64.DEFAULT)
                    a.toast(ctx.getString(R.string.saved_to, Downloads.saveBytes(ctx,
                        URLUtil.guessFileName(url, disposition, mime), mime, bytes)))
                } catch (_: Exception) { a.toast(ctx.getString(R.string.download_failed)) }
                else -> Downloads.start(ctx, url, ua, disposition, mime, cookies = !tab.incognito)
                    ?.let { (name, id) -> a.onDownload(tab, name, url, id) }
                    ?: a.toast(ctx.getString(R.string.download_unsupported))
            }
        }
        return wv
    }

    /** Mobile or desktop site: the user agent (always ending with the app's ColonAndroid token). */
    fun applyUserAgent(wv: WebView, desktop: Boolean) {
        val base = WebSettings.getDefaultUserAgent(wv.context)
        wv.settings.userAgentString = (if (desktop) UserAgents.desktop(base) else base) + " " + ShellWeb.UA_TOKEN
        wv.settings.loadWithOverviewMode = true
        wv.settings.useWideViewPort = true
    }

    private class TabClient(private val a: BrowserHost, private val tab: BrowserTab) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (request.isForMainFrame && UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS)) {
                a.openSignIn(url); return true
            }
            if (UrlRules.isWebUrl(url) || url.startsWith("about:")) return false
            if (!request.isForMainFrame) return true
            External.open(a.activity, url)?.let { view.loadUrl(it) }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // A sign-in page reached without a link click (a pop-up, a redirect from script): stop and hand it over.
            if (UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS)) {
                view.stopLoading()
                a.openSignIn(url!!)
                if (tab.popup && !view.canGoBack()) view.post { a.tabs.close(tab) }
                return
            }
            if (url != null && !url.startsWith("about:")) tab.url = url
            tab.progress = 0
            a.onTabUpdated(tab)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            tab.progress = 100
            if (url != null && UrlRules.isWebUrl(url)) {
                tab.url = url
                view.title?.let { tab.title = it }
                a.onPageLoaded(tab)
            }
            a.onTabUpdated(tab)
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            if (url != null) tab.url = if (url.startsWith("about:")) UrlRules.HOME else url
            a.onTabUpdated(tab)
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel() // never proceed past a bad certificate
            a.toast(a.activity.getString(R.string.ssl_blocked))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w("ColonBrowser", "tab renderer gone")
            a.onTabRendererGone(tab)
            return true
        }
    }

    private class TabChrome(private val a: BrowserHost, private val tab: BrowserTab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            tab.progress = newProgress
            a.onTabUpdated(tab)
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            tab.title = title.orEmpty()
            a.onTabUpdated(tab)
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>,
                                       params: FileChooserParams): Boolean = a.fileChooser.show(callback, params)

        /** Camera / microphone for sites: ask the user per request, then the Android permission. */
        override fun onPermissionRequest(request: PermissionRequest) {
            val wanted = request.resources.filter {
                it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
            }
            if (wanted.isEmpty()) { request.deny(); return }
            val host = request.origin.host ?: request.origin.toString()
            val what = a.activity.getString(if (wanted.size == 2) R.string.perm_cam_mic
                else if (wanted[0] == PermissionRequest.RESOURCE_AUDIO_CAPTURE) R.string.perm_mic else R.string.perm_cam)
            MaterialAlertDialogBuilder(a.activity)
                .setTitle(a.activity.getString(R.string.perm_site_title, host))
                .setMessage(a.activity.getString(R.string.perm_site_text, host, what))
                .setPositiveButton(R.string.allow) { _, _ ->
                    val perms = wanted.map {
                        if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO
                        else Manifest.permission.CAMERA
                    }.toTypedArray()
                    a.askPermissions(perms) { granted ->
                        val ok = wanted.filter {
                            granted[if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO
                            else Manifest.permission.CAMERA] == true
                        }
                        if (ok.isEmpty()) request.deny() else request.grant(ok.toTypedArray())
                    }
                }
                .setNegativeButton(R.string.block) { _, _ -> request.deny() }
                .setOnCancelListener { request.deny() }
                .show()
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) = Unit

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false) // location for sites comes later (Phase 8)
        }

        /** Pop-ups opened by a tap become new tabs; script-only pop-ups are blocked. */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message):
            Boolean {
            if (!isUserGesture) return false
            // A blank tab: the opener fills it through the transport.
            // A private tab's pop-up stays private (same profile).
            val newTab = a.tabs.open("", foreground = true, incognito = tab.incognito)
                ?: run { a.tabLimitReached(); return false }
            newTab.popup = true
            val wv = a.tabs.ensureLive(newTab)
            (resultMsg.obj as WebView.WebViewTransport).webView = wv
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) {
            a.tabs.tabs.firstOrNull { it.webView === window }?.let { a.tabs.close(it) }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) = a.enterFullscreen(view, callback)
        override fun onHideCustomView() = a.exitFullscreen()
    }
}
