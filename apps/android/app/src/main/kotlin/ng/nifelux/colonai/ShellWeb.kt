package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** WebView set-up for the Colon AI shell and its clients (navigation policy, permissions, files, downloads). */
object ShellWeb {
    /** The app's user-agent token. The web app looks for it to know it runs inside the Android shell. */
    val UA_TOKEN = "ColonAndroid/${BuildConfig.VERSION_NAME}"

    /** Creates the shell WebView, or null when Android System WebView is missing or being updated. */
    @SuppressLint("SetJavaScriptEnabled")
    fun create(activity: MainActivity): WebView? {
        val wv = try { WebView(activity) } catch (e: Exception) { Log.e("ColonShell", "no WebView", e); return null }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        wv.setBackgroundColor(ContextCompat.getColor(activity, R.color.colon_dark))
        secureDefaults(wv.settings)
        wv.settings.apply {
            mediaPlaybackRequiresUserGesture = false // read-aloud and hands-free play replies without a tap
            setSupportMultipleWindows(true)          // target=_blank links reach onCreateWindow (opened as tabs)
            userAgentString = "$userAgentString $UA_TOKEN"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true) // chat. and api. share the Colon session cookie
        }
        wv.webViewClient = Client(activity)
        wv.webChromeClient = Chrome(activity)
        wv.setDownloadListener { url, ua, disposition, mime, _ -> download(activity, wv, url, ua, disposition, mime) }
        return wv
    }

    /** Defaults shared by the shell and browser tabs: no local file access, no mixed content, Safe Browsing on. */
    @SuppressLint("SetJavaScriptEnabled")
    fun secureDefaults(s: WebSettings) {
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setGeolocationEnabled(false)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(s, true)
        }
    }

    fun destroy(wv: WebView) {
        (wv.parent as? android.view.ViewGroup)?.removeView(wv)
        wv.stopLoading()
        wv.webChromeClient = null
        wv.destroy()
    }

    private fun download(a: MainActivity, wv: WebView, url: String, ua: String?, disposition: String?, mime: String?) {
        when {
            url.startsWith("blob:") && UrlRules.isBridgeOrigin(a.currentUrl) -> {
                // The page still holds the blob: let it read the bytes and hand them to the bridge (saveFile).
                val name = URLUtil.guessFileName(url, disposition, mime)
                wv.evaluateJavascript("(function(u,n,m){fetch(u).then(function(r){return r.blob()})" +
                    ".then(function(b){return new Promise(function(ok){var f=new FileReader();" +
                    "f.onload=function(){ok(f.result)};f.readAsDataURL(b)})})" +
                    ".then(function(d){return window.ColonNative&&window.ColonNative.call('saveFile'," +
                    "{name:n,mime:m,base64:String(d)})}).catch(function(){})})(" +
                    "${JSONObject.quote(url)},${JSONObject.quote(name)},${JSONObject.quote(mime ?: "")})", null)
            }
            url.startsWith("data:") -> try {
                val bytes = Base64.decode(url.substringAfter("base64,"), Base64.DEFAULT)
                a.toast(a.getString(R.string.saved_to, Downloads.saveBytes(a, URLUtil.guessFileName(url,
                    disposition, mime), mime, bytes)))
            } catch (_: Exception) { a.toast(a.getString(R.string.download_failed)) }
            else -> Downloads.enqueue(a, url, ua, disposition, mime)
                ?.let { a.toast(a.getString(R.string.downloading, it)) }
                ?: a.toast(a.getString(R.string.download_failed))
        }
    }

    private class Client(private val a: MainActivity) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            return route(a, request.url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            a.currentUrl = url
            a.nativeBridge.onPageStarted()
            a.onShellPageStarted()
        }

        override fun onPageCommitVisible(view: WebView, url: String?) {
            a.onPageVisible()
            a.nativeBridge.injectIfNeeded(url)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            a.onPageVisible()
            a.nativeBridge.injectIfNeeded(url)
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            a.currentUrl = url
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) a.showOffline(null)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w("ColonShell", "renderer gone")
            a.onRendererGone()
            return true
        }
    }

    /** Shell navigation policy: Colon pages stay, other web pages open in a Colon Browser tab, other apps' links leave. */
    fun route(a: MainActivity, uri: Uri): Boolean {
        val url = uri.toString()
        return when {
            UrlRules.isShellUrl(url) -> false
            UrlRules.isWebUrl(url) -> { a.openBrowserTab(url); true }
            else -> { External.open(a, url)?.let { a.openBrowserTab(it) }; true }
        }
    }

    private class Chrome(private val a: MainActivity) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) = a.onProgress(newProgress)

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>,
                                       params: FileChooserParams): Boolean = a.fileChooser.show(callback, params)

        /** getUserMedia: only Colon's own pages, microphone only, after the Android permission. */
        override fun onPermissionRequest(request: PermissionRequest) {
            val trusted = UrlRules.isBridgeOrigin(request.origin.toString())
            val wantsAudio = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
            if (!trusted || !wantsAudio) { request.deny(); return }
            a.requestPermission(android.Manifest.permission.RECORD_AUDIO) { ok ->
                if (ok) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false)
        }

        /** window.open / target=_blank: catch the URL with a throwaway WebView and route it like a link. */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message):
            Boolean {
            if (!isUserGesture) return false
            val catcher = WebView(a)
            catcher.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    val uri = r.url
                    if (UrlRules.isShellUrl(uri.toString())) a.openBrowserTab(uri.toString()) else route(a, uri)
                    v.post { v.destroy() }
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = catcher
            resultMsg.sendToTarget()
            return true
        }
    }
}
