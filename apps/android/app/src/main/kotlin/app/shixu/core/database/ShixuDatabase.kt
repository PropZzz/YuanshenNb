package app.shixu.core.database

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "pending_biometrics")
data class PendingBiometric(@PrimaryKey val id: String, val ownerId: String, val payload: String, val queuedAt: Long)

@Entity(tableName = "schedule_snapshots", primaryKeys = ["ownerId", "localDay"])
data class ScheduleSnapshot(val ownerId: String, val localDay: String, val payload: String, val savedAt: Long)

@Dao
interface PendingDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun enqueue(samples: List<PendingBiometric>)
    @Query("SELECT * FROM pending_biometrics WHERE ownerId = :owner ORDER BY queuedAt, id LIMIT 500") suspend fun batch(owner: String): List<PendingBiometric>
    @Query("DELETE FROM pending_biometrics WHERE id IN (:ids)") suspend fun delete(ids: List<String>)
    @Query("SELECT COUNT(*) FROM pending_biometrics WHERE ownerId = :owner") fun count(owner: String): Flow<Int>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveSnapshot(snapshot: ScheduleSnapshot)
    @Query("SELECT * FROM schedule_snapshots WHERE ownerId = :owner AND localDay = :day") suspend fun snapshot(owner: String, day: String): ScheduleSnapshot?
}

@Database(entities = [PendingBiometric::class, ScheduleSnapshot::class], version = 1, exportSchema = true)
abstract class ShixuDatabase : RoomDatabase() { abstract fun pending(): PendingDao }
