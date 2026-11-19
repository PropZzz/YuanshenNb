package app.shixu.core.network

import javax.inject.Inject
import javax.inject.Singleton

/**
 * 令牌存储抽象；P4 阶段将替换为基于 Android Keystore + EncryptedDataStore 的持久化安全实现。
 */
interface TokenStore {
    fun accessToken(): String?
    fun refreshToken(): String?
    fun saveTokens(accessToken: String, refreshToken: String)
    fun clear()
}

@Singleton
class InMemoryTokenStore @Inject constructor() : TokenStore {
    @Volatile
    private var access: String? = null

    @Volatile
    private var refresh: String? = null

    override fun accessToken(): String? = access

    override fun refreshToken(): String? = refresh

    @Synchronized
    override fun saveTokens(accessToken: String, refreshToken: String) {
        access = accessToken
        refresh = refreshToken
    }

    @Synchronized
    override fun clear() {
        access = null
        refresh = null
    }
}
