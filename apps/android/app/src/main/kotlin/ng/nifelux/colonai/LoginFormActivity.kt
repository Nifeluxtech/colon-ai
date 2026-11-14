package ng.nifelux.colonai

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The "Colon Secured Login" form (0.11.0, ADR 0007): site, user name or email, password and "trust this site for
 * Saga". FLAG_SECURE keeps it out of screenshots and the recent-apps picture; autofill services are kept out; the
 * values are written straight into LoginVault (Keystore-encrypted) and the activity's result carries only the site,
 * that a login was saved and the masked user name, never the password. Opened by the chat's secure card
 * (NativeBridge vault form), by Saga when it needs a login it doesn't have (handoff kind login), from the vault
 * screen, and after the user signed in by hand (offer to save).
 */
class LoginFormActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        setContentView(R.layout.activity_login_form)
        val root = findViewById<View>(R.id.login_root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        val site = findViewById<EditText>(R.id.login_site)
        val user = findViewById<EditText>(R.id.login_user)
        val pass = findViewById<EditText>(R.id.login_pass)
        val trust = findViewById<CheckBox>(R.id.login_trust)
        val vault = LoginVault(this)
        val given = VaultRules.site(intent.getStringExtra(EXTRA_SITE))
        site.setText(given.orEmpty())
        if (given != null) vault.find(given)?.let { user.setText(it.user); trust.isChecked = it.trusted }
        intent.getStringExtra(EXTRA_USER)?.takeIf { user.text.isNullOrEmpty() }?.let { user.setText(it.take(512)) }
        trust.isChecked = trust.isChecked || intent.getBooleanExtra(EXTRA_TRUST, false)
        (if (given == null) site else if (user.text.isNullOrEmpty()) user else pass).requestFocus()
        findViewById<CheckBox>(R.id.login_show).setOnCheckedChangeListener { _, on ->
            pass.inputType = InputType.TYPE_CLASS_TEXT or if (on) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                else InputType.TYPE_TEXT_VARIATION_PASSWORD
            pass.setSelection(pass.text.length)
        }
        findViewById<Button>(R.id.login_cancel).setOnClickListener { setResult(Activity.RESULT_CANCELED); finish() }
        findViewById<Button>(R.id.login_save).setOnClickListener {
            val e = VaultRules.entryOf(site.text.toString(), user.text.toString(), pass.text.toString(),
                trust.isChecked, System.currentTimeMillis())
            if (e == null) {
                Toast.makeText(this, R.string.vault_invalid, Toast.LENGTH_SHORT).show(); return@setOnClickListener
            }
            vault.save(e)
            pass.text.clear()
            Toast.makeText(this, getString(R.string.vault_saved, e.site), Toast.LENGTH_SHORT).show()
            setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_SITE, e.site).putExtra(RESULT_MASKED,
                VaultRules.mask(e.user)).putExtra(RESULT_TRUSTED, e.trusted))
            finish()
        }
    }

    override fun onStop() {
        super.onStop()
        // Nothing typed lingers in a backgrounded form.
        if (isFinishing) findViewById<EditText>(R.id.login_pass)?.text?.clear()
    }

    companion object {
        const val EXTRA_SITE = "ng.nifelux.colonai.vault.SITE"
        const val EXTRA_USER = "ng.nifelux.colonai.vault.USER"
        const val EXTRA_TRUST = "ng.nifelux.colonai.vault.TRUST"
        const val RESULT_MASKED = "ng.nifelux.colonai.vault.MASKED"
        const val RESULT_TRUSTED = "ng.nifelux.colonai.vault.TRUSTED"

        fun intent(context: Context, site: String?, user: String? = null, trust: Boolean = false): Intent =
            Intent(context, LoginFormActivity::class.java).putExtra(EXTRA_SITE, site).putExtra(EXTRA_USER, user)
                .putExtra(EXTRA_TRUST, trust)
    }
}
