package ng.nifelux.colonai

import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException

/**
 * Colon JetX's one API read (0.34.0): GET /crash/settings with the Colon session the predictor pane signed in
 * with, for settings.site_url (the betting site the top pane opens). The session cookie goes only to the Colon API
 * host (UrlRules.isColonApi); nothing is written. Not signed in, offline or a bad answer: null.
 */
object JetxApi {
    fun siteUrl(http: OkHttpClient, done: (String?) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        val url = "${BuildConfig.API_URL}/crash/settings"
        val cookie = if (UrlRules.isColonApi(url)) sessionCookie() else null
        if (cookie == null) { main.post { done(null) }; return }
        val req = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("Cookie", cookie)
            .header("User-Agent", "ColonAndroid/${BuildConfig.VERSION_NAME} (${BuildConfig.APP_KEY})")
            .header("X-Colon-Client", "android")
            .build()
        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { main.post { done(null) } }

            override fun onResponse(call: Call, response: Response) {
                val site = response.use { r ->
                    if (!r.isSuccessful) null else JetxRules.siteFromSettings(r.body?.string()?.take(64_000))
                }
                main.post { done(site) }
            }
        })
    }

    private fun sessionCookie(): String? = try {
        CookieManager.getInstance().getCookie(BuildConfig.API_URL)
            ?.split(';')?.map { it.trim() }?.firstOrNull { it.startsWith("colon_sid=") }
    } catch (_: Exception) {
        null // WebView not available (being updated)
    }
}
