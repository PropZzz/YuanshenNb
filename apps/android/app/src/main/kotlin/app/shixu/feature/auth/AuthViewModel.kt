package app.shixu.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.BuildConfig
import app.shixu.core.data.AuthRepository
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.generated.models.ErrorCode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.ZoneId
import javax.inject.Inject

data class AuthUiState(
    val isRegisterMode: Boolean = false,
    val email: String = "",
    val displayName: String = "",
    val password: String = "",
    val timezone: String = ZoneId.systemDefault().id,
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    val emailError: String? = null,
    val displayNameError: String? = null,
    val passwordError: String? = null,
    val isCheckingHealth: Boolean = false,
    val healthCheckMessage: String? = null,
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun toggleMode(registerMode: Boolean) {
        _uiState.update {
            it.copy(
                isRegisterMode = registerMode,
                errorMessage = null,
                emailError = null,
                displayNameError = null,
                passwordError = null,
            )
        }
    }

    fun updateEmail(value: String) {
        _uiState.update { it.copy(email = value, emailError = null, errorMessage = null) }
    }

    fun updateDisplayName(value: String) {
        _uiState.update { it.copy(displayName = value, displayNameError = null, errorMessage = null) }
    }

    fun updatePassword(value: String) {
        _uiState.update { it.copy(password = value, passwordError = null, errorMessage = null) }
    }

    fun updateTimezone(value: String) {
        _uiState.update { it.copy(timezone = value, errorMessage = null) }
    }

    fun submit() {
        val current = _uiState.value
        val trimmedEmail = current.email.trim()
        val emailErr = when {
            trimmedEmail.isEmpty() -> "请输入邮箱"
            !trimmedEmail.contains("@") || !trimmedEmail.contains(".") -> "邮箱格式不正确"
            else -> null
        }
        val nameErr = if (current.isRegisterMode && current.displayName.trim().isEmpty()) {
            "请输入显示昵称"
        } else {
            null
        }
        val pwdErr = if (current.password.length < 8) {
            "密码长度至少需要 8 位"
        } else {
            null
        }

        if (emailErr != null || nameErr != null || pwdErr != null) {
            _uiState.update {
                it.copy(
                    emailError = emailErr,
                    displayNameError = nameErr,
                    passwordError = pwdErr,
                )
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            val result = if (current.isRegisterMode) {
                authRepository.register(
                    email = trimmedEmail,
                    displayName = current.displayName.trim(),
                    password = current.password,
                    timezone = current.timezone.trim().ifEmpty { ZoneId.systemDefault().id },
                )
            } else {
                authRepository.login(email = trimmedEmail, password = current.password)
            }

            when (result) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = null) }
                }

                is ApiResult.HttpError -> {
                    val code = result.problem?.code
                    val msg = ErrorMessageMapper.messageFor(result)
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            errorMessage = msg,
                            emailError = if (code == ErrorCode.EMAIL_ALREADY_EXISTS) msg else it.emailError,
                        )
                    }
                }

                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            errorMessage = "${ErrorMessageMapper.messageFor(result)}（目标：${BuildConfig.API_BASE_URL}）",
                        )
                    }
                }
            }
        }
    }

    fun probeHealth() {
        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingHealth = true, healthCheckMessage = null) }
            when (val res = authRepository.checkHealth()) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isCheckingHealth = false,
                            healthCheckMessage = "服务端连通正常 · v${res.data.version} · DB ${res.data.dbStatus.value}",
                        )
                    }
                }

                is ApiResult.HttpError -> {
                    _uiState.update {
                        it.copy(
                            isCheckingHealth = false,
                            healthCheckMessage = "探针异常：${ErrorMessageMapper.messageFor(res)}",
                        )
                    }
                }

                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isCheckingHealth = false,
                            healthCheckMessage = "无法连接 ${BuildConfig.API_BASE_URL}（${res.cause.localizedMessage ?: "网络不可达"}）",
                        )
                    }
                }
            }
        }
    }
}
