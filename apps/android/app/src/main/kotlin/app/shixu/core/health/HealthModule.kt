package app.shixu.core.health

import android.content.Context
import androidx.work.WorkManager
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.time.Instant
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class HealthBindingsModule {

    @Binds
    @Singleton
    abstract fun bindBiometricQueueStore(impl: RoomBiometricQueueStore): BiometricQueueStore

    @Binds
    @Singleton
    abstract fun bindHealthConnectGateway(impl: AndroidHealthConnectGateway): HealthConnectGateway
}

@Module
@InstallIn(SingletonComponent::class)
object HealthModule {

    @Provides
    @Singleton
    fun provideWorkManager(
        @ApplicationContext context: Context,
    ): WorkManager = WorkManager.getInstance(context)

    @Provides
    @Singleton
    fun provideClock(): () -> Instant = { Instant.now() }
}
