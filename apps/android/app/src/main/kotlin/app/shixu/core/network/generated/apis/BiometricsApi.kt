package app.shixu.core.network.generated.apis

import app.shixu.core.network.generated.infrastructure.CollectionFormats.*
import retrofit2.http.*
import retrofit2.Response
import okhttp3.RequestBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import app.shixu.core.network.generated.models.BiometricBatchRequest
import app.shixu.core.network.generated.models.BiometricBatchResponse
import app.shixu.core.network.generated.models.ProblemDetail
import app.shixu.core.network.generated.models.ReplaySeedRequest
import app.shixu.core.network.generated.models.ReplaySeedResponse

interface BiometricsApi {
    /**
     * POST api/v1/biometrics/samples/batch
     * 批量上报穿戴生理样本（按 externalId 幂等去重并触发精力重算）
     * 
     * Responses:
     *  - 200: OK
     *  - 0: Error
     *
     * @param biometricBatchRequest 
     * @return [BiometricBatchResponse]
     */
    @POST("api/v1/biometrics/samples/batch")
    suspend fun ingestBiometricSamplesBatch(@Body biometricBatchRequest: BiometricBatchRequest): Response<BiometricBatchResponse>

    /**
     * POST api/v1/biometrics/replay-seed
     * 显式注入 replay_demo 测试回放样本
     * 
     * Responses:
     *  - 200: OK
     *  - 0: Error
     *
     * @param replaySeedRequest 
     * @return [ReplaySeedResponse]
     */
    @POST("api/v1/biometrics/replay-seed")
    suspend fun seedBiometricReplay(@Body replaySeedRequest: ReplaySeedRequest): Response<ReplaySeedResponse>

}
