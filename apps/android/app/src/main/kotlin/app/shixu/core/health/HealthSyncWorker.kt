package app.shixu.core.health

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface HealthSyncWorkerEntryPoint {
    fun healthSyncCoordinator(): HealthSyncCoordinator
}

/**
 * 15 分钟周期及前台唤醒触发的穿戴同步 Worker，断网或 5xx 时交由 WorkManager 指数退避重试。
 */
class HealthSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            HealthSyncWorkerEntryPoint::class.java,
        )
        val report = entryPoint.healthSyncCoordinator().syncNow()
        return when (report.flushResult) {
            is BiometricFlushResult.RetryableFailure -> Result.retry()
            else -> Result.success()
        }
    }
}
