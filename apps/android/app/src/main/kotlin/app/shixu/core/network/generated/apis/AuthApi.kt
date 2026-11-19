package app.shixu.core.network.generated.apis

import app.shixu.core.network.generated.infrastructure.CollectionFormats.*
import retrofit2.http.*
import retrofit2.Response
import okhttp3.RequestBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

import app.shixu.core.network.generated.models.AuthTokensResponse
import app.shixu.core.network.generated.models.LoginRequest
import app.shixu.core.network.generated.models.LogoutRequest
import app.shixu.core.network.generated.models.ProblemDetail
import app.shixu.core.network.generated.models.RefreshTokenRequest
import app.shixu.core.network.generated.models.RegisterRequest
import app.shixu.core.network.generated.models.UpdateMeRequest
import app.shixu.core.network.generated.models.UserProfile
import app.shixu.core.network.generated.models.WsTicketResponse

interface AuthApi {
    /**
     * GET api/v1/auth/me
     * 获取当前登录用户档案
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 500: Internal Server Error
     *
     * @return [UserProfile]
     */
    @GET("api/v1/auth/me")
    suspend fun getCurrentUser(): Response<UserProfile>

    /**
     * POST api/v1/auth/ws-ticket
     * 签发 30 秒一次性 WebSocket 握手票据
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 500: Internal Server Error
     *
     * @return [WsTicketResponse]
     */
    @POST("api/v1/auth/ws-ticket")
    suspend fun issueWsTicket(): Response<WsTicketResponse>

    /**
     * POST api/v1/auth/login
     * Argon2id 密码校验登录并签发令牌族
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param loginRequest 
     * @return [AuthTokensResponse]
     */
    @POST("api/v1/auth/login")
    suspend fun loginUser(@Body loginRequest: LoginRequest): Response<AuthTokensResponse>

    /**
     * POST api/v1/auth/logout
     * 吊销当前设备 Refresh Token 并清除 Cookie
     * 
     * Responses:
     *  - 204: No Content
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param logoutRequest  (optional)
     * @return [Unit]
     */
    @POST("api/v1/auth/logout")
    suspend fun logoutUser(@Body logoutRequest: LogoutRequest? = null): Response<Unit>

    /**
     * POST api/v1/auth/refresh
     * 轮换 Refresh Token（支持 JSON Body 或 HttpOnly Cookie，含重放盗用检测）
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param refreshTokenRequest  (optional)
     * @return [AuthTokensResponse]
     */
    @POST("api/v1/auth/refresh")
    suspend fun refreshTokens(@Body refreshTokenRequest: RefreshTokenRequest? = null): Response<AuthTokensResponse>

    /**
     * POST api/v1/auth/register
     * 注册新账号并初始化默认精力节律档案
     * 
     * Responses:
     *  - 201: Created
     *  - 409: Conflict
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param registerRequest 
     * @return [AuthTokensResponse]
     */
    @POST("api/v1/auth/register")
    suspend fun registerUser(@Body registerRequest: RegisterRequest): Response<AuthTokensResponse>

    /**
     * PATCH api/v1/auth/me
     * 更新用户昵称、时区或外观主题偏好
     * 
     * Responses:
     *  - 200: OK
     *  - 401: Unauthorized
     *  - 422: Unprocessable Entity
     *  - 500: Internal Server Error
     *
     * @param updateMeRequest 
     * @return [UserProfile]
     */
    @PATCH("api/v1/auth/me")
    suspend fun updateCurrentUser(@Body updateMeRequest: UpdateMeRequest): Response<UserProfile>

}
