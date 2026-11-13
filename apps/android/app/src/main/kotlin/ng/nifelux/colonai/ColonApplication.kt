package ng.nifelux.colonai

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * App-wide singletons: one OkHttp client, the bridge, and network awareness. Notification channels are created
 * here (they are cheap and must exist before anything is posted).
 */
class ColonApplication : Application() {
    lateinit var http: OkHttpClient
        private set
    lateinit var bridge: BridgeClient
        private set

    private val main = Handler(Looper.getMainLooper())
    private val networkListeners = linkedSetOf<(Boolean) -> Unit>()
    var online = true
        private set

    override fun onCreate() {
        super.onCreate()
        http = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        bridge = BridgeClient(this, http)
        Notifications.createChannels(this)
        watchNetwork()
    }

    fun addNetworkListener(l: (Boolean) -> Unit) { networkListeners += l }
    fun removeNetworkListener(l: (Boolean) -> Unit) { networkListeners -= l }

    private fun watchNetwork() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        online = isOnline(cm)
        try {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = changed(true)
                override fun onLost(network: Network) {
                    main.postDelayed({ if (!isOnline(cm)) changed(false) }, 500)
                }
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) changed(true)
                }
            })
        } catch (_: Exception) {
            // Some Android 7 builds throw when too many callbacks are registered; the app still works offline-unaware.
        }
    }

    private fun changed(now: Boolean) {
        main.post {
            if (now != online) {
                online = now
                bridge.onNetwork(now)
                networkListeners.toList().forEach { it(now) }
            }
        }
    }

    private fun isOnline(cm: ConnectivityManager): Boolean {
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    companion object {
        fun of(context: Context): ColonApplication = context.applicationContext as ColonApplication
    }
}
