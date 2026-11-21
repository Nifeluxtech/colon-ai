package ng.nifelux.colonai

import android.content.Context

/**
 * 0.23.0: no wake word engine in this build (Colon Browser, or a local build without the sherpa-onnx AAR and model
 * that CI downloads; see docs/os-assistant/step-5.md). Settings hide the "Hey Colon" switch.
 */
object WakeEngines {
    const val BUNDLED = false

    @Suppress("UNUSED_PARAMETER")
    fun create(context: Context): WakeWordEngine? = null
}
