package ng.nifelux.colonai

import android.content.pm.PackageManager
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/** Asks for several Android permissions at once. Create it while the activity is created (it registers a launcher). */
class PermissionAsker(private val activity: ComponentActivity) {
    private var pending: ((Map<String, Boolean>) -> Unit)? = null
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pending?.invoke(it); pending = null
    }

    fun ask(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit) {
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) { cb(perms.associateWith { true }); return }
        pending?.invoke(emptyMap())
        pending = { r -> cb(perms.associateWith { it !in missing || r[it] == true }) }
        launcher.launch(missing.toTypedArray())
    }
}
