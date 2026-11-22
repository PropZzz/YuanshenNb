package app.shixu.core.network

import app.shixu.BuildConfig
import app.shixu.core.network.di.WsOkHttpClient
import app.shixu.core.network.generated.apis.AuthApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.URLEncoder
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

sealed interface WsConnectionState {
    data object Disconnected : WsConnectionState
    data object Connecting : WsConnectionState
    data object Connected : WsConnectionState
    data class Reconnecting(val attempt: Int, val nextRetryMs: Long) : WsConnectionState
}

/**
 * 基于短效一次性 ticket 的 WebSocket 实时协同控制器，支持 30s Ping/Pong 保活与指数退避重连补偿。
 */
@Singleton
class ShixuWebSocketManager @Inject constructor(
    private val authApi: AuthApi,
    @WsOkHttpClient private val wsClient: OkHttpClient,
    private val tokenStore: TokenStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _connectionState = MutableStateFlow<WsConnectionState>(WsConnectionState.Disconnected)
    val connectionState: StateFlow<WsConnectionState> = _connectionState.asStateFlow()

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<WsEvent> = _events.asSharedFlow()

    private val _connectedSignal = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    val connectedSignal: SharedFlow<Unit> = _connectedSignal.asSharedFlow()

    @Volatile
    private var connectionLoopJob: Job? = null

    @Volatile
    private var activeSocket: WebSocket? = null

    @Synchronized
    fun start() {
        if (connectionLoopJob?.isActive == true) return
        connectionLoopJob = scope.launch {
            runReconnectLoop()
        }
    }

    @Synchronized
    fun stop() {
        connectionLoopJob?.cancel()
        connectionLoopJob = null
        activeSocket?.close(NORMAL_CLOSE_CODE, "client_stopped")
        activeSocket = null
        _connectionState.value = WsConnectionState.Disconnected
    }

    @Synchronized
    fun ensureConnected() {
        if (connectionLoopJob?.isActive != true) {
            start()
        }
    }

    private suspend fun runReconnectLoop() {
        var attempt = 0
        while (scope.isActive) {
            if (tokenStore.accessToken().isNullOrBlank() && tokenStore.refreshToken().isNullOrBlank()) {
                _connectionState.value = WsConnectionState.Disconnected
                return
            }

            _connectionState.value = if (attempt == 0) {
                WsConnectionState.Connecting
            } else {
                WsConnectionState.Reconnecting(attempt = attempt, nextRetryMs = 0L)
            }

            val ticketResult = safeApiCall { authApi.issueWsTicket() }
            if (ticketResult is ApiResult.Success) {
                val closedSignal = CompletableDeferred<Boolean>()
                val wsUrl = buildWsUrl(BuildConfig.API_BASE_URL, ticketResult.data.ticket)
                val request = Request.Builder().url(wsUrl).build()

                val socket = wsClient.newWebSocket(
                    request,
                    object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) {
                            attempt = 0
                            _connectionState.value = WsConnectionState.Connected
                            _connectedSignal.tryEmit(Unit)
                        }

                        override fun onMessage(webSocket: WebSocket, text: String) {
                            WsEventParser.parse(text)?.let { parsed ->
                                _events.tryEmit(parsed)
                            }
                        }

                        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                            webSocket.close(NORMAL_CLOSE_CODE, null)
                        }

                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                            closedSignal.complete(code == NORMAL_CLOSE_CODE)
                        }

                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                            closedSignal.complete(false)
                        }
                    },
                )
                activeSocket = socket
                val normalClose = closedSignal.await()
                activeSocket = null
                if (normalClose) {
                    _connectionState.value = WsConnectionState.Disconnected
                    return
                }
            }

            val baseDelay = BACKOFF_STEPS_MS[attempt.coerceAtMost(BACKOFF_STEPS_MS.lastIndex)]
            val waitMs = baseDelay + Random.nextLong(0L, 500L)
            attempt++
            _connectionState.value = WsConnectionState.Reconnecting(attempt = attempt, nextRetryMs = waitMs)
            delay(waitMs)
        }
    }

    internal fun buildWsUrl(apiBaseUrl: String, ticket: String): String {
        val trimmed = if (apiBaseUrl.endsWith("/")) apiBaseUrl else "$apiBaseUrl/"
        val wsBase = when {
            trimmed.startsWith("https://", ignoreCase = true) -> "wss://" + trimmed.substring(8)
            trimmed.startsWith("http://", ignoreCase = true) -> "ws://" + trimmed.substring(7)
            else -> "ws://$trimmed"
        }
        val encodedTicket = URLEncoder.encode(ticket, Charsets.UTF_8.name())
        return "${wsBase}api/v1/ws?ticket=$encodedTicket"
    }

    private companion object {
        const val NORMAL_CLOSE_CODE = 1000
        val BACKOFF_STEPS_MS = longArrayOf(1_000L, 2_000L, 5_000L, 15_000L)
    }
}
