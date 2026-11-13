package ng.nifelux.colonai

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Full-screen video (WebChromeClient.onShowCustomView) over the whole window, system bars hidden. */
class Fullscreen(private val activity: Activity) {
    private var view: View? = null
    private var callback: WebChromeClient.CustomViewCallback? = null

    val active: Boolean get() = view != null

    fun enter(v: View, cb: WebChromeClient.CustomViewCallback) {
        if (view != null) { cb.onCustomViewHidden(); return }
        view = v
        callback = cb
        (activity.window.decorView as FrameLayout).addView(v, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    fun exit() {
        val v = view ?: return
        (activity.window.decorView as FrameLayout).removeView(v)
        view = null
        WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            .show(WindowInsetsCompat.Type.systemBars())
        callback?.onCustomViewHidden()
        callback = null
    }
}
