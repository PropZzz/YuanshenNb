package app.shixu.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.data.AppSessionState
import app.shixu.core.data.AuthRepository
import app.shixu.core.data.EnergyRepository
import app.shixu.core.data.WorkspaceRepository
import app.shixu.core.datastore.SyncMetadata
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.health.BiometricFlushResult
import app.shixu.core.health.BiometricUploadQueue
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.ShixuWebSocketManager
import app.shixu.core.network.WsConnectionState
import app.shixu.core.network.generated.models.Chronotype
import app.shixu.core.network.generated.models.DailyMinuteWindow
import app.shixu.core.network.generated.models.EnergyProfileDTO
import app.shixu.core.network.generated.models.PrivacyLevel
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.network.generated.models.UpdateEnergyProfileRequest
import app.shixu.core.network.generated.models.UserProfile
import app.shixu.core.network.generated.models.WorkspaceDTO
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class SettingsDraftState(
    val displayName: String = "",
    val timezone: String = "Asia/Shanghai",
    val themeMode: ThemeMode = ThemeMode.system,
    val workStartMinute: Long = 540L,
    val workEndMinute: Long = 1080L,
    val chronotype: Chronotype = Chronotype.balanced,
    val minRecoveryBufferMin: Long = 15L,
    val preferredFocusWindows: List<DailyMinuteWindow> = emptyList(),
    val isSavingProfile: Boolean = false,
    val isSavingEnergyProfile: Boolean = false,
    val isFlushingQueue: Boolean = false,
    val healthProbeResult: String? = null,
    val feedbackMessage: String? = null,
    val errorMessage: String? = null,
    val initializedFromServer: Boolean = false,
)

