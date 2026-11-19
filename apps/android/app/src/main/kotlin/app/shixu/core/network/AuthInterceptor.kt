package app.shixu.core.network

import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val path = original.url.encodedPath
        if (PUBLIC_PATHS.any { path.endsWith(it) } || original.header("Authorization") != null) {
            return chain.proceed(original)
        }

        val token = tokenStore.accessToken()?.takeIf { it.isNotBlank() }
            ?: return chain.proceed(original)

        val authed = original.newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(authed)
    }

    private companion object {
        val PUBLIC_PATHS = setOf(
            "/api/v1/health",
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/refresh",
        )
    }
}
