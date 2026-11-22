package app.shixu.feature.focus

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.data.AppSessionState
import app.shixu.core.data.AuthRepository
import app.shixu.core.data.EnergyRepository
import app.shixu.core.data.ScheduleRepository
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.ShixuWebSocketManager
import app.shixu.core.network.WsConnectionState
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleStatus
import app.shixu.core.network.generated.models.UpdateScheduleItemRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject

enum class FocusTimerMode {
    POMODORO,
    FLOW,
}

data class FocusTimerState(
    val mode: FocusTimerMode = FocusTimerMode.POMODORO,
    val presetMinutes: Int = 25,
    val isRunning: Boolean = false,
    val startedAtEpochMs: Long? = null,
    val deadlineAtEpochMs: Long? = null,
    val pausedSeconds: Long = 25 * 60L,
    val displaySeconds: Long = 25 * 60L,
    val progress: Float = 0f,
    val selectedTaskId: UUID? = null,
)

data class FocusUiState(
    val energy: EnergyTodayResponse? = null,
    val isOfflineEnergy: Boolean = false,
    val isOfflineSchedule: Boolean = false,
    val wsState: WsConnectionState = WsConnectionState.Disconnected,
    val todayItems: List<ScheduleItemDTO> = emptyList(),
    val timer: FocusTimerState = FocusTimerState(),
    val isMutatingTask: Boolean = false,
    val feedbackMessage: String? = null,
    val userZoneId: ZoneId = ZoneId.systemDefault(),
)

