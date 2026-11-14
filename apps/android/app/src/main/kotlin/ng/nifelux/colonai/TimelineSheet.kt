package ng.nifelux.colonai

import android.graphics.BitmapFactory
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialog

/**
 * 0.11.0: tapping the Saga card shows every step of the task (StepLog): a small picture of the page after the step,
 * what Saga did (opened, clicked, typed — typed values of secret fields always hidden) and on which site, newest
 * last. Read-only; nothing here leaves the phone.
 */
object TimelineSheet {
    fun show(a: android.app.Activity, goal: String, steps: List<StepLog.Step>, thumb: (String) -> ByteArray?) {
        val d = a.resources.displayMetrics.density
        fun px(dp: Int) = (dp * d).toInt()
        val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(px(20), px(16), px(20), px(24)) }
        col.addView(TextView(a).apply {
            text = a.getString(R.string.timeline_title); textSize = 18f
            setTextColor(ContextCompat.getColor(a, R.color.colon_text))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        if (goal.isNotBlank()) col.addView(TextView(a).apply {
            text = goal.take(200); setTextColor(ContextCompat.getColor(a, R.color.colon_muted)); setPadding(0, px(4), 0,
                px(12))
        })
        if (steps.isEmpty()) col.addView(TextView(a).apply {
            setText(R.string.timeline_empty); setTextColor(ContextCompat.getColor(a, R.color.colon_muted))
        })
        steps.forEach { s ->
            val row = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(0, px(8), 0, px(8)) }
            val img = ImageView(a).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(ContextCompat.getColor(a, R.color.colon_chip))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                s.thumb?.let { t -> thumb(t)?.let { b -> BitmapFactory.decodeByteArray(b, 0, b.size)?.let(::setImageBitmap) } }
            }
            row.addView(img, LinearLayout.LayoutParams(px(96), px(60)))
            val texts = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(px(12), 0, 0, 0) }
            texts.addView(TextView(a).apply {
                text = a.getString(R.string.timeline_row, s.n, a.getString(kindRes(s.kind)))
                setTextColor(ContextCompat.getColor(a, if (s.ok == false) R.color.colon_pill_bad else R.color.colon_text))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            texts.addView(TextView(a).apply { text = s.label; setTextColor(ContextCompat.getColor(a, R.color.colon_text)) })
            if (s.host.isNotBlank()) texts.addView(TextView(a).apply {
                text = s.host; textSize = 12f; setTextColor(ContextCompat.getColor(a, R.color.colon_muted))
            })
            row.addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            col.addView(row)
        }
        val dialog = BottomSheetDialog(a)
        dialog.setContentView(ScrollView(a).apply { addView(col) })
        dialog.show()
    }

    private fun kindRes(kind: String): Int = when (kind) {
        "opened" -> R.string.step_opened
        "clicked" -> R.string.step_clicked
        "typed" -> R.string.step_typed
        "scrolled" -> R.string.step_scrolled
        "read" -> R.string.step_read
        "signed_in" -> R.string.step_signed_in
        "extracted" -> R.string.step_extracted
        "tab" -> R.string.step_tab
        "back" -> R.string.step_back
        else -> R.string.step_other
    }
}
