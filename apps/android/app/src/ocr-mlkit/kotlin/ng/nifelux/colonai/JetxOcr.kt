package ng.nifelux.colonai

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Colon JetX's on-device text recognition (0.38.0, colonjetx only): ML Kit Text Recognition (Latin) through Google
 * Play services, so the model is not bundled in the APK (the manifest asks Play services to fetch "ocr" at install).
 * Everything runs on the phone; the bitmap is never sent anywhere. Words come back with their boxes, as
 * JetxOcrRules.Token. No Play services, or the model is still downloading: [done] gets null and the screen reader
 * says so.
 */
object JetxOcr {
    const val available = true

    private var client: TextRecognizer? = null

    fun recognize(bitmap: Bitmap, done: (List<JetxOcrRules.Token>?) -> Unit) {
        val c = client ?: try {
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { client = it }
        } catch (_: Exception) {
            done(null); return
        }
        try {
            c.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { text ->
                    val out = ArrayList<JetxOcrRules.Token>()
                    for (b in text.textBlocks) for (l in b.lines) for (e in l.elements) {
                        val r = e.boundingBox ?: continue
                        out += JetxOcrRules.Token(e.text, r.left, r.top, r.right, r.bottom)
                    }
                    done(out)
                }
                .addOnFailureListener { done(null) }
        } catch (_: Exception) {
            done(null)
        }
    }

    fun close() {
        try { client?.close() } catch (_: Exception) { }
        client = null
    }
}
