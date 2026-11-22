package app.shixu.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface CachedScheduleDao {
    @Query("SELECT * FROM cached_schedule_items WHERE status != 'cancelled' ORDER BY startAtIso ASC")
    fun observeActiveItems(): Flow<List<CachedScheduleItemEntity>>

    @Query("SELECT * FROM cached_schedule_items WHERE status != 'cancelled' ORDER BY startAtIso ASC")
    suspend fun getActiveItems(): List<CachedScheduleItemEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<CachedScheduleItemEntity>)

    @Query("DELETE FROM cached_schedule_items")
    suspend fun clearAll()

    @Transaction
    suspend fun replaceAll(items: List<CachedScheduleItemEntity>) {
        clearAll()
        if (items.isNotEmpty()) {
            upsertAll(items)
        }
    }
}
