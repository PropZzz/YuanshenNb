package app.shixu.core.network.di

import app.shixu.BuildConfig
import app.shixu.core.network.AuthInterceptor
import app.shixu.core.network.ProblemDetailParser
import app.shixu.core.network.Rfc3339StringConverterFactory
import app.shixu.core.network.SessionEvent
import app.shixu.core.network.SessionEventBus
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.TokenAuthenticator
import app.shixu.core.network.TokenStore
import app.shixu.core.network.generated.apis.AuthApi
import app.shixu.core.network.generated.apis.BiometricsApi
import app.shixu.core.network.generated.apis.EnergyApi
import app.shixu.core.network.generated.apis.ScheduleApi
import app.shixu.core.network.generated.apis.SystemApi
import app.shixu.core.network.generated.apis.WorkspacesApi
import app.shixu.core.network.generated.models.ErrorCode
import app.shixu.core.network.generated.models.RefreshTokenRequest
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.converter.scalars.ScalarsConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class WsOkHttpClient

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = ShixuJson.json

    @Provides
    @Singleton
    fun provideTokenAuthenticator(
        tokenStore: TokenStore,
        sessionEventBus: SessionEventBus,
        json: Json,
    ): TokenAuthenticator {
        val refreshClient = newBaseClientBuilder().build()
        val refreshRetrofit = newRetrofit(refreshClient, json)
        val refreshApi = refreshRetrofit.create(AuthApi::class.java)

        var specificEventEmitted = false
        return TokenAuthenticator(
            tokenStore = tokenStore,
            onInvalidSession = {
                if (!specificEventEmitted) {
                    sessionEventBus.tryEmit(
                        SessionEvent.SessionExpired("登录状态已过期，请重新登录"),
                    )
                }
                specificEventEmitted = false
            },
        ) { refreshToken ->
            specificEventEmitted = false
            runBlocking {
                val response = refreshApi.refreshTokens(RefreshTokenRequest(refreshToken = refreshToken))
                if (response.code() >= 500 || response.code() == 429) {
                    throw java.io.IOException("Refresh temporarily unavailable (${response.code()})")
                }
                if (response.isSuccessful) {
                    response.body()
                } else {
                    val problem = ProblemDetailParser.parse(response)
                    when (problem?.code) {
                        ErrorCode.TOKEN_REUSE_DETECTED -> {
                            specificEventEmitted = true
                            sessionEventBus.tryEmit(
                                SessionEvent.TokenReuseDetected(
                                    problem.detail.ifBlank { "检测到会话异常，请重新登录" },
                                ),
                            )
                        }
                        ErrorCode.INVALID_REFRESH_TOKEN -> {
                            specificEventEmitted = true
                            sessionEventBus.tryEmit(
                                SessionEvent.SessionExpired(
                                    problem.detail.ifBlank { "登录状态已过期，请重新登录" },
                                ),
                            )
                        }
                        else -> if (response.code() == 401) {
                            specificEventEmitted = true
                            sessionEventBus.tryEmit(
                                SessionEvent.SessionExpired("登录状态已过期，请重新登录"),
                            )
                        }
                    }
                    null
                }
            }
        }
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        tokenAuthenticator: TokenAuthenticator,
    ): OkHttpClient =
        newBaseClientBuilder()
            .addInterceptor(authInterceptor)
            .authenticator(tokenAuthenticator)
            .build()

    @Provides
    @Singleton
    @WsOkHttpClient
    fun provideWsOkHttpClient(): OkHttpClient =
        newBaseClientBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()

    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        json: Json,
    ): Retrofit = newRetrofit(okHttpClient, json)

    @Provides
    @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)

    @Provides
    @Singleton
    fun provideBiometricsApi(retrofit: Retrofit): BiometricsApi = retrofit.create(BiometricsApi::class.java)

    @Provides
    @Singleton
    fun provideEnergyApi(retrofit: Retrofit): EnergyApi = retrofit.create(EnergyApi::class.java)

    @Provides
    @Singleton
    fun provideScheduleApi(retrofit: Retrofit): ScheduleApi = retrofit.create(ScheduleApi::class.java)

    @Provides
    @Singleton
    fun provideWorkspacesApi(retrofit: Retrofit): WorkspacesApi = retrofit.create(WorkspacesApi::class.java)

    @Provides
    @Singleton
    fun provideSystemApi(retrofit: Retrofit): SystemApi = retrofit.create(SystemApi::class.java)

    private fun newBaseClientBuilder(): OkHttpClient.Builder {
        val builder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)

        if (BuildConfig.DEBUG) {
            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
                redactHeader("Authorization")
                redactHeader("Cookie")
            }
            builder.addInterceptor(logging)
        }
        return builder
    }

    private fun newRetrofit(client: OkHttpClient, json: Json): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(Rfc3339StringConverterFactory)
            .addConverterFactory(ScalarsConverterFactory.create())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
}
