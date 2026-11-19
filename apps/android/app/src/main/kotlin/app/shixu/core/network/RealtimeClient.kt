package app.shixu.core.network

import app.shixu.BuildConfig
import app.shixu.core.database.TodaySnapshotStore
import app.shixu.core.network.generated.models.UserProfile
import app.shixu.core.ui.ScheduleNotifications
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

data class RealtimeInvalidation(val energy: Boolean = false, val schedule: Boolean = false, val team: Boolean = false)

@Singleton
class RealtimeClient @Inject constructor(private val api: ClientServices, client: OkHttpClient, private val snapshots: TodaySnapshotStore, private val notifications: ScheduleNotifications) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // Avoid logging the short-lived single-use handshake ticket.
    private val sockets = client.newBuilder().apply { interceptors().clear(); authenticator(Authenticator.NONE) }.build()
    private val _updates = MutableSharedFlow<RealtimeInvalidation>(extraBufferCapacity = 32)
    val updates = _updates.asSharedFlow()
    private val _status = MutableStateFlow("未连接")
    val status = _status.asStateFlow()
    private var job: Job? = null
    private var socket: WebSocket? = null
    private var currentUser: String? = null
    fun start(user: UserProfile?) {
        val identity = user?.let { "${it.id}:${it.timezone}" }
        if (currentUser == identity && job?.isActive == true) return
        job?.cancel(); socket?.close(1000, "session changed"); currentUser = identity
        if (user == null) { _status.value = "未连接"; notifications.clear(); return }
        job = scope.launch {
            val sessionScope = this
            val zone = runCatching { ZoneId.of(user.timezone) }.getOrDefault(ZoneId.systemDefault())
            var attempt = 0
            while (isActive && api.tokens.refreshToken() != null) {
                val disconnected = CompletableDeferred<Unit>()
                try {
                    _status.value = "连接中"
                    val ticket = api.auth.issueWsTicket().requireBody().ticket
                    val url = BuildConfig.API_BASE_URL.toHttpUrl().newBuilder().addPathSegments("api/v1/ws").addQueryParameter("ticket", ticket).build()
                    socket = sockets.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) {
                            attempt = 0; _status.value = "已连接"
                            sessionScope.launch { runCatching { snapshots.refresh(user.id.toString(), zone) }; _updates.emit(RealtimeInvalidation(energy = true, schedule = true, team = true)) }
                        }
                        override fun onMessage(webSocket: WebSocket, text: String) {
                            val event = WsEventParser.parse(text) ?: return
                            sessionScope.launch {
                                val schedule = event is WsEvent.ScheduleUpdated || event is WsEvent.WorkspaceMeetingConfirmed || event is WsEvent.WorkspaceMeetingCancelled || event is WsEvent.WorkspaceMeetingResponded
                                if (schedule) runCatching { snapshots.refresh(user.id.toString(), zone) }
                                if (event is WsEvent.EnergyOverloadAlert) notifications.overload(event.payload.message)
                                _updates.emit(RealtimeInvalidation(energy = event is WsEvent.EnergyUpdated || event is WsEvent.EnergyOverloadAlert || schedule, schedule = schedule, team = event is WsEvent.AvailabilityChanged || schedule))
                            }
                        }
                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { disconnected.complete(Unit) }
                        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason); disconnected.complete(Unit) }
                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { disconnected.complete(Unit) }
                    })
                    disconnected.await()
                } catch (e: CancellationException) { throw e } catch (_: Exception) { /* Retain cached UI, then obtain a fresh ticket. */ }
                _status.value = "断线重连"
                delay(listOf(1000L, 2000L, 5000L, 15000L)[attempt.coerceAtMost(3)] + Random.nextLong(500))
                attempt++
            }
        }
    }
}
