package ng.nifelux.colonai

import android.graphics.Bitmap

/** Colon AI and Colon Browser have no screen reader (only Colon JetX ships ML Kit, src/ocr-mlkit). */
object JetxOcr {
    const val available = false

    fun recognize(bitmap: Bitmap, done: (List<JetxOcrRules.Token>?) -> Unit) {
        if (bitmap.width < 0) return
        done(null)
    }

    fun close() = Unit
}
