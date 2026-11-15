package ng.nifelux.colonai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Colon Secured Login's vault on the phone (0.11.0, ADR 0007): the user's saved site logins, encrypted with an
 * AES-256-GCM key that lives in the Android Keystore (it can't be read out of the phone, and it goes with the app's
 * data). The encrypted list sits in app-private preferences, excluded from backups (data_extraction_rules,
 * allowBackup=false). Nothing here is ever sent to the server, the chat page or the model: callers get entries only
 * to fill a trusted page natively (BrowserSaga.signIn) or to show the user their own list (VaultActivity).
 */
class LoginVault(context: Context, private val crypt: Crypt = KeystoreCrypt()) {
    /** Encrypts and decrypts the stored list; tests swap in a fake (the Keystore isn't there in local unit tests). */
    interface Crypt {
        fun encrypt(plain: ByteArray): ByteArray
        fun decrypt(sealed: ByteArray): ByteArray
    }

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun all(): List<VaultRules.Entry> = try {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        VaultRules.fromJson(String(crypt.decrypt(Base64.decode(raw, Base64.NO_WRAP)), Charsets.UTF_8))
    } catch (_: Exception) { emptyList() } // a lost key (the user cleared credentials) reads as an empty vault

    /** 0.11.6: the site's own login, else its domain family's (VaultRules.match: parent or subdomain, same domain). */
    fun find(site: String): VaultRules.Entry? = VaultRules.match(all(), site)

    /** The entry saved for exactly [site] (the form edits that one). */
    fun exact(site: String): VaultRules.Entry? = all().firstOrNull { it.site == site }

    fun has(site: String): Boolean = find(site) != null

    fun save(e: VaultRules.Entry) = write(VaultRules.upsert(all(), e))

    fun delete(site: String) = write(all().filter { it.site != site })

    fun setTrusted(site: String, trusted: Boolean) =
        write(all().map { if (it.site == site) it.copy(trusted = trusted, approved = it.approved && trusted) else it })

    /** The user's one-time yes to Saga signing in on [site]. */
    fun approve(site: String) = write(all().map { if (it.site == site) it.copy(approved = true) else it })

    fun clear() { prefs.edit().remove(KEY).apply() }

    private fun write(list: List<VaultRules.Entry>) {
        val sealed = crypt.encrypt(VaultRules.toJson(list).toByteArray(Charsets.UTF_8))
        prefs.edit().putString(KEY, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    /** AES-256-GCM with a non-exportable Android Keystore key; output = 12-byte IV followed by the ciphertext. */
    class KeystoreCrypt : Crypt {
        private fun key(): SecretKey {
            val ks = KeyStore.getInstance(STORE).apply { load(null) }
            (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE)
            gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
            return gen.generateKey()
        }

        override fun encrypt(plain: ByteArray): ByteArray {
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.ENCRYPT_MODE, key())
            return c.iv + c.doFinal(plain)
        }

        override fun decrypt(sealed: ByteArray): ByteArray {
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            return c.doFinal(sealed, 12, sealed.size - 12)
        }
    }

    companion object {
        private const val PREFS = "colon.vault"
        private const val KEY = "logins"
        private const val STORE = "AndroidKeyStore"
        private const val ALIAS = "colon_secured_login_v1"
        private const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
