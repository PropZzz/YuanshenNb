package app.shixu.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingBiometricDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnore(items: List<PendingBiometricEntity>): List<Long>

    @Query("SELECT * FROM pending_biometrics ORDER BY recordedAtIso ASC, id ASC LIMIT :limit")
    suspend fun peekBatch(limit: Int = 500): List<PendingBiometricEntity>

    @Query("DELETE FROM pending_biometrics WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("UPDATE pending_biometrics SET retryCount = retryCount + 1 WHERE id IN (:ids)")
    suspend fun incrementRetry(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM pending_biometrics")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM pending_biometrics")
    suspend fun countPending(): Int

    @Query("DELETE FROM pending_biometrics")
    suspend fun clearAll()
}
