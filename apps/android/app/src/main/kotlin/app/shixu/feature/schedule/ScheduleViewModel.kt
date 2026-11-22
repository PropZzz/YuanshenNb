package app.shixu.feature.schedule

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.data.AppSessionState
import app.shixu.core.data.AuthRepository
import app.shixu.core.data.EnergyRepository
import app.shixu.core.data.ScheduleRepository
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.CreateScheduleItemRequest
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ErrorCode
import app.shixu.core.network.generated.models.Flexibility
import app.shixu.core.network.generated.models.RescueOptionPlan
import app.shixu.core.network.generated.models.RescueSnapshotRecord
import app.shixu.core.network.generated.models.RescueStrategy
import app.shixu.core.network.generated.models.RescueTriggerReason
import app.shixu.core.network.generated.models.ScheduleCategory
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleStatus
import app.shixu.core.network.generated.models.UpdateScheduleItemRequest
import app.shixu.core.network.generated.models.UrgentTaskDTO
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject

data class ScheduleEditorState(
    val editingItem: ScheduleItemDTO? = null,
    val title: String = "",
    val notes: String = "",
    val category: ScheduleCategory = ScheduleCategory.deep_work,
    val cognitiveLoad: CognitiveLoad = CognitiveLoad.high,
    val flexibility: Flexibility = Flexibility.flexible,
    val status: ScheduleStatus = ScheduleStatus.planned,
    val startMinuteOfDay: Int = 9 * 60,
    val durationMinutes: Int = 60,
    val reminderMinutes: Int = 10,
    val hasDeadline: Boolean = false,
    val deadlineMinuteOfDay: Int = 18 * 60,
    val overlapConflictDetail: String? = null,
    val errorMessage: String? = null,
    val isSaving: Boolean = false,
) {
    val isTeamManagedMeeting: Boolean
        get() = editingItem?.meetingProposalId != null
}

data class RescueSheetState(
    val isOpen: Boolean = false,
    val showHistoryTab: Boolean = false,
    val triggerReason: RescueTriggerReason = RescueTriggerReason.urgent_task,
    val urgentTitle: String = "",
    val urgentNotes: String = "",
    val urgentDurationMinutes: Int = 60,
    val urgentCognitiveLoad: CognitiveLoad = CognitiveLoad.high,
    val urgentDeadlineMinuteOfDay: Int = 20 * 60,
    val urgentDeadlineDayOffset: Int = 0,
    val isPreviewLoading: Boolean = false,
    val isApplying: Boolean = false,
    val previewBaselineVersion: String? = null,
    val options: List<RescueOptionPlan> = emptyList(),
    val selectedStrategy: RescueStrategy = RescueStrategy.protect_recovery,
    val historyLoading: Boolean = false,
    val historySnapshots: List<RescueSnapshotRecord> = emptyList(),
    val undoingSnapshotId: UUID? = null,
    val errorMessage: String? = null,
    val successMessage: String? = null,
)

data class CalendarUiState(
    val selectedDay: LocalDate = LocalDate.now(),
    val showEnergyOverlay: Boolean = true,
    val dayItems: List<ScheduleItemDTO> = emptyList(),
    val energy: EnergyTodayResponse? = null,
    val isLoading: Boolean = false,
    val isOfflineReadOnly: Boolean = false,
    val baselineVersion: String? = null,
    val userZoneId: ZoneId = ZoneId.systemDefault(),
    val feedbackMessage: String? = null,
    val editor: ScheduleEditorState? = null,
    val rescue: RescueSheetState = RescueSheetState(),
)

