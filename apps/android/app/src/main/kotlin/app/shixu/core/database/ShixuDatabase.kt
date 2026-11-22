package app.shixu.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        PendingBiometricEntity::class,
        CachedScheduleItemEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class ShixuDatabase : RoomDatabase() {
    abstract fun pendingBiometricDao(): PendingBiometricDao
    abstract fun cachedScheduleDao(): CachedScheduleDao
}
