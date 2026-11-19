package app.shixu.core.datastore

import app.shixu.core.network.TokenStore
import java.nio.ByteBuffer
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Persists one authenticated, atomic envelope; neither token is ever stored as plaintext. */
class EncryptedTokenVault(
    private val read: () -> String?,
    private val write: (String?) -> Unit,
    private val key: () -> SecretKey,
) : TokenStore {
    @Synchronized override fun saveTokens(accessToken: String, refreshToken: String) {
        require(accessToken.isNotBlank() && refreshToken.isNotBlank())
        val access = accessToken.toByteArray(Charsets.UTF_8)
        val refresh = refreshToken.toByteArray(Charsets.UTF_8)
        val plain = ByteBuffer.allocate(4 + access.size + refresh.size).putInt(access.size).put(access).put(refresh).array()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(plain)
        write(Base64.getEncoder().encodeToString(cipher.iv + encrypted))
    }
    override fun accessToken(): String? = tokens()?.first
    override fun refreshToken(): String? = tokens()?.second
    @Synchronized override fun clear() = write(null)
    @Synchronized private fun tokens(): Pair<String, String>? = runCatching {
        val encoded = read() ?: return null
        val raw = Base64.getDecoder().decode(encoded)
        require(raw.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12))) }
        val decoded = ByteBuffer.wrap(cipher.doFinal(raw.copyOfRange(12, raw.size)))
        val size = decoded.int
        require(size > 0 && size < decoded.remaining())
        val access = ByteArray(size).also(decoded::get).toString(Charsets.UTF_8)
        val refresh = ByteArray(decoded.remaining()).also(decoded::get).toString(Charsets.UTF_8)
        access to refresh
    }.getOrNull()
}
