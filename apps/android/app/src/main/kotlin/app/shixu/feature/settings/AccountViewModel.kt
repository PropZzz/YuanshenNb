package app.shixu.feature.settings

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.network.*
import app.shixu.core.network.generated.models.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.ZoneId

class AccountViewModel(private val api: ClientServices, private val onSession: (UserProfile?) -> Unit) : ViewModel() {
    var user by mutableStateOf<UserProfile?>(null); private set
    var profile by mutableStateOf<EnergyProfileDTO?>(null); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var bootstrapped by mutableStateOf(false); private set
    init { bootstrap() }
    fun bootstrap() = action {
        try {
            if (api.tokens.refreshToken() != null) {
                user = api.auth.getCurrentUser().requireBody()
                onSession(user)
                profile = api.energy.getEnergyProfile().requireBody()
            }
        } finally { bootstrapped = true }
    }
    fun authenticate(email: String, password: String, displayName: String?) = action {
        require(email.isNotBlank() && password.length >= 8) { "请输入有效邮箱和至少 8 位密码" }
        val tokens = if (displayName == null) api.auth.loginUser(LoginRequest(email.trim(), password, "Android")).requireBody()
        else api.auth.registerUser(RegisterRequest(displayName.trim().also { require(it.isNotBlank()) { "请填写昵称" } }, email.trim(), password, "Android", ZoneId.systemDefault().id)).requireBody()
        api.tokens.saveTokens(tokens.accessToken, tokens.refreshToken)
        user = tokens.user
        onSession(user)
        profile = api.energy.getEnergyProfile().requireBody()
    }
    fun updateAccount(name: String, timezone: String, theme: ThemeMode) = action {
        ZoneId.of(timezone)
        user = api.auth.updateCurrentUser(UpdateMeRequest(displayName = name.trim(), timezone = timezone, themeMode = theme)).requireBody()
        onSession(user)
    }
    fun updateEnergy(request: UpdateEnergyProfileRequest) = action { profile = api.energy.updateEnergyProfile(request).requireBody() }
    fun logout() = action {
        api.auth.logoutUser(LogoutRequest(refreshToken = api.tokens.refreshToken())).requireSuccess()
        api.tokens.clear(); user = null; profile = null; onSession(null)
    }
    fun forgetLocalSession() { api.tokens.clear(); user = null; profile = null; error = null; bootstrapped = true; onSession(null) }
    private fun action(block: suspend () -> Unit) {
        if (busy) return
        viewModelScope.launch {
            busy = true; error = null
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (e is ApiFailure && e.status == 401) { api.tokens.clear(); user = null; onSession(null) }
                error = e.userMessage()
            } finally { busy = false }
        }
    }
}
