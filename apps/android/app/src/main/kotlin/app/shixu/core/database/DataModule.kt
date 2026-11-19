package app.shixu.core.database

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module @InstallIn(SingletonComponent::class)
object DataModule {
    @Provides @Singleton fun database(@ApplicationContext context: Context): ShixuDatabase = Room.databaseBuilder(context, ShixuDatabase::class.java, "shixu-pending-v2.db").build()
    @Provides fun pending(database: ShixuDatabase): PendingDao = database.pending()
}
