package ng.nifelux.colonai

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import ng.nifelux.colonai.UpdateRules.Phase

/**
 * 0.24.0: the update download's progress sheet. Reads DownloadManager every half second on the main looper (percent,
 * "X MB of Y MB"), with Cancel (removes the download) and Hide (the download goes on in the notification shade).
 * When the APK is in it is verified (UpdateChecker.complete, off the main thread) and the sheet turns into Install.
 */
class UpdateSheet(val activity: Activity, private val saved: UpdateRules.Saved) {
    private val main = Handler(Looper.getMainLooper())
    private val dialog = BottomSheetDialog(activity)
    private val ctx = dialog.context // the sheet's Material theme
    private val title = TextView(ctx)
    private val bar = LinearProgressIndicator(ctx)
    private val percent = TextView(ctx)
    private val bytes = TextView(ctx)
    private val cancel = MaterialButton(ctx, null, androidx.appcompat.R.attr.borderlessButtonStyle)
    private val hide = MaterialButton(ctx, null, androidx.appcompat.R.attr.borderlessButtonStyle)
    private val install = MaterialButton(ctx)
    private var verifying = false
    private var ended = false // ready, failed or cancelled: polling stops
    private val tick = object : Runnable {
        override fun run() { if (poll()) main.postDelayed(this, UpdateRules.POLL_MS) }
    }

    val isShowing: Boolean get() = dialog.isShowing

    init {
        val d = activity.resources.displayMetrics.density
        fun px(dp: Int) = (dp * d).toInt()
        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; setPadding(px(20), px(16), px(20), px(16))
        }
        title.apply {
            text = activity.getString(R.string.update_progress_title, saved.versionName); textSize = 18f
            setTextColor(ContextCompat.getColor(activity, R.color.colon_text))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        col.addView(title)
        bar.apply { max = 100; isIndeterminate = true }
        col.addView(bar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = px(16); bottomMargin = px(8) })
        val line = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        percent.setTextColor(ContextCompat.getColor(activity, R.color.colon_text))
        bytes.apply { setTextColor(ContextCompat.getColor(activity, R.color.colon_muted)); gravity = Gravity.END }
        line.addView(percent, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        line.addView(bytes, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        col.addView(line)
        val buttons = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END; setPadding(0, px(12), 0, 0)
        }
        cancel.setText(R.string.update_cancel)
        hide.setText(R.string.update_hide)
        install.setText(R.string.update_install)
        install.visibility = View.GONE
        buttons.addView(cancel); buttons.addView(hide); buttons.addView(install)
        col.addView(buttons)
        dialog.setContentView(col)

        cancel.setOnClickListener {
            ended = true
            UpdateChecker.cancelDownload(activity)
            dialog.dismiss()
        }
        hide.setOnClickListener { UpdateChecker.hide(saved.downloadId); dialog.dismiss() }
        install.setOnClickListener { dialog.dismiss(); UpdateChecker.install(activity) }
        // Back or a swipe down is Hide: the download keeps going and the sheet comes back next time the app opens.
        dialog.setOnCancelListener { UpdateChecker.hide(saved.downloadId) }
        dialog.setOnDismissListener { main.removeCallbacks(tick); UpdateChecker.sheetGone(this) }
    }

    fun show() {
        if (activity.isFinishing || activity.isDestroyed) return
        dialog.show()
        main.post(tick)
    }

    fun dismiss() { if (dialog.isShowing) dialog.dismiss() }

    /** One read of DownloadManager; false stops polling. */
    private fun poll(): Boolean {
        if (ended || !dialog.isShowing) return false
        if (activity.isFinishing || activity.isDestroyed) { dismiss(); return false }
        val p = UpdateChecker.query(activity, saved.downloadId)
        when (UpdateRules.phase(p?.status)) {
            Phase.WAITING -> showProgress(p, R.string.update_progress_waiting)
            Phase.PAUSED -> showProgress(p, R.string.update_progress_paused)
            Phase.RUNNING -> showProgress(p, 0)
            Phase.DONE -> { finish(); return false }
            Phase.FAILED, Phase.MISSING -> {
                UpdateChecker.forget(activity)
                showEnd(activity.getString(R.string.update_failed)); return false
            }
        }
        return true
    }

    private fun showProgress(p: UpdateChecker.Progress?, note: Int) {
        val pct = p?.let { UpdateRules.percent(it.done, it.total) }
        if (pct == null) indeterminate(true) else { indeterminate(false); bar.setProgressCompat(pct, true) }
        percent.text = when {
            note != 0 -> activity.getString(note)
            pct != null -> activity.getString(R.string.update_progress_percent, pct)
            else -> ""
        }
        bytes.text = if (p != null && p.total > 0) activity.getString(R.string.update_progress_bytes,
            UpdateRules.mb(p.done), UpdateRules.mb(p.total)) else ""
    }

    /** The download is in: verify it off the main thread, then Install (or say why not). */
    private fun finish() {
        if (verifying) return
        verifying = true
        indeterminate(true)
        percent.setText(R.string.update_verifying); bytes.text = ""
        val app = activity.applicationContext
        Thread {
            val r = UpdateChecker.complete(app)
            main.post {
                verifying = false
                if (!dialog.isShowing) return@post
                when (r) {
                    UpdateChecker.Result.READY -> showReady()
                    UpdateChecker.Result.NOT_DONE -> main.postDelayed(tick, UpdateRules.POLL_MS)
                    else -> showEnd(activity.getString(UpdateChecker.messageFor(r)))
                }
            }
        }.start()
    }

    /** The bar's mode is switched while it is hidden (the safe way for Material's progress indicators). */
    private fun indeterminate(on: Boolean) {
        if (bar.isIndeterminate == on) return
        bar.visibility = View.INVISIBLE
        bar.isIndeterminate = on
        bar.visibility = View.VISIBLE
    }

    private fun showReady() {
        ended = true
        title.text = activity.getString(R.string.update_ready_title, saved.versionName)
        indeterminate(false); bar.setProgressCompat(100, false)
        percent.setText(R.string.update_ready_sheet); bytes.text = ""
        cancel.visibility = View.GONE
        hide.setText(R.string.update_later)
        install.visibility = View.VISIBLE
    }

    private fun showEnd(message: String) {
        ended = true
        bar.visibility = View.GONE
        percent.text = message; bytes.text = ""
        cancel.visibility = View.GONE; install.visibility = View.GONE
        hide.setText(R.string.update_close)
        hide.setOnClickListener { dialog.dismiss() }
        dialog.setOnCancelListener(null)
    }
}
