package app.shixu.core.database

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideShixuDatabase(
        @ApplicationContext context: Context,
    ): ShixuDatabase =
        Room.databaseBuilder(
            context,
            ShixuDatabase::class.java,
            "shixu_v2.db",
        ).build()

    @Provides
    fun providePendingBiometricDao(db: ShixuDatabase): PendingBiometricDao = db.pendingBiometricDao()

    @Provides
    fun provideCachedScheduleDao(db: ShixuDatabase): CachedScheduleDao = db.cachedScheduleDao()
}
