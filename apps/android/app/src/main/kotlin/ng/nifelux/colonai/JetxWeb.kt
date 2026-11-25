package ng.nifelux.colonai

import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.ContextCompat

/**
 * Colon JetX's two WebViews (0.34.0), on the Colon Browser engine: the same Android System WebView set-up as
 * browser tabs (ShellWeb.secureDefaults: no file access, no mixed content, Safe Browsing; TabWebView; the
 * ColonAndroid user agent; Google and bank sign-in in a Custom Tab; bad certificates refused).
 *
 * Game pane: the user's betting site, an ordinary web page. It never gets a bridge or an injected script, and the
 * app never reads its pages, cookies, passwords or tokens (the user signs in there themselves).
 * Predictor pane: https://crash.apparatus.name.ng with window.ColonJetX (JetxBridge). Colon's own pages stay in
 * it; other web links open in the game pane.
 */
object JetxWeb {
    /** The betting site's WebView, or null when Android System WebView is missing or updating. */
    fun game(a: JetxActivity): TabWebView? {
        val wv = try { TabWebView(a) } catch (e: Exception) { Log.e(TAG, "no WebView", e); return null }
        base(a, wv)
        wv.settings.apply {
            setSupportMultipleWindows(true) // target=_blank / window.open reach onCreateWindow (kept in this pane)
            builtInZoomControls = true
            displayZoomControls = false
        }
        // Crash games are usually an iframe from the game provider on the operator's page; it needs its own
        // cookies to keep the round going. Accepting them is not reading them: the app never looks at any.
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.webViewClient = GameClient(a)
        wv.webChromeClient = Chrome(a, game = true)
        return wv
    }

    /** The predictor's WebView, or null when Android System WebView is missing or updating. */
    fun predictor(a: JetxActivity): WebView? {
        val wv = try { WebView(a) } catch (e: Exception) { Log.e(TAG, "no WebView", e); return null }
        base(a, wv)
        wv.settings.setSupportMultipleWindows(true)
        wv.settings.userAgentString = wv.settings.userAgentString + " " + UA_TOKEN // the web app can tell
        // crash. and api.apparatus.name.ng share the Colon session cookie (as in the Colon AI shell).
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.webViewClient = PredictorClient(a)
        wv.webChromeClient = Chrome(a, game = false)
        return wv
    }

    private fun base(a: JetxActivity, wv: WebView) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        wv.setBackgroundColor(ContextCompat.getColor(a, R.color.jetx_bg))
        ShellWeb.secureDefaults(wv.settings)
        wv.settings.loadWithOverviewMode = true
        wv.settings.useWideViewPort = true
        BrowserWeb.applyUserAgent(wv, desktop = false)
        CookieManager.getInstance().setAcceptCookie(true)
    }

    /** Main-frame links shared by both panes: Google or bank sign-in leaves for a Custom Tab, other apps' links
     *  leave the app. Returns true when the link was handled here. */
    private fun leaves(a: JetxActivity, view: WebView, url: String): Boolean {
        if (UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS)) { a.openSignIn(url); return true }
        if (UrlRules.isWebUrl(url)) return false
        External.open(a, url)?.let { view.loadUrl(it) }
        return true
    }

    private class GameClient(private val a: JetxActivity) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (!request.isForMainFrame) return !(UrlRules.isWebUrl(url) || url.startsWith("about:"))
            if (url.startsWith("about:")) return false
            return leaves(a, view, url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = a.onGamePage(url, done = false)
        override fun onPageFinished(view: WebView, url: String?) = a.onGamePage(url, done = true)

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) a.onGameError()
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel() // never proceed past a bad certificate
            a.onGameError()
            a.toast(a.getString(R.string.ssl_blocked))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "game renderer gone")
            a.onRendererGone(game = true)
            return true
        }
    }

    private class PredictorClient(private val a: JetxActivity) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (!request.isForMainFrame || JetxRules.predictorKeeps(url)) return false
            if (leaves(a, view, url)) return true
            a.openInGame(url) // a web page from the predictor (the site link): the game pane, not over the predictor
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = a.bridge.onPageStarted()

        override fun onPageFinished(view: WebView, url: String?) {
            if (JetxRules.isPredictor(url)) a.onPredictorLoaded()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) a.toast(a.getString(R.string.jetx_predictor_offline))
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            a.toast(a.getString(R.string.ssl_blocked))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "predictor renderer gone")
            a.onRendererGone(game = false)
            return true
        }
    }

    private class Chrome(private val a: JetxActivity, private val game: Boolean) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) { if (game) a.onGameProgress(newProgress) }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>,
                                       params: FileChooserParams): Boolean = a.fileChooser.show(callback, params)

        /** Neither pane needs the camera, microphone or location in this step. */
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false)
        }

        /** A pop-up opened by a tap: catch its address with a throwaway WebView and route it like a link (the
         *  game pane keeps its own pop-ups, such as a game opening in a new window). Script-only pop-ups are
         *  blocked (secureDefaults). */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message):
            Boolean {
            if (!isUserGesture) return false
            val catcher = WebView(a)
            catcher.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    val url = r.url.toString()
                    when {
                        UrlRules.needsCustomTab(url, BuildConfig.EXTRA_CUSTOM_TAB_HOSTS) -> a.openSignIn(url)
                        !game && JetxRules.predictorKeeps(url) -> view.loadUrl(url)
                        UrlRules.isWebUrl(url) -> a.openInGame(url)
                        else -> External.open(a, url)?.let { a.openInGame(it) }
                    }
                    v.post { v.destroy() }
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = catcher
            resultMsg.sendToTarget()
            return true
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) = a.fullscreen.enter(view, callback)
        override fun onHideCustomView() = a.fullscreen.exit()
    }

    /** Added to the predictor's user agent only (never sent to the betting site). */
    val UA_TOKEN = "ColonJetX/${BuildConfig.VERSION_NAME}"
    private const val TAG = "ColonJetX"
}
