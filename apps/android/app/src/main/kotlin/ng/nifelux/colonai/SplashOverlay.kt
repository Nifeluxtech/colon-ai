package ng.nifelux.colonai

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.core.splashscreen.SplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The first-load splash with a "from Nifelux" footer (like WhatsApp's "from Meta").
 *
 * The system splash (Android 12+ SplashScreen API, or androidx's backport on 7-11) shows only the centred icon, and
 * its branding image is not shown reliably on every phone, so the footer is a native overlay instead: a navy view
 * on top of the activity's content (view_splash.xml) with the same background and the same 288dp icon, centred in
 * the same window, so the hand-off from the system splash is seamless and only the footer is added. The system
 * splash stays just long enough for its icon animation (Android 12+), then this overlay stays until the page is
 * ready or [maxMs] passes, and fades out. Shared by both apps; each app's splash_icon resolves per flavor.
 */
class SplashOverlay private constructor(private val view: View) {
    private val main = Handler(Looper.getMainLooper())
    private var gone = false

    /** Fades the overlay out and removes it (safe to call more than once). */
    fun hide() {
        if (gone) return
        gone = true
        main.removeCallbacksAndMessages(null)
        view.animate().alpha(0f).setDuration(FADE_MS).withEndAction {
            (view.parent as? ViewGroup)?.removeView(view)
        }.start()
    }

    companion object {
        private const val FADE_MS = 220L
        /** Android 12+ animates the splash icon (splash_icon.xml grows in over 650 ms); older phones show it still. */
        private val systemIconMs: Long get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) 700L else 0L

        /**
         * Call right after setContentView. [fresh] is false for a re-created activity or a launch that should open
         * straight away (no overlay then). [ready] ends the system splash early once the page has painted.
         */
        fun start(a: Activity, splash: SplashScreen, fresh: Boolean, maxMs: Long,
                  ready: () -> Boolean = { false }): SplashOverlay? {
            if (!fresh) return null
            val t0 = SystemClock.elapsedRealtime()
            splash.setKeepOnScreenCondition { !ready() && SystemClock.elapsedRealtime() - t0 < systemIconMs }
            val content = a.findViewById<ViewGroup>(android.R.id.content) ?: return null
            val v = LayoutInflater.from(a).inflate(R.layout.view_splash, content, false)
            content.addView(v)
            liftFooter(v)
            return SplashOverlay(v).also { o -> o.main.postDelayed({ o.hide() }, maxMs) }
        }

        /** Keeps the footer above the navigation bar (the window is edge-to-edge), set before the first frame. */
        private fun liftFooter(v: View) {
            val footer = v.findViewById<View>(R.id.splash_footer)
            v.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
                override fun onPreDraw(): Boolean {
                    if (v.viewTreeObserver.isAlive) v.viewTreeObserver.removeOnPreDrawListener(this)
                    val nav = ViewCompat.getRootWindowInsets(v)
                        ?.getInsets(WindowInsetsCompat.Type.systemBars())?.bottom ?: 0
                    if (nav == footer.paddingBottom) return true
                    footer.setPadding(0, 0, 0, nav)
                    return false
                }
            })
        }
    }
}
