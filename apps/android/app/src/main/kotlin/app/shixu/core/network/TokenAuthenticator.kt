package app.shixu.core.network

import app.shixu.core.network.generated.models.AuthTokensResponse
import app.shixu.core.network.generated.models.ErrorCode
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

class TokenAuthenticator(
    private val tokenStore: TokenStore,
    private val refreshCall: (refreshToken: String) -> AuthTokensResponse?,
) : Authenticator {
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= MAX_ATTEMPTS) {
            return null
        }

        val path = response.request.url.encodedPath
        if (PUBLIC_AUTH_PATHS.any { path.endsWith(it) }) {
            return null
        }

        val rawBody = runCatching { response.peekBody(MAX_PEEK_BYTES).string() }.getOrNull()
        val problem = rawBody?.let(ProblemDetailParser::parseRaw)
        if (problem?.code != ErrorCode.UNAUTHORIZED) {
            return null
        }

        val failedBearer = response.request.header("Authorization")
            ?.removePrefix("Bearer ")
            ?.trim()

        synchronized(lock) {
            val latestAccess = tokenStore.accessToken()?.takeIf { it.isNotBlank() }
            if (latestAccess != null && latestAccess != failedBearer) {
                return response.request.newBuilder()
                    .header("Authorization", "Bearer $latestAccess")
                    .build()
            }

            val currentRefresh = tokenStore.refreshToken()?.takeIf { it.isNotBlank() }
            if (currentRefresh == null) {
                tokenStore.clear()
                return null
            }

            val renewed = runCatching { refreshCall(currentRefresh) }.getOrNull()
            if (renewed == null) {
                tokenStore.clear()
                return null
            }

            tokenStore.saveTokens(renewed.accessToken, renewed.refreshToken)
            return response.request.newBuilder()
                .header("Authorization", "Bearer ${renewed.accessToken}")
                .build()
        }
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }

    private companion object {
        const val MAX_ATTEMPTS = 2
        const val MAX_PEEK_BYTES = 64L * 1024L
        val PUBLIC_AUTH_PATHS = setOf(
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/refresh",
        )
    }
}
