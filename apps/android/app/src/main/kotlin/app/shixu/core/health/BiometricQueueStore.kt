package app.shixu.core.health

import app.shixu.core.database.PendingBiometricDao
import app.shixu.core.database.PendingBiometricEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 生理待上传队列存储抽象，解耦 Room 实现以支撑高覆盖率的纯 Kotlin 单元测试。
 */
interface BiometricQueueStore {
    suspend fun enqueue(items: List<PendingBiometricEntity>): Int
    suspend fun peekBatch(limit: Int): List<PendingBiometricEntity>
    suspend fun deleteByIds(ids: List<Long>)
    suspend fun incrementRetry(ids: List<Long>)
    suspend fun countPending(): Int
    fun observePendingCount(): Flow<Int>
    suspend fun clearAll()
}

@Singleton
class RoomBiometricQueueStore @Inject constructor(
    private val dao: PendingBiometricDao,
) : BiometricQueueStore {
    override suspend fun enqueue(items: List<PendingBiometricEntity>): Int {
        if (items.isEmpty()) return 0
        val inserted = dao.insertAllIgnore(items)
        return inserted.count { it != -1L }
    }

    override suspend fun peekBatch(limit: Int): List<PendingBiometricEntity> = dao.peekBatch(limit)

    override suspend fun deleteByIds(ids: List<Long>) {
        if (ids.isNotEmpty()) dao.deleteByIds(ids)
    }

    override suspend fun incrementRetry(ids: List<Long>) {
        if (ids.isNotEmpty()) dao.incrementRetry(ids)
    }

    override suspend fun countPending(): Int = dao.countPending()

    override fun observePendingCount(): Flow<Int> = dao.observePendingCount()

    override suspend fun clearAll() {
        dao.clearAll()
    }
}
