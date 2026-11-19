package app.shixu.core.health

import android.content.Context
import android.app.ActivityManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.shixu.core.network.ApiFailure
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException

class HealthSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        val process = ActivityManager.RunningAppProcessInfo().also(ActivityManager::getMyMemoryState)
        EntryPointAccessors.fromApplication(applicationContext, Dependencies::class.java).healthSync().sync(background = process.importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND)
        Result.success()
    } catch (e: CancellationException) { throw e }
    catch (_: SecurityException) { Result.success() } // Revoked Health Connect permission is surfaced in the foreground.
    catch (e: ApiFailure) { if (e.status in 400..499 && e.status != 429) Result.failure() else Result.retry() }
    catch (_: java.io.IOException) { Result.retry() }
    catch (_: Exception) { Result.retry() }
    @EntryPoint @InstallIn(SingletonComponent::class)
    interface Dependencies { fun healthSync(): HealthSync }
}
