package ng.nifelux.colonai

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The "Clear browsing data" screen: history, cookies and site data, cached files, site storage and the downloads
 * list. Colon AI's sign-in is kept. Started for a result so the browser can reload its tabs afterwards.
 * EXTRA_STORE names the BrowserStore (Colon Browser's or the in-chat panel's).
 */
class ClearDataActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_clear_data)
        val root = findViewById<View>(R.id.clear_root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        val store = BrowserStore(this, intent.getStringExtra(EXTRA_STORE) ?: BrowserStore.DEFAULT)
        val boxes = listOf(R.id.cb_history, R.id.cb_cookies, R.id.cb_cache, R.id.cb_storage, R.id.cb_downloads)
            .map { findViewById<CheckBox>(it) }
        val go = findViewById<Button>(R.id.btn_clear)
        val sync = { go.isEnabled = boxes.any { it.isChecked } }
        boxes.forEach { it.setOnCheckedChangeListener { _, _ -> sync() } }
        sync()
        findViewById<View>(R.id.btn_cancel).setOnClickListener { finish() }
        go.setOnClickListener {
            val c = BrowserData.Choice(boxes[0].isChecked, boxes[1].isChecked, boxes[2].isChecked,
                boxes[3].isChecked, boxes[4].isChecked)
            go.isEnabled = false
            BrowserData.clear(this, store, c) {
                runOnUiThread {
                    toast()
                    setResult(Activity.RESULT_OK)
                    finish()
                }
            }
        }
    }

    private fun toast() = android.widget.Toast.makeText(this, R.string.cleared, android.widget.Toast.LENGTH_SHORT).show()

    companion object {
        const val EXTRA_STORE = "ng.nifelux.colonai.STORE"
    }
}