@HiltViewModel
class ScheduleViewModel @Inject constructor(
    private val scheduleRepository: ScheduleRepository,
    private val energyRepository: EnergyRepository,
    private val authRepository: AuthRepository,
    private val clock: () -> Instant,
) : ViewModel() {

    private val selectedDayFlow = MutableStateFlow(LocalDate.now())
    private val showEnergyOverlayFlow = MutableStateFlow(true)
    private val loadingFlow = MutableStateFlow(false)
    private val feedbackFlow = MutableStateFlow<String?>(null)
    private val editorFlow = MutableStateFlow<ScheduleEditorState?>(null)
    private val rescueFlow = MutableStateFlow(RescueSheetState())

    val uiState: StateFlow<CalendarUiState> = combine(
        selectedDayFlow,
        showEnergyOverlayFlow,
        scheduleRepository.observeCachedItems(),
        energyRepository.todayEnergy,
        loadingFlow,
        scheduleRepository.isOfflineReadOnly,
        scheduleRepository.baselineVersion,
        authRepository.sessionState,
        feedbackFlow,
        editorFlow,
        rescueFlow,
    ) { values ->
        val day = values[0] as LocalDate
        val showOverlay = values[1] as Boolean
        @Suppress("UNCHECKED_CAST")
        val allCached = values[2] as List<ScheduleItemDTO>
        val energy = values[3] as EnergyTodayResponse?
        val isLoading = values[4] as Boolean
        val isOffline = values[5] as Boolean
        val baseline = values[6] as String?
        val session = values[7]
        val feedback = values[8] as String?
        val editor = values[9] as ScheduleEditorState?
        val rescue = values[10] as RescueSheetState

        val zone = (session as? AppSessionState.Authenticated)
            ?.let { runCatching { ZoneId.of(it.user.timezone) }.getOrNull() }
            ?: ZoneId.systemDefault()

        val dayStart = day.atStartOfDay(zone).toInstant()
        val dayEnd = day.plusDays(1).atStartOfDay(zone).toInstant()
        val filtered = allCached
            .filter { item ->
                item.status != ScheduleStatus.cancelled &&
                    item.endAt.toInstant().isAfter(dayStart) &&
                    item.startAt.toInstant().isBefore(dayEnd)
            }
            .sortedBy { it.startAt }

        CalendarUiState(
            selectedDay = day,
            showEnergyOverlay = showOverlay,
            dayItems = filtered,
            energy = energy,
            isLoading = isLoading,
            isOfflineReadOnly = isOffline,
            baselineVersion = baseline,
            userZoneId = zone,
            feedbackMessage = feedback,
            editor = editor,
            rescue = rescue,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = CalendarUiState(),
    )

    fun selectDay(day: LocalDate) {
        selectedDayFlow.value = day
        refreshDayData(day)
    }

    fun shiftDay(deltaDays: Long) {
        selectDay(selectedDayFlow.value.plusDays(deltaDays))
    }

    fun toggleEnergyOverlay() {
        showEnergyOverlayFlow.update { !it }
    }

    fun refresh() {
        refreshDayData(selectedDayFlow.value)
    }

    private fun refreshDayData(day: LocalDate) {
        viewModelScope.launch {
            loadingFlow.value = true
            val zone = uiState.value.userZoneId
            val from = day.minusDays(1).atStartOfDay(zone).toOffsetDateTime()
            val to = day.plusDays(7).atStartOfDay(zone).toOffsetDateTime()
            val result = scheduleRepository.refreshWindow(from, to, persistToRoom = true)
            if (result is ApiResult.HttpError) {
                feedbackFlow.value = ErrorMessageMapper.messageFor(result)
            }
            energyRepository.fetchTodayEnergy(day)
            loadingFlow.value = false
        }
    }

    fun openCreateEditor() {
        editorFlow.value = ScheduleEditorState(
            startMinuteOfDay = 10 * 60,
            durationMinutes = 60,
        )
    }

    fun openEditEditor(item: ScheduleItemDTO) {
        val zone = uiState.value.userZoneId
        val localStart = item.startAt.atZoneSameInstant(zone).toLocalTime()
        val startMin = localStart.hour * 60 + localStart.minute
        val deadlineMin = item.deadlineAt?.atZoneSameInstant(zone)?.toLocalTime()?.let { it.hour * 60 + it.minute } ?: (18 * 60)
        editorFlow.value = ScheduleEditorState(
            editingItem = item,
            title = item.title,
            notes = item.notes,
            category = item.category,
            cognitiveLoad = item.cognitiveLoad,
            flexibility = item.flexibility,
            status = item.status,
            startMinuteOfDay = startMin,
            durationMinutes = item.durationMinutes.toInt().coerceIn(15, 480),
            reminderMinutes = item.reminderMinutes.toInt().coerceAtLeast(0),
            hasDeadline = item.deadlineAt != null,
            deadlineMinuteOfDay = deadlineMin,
        )
    }

    fun dismissEditor() {
        editorFlow.value = null
    }

    fun updateEditor(transform: (ScheduleEditorState) -> ScheduleEditorState) {
        editorFlow.update { current -> current?.let(transform) }
    }

    fun saveEditor(allowOverlap: Boolean = false) {
        val current = editorFlow.value ?: return
        val day = selectedDayFlow.value
        val zone = uiState.value.userZoneId

        if (!current.isTeamManagedMeeting && current.title.trim().isEmpty()) {
            editorFlow.value = current.copy(errorMessage = "请输入日程标题")
            return
        }

        val startAt = day.atTime(LocalTime.of(current.startMinuteOfDay / 60, current.startMinuteOfDay % 60))
            .atZone(zone)
            .toOffsetDateTime()
        val endAt = startAt.plusMinutes(current.durationMinutes.toLong())
        val deadlineAt: OffsetDateTime? = if (current.hasDeadline) {
            day.atTime(LocalTime.of(current.deadlineMinuteOfDay / 60, current.deadlineMinuteOfDay % 60))
                .atZone(zone)
                .toOffsetDateTime()
        } else {
            null
        }

        viewModelScope.launch {
            editorFlow.update { it?.copy(isSaving = true, errorMessage = null, overlapConflictDetail = null) }
            val existing = current.editingItem
            val result = if (existing == null) {
                scheduleRepository.createItem(
                    CreateScheduleItemRequest(
                        title = current.title.trim(),
                        notes = current.notes.trim().ifEmpty { null },
                        category = current.category,
                        cognitiveLoad = current.cognitiveLoad,
                        flexibility = current.flexibility,
                        startAt = startAt,
                        endAt = endAt,
                        deadlineAt = deadlineAt,
                        reminderMinutes = current.reminderMinutes.toLong(),
                        allowOverlap = allowOverlap,
                    ),
                )
            } else if (current.isTeamManagedMeeting) {
                // 团队关联会议仅允许更新备注、提前提醒或标为已完成
                scheduleRepository.updateItem(
                    existing.id,
                    UpdateScheduleItemRequest(
                        notes = current.notes.trim(),
                        reminderMinutes = current.reminderMinutes.toLong(),
                        status = if (current.status == ScheduleStatus.completed) ScheduleStatus.completed else null,
                    ),
                )
            } else {
                scheduleRepository.updateItem(
                    existing.id,
                    UpdateScheduleItemRequest(
                        title = current.title.trim(),
                        notes = current.notes.trim(),
                        category = current.category,
                        cognitiveLoad = current.cognitiveLoad,
                        flexibility = current.flexibility,
                        status = current.status,
                        startAt = startAt,
                        endAt = endAt,
                        deadlineAt = deadlineAt,
                        clearDeadline = !current.hasDeadline && existing.deadlineAt != null,
                        reminderMinutes = current.reminderMinutes.toLong(),
                        allowOverlap = allowOverlap,
                    ),
                )
            }

            when (result) {
                is ApiResult.Success -> {
                    editorFlow.value = null
                    feedbackFlow.value = if (existing == null) "已创建日程并校准闹钟" else "日程已更新"
                    energyRepository.fetchTodayEnergy(day)
                }

                is ApiResult.HttpError -> {
                    val code = result.problem?.code
                    val msg = ErrorMessageMapper.messageFor(result)
                    if (code == ErrorCode.CONFLICT_SCHEDULE_OVERLAP) {
                        editorFlow.update { it?.copy(isSaving = false, overlapConflictDetail = msg, errorMessage = null) }
                    } else {
                        editorFlow.update { it?.copy(isSaving = false, errorMessage = msg) }
                    }
                }

                is ApiResult.NetworkError -> {
                    editorFlow.update { it?.copy(isSaving = false, errorMessage = ErrorMessageMapper.messageFor(result)) }
                }
            }
        }
    }

    fun deleteEditingItem() {
        val existing = editorFlow.value?.editingItem ?: return
        viewModelScope.launch {
            editorFlow.update { it?.copy(isSaving = true, errorMessage = null) }
            when (val res = scheduleRepository.deleteItem(existing.id)) {
                is ApiResult.Success -> {
                    editorFlow.value = null
                    feedbackFlow.value = "已取消日程并释放时段"
                    energyRepository.fetchTodayEnergy(selectedDayFlow.value)
                }

                is ApiResult.HttpError -> {
                    editorFlow.update { it?.copy(isSaving = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    editorFlow.update { it?.copy(isSaving = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun openRescueSheet(reason: RescueTriggerReason? = null) {
        val defaultReason = reason ?: RescueTriggerReason.urgent_task
        rescueFlow.update {
            it.copy(
                isOpen = true,
                showHistoryTab = false,
                triggerReason = defaultReason,
                errorMessage = null,
                successMessage = null,
            )
        }
        if (defaultReason != RescueTriggerReason.urgent_task) {
            previewRescueOptions()
        }
        loadRescueHistory()
    }

    fun closeRescueSheet() {
        rescueFlow.update { it.copy(isOpen = false, errorMessage = null, successMessage = null) }
    }

    fun setRescueTab(showHistory: Boolean) {
        rescueFlow.update { it.copy(showHistoryTab = showHistory, errorMessage = null, successMessage = null) }
        if (showHistory) {
            loadRescueHistory()
        }
    }

    fun updateRescueState(transform: (RescueSheetState) -> RescueSheetState) {
        rescueFlow.update(transform)
    }

    fun previewRescueOptions() {
        val state = rescueFlow.value
        val day = selectedDayFlow.value
        val zone = uiState.value.userZoneId
        val urgentTask = buildUrgentTaskOrError(state, day, zone)
        if (state.triggerReason == RescueTriggerReason.urgent_task && urgentTask == null) {
            return
        }

        viewModelScope.launch {
            rescueFlow.update { it.copy(isPreviewLoading = true, errorMessage = null, successMessage = null) }
            when (val res = scheduleRepository.previewRescueOptions(day, state.triggerReason, urgentTask)) {
                is ApiResult.Success -> {
                    val options = res.data.options
                    val chosen = options.firstOrNull { it.strategy == state.selectedStrategy }?.strategy
                        ?: options.firstOrNull()?.strategy
                        ?: RescueStrategy.protect_recovery
                    rescueFlow.update {
                        it.copy(
                            isPreviewLoading = false,
                            previewBaselineVersion = res.data.baselineVersion,
                            options = options,
                            selectedStrategy = chosen,
                        )
                    }
                }

                is ApiResult.HttpError -> {
                    rescueFlow.update { it.copy(isPreviewLoading = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    rescueFlow.update { it.copy(isPreviewLoading = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun applySelectedRescueOption() {
        val state = rescueFlow.value
        val day = selectedDayFlow.value
        val zone = uiState.value.userZoneId
        val selectedPlan = state.options.firstOrNull { it.strategy == state.selectedStrategy }
        val baseline = state.previewBaselineVersion ?: uiState.value.baselineVersion
        if (selectedPlan == null || baseline.isNullOrBlank()) {
            rescueFlow.update { it.copy(errorMessage = "请先生成并选择一个救援方案") }
            return
        }

        val urgentTask = buildUrgentTaskOrError(state, day, zone)
        if (state.triggerReason == RescueTriggerReason.urgent_task && urgentTask == null) {
            return
        }

        viewModelScope.launch {
            rescueFlow.update { it.copy(isApplying = true, errorMessage = null, successMessage = null) }
            val result = scheduleRepository.applyRescueOption(
                day = day,
                baselineVersion = baseline,
                strategy = selectedPlan.strategy,
                triggerReason = state.triggerReason,
                urgentTask = urgentTask,
                expectedOptionHash = selectedPlan.optionHash,
            )
            when (result) {
                is ApiResult.Success -> {
                    rescueFlow.update {
                        it.copy(
                            isApplying = false,
                            options = emptyList(),
                            successMessage = "已应用「${selectedPlan.strategy.value}」救援方案并记录快照，可随时撤销",
                        )
                    }
                    feedbackFlow.value = "救援方案已落库并重新校准本地闹钟"
                    energyRepository.fetchTodayEnergy(day)
                    loadRescueHistory()
                }

                is ApiResult.HttpError -> {
                    if (result.problem?.code == ErrorCode.STALE_BASELINE_VERSION) {
                        rescueFlow.update {
                            it.copy(
                                isApplying = false,
                                errorMessage = ErrorMessageMapper.messageFor(result),
                            )
                        }
                        previewRescueOptions()
                    } else {
                        rescueFlow.update {
                            it.copy(isApplying = false, errorMessage = ErrorMessageMapper.messageFor(result))
                        }
                    }
                }

                is ApiResult.NetworkError -> {
                    rescueFlow.update {
                        it.copy(isApplying = false, errorMessage = ErrorMessageMapper.messageFor(result))
                    }
                }
            }
        }
    }

    fun loadRescueHistory() {
        viewModelScope.launch {
            rescueFlow.update { it.copy(historyLoading = true) }
            when (val res = scheduleRepository.listRescueHistory()) {
                is ApiResult.Success -> {
                    rescueFlow.update { it.copy(historyLoading = false, historySnapshots = res.data.snapshots) }
                }

                is ApiResult.HttpError -> {
                    rescueFlow.update { it.copy(historyLoading = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    rescueFlow.update { it.copy(historyLoading = false) }
                }
            }
        }
    }

    fun undoSnapshot(snapshotId: UUID) {
        viewModelScope.launch {
            rescueFlow.update { it.copy(undoingSnapshotId = snapshotId, errorMessage = null, successMessage = null) }
            when (val res = scheduleRepository.undoRescueSnapshot(snapshotId)) {
                is ApiResult.Success -> {
                    rescueFlow.update {
                        it.copy(
                            undoingSnapshotId = null,
                            successMessage = "已原子撤销该救援方案并还原受影响日程",
                        )
                    }
                    energyRepository.fetchTodayEnergy(selectedDayFlow.value)
                    loadRescueHistory()
                }

                is ApiResult.HttpError -> {
                    rescueFlow.update {
                        it.copy(undoingSnapshotId = null, errorMessage = ErrorMessageMapper.messageFor(res))
                    }
                    loadRescueHistory()
                }

                is ApiResult.NetworkError -> {
                    rescueFlow.update {
                        it.copy(undoingSnapshotId = null, errorMessage = ErrorMessageMapper.messageFor(res))
                    }
                }
            }
        }
    }

    fun clearFeedback() {
        feedbackFlow.value = null
    }

    private fun buildUrgentTaskOrError(
        state: RescueSheetState,
        day: LocalDate,
        zone: ZoneId,
    ): UrgentTaskDTO? {
        if (state.triggerReason != RescueTriggerReason.urgent_task) return null
        val trimmedTitle = state.urgentTitle.trim()
        if (trimmedTitle.isEmpty()) {
            rescueFlow.update { it.copy(errorMessage = "请输入突发紧急任务标题") }
            return null
        }
        val deadlineDate = day.plusDays(state.urgentDeadlineDayOffset.toLong())
        val deadlineTime = LocalTime.of(
            (state.urgentDeadlineMinuteOfDay / 60).coerceIn(0, 23),
            (state.urgentDeadlineMinuteOfDay % 60).coerceIn(0, 59),
        )
        val deadlineAt = deadlineDate.atTime(deadlineTime).atZone(zone).toOffsetDateTime()
        if (!deadlineAt.toInstant().isAfter(clock())) {
            rescueFlow.update { it.copy(errorMessage = "紧急任务截止时间必须晚于当前时间") }
            return null
        }
        return UrgentTaskDTO(
            title = trimmedTitle,
            notes = state.urgentNotes.trim().ifEmpty { null },
            durationMinutes = state.urgentDurationMinutes.toLong().coerceIn(15L, 480L),
            cognitiveLoad = state.urgentCognitiveLoad,
            deadlineAt = deadlineAt,
        )
    }
}
