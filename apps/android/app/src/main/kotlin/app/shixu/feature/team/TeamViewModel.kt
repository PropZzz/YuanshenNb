package app.shixu.feature.team

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.data.AppSessionState
import app.shixu.core.data.AuthRepository
import app.shixu.core.data.WorkspaceRepository
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.generated.models.BlockingDiagnostic
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.ConfirmMeetingRequest
import app.shixu.core.network.generated.models.ErrorCode
import app.shixu.core.network.generated.models.GoldenWindowRecommendation
import app.shixu.core.network.generated.models.MeetingDecisionStatus
import app.shixu.core.network.generated.models.MeetingProposalDTO
import app.shixu.core.network.generated.models.MeetingRecommendationMeta
import app.shixu.core.network.generated.models.MemberAvailabilityView
import app.shixu.core.network.generated.models.PrivacyLevel
import app.shixu.core.network.generated.models.RecommendMeetingRequest
import app.shixu.core.network.generated.models.WorkspaceDTO
import app.shixu.core.network.generated.models.WorkspaceMemberDTO
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject

data class MeetingWizardState(
    val isOpen: Boolean = false,
    val title: String = "",
    val description: String = "",
    val durationMinutes: Int = 45,
    val cognitiveLoad: CognitiveLoad = CognitiveLoad.high,
    val searchDays: Int = 5,
    val respectFocusShields: Boolean = true,
    val requiredIds: Set<UUID> = emptySet(),
    val optionalIds: Set<UUID> = emptySet(),
    val isRecommending: Boolean = false,
    val isConfirming: Boolean = false,
    val recommendations: List<GoldenWindowRecommendation> = emptyList(),
    val diagnostics: List<BlockingDiagnostic> = emptyList(),
    val selectedRank: Long? = null,
    val errorMessage: String? = null,
)

data class TeamUiState(
    val currentUserId: UUID? = null,
    val userZoneId: ZoneId = ZoneId.systemDefault(),
    val workspaces: List<WorkspaceDTO> = emptyList(),
    val selectedWorkspaceId: UUID? = null,
    val members: List<WorkspaceMemberDTO> = emptyList(),
    val availability: List<MemberAvailabilityView> = emptyList(),
    val meetings: List<MeetingProposalDTO> = emptyList(),
    val isLoading: Boolean = false,
    val isSubmittingAction: Boolean = false,
    val feedbackMessage: String? = null,
    val errorMessage: String? = null,
    val showCreateDialog: Boolean = false,
    val showJoinDialog: Boolean = false,
    val createName: String = "",
    val createDescription: String = "",
    val joinInviteCode: String = "",
    val dialogError: String? = null,
    val wizard: MeetingWizardState = MeetingWizardState(),
) {
    val activeWorkspace: WorkspaceDTO?
        get() = workspaces.firstOrNull { it.id == selectedWorkspaceId } ?: workspaces.firstOrNull()
}

