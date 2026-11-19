package app.shixu.core.network.generated.apis

import app.shixu.core.network.generated.infrastructure.CollectionFormats.*
import retrofit2.http.*
import retrofit2.Response
import okhttp3.RequestBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import app.shixu.core.network.generated.models.HealthResponse
import app.shixu.core.network.generated.models.ProblemDetail

interface SystemApi {
    /**
     * GET api/v1/health
     * 数据库与服务连通性探针
     * 
     * Responses:
     *  - 200: OK
     *  - 500: Internal Server Error
     *  - 503: Service Unavailable
     *
     * @return [HealthResponse]
     */
    @GET("api/v1/health")
    suspend fun getHealth(): Response<HealthResponse>

}
