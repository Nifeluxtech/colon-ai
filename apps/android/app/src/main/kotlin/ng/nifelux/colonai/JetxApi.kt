package ng.nifelux.colonai

import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException

/**
 * Colon JetX's API calls, with the Colon session the predictor pane signed in with. The session cookie goes only to
 * the Colon API host (UrlRules.isColonApi), never anywhere else.
 * 0.34.0: GET /crash/settings for settings.site_url (the betting site the top pane opens); not signed in, offline
 * or a bad answer: null.
 * 0.35.0 (step 3): [post] for the round collector (POST /crash/rounds and /crash/sessions).
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

    /**
     * POST [json] to the Colon API at [path]; [done] gets the HTTP status and body on the main thread. Status -1:
     * not signed in in the predictor (no session cookie, nothing sent); 0: offline or no answer.
     */
    fun post(http: OkHttpClient, path: String, json: String, done: (Int, String?) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        val url = "${BuildConfig.API_URL}$path"
        val cookie = if (UrlRules.isColonApi(url)) sessionCookie() else null
        if (cookie == null) { main.post { done(-1, null) }; return }
        val req = Request.Builder().url(url)
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .header("Accept", "application/json")
            .header("Cookie", cookie)
            .header("User-Agent", "ColonAndroid/${BuildConfig.VERSION_NAME} (${BuildConfig.APP_KEY})")
            .header("X-Colon-Client", "android")
            .build()
        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { main.post { done(0, null) } }

            override fun onResponse(call: Call, response: Response) {
                val (code, body) = try {
                    response.use { r -> r.code to r.body?.string()?.take(16_000) }
                } catch (_: IOException) {
                    0 to null
                }
                main.post { done(code, body) }
            }
        })
    }

    /** 0.38.0: GET [path] from the Colon API (the bubble's GET /crash/live); [done] as for [post]. */
    fun get(http: OkHttpClient, path: String, done: (Int, String?) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        val url = "${BuildConfig.API_URL}$path"
        val cookie = if (UrlRules.isColonApi(url)) sessionCookie() else null
        if (cookie == null) { main.post { done(-1, null) }; return }
        val req = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("Cookie", cookie)
            .header("User-Agent", "ColonAndroid/${BuildConfig.VERSION_NAME} (${BuildConfig.APP_KEY})")
            .header("X-Colon-Client", "android")
            .build()
        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { main.post { done(0, null) } }

            override fun onResponse(call: Call, response: Response) {
                val (code, body) = try {
                    response.use { r -> r.code to r.body?.string()?.take(32_000) }
                } catch (_: IOException) {
                    0 to null
                }
                main.post { done(code, body) }
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
