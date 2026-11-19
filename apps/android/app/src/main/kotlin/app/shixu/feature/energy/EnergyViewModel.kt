package app.shixu.feature.energy

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.health.HealthSync
import app.shixu.core.network.*
import app.shixu.core.network.generated.models.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

class EnergyViewModel(private val api: ClientServices, private val health: HealthSync) : ViewModel() {
    var energy by mutableStateOf<EnergyTodayResponse?>(null); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var missing by mutableStateOf<Set<String>>(emptySet()); private set
    var syncNotice by mutableStateOf<String?>(null); private set
    var backgroundReadGranted by mutableStateOf(false); private set
    val backgroundReadSupported get() = health.backgroundReadSupported
    val healthAvailable get() = health.sdkStatus == androidx.health.connect.client.HealthConnectClient.SDK_AVAILABLE
    init { load() }
    fun load() = action { refresh() }
    private suspend fun refresh() { energy = api.energy.getTodayEnergy().requireBody(); missing = health.missingPermissions(); backgroundReadGranted = health.backgroundReadGranted() }
    fun sync() = action { health.sync(); refresh(); syncNotice = "同步完成，已刷新服务端精力状态" }
    fun replay(scenario: ReplayScenario) = action {
        api.biometrics.seedBiometricReplay(ReplaySeedRequest(scenario, energy?.localDay ?: LocalDate.now())).requireBody()
        refresh(); syncNotice = "已加载 replay_demo 回放测试源"
    }
    fun refreshPermissions() = action { missing = health.missingPermissions(); backgroundReadGranted = health.backgroundReadGranted() }
    private fun action(block: suspend () -> Unit) {
        if (busy) return
        viewModelScope.launch {
            busy = true; error = null; syncNotice = null
            try { block() } catch (e: CancellationException) { throw e } catch (_: SecurityException) { missing = HealthSync.PERMISSIONS; error = "健康读取权限已撤销，请重新授权后同步。" } catch (e: Exception) { error = e.userMessage() } finally { busy = false }
        }
    }
}
