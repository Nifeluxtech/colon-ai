package ng.nifelux.colonai

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File

/**
 * <input type="file"> for WebViews. Create it in onCreate (it registers activity result launchers).
 * 0.24.0 (FileChooserRules picks which): capture on an image input takes a photo with the camera (TakePicture into
 * a FileProvider uri; the CAMERA permission is asked for right then, as the manifest declares it), images only open
 * the Android photo picker (PickVisualMedia / PickMultipleVisualMedia), anything else the document picker
 * (OpenDocument / OpenMultipleDocuments) with the page's accepted types.
 */
class FileChooser(private val activity: ComponentActivity) {
    private var pending: ValueCallback<Array<Uri>>? = null
    private var photoFile: File? = null
    private var photoUri: Uri? = null

    private fun deliver(uris: Array<Uri>?) {
        val cb = pending ?: return
        pending = null
        cb.onReceiveValue(uris?.takeIf { it.isNotEmpty() })
    }

    private val camera = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = photoUri
        photoUri = null
        if (ok && uri != null) deliver(arrayOf(uri)) else { photoFile?.delete(); deliver(null) }
        photoFile = null
    }
    private val cameraPermission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        ok -> if (ok) launchCamera() else deliver(null)
    }
    private val photo = activity.registerForActivityResult(PickVisualMedia()) { uri ->
        deliver(uri?.let { arrayOf(it) })
    }
    private val photos = activity.registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) {
        uris -> deliver(uris.toTypedArray())
    }
    private val document = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        deliver(uri?.let { arrayOf(it) })
    }
    private val documents = activity.registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) {
        uris -> deliver(uris.toTypedArray())
    }

    /** WebChromeClient.onShowFileChooser: true when a picker opened (the page then waits for the callback). */
    fun show(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        pending?.onReceiveValue(null) // a second chooser cancels the first, as Chrome does
        pending = callback
        val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        return try {
            when (FileChooserRules.picker(params.acceptTypes, params.isCaptureEnabled)) {
                FileChooserRules.Picker.CAMERA ->
                    if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) launchCamera()
                    else cameraPermission.launch(Manifest.permission.CAMERA)
                FileChooserRules.Picker.PHOTOS -> {
                    val request = PickVisualMediaRequest(PickVisualMedia.ImageOnly)
                    if (multiple) photos.launch(request) else photo.launch(request)
                }
                FileChooserRules.Picker.FILES -> {
                    val types = FileChooserRules.documentTypes(params.acceptTypes)
                    if (multiple) documents.launch(types) else document.launch(types)
                }
            }
            true
        } catch (_: ActivityNotFoundException) {
            pending = null
            callback.onReceiveValue(null)
            false
        }
    }

    /** A fresh file in cache/camera/ (shared through the "files" FileProvider, see res/xml/file_paths.xml). */
    private fun launchCamera() {
        try {
            val dir = File(activity.cacheDir, "camera").apply { mkdirs() }
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000L }
                ?.forEach { it.delete() } // photos older than a day were uploaded long ago
            val file = File(dir, "IMG_${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
            photoFile = file
            photoUri = uri
            camera.launch(uri)
        } catch (_: Exception) { // no camera app, or the file could not be made
            photoFile = null
            photoUri = null
            deliver(null)
        }
    }
}
