package app.shixu.core.network.generated.apis

import app.shixu.core.network.generated.infrastructure.CollectionFormats.*
import retrofit2.http.*
import retrofit2.Response
import okhttp3.RequestBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import app.shixu.core.network.generated.models.CancelMeetingRequest
import app.shixu.core.network.generated.models.CancelMeetingResponse
import app.shixu.core.network.generated.models.ConfirmMeetingRequest
import app.shixu.core.network.generated.models.ConfirmMeetingResponse
import app.shixu.core.network.generated.models.CreateWorkspaceRequest
import app.shixu.core.network.generated.models.JoinWorkspaceRequest
import app.shixu.core.network.generated.models.MeetingProposalListResponse
import app.shixu.core.network.generated.models.MeetingProposalStatus
import app.shixu.core.network.generated.models.ProblemDetail
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

interface WorkspacesApi {
    /**
     * POST api/v1/workspaces/{id}/meetings/{proposalId}/cancel
     * 组织者或管理员取消团队会议
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param proposalId 
     * @param cancelMeetingRequest  (optional)
     * @return [CancelMeetingResponse]
     */
    @POST("api/v1/workspaces/{id}/meetings/{proposalId}/cancel")
    suspend fun cancelWorkspaceMeeting(@Path("id") id: java.util.UUID, @Path("proposalId") proposalId: java.util.UUID, @Body cancelMeetingRequest: CancelMeetingRequest? = null): Response<CancelMeetingResponse>

    /**
     * POST api/v1/workspaces/{id}/meetings/confirm
     * 单事务按序加锁确认团队会议并同步落库全员 schedule_items
     * 
     * Responses:
     *  - 201: Created
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param confirmMeetingRequest 
     * @param idempotencyKey 可选请求幂等键 (optional)
     * @return [ConfirmMeetingResponse]
     */
    @POST("api/v1/workspaces/{id}/meetings/confirm")
    suspend fun confirmWorkspaceMeeting(@Path("id") id: java.util.UUID, @Body confirmMeetingRequest: ConfirmMeetingRequest, @Header("Idempotency-Key") idempotencyKey: kotlin.String? = null): Response<ConfirmMeetingResponse>

    /**
     * POST api/v1/workspaces
     * 创建团队工作区并将创建者设为 owner
     * 
     * Responses:
     *  - 201: Created
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param createWorkspaceRequest 
     * @return [WorkspaceDTO]
     */
    @POST("api/v1/workspaces")
    suspend fun createWorkspace(@Body createWorkspaceRequest: CreateWorkspaceRequest): Response<WorkspaceDTO>

    /**
     * GET api/v1/workspaces/{id}/availability
     * 获取经服务端严格隐私脱敏后的团队成员状态网格与整点精力档位（最大跨度 14 天）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param from 
     * @param to 
     * @param memberIds 可选过滤工作区成员子集 (optional)
     * @return [WorkspaceAvailabilityResponse]
     */
    @GET("api/v1/workspaces/{id}/availability")
    suspend fun getWorkspaceAvailability(@Path("id") id: java.util.UUID, @Query("from") from: java.time.OffsetDateTime, @Query("to") to: java.time.OffsetDateTime, @Query("memberIds") memberIds: CSVParams? = null): Response<WorkspaceAvailabilityResponse>

    /**
     * POST api/v1/workspaces/join
     * 通过邀请码加入团队工作区
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param joinWorkspaceRequest 
     * @return [WorkspaceDTO]
     */
    @POST("api/v1/workspaces/join")
    suspend fun joinWorkspace(@Body joinWorkspaceRequest: JoinWorkspaceRequest): Response<WorkspaceDTO>

    /**
     * GET api/v1/workspaces/{id}/meetings
     * 查询团队工作区的会议提案列表及各参会人回执状态
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param status  (optional)
     * @param from  (optional)
     * @param to  (optional)
     * @param limit  (optional, default to 20L)
     * @param cursor  (optional)
     * @return [MeetingProposalListResponse]
     */
    @GET("api/v1/workspaces/{id}/meetings")
    suspend fun listWorkspaceMeetings(@Path("id") id: java.util.UUID, @Query("status") status: MeetingProposalStatus? = null, @Query("from") from: java.time.OffsetDateTime? = null, @Query("to") to: java.time.OffsetDateTime? = null, @Query("limit") limit: kotlin.Long? = 20L, @Query("cursor") cursor: kotlin.String? = null): Response<MeetingProposalListResponse>

    /**
     * GET api/v1/workspaces/{id}/members
     * 获取团队工作区成员名册
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @return [WorkspaceMemberListResponse]
     */
    @GET("api/v1/workspaces/{id}/members")
    suspend fun listWorkspaceMembers(@Path("id") id: java.util.UUID): Response<WorkspaceMemberListResponse>

    /**
     * GET api/v1/workspaces
     * 列出当前用户已加入的全部团队工作区
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 500: Internal Server Error
     *
     * @return [WorkspaceListResponse]
     */
    @GET("api/v1/workspaces")
    suspend fun listWorkspaces(): Response<WorkspaceListResponse>

    /**
     * POST api/v1/workspaces/{id}/meetings/recommend
     * 求解团队协同排会黄金窗口（最大搜索跨度 14 天）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param recommendMeetingRequest 
     * @return [RecommendMeetingResponse]
     */
    @POST("api/v1/workspaces/{id}/meetings/recommend")
    suspend fun recommendWorkspaceMeetings(@Path("id") id: java.util.UUID, @Body recommendMeetingRequest: RecommendMeetingRequest): Response<RecommendMeetingResponse>

    /**
     * POST api/v1/workspaces/{id}/meetings/{proposalId}/respond
     * 参会成员提交会议回执（accepted / declined）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param proposalId 
     * @param respondMeetingRequest 
     * @return [RespondMeetingResponse]
     */
    @POST("api/v1/workspaces/{id}/meetings/{proposalId}/respond")
    suspend fun respondWorkspaceMeeting(@Path("id") id: java.util.UUID, @Path("proposalId") proposalId: java.util.UUID, @Body respondMeetingRequest: RespondMeetingRequest): Response<RespondMeetingResponse>

    /**
     * PATCH api/v1/workspaces/{id}/me
     * 修改当前用户在该团队工作区的隐私脱敏投影级别
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 403: Forbidden
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param updateWorkspaceMemberConfigRequest 
     * @return [WorkspaceMemberDTO]
     */
    @PATCH("api/v1/workspaces/{id}/me")
    suspend fun updateWorkspacePrivacy(@Path("id") id: java.util.UUID, @Body updateWorkspaceMemberConfigRequest: UpdateWorkspaceMemberConfigRequest): Response<WorkspaceMemberDTO>

}
