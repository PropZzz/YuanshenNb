package app.shixu.feature.team

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.network.*
import app.shixu.core.network.generated.models.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.*
import java.util.UUID

class TeamViewModel(private val api: ClientServices, val zone: ZoneId, val myId: UUID) : ViewModel() {
    var workspaces by mutableStateOf<List<WorkspaceDTO>>(emptyList()); private set
    var selected by mutableStateOf<WorkspaceDTO?>(null); private set
    var members by mutableStateOf<List<WorkspaceMemberDTO>>(emptyList()); private set
    var availability by mutableStateOf<WorkspaceAvailabilityResponse?>(null); private set
    var meetings by mutableStateOf<List<MeetingProposalDTO>>(emptyList()); private set
    var recommendations by mutableStateOf<RecommendMeetingResponse?>(null); private set
    var busy by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<String?>(null); private set
    private var meetingRequest: RecommendMeetingRequest? = null
    init { load() }
    fun load() = action {
        workspaces = api.workspaces.listWorkspaces().requireBody().workspaces
        selected = workspaces.firstOrNull { it.id == selected?.id } ?: workspaces.firstOrNull()
        loaded = true
        loadWorkspace()
    }
    fun select(workspace: WorkspaceDTO) = action { selected = workspace; recommendations = null; loadWorkspace() }
    private suspend fun loadWorkspace() {
        val id = selected?.id ?: return
        members = api.workspaces.listWorkspaceMembers(id).requireBody().members
        meetings = api.workspaces.listWorkspaceMeetings(id).requireBody().meetings
        val today = LocalDate.now(zone)
        val start = today.atStartOfDay(zone).toOffsetDateTime()
        availability = api.workspaces.getWorkspaceAvailability(id, start, today.plusDays(1).atStartOfDay(zone).toOffsetDateTime()).requireBody()
    }
    fun create(name: String) = action {
        val workspace = api.workspaces.createWorkspace(CreateWorkspaceRequest(name.trim().also { require(it.isNotBlank()) { "请输入工作区名称" } })).requireBody()
        selected = workspace; workspaces = api.workspaces.listWorkspaces().requireBody().workspaces; loadWorkspace()
    }
    fun join(code: String) = action {
        val workspace = api.workspaces.joinWorkspace(JoinWorkspaceRequest(code.trim().also { require(it.isNotBlank()) { "请输入邀请码" } })).requireBody()
        selected = workspace; workspaces = api.workspaces.listWorkspaces().requireBody().workspaces; loadWorkspace()
    }
    fun privacy(level: PrivacyLevel) = action {
        val current = selected ?: return@action
        api.workspaces.updateWorkspacePrivacy(current.id, UpdateWorkspaceMemberConfigRequest(level)).requireBody()
        selected = current.copy(myPrivacyLevel = level)
        workspaces = workspaces.map { if (it.id == current.id) it.copy(myPrivacyLevel = level) else it }
        notice = "隐私边界已保存"; loadWorkspace()
    }
    fun recommend(request: RecommendMeetingRequest) = action {
        val current = selected ?: return@action
        recommendations = api.workspaces.recommendWorkspaceMeetings(current.id, request).requireBody(); meetingRequest = request
    }
    fun confirm(window: GoldenWindowRecommendation) = action {
        val id = selected?.id ?: return@action
        val request = meetingRequest ?: return@action
        api.workspaces.confirmWorkspaceMeeting(id, ConfirmMeetingRequest(request.cognitiveLoad, window.endAt, request.participantIds, window.startAt, request.title, request.description, request.optionalIds, recommendationMeta = MeetingRecommendationMeta(window.breakdown, window.explanationTags, window.rank, window.score, window.summary)), UUID.randomUUID().toString()).requireBody()
        notice = "会议已确认并同步参会人日程"; recommendations = null; loadWorkspace()
    }
    fun respond(meeting: MeetingProposalDTO, decision: MeetingDecisionStatus) = action {
        api.workspaces.respondWorkspaceMeeting(meeting.workspaceId, meeting.id, RespondMeetingRequest(decision)).requireBody(); notice = "会议回执已提交"; loadWorkspace()
    }
    fun cancel(meeting: MeetingProposalDTO) = action { api.workspaces.cancelWorkspaceMeeting(meeting.workspaceId, meeting.id).requireBody(); notice = "会议已取消"; loadWorkspace() }
    private fun action(block: suspend () -> Unit) {
        if (busy) return
        viewModelScope.launch {
            busy = true; error = null; notice = null
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.userMessage() } finally { busy = false }
        }
    }
}
