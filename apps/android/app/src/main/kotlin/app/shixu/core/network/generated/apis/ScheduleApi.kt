package app.shixu.core.network.generated.apis

import app.shixu.core.network.generated.infrastructure.CollectionFormats.*
import retrofit2.http.*
import retrofit2.Response
import okhttp3.RequestBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import app.shixu.core.network.generated.models.CreateScheduleItemRequest
import app.shixu.core.network.generated.models.ProblemDetail
import app.shixu.core.network.generated.models.RescueApplyRequest
import app.shixu.core.network.generated.models.RescueApplyResponse
import app.shixu.core.network.generated.models.RescueHistoryResponse
import app.shixu.core.network.generated.models.RescueOptionsRequest
import app.shixu.core.network.generated.models.RescueOptionsResponse
import app.shixu.core.network.generated.models.RescueUndoRequest
import app.shixu.core.network.generated.models.RescueUndoResponse
import app.shixu.core.network.generated.models.ScheduleItemListResponse
import app.shixu.core.network.generated.models.ScheduleMutationResponse
import app.shixu.core.network.generated.models.UpdateScheduleItemRequest

interface ScheduleApi {
    /**
     * POST api/v1/schedule/rescue/apply
     * 确认采纳某套救援策略（单事务校验 48h baselineVersion、服务端确定性重算落库）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param rescueApplyRequest 
     * @param idempotencyKey 可选请求幂等键（防弱网重复应用救援方案） (optional)
     * @return [RescueApplyResponse]
     */
    @POST("api/v1/schedule/rescue/apply")
    suspend fun applyRescueOption(@Body rescueApplyRequest: RescueApplyRequest, @Header("Idempotency-Key") idempotencyKey: kotlin.String? = null): Response<RescueApplyResponse>

    /**
     * POST api/v1/schedule/items
     * 新建个人日程时间块（含 GiST 硬锁定冲突检测）
     * 
     * Responses:
     *  - 201: Created
     *  - 401: Unauthorized
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param createScheduleItemRequest 
     * @return [ScheduleMutationResponse]
     */
    @POST("api/v1/schedule/items")
    suspend fun createScheduleItem(@Body createScheduleItemRequest: CreateScheduleItemRequest): Response<ScheduleMutationResponse>

    /**
     * DELETE api/v1/schedule/items/{id}
     * 取消/软删除个人日程（置 status&#x3D;&#39;cancelled&#39;）
     * 
     * Responses:
     *  - 204: No Content
     *  - 401: Unauthorized
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @return [Unit]
     */
    @DELETE("api/v1/schedule/items/{id}")
    suspend fun deleteScheduleItem(@Path("id") id: java.util.UUID): Response<Unit>

    /**
     * GET api/v1/schedule/rescue/history
     * 分页查询近期日程救援采纳与撤销历史
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param limit  (optional, default to 20L)
     * @param cursor  (optional)
     * @return [RescueHistoryResponse]
     */
    @GET("api/v1/schedule/rescue/history")
    suspend fun listRescueHistory(@Query("limit") limit: kotlin.Long? = 20L, @Query("cursor") cursor: kotlin.String? = null): Response<RescueHistoryResponse>

    /**
     * GET api/v1/schedule/items
     * 按 UTC 时间区间拉取个人日程与 48h 乐观锁基线版本（最大跨度 62 天）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param from 
     * @param to 
     * @param includeCancelled  (optional, default to false)
     * @return [ScheduleItemListResponse]
     */
    @GET("api/v1/schedule/items")
    suspend fun listScheduleItems(@Query("from") from: java.time.OffsetDateTime, @Query("to") to: java.time.OffsetDateTime, @Query("includeCancelled") includeCancelled: kotlin.Boolean? = false): Response<ScheduleItemListResponse>

    /**
     * POST api/v1/schedule/rescue/options
     * 预览突发插单或疲劳过载的日程救援方案（纯函数计算，不写库）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param rescueOptionsRequest 
     * @return [RescueOptionsResponse]
     */
    @POST("api/v1/schedule/rescue/options")
    suspend fun previewRescueOptions(@Body rescueOptionsRequest: RescueOptionsRequest): Response<RescueOptionsResponse>

    /**
     * POST api/v1/schedule/rescue/undo
     * 原子撤销已应用的救援快照（校验无新增锁定会议冲突后按 before_items 还原）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param rescueUndoRequest 
     * @return [RescueUndoResponse]
     */
    @POST("api/v1/schedule/rescue/undo")
    suspend fun undoRescueSnapshot(@Body rescueUndoRequest: RescueUndoRequest): Response<RescueUndoResponse>

    /**
     * PATCH api/v1/schedule/items/{id}
     * 更新个人日程
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 404: Not Found
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param id 
     * @param updateScheduleItemRequest 
     * @return [ScheduleMutationResponse]
     */
    @PATCH("api/v1/schedule/items/{id}")
    suspend fun updateScheduleItem(@Path("id") id: java.util.UUID, @Body updateScheduleItemRequest: UpdateScheduleItemRequest): Response<ScheduleMutationResponse>

}
