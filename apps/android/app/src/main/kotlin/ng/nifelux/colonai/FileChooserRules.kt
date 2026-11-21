package ng.nifelux.colonai

/**
 * 0.24.0: which picker an <input type="file"> opens (pure, unit-tested in FileChooserRulesTest).
 * The chat's attach sheet sets the input up for each item: Camera = accept="image/…" capture, Photos =
 * accept="image/…" multiple, Files = the full accepted list. capture on images opens the camera, images only open
 * the Android photo picker, anything else the document picker.
 */
object FileChooserRules {
    enum class Picker { CAMERA, PHOTOS, FILES }

    /** The page's accept list as mime types ("" or an unknown extension means any file: an empty list). */
    fun mimes(acceptTypes: Array<String>?): List<String> = (acceptTypes ?: emptyArray())
        .flatMap { it.split(',') }.map { it.trim().lowercase() }
        .filter { it.isNotEmpty() }
        .map { if (it.startsWith('.')) mimeForExtension(it) else it }
        .distinct()
        .let { if ("*/*" in it) emptyList() else it }

    fun picker(acceptTypes: Array<String>?, capture: Boolean): Picker {
        val m = mimes(acceptTypes)
        val imagesOnly = m.isNotEmpty() && m.all { it.startsWith("image/") }
        return when {
            capture && imagesOnly -> Picker.CAMERA
            imagesOnly -> Picker.PHOTOS
            else -> Picker.FILES
        }
    }

    /** The document picker's types: the accepted list, or any file. */
    fun documentTypes(acceptTypes: Array<String>?): Array<String> =
        mimes(acceptTypes).ifEmpty { listOf("*/*") }.toTypedArray()

    fun mimeForExtension(ext: String): String = when (ext) {
        ".pdf" -> "application/pdf"
        ".png" -> "image/png"
        ".jpg", ".jpeg" -> "image/jpeg"
        ".webp" -> "image/webp"
        ".gif" -> "image/gif"
        ".txt", ".md", ".csv" -> "text/*"
        ".zip" -> "application/zip"
        else -> "*/*"
    }
}
