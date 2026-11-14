package ng.nifelux.colonai

import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/**
 * Settings › Saved logins (0.11.0): the user's Colon Secured Login vault on this phone. Each site shows its masked
 * user name, "Saga may use it" (trusted) and whether Saga's sign-in there was approved; the user adds, edits
 * (re-enters) and deletes logins. FLAG_SECURE: the list never shows in screenshots. Passwords are never shown here.
 */
class VaultActivity : AppCompatActivity() {
    private lateinit var vault: LoginVault
    private lateinit var list: LinearLayout
    private val form = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        vault = LoginVault(this)
        val pad = (20 * resources.displayMetrics.density).toInt()
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        val scroll = ScrollView(this).apply { addView(list); isFillViewport = true }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(scroll)
        render()
    }

    private fun text(res: Int, size: Float, muted: Boolean = false, bold: Boolean = false) = TextView(this).apply {
        setText(res); textSize = size; if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setTextColor(ContextCompat.getColor(context, if (muted) R.color.colon_muted else R.color.colon_text))
    }

    private fun render() {
        list.removeAllViews()
        list.addView(text(R.string.vault_list_title, 22f, bold = true))
        list.addView(text(R.string.vault_list_intro, 14f, muted = true).apply { setPadding(0, 8, 0, 24) })
        val all = vault.all()
        if (all.isEmpty()) list.addView(text(R.string.vault_empty, 15f, muted = true))
        all.forEach { e ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 16, 0, 16) }
            row.addView(TextView(this).apply { text = e.site; textSize = 17f
                setTextColor(ContextCompat.getColor(context, R.color.colon_text)) })
            row.addView(TextView(this).apply {
                text = getString(R.string.vault_row, VaultRules.mask(e.user), getString(if (e.approved)
                    R.string.vault_approved else R.string.vault_not_approved))
                setTextColor(ContextCompat.getColor(context, R.color.colon_muted))
            })
            row.addView(CheckBox(this).apply {
                setText(R.string.vault_trust); isChecked = e.trusted; minHeight = (48 * resources.displayMetrics.density)
                    .toInt()
                setOnCheckedChangeListener { _, on -> vault.setTrusted(e.site, on); render() }
            })
            val buttons = LinearLayout(this).apply { gravity = Gravity.END }
            buttons.addView(Button(this, null, 0, R.style.Colon_BarButton).apply {
                setText(R.string.vault_edit); setOnClickListener { form.launch(LoginFormActivity.intent(context, e.site)) }
            })
            buttons.addView(Button(this, null, 0, R.style.Colon_BarButton).apply {
                setText(R.string.vault_delete); setOnClickListener { confirmDelete(e.site) }
            })
            row.addView(buttons)
            list.addView(row)
        }
        list.addView(Button(this).apply {
            setText(R.string.vault_add); setOnClickListener { form.launch(LoginFormActivity.intent(context, null)) }
        })
        list.addView(View(this), LinearLayout.LayoutParams(1, 24))
    }

    private fun confirmDelete(site: String) {
        MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.vault_delete_title, site))
            .setMessage(R.string.vault_delete_text)
            .setPositiveButton(R.string.vault_delete) { _, _ -> vault.delete(site); render() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }
}
