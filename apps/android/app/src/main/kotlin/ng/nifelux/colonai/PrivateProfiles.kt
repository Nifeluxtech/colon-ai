package ng.nifelux.colonai

import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * The Android side of private tabs (rules in PrivateBrowsing): one throwaway WebView profile per private session,
 * so a private tab's cookies, site storage and cache never mix with normal tabs and are deleted when it ends.
 */
object PrivateProfiles {
    private var session: String? = null

    /** True when this phone's WebView can give private tabs their own cookies and storage. */
    fun supported(): Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
    } catch (_: Throwable) { false }

    /** Puts a new private tab's WebView in the private profile. Must run before the WebView loads anything. */
    fun apply(wv: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return false
        return try {
            val name = session ?: PrivateBrowsing.profileName(System.currentTimeMillis()).also { session = it }
            ProfileStore.getInstance().getOrCreateProfile(name)
            WebViewCompat.setProfile(wv, name)
            true
        } catch (_: Throwable) { false }
    }

    /** The last private tab closed: forget the session and delete its profile (and stale ones) once unused. */
    fun endSession() {
        session = null
        deleteStale()
    }

    /** Deletes every private profile not in use (also leftovers from a session the app was killed in). */
    fun deleteStale() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return
            val store = ProfileStore.getInstance()
            PrivateBrowsing.staleProfiles(store.allProfileNames, session).forEach { name ->
                try { store.deleteProfile(name) } catch (_: Exception) { /* still in use; retried next launch */ }
            }
        } catch (_: Throwable) {}
    }
}
