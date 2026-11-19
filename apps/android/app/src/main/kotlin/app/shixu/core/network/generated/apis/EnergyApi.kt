package app.shixu.core.network.generated.apis

import app.shixu.core.network.generated.infrastructure.CollectionFormats.*
import retrofit2.http.*
import retrofit2.Response
import okhttp3.RequestBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import app.shixu.core.network.generated.models.EnergyProfileDTO
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ProblemDetail
import app.shixu.core.network.generated.models.UpdateEnergyProfileRequest

interface EnergyApi {
    /**
     * GET api/v1/energy/profile
     * 获取个人工作时间窗、昼夜节律类型、偏好心流窗口与 14 日生理基线
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 500: Internal Server Error
     *
     * @return [EnergyProfileDTO]
     */
    @GET("api/v1/energy/profile")
    suspend fun getEnergyProfile(): Response<EnergyProfileDTO>

    /**
     * GET api/v1/energy/today
     * 获取指定日期的实时精力电量、四因子拆解、本地自然日节律曲线、保护盾与穿戴源诊断
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param day 用户本地日期 YYYY-MM-DD（默认今日） (optional)
     * @return [EnergyTodayResponse]
     */
    @GET("api/v1/energy/today")
    suspend fun getTodayEnergy(@Query("day") day: java.time.LocalDate? = null): Response<EnergyTodayResponse>

    /**
     * PUT api/v1/energy/profile
     * 更新个人工作时间窗、昼夜节律类型、心流保护窗与最小恢复缓冲
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param updateEnergyProfileRequest 
     * @return [EnergyProfileDTO]
     */
    @PUT("api/v1/energy/profile")
    suspend fun updateEnergyProfile(@Body updateEnergyProfileRequest: UpdateEnergyProfileRequest): Response<EnergyProfileDTO>

}
