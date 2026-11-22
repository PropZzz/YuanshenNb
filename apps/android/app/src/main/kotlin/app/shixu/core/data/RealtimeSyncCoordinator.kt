package app.shixu.core.data

import app.shixu.core.ble.BleHeartRateManager
import app.shixu.core.health.BiometricUploadQueue
import app.shixu.core.health.HealthSyncCoordinator
import app.shixu.core.health.HealthSyncScheduler
import app.shixu.core.network.ShixuWebSocketManager
import app.shixu.core.network.WsEvent
import app.shixu.core.network.generated.models.WsEnergyOverloadAlertPayload
import app.shixu.core.notifications.ShixuNotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 全局实时协调器：
 * - 响应会话状态自动启停 WebSocket、15 分钟 Health Connect 周期 Worker、BLE 穿戴与本地闹钟；
 * - 消费 7 类 WS 实时事件并驱动精力、Room 日程快照、AlarmManager 闹钟与团队工作区同步对齐。
 */
@Singleton
class RealtimeSyncCoordinator @Inject constructor(
    private val authRepository: AuthRepository,
    private val energyRepository: EnergyRepository,
    private val scheduleRepository: ScheduleRepository,
    private val workspaceRepository: WorkspaceRepository,
    private val wsManager: ShixuWebSocketManager,
    private val healthSyncCoordinator: HealthSyncCoordinator,
    private val healthSyncScheduler: HealthSyncScheduler,
    private val biometricUploadQueue: BiometricUploadQueue,
    private val bleHeartRateManager: BleHeartRateManager,
    private val notificationHelper: ShixuNotificationHelper,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _activeOverloadBanner = MutableStateFlow<WsEnergyOverloadAlertPayload?>(null)
    val activeOverloadBanner: StateFlow<WsEnergyOverloadAlertPayload?> = _activeOverloadBanner.asStateFlow()

    @Volatile
    private var bound = false
    private var foregroundSyncJob: Job? = null

    @Synchronized
    fun startObserving() {
        if (bound) return
        bound = true

        scope.launch {
            authRepository.sessionState.collect { session ->
                when (session) {
                    is AppSessionState.Authenticated -> onAuthenticated()
                    is AppSessionState.Unauthenticated -> onUnauthenticated()
                    AppSessionState.Bootstrapping -> Unit
                }
            }
        }

        scope.launch {
            wsManager.connectedSignal.collect {
                // WS 每次重连成功后立即对齐最新精力电量、今日日程基线与本地提醒闹钟
                energyRepository.fetchTodayEnergy()
                scheduleRepository.refreshRollingWindow()
            }
        }

        scope.launch {
            wsManager.events.collect { event ->
                handleWsEvent(event)
            }
        }

        scope.launch {
            healthSyncCoordinator.latestSyncedEnergy.collect { energy ->
                energyRepository.acceptSyncedEnergy(energy)
            }
        }

        scope.launch {
            bleHeartRateManager.latestEnergyFromBle.collect { energy ->
                energyRepository.acceptSyncedEnergy(energy)
            }
        }
    }

    fun onAppForegrounded() {
        if (authRepository.sessionState.value !is AppSessionState.Authenticated) return
        wsManager.ensureConnected()
        if (foregroundSyncJob?.isActive == true) return
        foregroundSyncJob = scope.launch {
            healthSyncCoordinator.syncNow()
            energyRepository.fetchTodayEnergy()
            scheduleRepository.refreshRollingWindow()
        }
    }

    fun dismissOverloadBanner() {
        _activeOverloadBanner.value = null
    }

    private suspend fun onAuthenticated() {
        energyRepository.hydrateFromCache()
        scheduleRepository.hydrateBaselineFromPrefs()
        wsManager.start()
        healthSyncScheduler.schedulePeriodicSync()
        healthSyncScheduler.triggerImmediateSync()
        energyRepository.fetchTodayEnergy()
        energyRepository.fetchEnergyProfile()
        scheduleRepository.refreshRollingWindow()
    }

    private suspend fun onUnauthenticated() {
        wsManager.stop()
        healthSyncScheduler.cancelAll()
        bleHeartRateManager.disconnect()
        biometricUploadQueue.clear()
        scheduleRepository.clearCache()
        energyRepository.clear()
        _activeOverloadBanner.value = null
    }

    private suspend fun handleWsEvent(event: WsEvent) {
        when (event) {
            is WsEvent.EnergyUpdated -> {
                energyRepository.fetchTodayEnergy()
            }

            is WsEvent.EnergyOverloadAlert -> {
                _activeOverloadBanner.value = event.payload
                notificationHelper.showOverloadAlert(event.payload)
                energyRepository.fetchTodayEnergy()
            }

            is WsEvent.ScheduleUpdated -> {
                scheduleRepository.refreshRollingWindow()
            }

            is WsEvent.WorkspaceMeetingConfirmed -> {
                scheduleRepository.refreshRollingWindow()
                notificationHelper.showMeetingConfirmed(event.payload)
                workspaceRepository.notifyWorkspaceChanged(event.payload.workspaceId)
            }

            is WsEvent.WorkspaceMeetingCancelled -> {
                scheduleRepository.refreshRollingWindow()
                notificationHelper.showMeetingCancelled(event.payload)
                workspaceRepository.notifyWorkspaceChanged(event.payload.workspaceId)
            }

            is WsEvent.WorkspaceMeetingResponded -> {
                workspaceRepository.notifyWorkspaceChanged(event.payload.workspaceId)
            }

            is WsEvent.AvailabilityChanged -> {
                workspaceRepository.notifyWorkspaceChanged(event.payload.workspaceId)
            }
        }
    }
}