data class SettingsUiState(
    val user: UserProfile? = null,
    val energyProfile: EnergyProfileDTO? = null,
    val workspaces: List<WorkspaceDTO> = emptyList(),
    val syncMetadata: SyncMetadata = SyncMetadata(),
    val pendingQueueCount: Int = 0,
    val wsState: WsConnectionState = WsConnectionState.Disconnected,
    val draft: SettingsDraftState = SettingsDraftState(),
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val energyRepository: EnergyRepository,
    private val workspaceRepository: WorkspaceRepository,
    private val syncPreferencesStore: SyncPreferencesStore,
    private val uploadQueue: BiometricUploadQueue,
    private val wsManager: ShixuWebSocketManager,
) : ViewModel() {

    private val workspacesFlow = MutableStateFlow<List<WorkspaceDTO>>(emptyList())
    private val draftFlow = MutableStateFlow(SettingsDraftState())

    val uiState: StateFlow<SettingsUiState> = combine(
        authRepository.sessionState,
        energyRepository.energyProfile,
        workspacesFlow,
        syncPreferencesStore.metadataFlow,
        uploadQueue.pendingCountFlow,
        wsManager.connectionState,
        draftFlow,
    ) { values ->
        val session = values[0]
        val energyProfile = values[1] as EnergyProfileDTO?
        @Suppress("UNCHECKED_CAST")
        val workspaces = values[2] as List<WorkspaceDTO>
        val meta = values[3] as SyncMetadata
        val pendingCount = values[4] as Int
        val ws = values[5] as WsConnectionState
        val draft = values[6] as SettingsDraftState

        val user = (session as? AppSessionState.Authenticated)?.user
        SettingsUiState(
            user = user,
            energyProfile = energyProfile,
            workspaces = workspaces,
            syncMetadata = meta,
            pendingQueueCount = pendingCount,
            wsState = ws,
            draft = draft,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = SettingsUiState(),
    )

    init {
        viewModelScope.launch {
            authRepository.sessionState.collect { session ->
                if (session is AppSessionState.Authenticated) {
                    draftFlow.update { d ->
                        if (!d.initializedFromServer) {
                            d.copy(
                                displayName = session.user.displayName,
                                timezone = session.user.timezone,
                                themeMode = session.user.themeMode,
                                initializedFromServer = true,
                            )
                        } else {
                            d.copy(themeMode = session.user.themeMode)
                        }
                    }
                    refreshAllSettings()
                } else if (session is AppSessionState.Unauthenticated) {
                    workspacesFlow.value = emptyList()
                    draftFlow.value = SettingsDraftState()
                }
            }
        }

        viewModelScope.launch {
            energyRepository.energyProfile.collect { ep ->
                if (ep != null) {
                    draftFlow.update { d ->
                        d.copy(
                            workStartMinute = ep.workStartMinute,
                            workEndMinute = ep.workEndMinute,
                            chronotype = ep.chronotype,
                            minRecoveryBufferMin = ep.minRecoveryBufferMin,
                            preferredFocusWindows = ep.preferredFocusWindows,
                        )
                    }
                }
            }
        }
    }

    fun refreshAllSettings() {
        viewModelScope.launch {
            energyRepository.fetchEnergyProfile()
            val wsRes = workspaceRepository.listWorkspaces()
            if (wsRes is ApiResult.Success) {
                workspacesFlow.value = wsRes.data.workspaces
            }
        }
    }

    fun updateDraft(transform: (SettingsDraftState) -> SettingsDraftState) {
        draftFlow.update(transform)
    }

    fun selectThemeMode(mode: ThemeMode) {
        draftFlow.update { it.copy(themeMode = mode, errorMessage = null, feedbackMessage = null) }
        viewModelScope.launch {
            when (val res = authRepository.updateProfile(themeMode = mode)) {
                is ApiResult.Success -> draftFlow.update { it.copy(feedbackMessage = "主题外观已保存并同步") }
                is ApiResult.HttpError -> draftFlow.update { it.copy(errorMessage = ErrorMessageMapper.messageFor(res)) }
                is ApiResult.NetworkError -> draftFlow.update { it.copy(errorMessage = ErrorMessageMapper.messageFor(res)) }
            }
        }
    }

    fun saveUserProfile() {
        val d = draftFlow.value
        if (d.displayName.trim().isEmpty()) {
            draftFlow.update { it.copy(errorMessage = "昵称不能为空") }
            return
        }
        viewModelScope.launch {
            draftFlow.update { it.copy(isSavingProfile = true, errorMessage = null, feedbackMessage = null) }
            when (val res = authRepository.updateProfile(displayName = d.displayName, timezone = d.timezone, themeMode = d.themeMode)) {
                is ApiResult.Success -> {
                    draftFlow.update { it.copy(isSavingProfile = false, feedbackMessage = "个人档案与时区已保存") }
                    energyRepository.fetchTodayEnergy()
                }

                is ApiResult.HttpError -> {
                    draftFlow.update { it.copy(isSavingProfile = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    draftFlow.update { it.copy(isSavingProfile = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun saveEnergyProfile() {
        val d = draftFlow.value
        viewModelScope.launch {
            draftFlow.update { it.copy(isSavingEnergyProfile = true, errorMessage = null, feedbackMessage = null) }
            val req = UpdateEnergyProfileRequest(
                workStartMinute = d.workStartMinute,
                workEndMinute = d.workEndMinute,
                chronotype = d.chronotype,
                preferredFocusWindows = d.preferredFocusWindows,
                minRecoveryBufferMin = d.minRecoveryBufferMin,
            )
            when (val res = energyRepository.updateEnergyProfile(req)) {
                is ApiResult.Success -> {
                    draftFlow.update { it.copy(isSavingEnergyProfile = false, feedbackMessage = "昼夜节律与工作时间窗已更新，当日曲线已重算") }
                }

                is ApiResult.HttpError -> {
                    draftFlow.update { it.copy(isSavingEnergyProfile = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    draftFlow.update { it.copy(isSavingEnergyProfile = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun addDefaultFocusWindow() {
        draftFlow.update { d ->
            val next = d.preferredFocusWindows + DailyMinuteWindow(startMinute = 540L, endMinute = 720L)
            d.copy(preferredFocusWindows = next)
        }
    }

    fun removeFocusWindowAt(index: Int) {
        draftFlow.update { d ->
            val next = d.preferredFocusWindows.filterIndexed { i, _ -> i != index }
            d.copy(preferredFocusWindows = next)
        }
    }

    fun updateWorkspacePrivacy(workspaceId: UUID, level: PrivacyLevel) {
        viewModelScope.launch {
            draftFlow.update { it.copy(errorMessage = null, feedbackMessage = null) }
            when (val res = workspaceRepository.updateMyPrivacy(workspaceId, level)) {
                is ApiResult.Success -> {
                    draftFlow.update { it.copy(feedbackMessage = "已更新团队隐私投影级别") }
                    refreshAllSettings()
                }

                is ApiResult.HttpError -> {
                    draftFlow.update { it.copy(errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    draftFlow.update { it.copy(errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun probeHealth() {
        viewModelScope.launch {
            when (val res = authRepository.checkHealth()) {
                is ApiResult.Success -> {
                    draftFlow.update {
                        it.copy(healthProbeResult = "正常 · v${res.data.version} · DB ${res.data.dbStatus.value}")
                    }
                }

                is ApiResult.HttpError -> {
                    draftFlow.update { it.copy(healthProbeResult = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    draftFlow.update { it.copy(healthProbeResult = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun flushPendingBiometrics() {
        viewModelScope.launch {
            draftFlow.update { it.copy(isFlushingQueue = true, errorMessage = null, feedbackMessage = null) }
            val result = uploadQueue.flushPending()
            val msg = when (result) {
                BiometricFlushResult.Empty -> "本地 Room 生理队列为空，无需补传"
                BiometricFlushResult.Unauthenticated -> "当前未登录，无法补传"
                is BiometricFlushResult.Success -> {
                    result.latestEnergy?.let { energyRepository.acceptSyncedEnergy(it) }
                    "补传完成：入库 ${result.acceptedCount} 条，幂等去重 ${result.deduplicatedCount} 条"
                }

                is BiometricFlushResult.RetryableFailure -> "补传暂缓：${result.reason}"
            }
            draftFlow.update { it.copy(isFlushingQueue = false, feedbackMessage = msg) }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }

    fun clearMessages() {
        draftFlow.update { it.copy(feedbackMessage = null, errorMessage = null) }
    }
}
