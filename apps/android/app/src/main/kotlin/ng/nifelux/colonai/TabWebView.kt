package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView

/**
 * 0.10.2: a browser tab's WebView that can ignore the user while Saga drives in "AI only" ([guard], from
 * BrowserHost.userInputBlocked). Then the user's taps, scrolls and mouse wheel never reach the page, the keyboard
 * can't type into it (no input connection, so the soft keyboard has nothing to type into, even after Saga's own tap
 * focused a field) and hardware keys other than Back, volume and the like are dropped. Saga's own gestures pass:
 * SagaClicks dispatches them inside [asSaga]. In "AI + me" and when the user has control nothing is filtered.
 * The AI shield over the page still shows the Take control button; this is the page's own lock behind it.
 */
@SuppressLint("ViewConstructor")
class TabWebView(context: Context) : WebView(context) {
    /** True while the user must not drive this page (Saga has it in "AI only"). */
    var guard: () -> Boolean = { false }
    /** 0.10.3: the desktop-layout script (DesktopView) to run as each page starts, on WebViews that can't inject it
     *  at document start; null otherwise. */
    var desktopScript: String? = null
    private var sagaDepth = 0

    /** Runs [block] (a dispatch of Saga's own MotionEvents) as Saga's input, which the lock lets through. */
    fun <T> asSaga(block: () -> T): T {
        sagaDepth++
        try { return block() } finally { sagaDepth-- }
    }

    private fun userBlocked() = sagaDepth == 0 && guard()

    @SuppressLint("ClickableViewAccessibility")
    override fun dispatchTouchEvent(event: MotionEvent): Boolean =
        if (userBlocked()) true else super.dispatchTouchEvent(event)

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean =
        if (userBlocked()) true else super.dispatchGenericMotionEvent(event)

    override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        if (userBlocked() && InputGuard.blocksKey(event.keyCode)) true else super.dispatchKeyEvent(event)

    override fun onCheckIsTextEditor(): Boolean = if (guard()) false else super.onCheckIsTextEditor()

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? =
        if (guard()) null else super.onCreateInputConnection(outAttrs)

    /** The lock just came on: a finger already on the page is cancelled and the keyboard goes away. When it comes
     *  off, the keyboard may connect again (the next tap on a field brings it up). */
    fun onGuardChanged(blocked: Boolean) {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        if (blocked) {
            val now = SystemClock.uptimeMillis()
            val cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
            try { super.dispatchTouchEvent(cancel) } catch (_: Exception) { } finally { cancel.recycle() }
            imm?.hideSoftInputFromWindow(windowToken, 0)
        }
        try { imm?.restartInput(this) } catch (_: Exception) { }
    }
}

/** Who may drive the page (pure, unit-tested in SagaTouchTest). */
object InputGuard {
    /** Keys that still work while the page is locked: they are the phone's, not the page's. */
    private val PHONE_KEYS = setOf(KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_VOLUME_MUTE, KeyEvent.KEYCODE_HOME, KeyEvent.KEYCODE_POWER, KeyEvent.KEYCODE_APP_SWITCH,
        KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_ESCAPE)

    /** "AI only" while Saga has the browser (paused too: Take control is how the user gets it back). "AI + me"
     *  and Manual leave the page to the user. */
    fun blocksUser(mode: ControlState.Mode): Boolean = mode == ControlState.Mode.AI

    fun blocksKey(keyCode: Int): Boolean = keyCode !in PHONE_KEYS
}
