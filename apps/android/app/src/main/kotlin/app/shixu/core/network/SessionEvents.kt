package app.shixu.core.network

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton class SessionEvents @Inject constructor() {
    private val expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val expirations = expired.asSharedFlow()
    fun notifyExpired() { expired.tryEmit(Unit) }
}