@HiltViewModel
class FocusViewModel @Inject constructor(
    private val energyRepository: EnergyRepository,
    private val scheduleRepository: ScheduleRepository,
    private val authRepository: AuthRepository,
    private val wsManager: ShixuWebSocketManager,
    private val clock: () -> Instant,
) : ViewModel() {

    private val timerInternal = MutableStateFlow(FocusTimerState())
    private val mutationBusy = MutableStateFlow(false)
    private val feedback = MutableStateFlow<String?>(null)

    val uiState: StateFlow<FocusUiState> = combine(
        energyRepository.todayEnergy,
        energyRepository.isOfflineSnapshot,
        scheduleRepository.observeCachedItems(),
        scheduleRepository.isOfflineReadOnly,
        wsManager.connectionState,
        timerInternal,
        mutationBusy,
        feedback,
        authRepository.sessionState,
    ) { values ->
        val energy = values[0] as EnergyTodayResponse?
        val offlineEnergy = values[1] as Boolean
        @Suppress("UNCHECKED_CAST")
        val allItems = values[2] as List<ScheduleItemDTO>
        val offlineSchedule = values[3] as Boolean
        val wsState = values[4] as WsConnectionState
        val timer = values[5] as FocusTimerState
        val mutating = values[6] as Boolean
        val msg = values[7] as String?
        val session = values[8]

        val zone = (session as? AppSessionState.Authenticated)
            ?.let { runCatching { ZoneId.of(it.user.timezone) }.getOrNull() }
            ?: ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val todayItems = allItems
            .filter { item ->
                val itemDate = item.startAt.atZoneSameInstant(zone).toLocalDate()
                itemDate == today && item.status != ScheduleStatus.cancelled
            }
            .sortedBy { it.startAt }

        FocusUiState(
            energy = energy,
            isOfflineEnergy = offlineEnergy,
            isOfflineSchedule = offlineSchedule,
            wsState = wsState,
            todayItems = todayItems,
            timer = timer,
            isMutatingTask = mutating,
            feedbackMessage = msg,
            userZoneId = zone,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = FocusUiState(),
    )

    init {
        viewModelScope.launch {
            while (isActive) {
                val t = timerInternal.value
                if (t.isRunning) {
                    val nowMs = clock().toEpochMilli()
                    when (t.mode) {
                        FocusTimerMode.POMODORO -> {
                            val totalSec = (t.presetMinutes * 60L).coerceAtLeast(1L)
                            val deadline = t.deadlineAtEpochMs ?: nowMs
                            val remainingSec = ((deadline - nowMs) / 1000L).coerceAtLeast(0L)
                            val elapsedRatio = ((totalSec - remainingSec).toFloat() / totalSec.toFloat()).coerceIn(0f, 1f)
                            if (remainingSec == 0L) {
                                timerInternal.update {
                                    it.copy(
                                        isRunning = false,
                                        deadlineAtEpochMs = null,
                                        pausedSeconds = totalSec,
                                        displaySeconds = 0L,
                                        progress = 1f,
                                    )
                                }
                                feedback.value = "专注计时完成，建议进入恢复缓冲并记录状态"
                            } else {
                                timerInternal.update {
                                    it.copy(displaySeconds = remainingSec, progress = elapsedRatio)
                                }
                            }
                        }

                        FocusTimerMode.FLOW -> {
                            val startMs = t.startedAtEpochMs ?: nowMs
                            val elapsedSec = ((nowMs - startMs) / 1000L).coerceAtLeast(0L)
                            val ratio = ((elapsedSec % 3600L) / 3600f).coerceIn(0f, 1f)
                            timerInternal.update {
                                it.copy(displaySeconds = elapsedSec, progress = ratio)
                            }
                        }
                    }
                }
                delay(1_000L)
            }
        }
    }

    fun selectMode(mode: FocusTimerMode) {
        val defaultSec = if (mode == FocusTimerMode.POMODORO) timerInternal.value.presetMinutes * 60L else 0L
        timerInternal.update {
            it.copy(
                mode = mode,
                isRunning = false,
                startedAtEpochMs = null,
                deadlineAtEpochMs = null,
                pausedSeconds = defaultSec,
                displaySeconds = defaultSec,
                progress = 0f,
            )
        }
    }

    fun selectPresetMinutes(minutes: Int) {
        val sec = minutes * 60L
        timerInternal.update {
            it.copy(
                mode = FocusTimerMode.POMODORO,
                presetMinutes = minutes,
                isRunning = false,
                startedAtEpochMs = null,
                deadlineAtEpochMs = null,
                pausedSeconds = sec,
                displaySeconds = sec,
                progress = 0f,
            )
        }
    }

    fun toggleStartPause() {
        val nowMs = clock().toEpochMilli()
        timerInternal.update { t ->
            if (t.isRunning) {
                when (t.mode) {
                    FocusTimerMode.POMODORO -> {
                        val rem = ((t.deadlineAtEpochMs ?: nowMs) - nowMs).div(1000L).coerceAtLeast(0L)
                        t.copy(isRunning = false, pausedSeconds = rem, displaySeconds = rem, deadlineAtEpochMs = null)
                    }

                    FocusTimerMode.FLOW -> {
                        val elapsed = ((nowMs - (t.startedAtEpochMs ?: nowMs)) / 1000L).coerceAtLeast(0L)
                        t.copy(isRunning = false, pausedSeconds = elapsed, displaySeconds = elapsed, startedAtEpochMs = null)
                    }
                }
            } else {
                when (t.mode) {
                    FocusTimerMode.POMODORO -> {
                        val baseSec = if (t.displaySeconds > 0L) t.displaySeconds else t.presetMinutes * 60L
                        t.copy(
                            isRunning = true,
                            startedAtEpochMs = nowMs,
                            deadlineAtEpochMs = nowMs + baseSec * 1000L,
                            displaySeconds = baseSec,
                        )
                    }

                    FocusTimerMode.FLOW -> {
                        val alreadyElapsed = t.pausedSeconds
                        t.copy(
                            isRunning = true,
                            startedAtEpochMs = nowMs - alreadyElapsed * 1000L,
                            deadlineAtEpochMs = null,
                        )
                    }
                }
            }
        }
    }

    fun resetTimer() {
        timerInternal.update { t ->
            val resetSec = if (t.mode == FocusTimerMode.POMODORO) t.presetMinutes * 60L else 0L
            t.copy(
                isRunning = false,
                startedAtEpochMs = null,
                deadlineAtEpochMs = null,
                pausedSeconds = resetSec,
                displaySeconds = resetSec,
                progress = 0f,
            )
        }
    }

    fun selectTask(taskId: UUID?) {
        timerInternal.update { it.copy(selectedTaskId = taskId) }
    }

    fun updateTaskStatus(item: ScheduleItemDTO, targetStatus: ScheduleStatus) {
        viewModelScope.launch {
            mutationBusy.value = true
            feedback.value = null
            when (val res = scheduleRepository.updateItem(item.id, UpdateScheduleItemRequest(status = targetStatus))) {
                is ApiResult.Success -> {
                    feedback.value = when (targetStatus) {
                        ScheduleStatus.in_progress -> "已进入专注执行：${item.title}"
                        ScheduleStatus.completed -> "已完成：${item.title}"
                        else -> "已更新日程状态"
                    }
                }

                is ApiResult.HttpError -> feedback.value = ErrorMessageMapper.messageFor(res)
                is ApiResult.NetworkError -> feedback.value = ErrorMessageMapper.messageFor(res)
            }
            mutationBusy.value = false
        }
    }

    fun refreshAll() {
        viewModelScope.launch {
            energyRepository.fetchTodayEnergy()
            scheduleRepository.refreshRollingWindow(uiState.value.userZoneId)
        }
    }

    fun clearFeedback() {
        feedback.value = null
    }
}