@HiltViewModel
class TeamViewModel @Inject constructor(
    private val workspaceRepository: WorkspaceRepository,
    private val authRepository: AuthRepository,
    private val clock: () -> Instant,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TeamUiState())
    val uiState: StateFlow<TeamUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            authRepository.sessionState.collect { session ->
                if (session is AppSessionState.Authenticated) {
                    val zone = runCatching { ZoneId.of(session.user.timezone) }.getOrDefault(ZoneId.systemDefault())
                    _uiState.update { it.copy(currentUserId = session.user.id, userZoneId = zone) }
                    loadWorkspaces()
                } else if (session is AppSessionState.Unauthenticated) {
                    _uiState.value = TeamUiState()
                }
            }
        }

        viewModelScope.launch {
            workspaceRepository.workspaceUpdates.collect { updatedId ->
                val activeId = _uiState.value.activeWorkspace?.id
                if (activeId == null || activeId == updatedId) {
                    loadWorkspaceDetails(updatedId)
                }
            }
        }
    }

    fun loadWorkspaces() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            when (val res = workspaceRepository.listWorkspaces()) {
                is ApiResult.Success -> {
                    val list = res.data.workspaces
                    val prevId = _uiState.value.selectedWorkspaceId
                    val target = list.firstOrNull { it.id == prevId } ?: list.firstOrNull()
                    _uiState.update {
                        it.copy(
                            workspaces = list,
                            selectedWorkspaceId = target?.id,
                            isLoading = false,
                        )
                    }
                    target?.let { loadWorkspaceDetails(it.id) }
                }

                is ApiResult.HttpError -> {
                    _uiState.update { it.copy(isLoading = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isLoading = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun selectWorkspace(workspaceId: UUID) {
        _uiState.update { it.copy(selectedWorkspaceId = workspaceId, errorMessage = null, feedbackMessage = null) }
        loadWorkspaceDetails(workspaceId)
    }

    fun refreshActiveWorkspace() {
        val id = _uiState.value.activeWorkspace?.id
        if (id != null) {
            loadWorkspaceDetails(id)
        } else {
            loadWorkspaces()
        }
    }

    private fun loadWorkspaceDetails(workspaceId: UUID) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val zone = _uiState.value.userZoneId
            val today = LocalDate.now(zone)
            val from = today.atStartOfDay(zone).toOffsetDateTime()
            val to = today.plusDays(2).atStartOfDay(zone).toOffsetDateTime()

            val membersRes = workspaceRepository.listMembers(workspaceId)
            val availRes = workspaceRepository.getAvailability(workspaceId, from, to)
            val meetingsRes = workspaceRepository.listMeetings(workspaceId)

            val members = (membersRes as? ApiResult.Success)?.data?.members ?: _uiState.value.members
            val availability = (availRes as? ApiResult.Success)?.data?.members ?: _uiState.value.availability
            val meetings = (meetingsRes as? ApiResult.Success)?.data?.meetings ?: _uiState.value.meetings

            val firstError = listOf(membersRes, availRes, meetingsRes).firstOrNull { it !is ApiResult.Success }
            val errMsg = when (firstError) {
                is ApiResult.HttpError -> ErrorMessageMapper.messageFor(firstError)
                is ApiResult.NetworkError -> ErrorMessageMapper.messageFor(firstError)
                else -> null
            }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    members = members,
                    availability = availability,
                    meetings = meetings,
                    errorMessage = errMsg,
                )
            }
        }
    }

    fun openCreateDialog() {
        _uiState.update {
            it.copy(showCreateDialog = true, createName = "", createDescription = "", dialogError = null)
        }
    }

    fun openJoinDialog() {
        _uiState.update {
            it.copy(showJoinDialog = true, joinInviteCode = "", dialogError = null)
        }
    }

    fun dismissDialogs() {
        _uiState.update { it.copy(showCreateDialog = false, showJoinDialog = false, dialogError = null) }
    }

    fun updateCreateFields(name: String? = null, description: String? = null) {
        _uiState.update {
            it.copy(
                createName = name ?: it.createName,
                createDescription = description ?: it.createDescription,
                dialogError = null,
            )
        }
    }

    fun updateJoinCode(code: String) {
        _uiState.update { it.copy(joinInviteCode = code, dialogError = null) }
    }

    fun submitCreateWorkspace() {
        val name = _uiState.value.createName.trim()
        if (name.isEmpty()) {
            _uiState.update { it.copy(dialogError = "请输入工作区名称") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            when (val res = workspaceRepository.createWorkspace(name, _uiState.value.createDescription)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            showCreateDialog = false,
                            selectedWorkspaceId = res.data.id,
                            feedbackMessage = "已创建工作区「${res.data.name}」，邀请码 ${res.data.inviteCode}",
                        )
                    }
                    loadWorkspaces()
                }

                is ApiResult.HttpError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun submitJoinWorkspace() {
        val code = _uiState.value.joinInviteCode.trim()
        if (code.isEmpty()) {
            _uiState.update { it.copy(dialogError = "请输入团队邀请码") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            when (val res = workspaceRepository.joinWorkspace(code)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            showJoinDialog = false,
                            selectedWorkspaceId = res.data.id,
                            feedbackMessage = "已加入工作区「${res.data.name}」",
                        )
                    }
                    loadWorkspaces()
                }

                is ApiResult.HttpError -> {
                    if (res.problem?.code == ErrorCode.ALREADY_WORKSPACE_MEMBER) {
                        _uiState.update {
                            it.copy(
                                isSubmittingAction = false,
                                showJoinDialog = false,
                                feedbackMessage = ErrorMessageMapper.messageFor(res),
                            )
                        }
                        loadWorkspaces()
                    } else {
                        _uiState.update {
                            it.copy(isSubmittingAction = false, dialogError = ErrorMessageMapper.messageFor(res))
                        }
                    }
                }

                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun updatePrivacyLevel(level: PrivacyLevel) {
        val workspace = _uiState.value.activeWorkspace ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, errorMessage = null) }
            when (val res = workspaceRepository.updateMyPrivacy(workspace.id, level)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            feedbackMessage = "已切换本团队隐私投影等级",
                        )
                    }
                    loadWorkspaces()
                }

                is ApiResult.HttpError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }

                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun respondToMeeting(proposalId: UUID, decision: MeetingDecisionStatus) {
        val workspaceId = _uiState.value.activeWorkspace?.id ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, errorMessage = null) }
            when (val res = workspaceRepository.respondMeeting(workspaceId, proposalId, decision)) {
                is ApiResult.Success -> {
                    val label = if (decision == MeetingDecisionStatus.accepted) {
                        "已确认参加会议，本地提醒闹钟已保持同步"
                    } else {
                        "已拒绝会议并自动释放该时段日程与闹钟"
                    }
                    _uiState.update { it.copy(isSubmittingAction = false, feedbackMessage = label) }
                    loadWorkspaceDetails(workspaceId)
                }

                is ApiResult.HttpError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                    loadWorkspaceDetails(workspaceId)
                }

                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun cancelMeeting(proposalId: UUID) {
        val workspaceId = _uiState.value.activeWorkspace?.id ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, errorMessage = null) }
            when (val res = workspaceRepository.cancelMeeting(workspaceId, proposalId, "组织者取消会议")) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            feedbackMessage = "已取消会议并注销全员日程 (${res.data.cancelledScheduleCount})",
                        )
                    }
                    loadWorkspaceDetails(workspaceId)
                }

                is ApiResult.HttpError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                    loadWorkspaceDetails(workspaceId)
                }

                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, errorMessage = ErrorMessageMapper.messageFor(res)) }
                }
            }
        }
    }

    fun openMeetingWizard() {
        val allMemberIds = _uiState.value.members.map { it.userId }.toSet()
        val defaultRequired = _uiState.value.currentUserId?.let { setOf(it) }
            ?: allMemberIds.take(1).toSet()
        _uiState.update {
            it.copy(
                wizard = MeetingWizardState(
                    isOpen = true,
                    requiredIds = if (allMemberIds.size <= 3) allMemberIds else defaultRequired,
                ),
            )
        }
    }

    fun closeMeetingWizard() {
        _uiState.update { it.copy(wizard = it.wizard.copy(isOpen = false, errorMessage = null)) }
    }

    fun updateWizard(transform: (MeetingWizardState) -> MeetingWizardState) {
        _uiState.update { it.copy(wizard = transform(it.wizard)) }
    }

    fun toggleRequiredMember(userId: UUID) {
        updateWizard { w ->
            val nextReq = w.requiredIds.toMutableSet()
            val nextOpt = w.optionalIds.toMutableSet()
            if (userId in nextReq) {
                nextReq.remove(userId)
            } else {
                nextReq.add(userId)
                nextOpt.remove(userId)
            }
            w.copy(requiredIds = nextReq, optionalIds = nextOpt, errorMessage = null)
        }
    }

    fun toggleOptionalMember(userId: UUID) {
        updateWizard { w ->
            val nextReq = w.requiredIds.toMutableSet()
            val nextOpt = w.optionalIds.toMutableSet()
            if (userId in nextOpt) {
                nextOpt.remove(userId)
            } else {
                nextOpt.add(userId)
                nextReq.remove(userId)
            }
            w.copy(requiredIds = nextReq, optionalIds = nextOpt, errorMessage = null)
        }
    }

    fun recommendGoldenWindows() {
        val workspaceId = _uiState.value.activeWorkspace?.id ?: return
        val w = _uiState.value.wizard
        val title = w.title.trim()
        if (title.isEmpty()) {
            updateWizard { it.copy(errorMessage = "请输入会议主题") }
            return
        }
        if (w.requiredIds.isEmpty()) {
            updateWizard { it.copy(errorMessage = "至少选择 1 位必选参会成员") }
            return
        }

        val zone = _uiState.value.userZoneId
        val searchFrom = clock().atZone(zone).toOffsetDateTime()
        val searchTo = LocalDate.now(zone).plusDays(w.searchDays.toLong().coerceIn(1L, 14L))
            .atStartOfDay(zone).toOffsetDateTime()

        viewModelScope.launch {
            updateWizard { it.copy(isRecommending = true, errorMessage = null) }
            val result = workspaceRepository.recommendMeetings(
                workspaceId = workspaceId,
                request = RecommendMeetingRequest(
                    title = title,
                    description = w.description.trim().ifEmpty { null },
                    durationMinutes = w.durationMinutes.toLong().coerceIn(15L, 480L),
                    cognitiveLoad = w.cognitiveLoad,
                    participantIds = w.requiredIds.map { it.toString() },
                    optionalIds = w.optionalIds.takeIf { it.isNotEmpty() }?.map { it.toString() },
                    searchFrom = searchFrom,
                    searchTo = searchTo,
                    respectFocusShields = w.respectFocusShields,
                    maxResults = 3L,
                ),
            )

            when (result) {
                is ApiResult.Success -> {
                    val recs = result.data.recommendations
                    updateWizard {
                        it.copy(
                            isRecommending = false,
                            recommendations = recs,
                            diagnostics = result.data.blockingDiagnostics,
                            selectedRank = recs.firstOrNull()?.rank,
                        )
                    }
                }

                is ApiResult.HttpError -> {
                    if (result.problem?.code == ErrorCode.PARTICIPANT_NOT_IN_WORKSPACE) {
                        loadWorkspaceDetails(workspaceId)
                    }
                    updateWizard { it.copy(isRecommending = false, errorMessage = ErrorMessageMapper.messageFor(result)) }
                }

                is ApiResult.NetworkError -> {
                    updateWizard { it.copy(isRecommending = false, errorMessage = ErrorMessageMapper.messageFor(result)) }
                }
            }
        }
    }

    fun confirmSelectedWindow() {
        val workspaceId = _uiState.value.activeWorkspace?.id ?: return
        val w = _uiState.value.wizard
        val chosen = w.recommendations.firstOrNull { it.rank == w.selectedRank }
            ?: w.recommendations.firstOrNull()
        if (chosen == null) {
            updateWizard { it.copy(errorMessage = "请先求解并选择一个候选黄金窗口") }
            return
        }

        viewModelScope.launch {
            updateWizard { it.copy(isConfirming = true, errorMessage = null) }
            val result = workspaceRepository.confirmMeeting(
                workspaceId = workspaceId,
                request = ConfirmMeetingRequest(
                    title = w.title.trim(),
                    description = w.description.trim().ifEmpty { null },
                    cognitiveLoad = w.cognitiveLoad,
                    participantIds = w.requiredIds.map { it.toString() },
                    optionalIds = w.optionalIds.takeIf { it.isNotEmpty() }?.map { it.toString() },
                    startAt = chosen.startAt,
                    endAt = chosen.endAt,
                    recommendationMeta = MeetingRecommendationMeta(
                        rank = chosen.rank,
                        score = chosen.score,
                        breakdown = chosen.breakdown,
                        explanationTags = chosen.explanationTags,
                        summary = chosen.summary,
                    ),
                ),
            )

            when (result) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            wizard = MeetingWizardState(isOpen = false),
                            feedbackMessage = "已确认会议「${result.data.proposal.title}」，全员日程与本地闹钟已对齐",
                        )
                    }
                    loadWorkspaceDetails(workspaceId)
                }

                is ApiResult.HttpError -> {
                    if (result.problem?.code == ErrorCode.CONFLICT_MEMBER_BUSY) {
                        updateWizard {
                            it.copy(
                                isConfirming = false,
                                errorMessage = ErrorMessageMapper.messageFor(result),
                            )
                        }
                        recommendGoldenWindows()
                    } else {
                        updateWizard {
                            it.copy(isConfirming = false, errorMessage = ErrorMessageMapper.messageFor(result))
                        }
                    }
                }

                is ApiResult.NetworkError -> {
                    updateWizard {
                        it.copy(isConfirming = false, errorMessage = ErrorMessageMapper.messageFor(result))
                    }
                }
            }
        }
    }

    fun clearFeedback() {
        _uiState.update { it.copy(feedbackMessage = null, errorMessage = null) }
    }
}
