package app.shixu.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import app.shixu.core.network.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 基于 Android Keystore + DataStore Preferences 的持久化安全令牌仓库。
 * 保留同步内存镜像以适配 OkHttp AuthInterceptor 与 TokenAuthenticator 的同步回调契约。
 */
@Singleton
class EncryptedTokenStore @Inject constructor(
    @TokenPreferencesDataStore private val dataStore: DataStore<Preferences>,
    private val cipher: TokenCipher,
) : TokenStore {

    @Volatile
    private var cachedAccessToken: String? = null

    @Volatile
    private var cachedRefreshToken: String? = null

    @Volatile
    private var initialized = false

    private val lock = Any()
    private val _hasSessionFlow = MutableStateFlow(false)
    val hasSessionFlow: StateFlow<Boolean> = _hasSessionFlow.asStateFlow()

    suspend fun warmUp() {
        if (initialized) return
        withContext(Dispatchers.IO) {
            ensureLoaded()
        }
    }

    override fun accessToken(): String? {
        ensureLoaded()
        return cachedAccessToken
    }

    override fun refreshToken(): String? {
        ensureLoaded()
        return cachedRefreshToken
    }

    override fun saveTokens(accessToken: String, refreshToken: String) {
        synchronized(lock) {
            cachedAccessToken = accessToken
            cachedRefreshToken = refreshToken
            initialized = true
            _hasSessionFlow.value = accessToken.isNotBlank() || refreshToken.isNotBlank()
            runBlocking {
                dataStore.edit { prefs ->
                    prefs[KEY_ACCESS_ENC] = cipher.encrypt(accessToken)
                    prefs[KEY_REFRESH_ENC] = cipher.encrypt(refreshToken)
                }
            }
        }
    }

    override fun clear() {
        synchronized(lock) {
            cachedAccessToken = null
            cachedRefreshToken = null
            initialized = true
            _hasSessionFlow.value = false
            runBlocking {
                dataStore.edit { prefs ->
                    prefs.remove(KEY_ACCESS_ENC)
                    prefs.remove(KEY_REFRESH_ENC)
                }
            }
        }
    }

    private fun ensureLoaded() {
        if (initialized) return
        synchronized(lock) {
            if (initialized) return
            val prefs = runCatching {
                runBlocking {
                    dataStore.data
                        .catch { err ->
                            if (err is IOException) emit(emptyPreferences()) else throw err
                        }
                        .first()
                }
            }.getOrElse { emptyPreferences() }

            val access = prefs[KEY_ACCESS_ENC]?.let(cipher::decrypt)?.takeIf { it.isNotBlank() }
            val refresh = prefs[KEY_REFRESH_ENC]?.let(cipher::decrypt)?.takeIf { it.isNotBlank() }
            cachedAccessToken = access
            cachedRefreshToken = refresh
            _hasSessionFlow.value = !access.isNullOrBlank() || !refresh.isNullOrBlank()
            initialized = true
        }
    }

    private companion object {
        val KEY_ACCESS_ENC = stringPreferencesKey("access_token_enc")
        val KEY_REFRESH_ENC = stringPreferencesKey("refresh_token_enc")
    }
}
