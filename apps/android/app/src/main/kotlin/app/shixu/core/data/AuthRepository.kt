package app.shixu.core.data

import android.os.Build
import app.shixu.core.datastore.EncryptedTokenStore
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.SessionEvent
import app.shixu.core.network.SessionEventBus
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.apis.AuthApi
import app.shixu.core.network.generated.apis.SystemApi
import app.shixu.core.network.generated.models.HealthResponse
import app.shixu.core.network.generated.models.LoginRequest
import app.shixu.core.network.generated.models.LogoutRequest
import app.shixu.core.network.generated.models.RegisterRequest
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.network.generated.models.UpdateMeRequest
import app.shixu.core.network.generated.models.UserProfile
import app.shixu.core.network.safeApiCall
import app.shixu.core.network.safeUnitApiCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

sealed interface AppSessionState {
    data object Bootstrapping : AppSessionState
    data class Unauthenticated(val alertMessage: String? = null) : AppSessionState
    data class Authenticated(
        val user: UserProfile,
        val isOfflineMode: Boolean = false,
    ) : AppSessionState
}

@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val systemApi: SystemApi,
    private val tokenStore: EncryptedTokenStore,
    private val syncPreferencesStore: SyncPreferencesStore,
    private val sessionEventBus: SessionEventBus,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _sessionState = MutableStateFlow<AppSessionState>(AppSessionState.Bootstrapping)
    val sessionState: StateFlow<AppSessionState> = _sessionState.asStateFlow()

    init {
        scope.launch {
            sessionEventBus.events.collect { event ->
                tokenStore.clear()
                syncPreferencesStore.clearUserScopedData()
                _sessionState.value = AppSessionState.Unauthenticated(alertMessage = event.detail)
            }
        }
    }

    suspend fun bootstrap() {
        tokenStore.warmUp()
        val hasRefresh = !tokenStore.refreshToken().isNullOrBlank()
        val hasAccess = !tokenStore.accessToken().isNullOrBlank()
        if (!hasRefresh && !hasAccess) {
            _sessionState.value = AppSessionState.Unauthenticated()
            return
        }

        val cachedUser = syncPreferencesStore.readMetadata().cachedUserJson?.let { raw ->
            runCatching { ShixuJson.json.decodeFromString<UserProfile>(raw) }.getOrNull()
        }

        when (val meResult = safeApiCall { authApi.getCurrentUser() }) {
            is ApiResult.Success -> {
                syncPreferencesStore.saveCachedUserJson(ShixuJson.json.encodeToString(meResult.data))
                _sessionState.value = AppSessionState.Authenticated(user = meResult.data, isOfflineMode = false)
            }

            is ApiResult.HttpError -> {
                if (meResult.httpCode == 401) {
                    tokenStore.clear()
                    syncPreferencesStore.clearUserScopedData()
                    val msg = if (_sessionState.value is AppSessionState.Unauthenticated) {
                        (_sessionState.value as AppSessionState.Unauthenticated).alertMessage
                    } else {
                        ErrorMessageMapper.messageFor(meResult)
                    }
                    _sessionState.value = AppSessionState.Unauthenticated(alertMessage = msg)
                } else if (cachedUser != null) {
                    _sessionState.value = AppSessionState.Authenticated(user = cachedUser, isOfflineMode = true)
                } else {
                    _sessionState.value = AppSessionState.Unauthenticated(ErrorMessageMapper.messageFor(meResult))
                }
            }

            is ApiResult.NetworkError -> {
                if (cachedUser != null) {
                    _sessionState.value = AppSessionState.Authenticated(user = cachedUser, isOfflineMode = true)
                } else {
                    _sessionState.value = AppSessionState.Unauthenticated("当前离线且尚无本地账号快照，请联网后登录")
                }
            }
        }
    }

    suspend fun login(email: String, password: String): ApiResult<UserProfile> {
        val deviceName = "${Build.MODEL} / Android ${Build.VERSION.RELEASE}"
        val result = safeApiCall {
            authApi.loginUser(
                LoginRequest(
                    email = email.trim(),
                    password = password,
                    deviceName = deviceName,
                ),
            )
        }
        return handleAuthSuccess(result)
    }

    suspend fun register(
        email: String,
        displayName: String,
        password: String,
        timezone: String = ZoneId.systemDefault().id,
    ): ApiResult<UserProfile> {
        val deviceName = "${Build.MODEL} / Android ${Build.VERSION.RELEASE}"
        val result = safeApiCall {
            authApi.registerUser(
                RegisterRequest(
                    email = email.trim(),
                    displayName = displayName.trim(),
                    password = password,
                    timezone = timezone,
                    deviceName = deviceName,
                ),
            )
        }
        return handleAuthSuccess(result)
    }

    suspend fun refreshProfile(): ApiResult<UserProfile> {
        val result = safeApiCall { authApi.getCurrentUser() }
        if (result is ApiResult.Success) {
            syncPreferencesStore.saveCachedUserJson(ShixuJson.json.encodeToString(result.data))
            _sessionState.value = AppSessionState.Authenticated(user = result.data, isOfflineMode = false)
        }
        return result
    }

    suspend fun updateProfile(
        displayName: String? = null,
        timezone: String? = null,
        themeMode: ThemeMode? = null,
    ): ApiResult<UserProfile> {
        val result = safeApiCall {
            authApi.updateCurrentUser(
                UpdateMeRequest(
                    displayName = displayName?.trim()?.takeIf { it.isNotEmpty() },
                    timezone = timezone?.trim()?.takeIf { it.isNotEmpty() },
                    themeMode = themeMode,
                ),
            )
        }
        if (result is ApiResult.Success) {
            syncPreferencesStore.saveCachedUserJson(ShixuJson.json.encodeToString(result.data))
            _sessionState.value = AppSessionState.Authenticated(user = result.data, isOfflineMode = false)
        }
        return result
    }

    suspend fun logout() {
        val refresh = tokenStore.refreshToken()
        runCatching {
            safeUnitApiCall { authApi.logoutUser(LogoutRequest(refreshToken = refresh)) }
        }
        tokenStore.clear()
        syncPreferencesStore.clearUserScopedData()
        _sessionState.value = AppSessionState.Unauthenticated()
    }

    suspend fun checkHealth(): ApiResult<HealthResponse> = safeApiCall { systemApi.getHealth() }

    fun dismissAlertMessage() {
        val current = _sessionState.value
        if (current is AppSessionState.Unauthenticated && current.alertMessage != null) {
            _sessionState.value = AppSessionState.Unauthenticated(alertMessage = null)
        }
    }

    private suspend fun handleAuthSuccess(result: ApiResult<app.shixu.core.network.generated.models.AuthTokensResponse>): ApiResult<UserProfile> =
        when (result) {
            is ApiResult.Success -> {
                tokenStore.saveTokens(result.data.accessToken, result.data.refreshToken)
                syncPreferencesStore.saveCachedUserJson(ShixuJson.json.encodeToString(result.data.user))
                _sessionState.value = AppSessionState.Authenticated(user = result.data.user, isOfflineMode = false)
                ApiResult.Success(result.data.user)
            }

            is ApiResult.HttpError -> result
            is ApiResult.NetworkError -> result
        }
}
