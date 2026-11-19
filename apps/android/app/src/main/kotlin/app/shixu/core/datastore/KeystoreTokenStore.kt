package app.shixu.core.datastore

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.shixu.core.network.TokenStore
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class KeystoreTokenStore @Inject constructor(@ApplicationContext context: Context) : TokenStore {
    private val preferences = context.getSharedPreferences("secure_session_v2", Context.MODE_PRIVATE)
    private val vault = EncryptedTokenVault(
        { preferences.getString("envelope", null) },
        { value -> check(preferences.edit().apply { if (value == null) remove("envelope") else putString("envelope", value) }.commit()) },
        ::encryptionKey,
    )
    @Synchronized private fun encryptionKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    override fun accessToken() = vault.accessToken()
    override fun refreshToken() = vault.refreshToken()
    override fun saveTokens(accessToken: String, refreshToken: String) = vault.saveTokens(accessToken, refreshToken)
    override fun clear() = vault.clear()
    private companion object { const val ALIAS = "shixu.session.v2" }
}
