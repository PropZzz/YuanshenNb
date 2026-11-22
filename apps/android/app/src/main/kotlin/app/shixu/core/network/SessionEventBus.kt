package app.shixu.core.network

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

sealed interface SessionEvent {
    val detail: String

    data class TokenReuseDetected(override val detail: String) : SessionEvent
    data class SessionExpired(override val detail: String) : SessionEvent
}

/**
 * 网络鉴权异常事件总线，用于在 Refresh Token 重放吊销或过期时通知会话状态机立即退回登录页。
 */
@Singleton
class SessionEventBus @Inject constructor() {
    private val _events = MutableSharedFlow<SessionEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<SessionEvent> = _events.asSharedFlow()

    fun tryEmit(event: SessionEvent) {
        _events.tryEmit(event)
    }
}
