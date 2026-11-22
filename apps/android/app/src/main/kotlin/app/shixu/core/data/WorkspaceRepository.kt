package app.shixu.core.data

import app.shixu.core.network.ApiResult
import app.shixu.core.network.generated.apis.WorkspacesApi
import app.shixu.core.network.generated.infrastructure.CollectionFormats
import app.shixu.core.network.generated.models.CancelMeetingRequest
import app.shixu.core.network.generated.models.CancelMeetingResponse
import app.shixu.core.network.generated.models.ConfirmMeetingRequest
import app.shixu.core.network.generated.models.ConfirmMeetingResponse
import app.shixu.core.network.generated.models.CreateWorkspaceRequest
import app.shixu.core.network.generated.models.JoinWorkspaceRequest
import app.shixu.core.network.generated.models.MeetingDecisionStatus
import app.shixu.core.network.generated.models.MeetingProposalListResponse
import app.shixu.core.network.generated.models.MeetingProposalStatus
import app.shixu.core.network.generated.models.PrivacyLevel
import app.shixu.core.network.generated.models.RecommendMeetingRequest
import app.shixu.core.network.generated.models.RecommendMeetingResponse
import app.shixu.core.network.generated.models.RespondMeetingRequest
import app.shixu.core.network.generated.models.RespondMeetingResponse
import app.shixu.core.network.generated.models.UpdateWorkspaceMemberConfigRequest
import app.shixu.core.network.generated.models.WorkspaceAvailabilityResponse
import app.shixu.core.network.generated.models.WorkspaceDTO
import app.shixu.core.network.generated.models.WorkspaceListResponse
import app.shixu.core.network.generated.models.WorkspaceMemberDTO
import app.shixu.core.network.generated.models.WorkspaceMemberListResponse
import app.shixu.core.network.safeApiCall
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.time.Duration
import java.time.OffsetDateTime
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WorkspaceRepository @Inject constructor(
    private val workspacesApi: WorkspacesApi,
    private val scheduleRepository: ScheduleRepository,
) {
    private val _workspaceUpdates = MutableSharedFlow<UUID>(extraBufferCapacity = 16)
    val workspaceUpdates: SharedFlow<UUID> = _workspaceUpdates.asSharedFlow()

    fun notifyWorkspaceChanged(workspaceId: UUID) {
        _workspaceUpdates.tryEmit(workspaceId)
    }

    suspend fun listWorkspaces(): ApiResult<WorkspaceListResponse> =
        safeApiCall { workspacesApi.listWorkspaces() }

    suspend fun createWorkspace(
        name: String,
        description: String? = null,
        privacyLevel: PrivacyLevel = PrivacyLevel.energy_tier,
    ): ApiResult<WorkspaceDTO> =
        safeApiCall {
            workspacesApi.createWorkspace(
                CreateWorkspaceRequest(
                    name = name.trim(),
                    description = description?.trim()?.takeIf { it.isNotEmpty() },
                    privacyLevel = privacyLevel,
                ),
            )
        }

    suspend fun joinWorkspace(
        inviteCode: String,
        privacyLevel: PrivacyLevel = PrivacyLevel.energy_tier,
    ): ApiResult<WorkspaceDTO> =
        safeApiCall {
            workspacesApi.joinWorkspace(
                JoinWorkspaceRequest(
                    inviteCode = inviteCode.trim(),
                    privacyLevel = privacyLevel,
                ),
            )
        }

    suspend fun listMembers(workspaceId: UUID): ApiResult<WorkspaceMemberListResponse> =
        safeApiCall { workspacesApi.listWorkspaceMembers(workspaceId) }

    suspend fun updateMyPrivacy(workspaceId: UUID, privacyLevel: PrivacyLevel): ApiResult<WorkspaceMemberDTO> =
        safeApiCall {
            workspacesApi.updateWorkspacePrivacy(
                id = workspaceId,
                updateWorkspaceMemberConfigRequest = UpdateWorkspaceMemberConfigRequest(privacyLevel = privacyLevel),
            )
        }

    suspend fun getAvailability(
        workspaceId: UUID,
        from: OffsetDateTime,
        to: OffsetDateTime,
        memberIds: List<UUID>? = null,
    ): ApiResult<WorkspaceAvailabilityResponse> {
        val safeTo = if (Duration.between(from, to).toDays() > MAX_TEAM_RANGE_DAYS) {
            from.plusDays(MAX_TEAM_RANGE_DAYS)
        } else {
            to
        }
        val csv = memberIds?.takeIf { it.isNotEmpty() }?.let { ids ->
            CollectionFormats.CSVParams(ids.map { it.toString() })
        }
        return safeApiCall {
            workspacesApi.getWorkspaceAvailability(
                id = workspaceId,
                from = from,
                to = safeTo,
                memberIds = csv,
            )
        }
    }

    suspend fun listMeetings(
        workspaceId: UUID,
        status: MeetingProposalStatus? = null,
        limit: Long = 20L,
    ): ApiResult<MeetingProposalListResponse> =
        safeApiCall {
            workspacesApi.listWorkspaceMeetings(
                id = workspaceId,
                status = status,
                limit = limit,
            )
        }

    suspend fun recommendMeetings(
        workspaceId: UUID,
        request: RecommendMeetingRequest,
    ): ApiResult<RecommendMeetingResponse> {
        val clampedTo = if (Duration.between(request.searchFrom, request.searchTo).toDays() > MAX_TEAM_RANGE_DAYS) {
            request.searchFrom.plusDays(MAX_TEAM_RANGE_DAYS)
        } else {
            request.searchTo
        }
        return safeApiCall {
            workspacesApi.recommendWorkspaceMeetings(
                id = workspaceId,
                recommendMeetingRequest = request.copy(searchTo = clampedTo),
            )
        }
    }

    suspend fun confirmMeeting(
        workspaceId: UUID,
        request: ConfirmMeetingRequest,
        idempotencyKey: String = UUID.randomUUID().toString(),
    ): ApiResult<ConfirmMeetingResponse> {
        val result = safeApiCall {
            workspacesApi.confirmWorkspaceMeeting(
                id = workspaceId,
                confirmMeetingRequest = request,
                idempotencyKey = idempotencyKey,
            )
        }
        if (result is ApiResult.Success) {
            scheduleRepository.refreshRollingWindow()
        }
        return result
    }

    suspend fun respondMeeting(
        workspaceId: UUID,
        proposalId: UUID,
        decision: MeetingDecisionStatus,
    ): ApiResult<RespondMeetingResponse> {
        val result = safeApiCall {
            workspacesApi.respondWorkspaceMeeting(
                id = workspaceId,
                proposalId = proposalId,
                respondMeetingRequest = RespondMeetingRequest(responseStatus = decision),
            )
        }
        if (result is ApiResult.Success) {
            scheduleRepository.refreshRollingWindow()
        }
        return result
    }

    suspend fun cancelMeeting(
        workspaceId: UUID,
        proposalId: UUID,
        reason: String? = null,
    ): ApiResult<CancelMeetingResponse> {
        val result = safeApiCall {
            workspacesApi.cancelWorkspaceMeeting(
                id = workspaceId,
                proposalId = proposalId,
                cancelMeetingRequest = reason?.trim()?.takeIf { it.isNotEmpty() }?.let { CancelMeetingRequest(it) },
            )
        }
        if (result is ApiResult.Success) {
            scheduleRepository.refreshRollingWindow()
        }
        return result
    }

    private companion object {
        const val MAX_TEAM_RANGE_DAYS = 14L
    }
}
