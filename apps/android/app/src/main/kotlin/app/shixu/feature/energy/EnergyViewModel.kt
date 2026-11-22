package app.shixu.feature.energy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.ble.BleConnectionState
import app.shixu.core.ble.BleHeartRateManager
import app.shixu.core.data.AppSessionState
import app.shixu.core.data.AuthRepository
import app.shixu.core.data.EnergyRepository
import app.shixu.core.datastore.SyncMetadata
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.health.BiometricUploadQueue
import app.shixu.core.health.HealthSyncCoordinator
import app.shixu.core.health.HealthSyncReport
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ReplayScenario
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.ZoneId
import javax.inject.Inject

data class EnergyUiState(
    val energy: EnergyTodayResponse? = null,
    val isOfflineSnapshot: Boolean = false,
    val healthReport: HealthSyncReport? = null,
    val syncMetadata: SyncMetadata = SyncMetadata(),
    val pendingQueueCount: Int = 0,
    val bleState: BleConnectionState = BleConnectionState.Disconnected(),
    val isSyncingHealth: Boolean = false,
    val isSeedingReplay: Boolean = false,
    val userZoneId: ZoneId = ZoneId.systemDefault(),
    val feedbackMessage: String? = null,
    val errorMessage: String? = null,
)

@HiltViewModel
class EnergyViewModel @Inject constructor(
    private val energyRepository: EnergyRepository,
    private val healthSyncCoordinator: HealthSyncCoordinator,
    private val uploadQueue: BiometricUploadQueue,
    private val syncPreferencesStore: SyncPreferencesStore,
    private val bleHeartRateManager: BleHeartRateManager,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val syncingHealth = MutableStateFlow(false)
    private val seedingReplay = MutableStateFlow(false)
    private val feedback = MutableStateFlow<String?>(null)
    private val error = MutableStateFlow<String?>(null)

    val uiState: StateFlow<EnergyUiState> = combine(
        energyRepository.todayEnergy,
        energyRepository.isOfflineSnapshot,
        healthSyncCoordinator.lastSyncReport,
        syncPreferencesStore.metadataFlow,
        uploadQueue.pendingCountFlow,
        bleHeartRateManager.state,
        syncingHealth,
        seedingReplay,
        feedback,
        error,
        authRepository.sessionState,
    ) { values ->
        val energy = values[0] as EnergyTodayResponse?
        val offline = values[1] as Boolean
        val report = values[2] as HealthSyncReport?
        val meta = values[3] as SyncMetadata
        val pending = values[4] as Int
        val ble = values[5] as BleConnectionState
        val isSyncing = values[6] as Boolean
        val isSeeding = values[7] as Boolean
        val msg = values[8] as String?
        val err = values[9] as String?
        val session = values[10]

        val zone = (session as? AppSessionState.Authenticated)
            ?.let { runCatching { ZoneId.of(it.user.timezone) }.getOrNull() }
            ?: ZoneId.systemDefault()

        EnergyUiState(
            energy = energy,
            isOfflineSnapshot = offline,
            healthReport = report,
            syncMetadata = meta,
            pendingQueueCount = pending,
            bleState = ble,
            isSyncingHealth = isSyncing,
            isSeedingReplay = isSeeding,
            userZoneId = zone,
            feedbackMessage = msg,
            errorMessage = err,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = EnergyUiState(),
    )

    init {
        viewModelScope.launch {
            healthSyncCoordinator.refreshStatusOnly()
        }
    }

    fun refreshEnergy() {
        viewModelScope.launch {
            error.value = null
            when (val res = energyRepository.fetchTodayEnergy()) {
                is ApiResult.HttpError -> error.value = ErrorMessageMapper.messageFor(res)
                is ApiResult.NetworkError -> error.value = ErrorMessageMapper.messageFor(res)
                is ApiResult.Success -> Unit
            }
            healthSyncCoordinator.refreshStatusOnly()
        }
    }

    fun onHealthPermissionsResult() {
        viewModelScope.launch {
            healthSyncCoordinator.onPermissionsUpdated()
            syncHealthConnectNow()
        }
    }

    fun syncHealthConnectNow() {
        viewModelScope.launch {
            syncingHealth.value = true
            error.value = null
            val report = healthSyncCoordinator.syncNow()
            feedback.value = report.summary
            energyRepository.fetchTodayEnergy()
            syncingHealth.value = false
        }
    }

    fun requiredBlePermissions(): Array<String> = bleHeartRateManager.requiredRuntimePermissions()

    fun hasBlePermissions(): Boolean = bleHeartRateManager.hasPermissions()

    fun startBleScan() {
        bleHeartRateManager.startScan()
    }

    fun stopBleScan() {
        bleHeartRateManager.stopScan()
    }

    fun connectBleDevice(address: String) {
        bleHeartRateManager.connectTo(address)
    }

    fun disconnectBleDevice() {
        bleHeartRateManager.disconnect()
    }

    fun seedReplayScenario(scenario: ReplayScenario) {
        viewModelScope.launch {
            seedingReplay.value = true
            error.value = null
            when (val res = energyRepository.seedReplay(scenario)) {
                is ApiResult.Success -> {
                    feedback.value = "已注入回放测试样本（${scenario.value} · ${res.data.seededCount} 条），顶部徽标已切换为「回放测试源」"
                }

                is ApiResult.HttpError -> error.value = ErrorMessageMapper.messageFor(res)
                is ApiResult.NetworkError -> error.value = ErrorMessageMapper.messageFor(res)
            }
            seedingReplay.value = false
        }
    }

    fun clearFeedback() {
        feedback.value = null
        error.value = null
    }
}
