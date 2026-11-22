package app.shixu.core.health

import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.TokenStore
import app.shixu.core.network.generated.models.EnergyTodayResponse
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import javax.inject.Singleton

data class HealthSyncReport(
    val sdkStatus: HealthConnectSdkStatus,
    val grantedPermissions: Set<String>,
    val missingPermissionLabels: List<String>,
    val enqueuedCount: Int,
    val flushResult: BiometricFlushResult,
    val usedFallback48h: Boolean,
    val syncedAtEpochMs: Long,
    val summary: String,
)

/**
 * 统一编排 Health Connect 首次 14 天基线回拉、ChangesToken 增量拉取、Token 过期 48h 兜底重拉及 Room 离线队列批量上报。
 */
@Singleton
class HealthSyncCoordinator @Inject constructor(
    private val gateway: HealthConnectGateway,
    private val uploadQueue: BiometricUploadQueue,
    private val syncPreferencesStore: SyncPreferencesStore,
    private val tokenStore: TokenStore,
    private val clock: () -> Instant,
) {
    private val syncMutex = Mutex()

    private val _lastSyncReport = MutableStateFlow<HealthSyncReport?>(null)
    val lastSyncReport: StateFlow<HealthSyncReport?> = _lastSyncReport.asStateFlow()

    private val _latestSyncedEnergy = MutableSharedFlow<EnergyTodayResponse>(extraBufferCapacity = 4)
    val latestSyncedEnergy: SharedFlow<EnergyTodayResponse> = _latestSyncedEnergy.asSharedFlow()

    suspend fun onPermissionsUpdated() {
        // 当用户新授予缺失的 Health Connect 权限后，清除旧 token 以便下次同步自动补拉对应类型 14 天基线
        syncPreferencesStore.clearHealthChangesToken()
    }

    suspend fun refreshStatusOnly(): HealthSyncReport {
        val status = gateway.sdkStatus()
        val granted = if (status == HealthConnectSdkStatus.AVAILABLE) {
            gateway.getGrantedPermissions()
        } else {
            emptySet()
        }
        val missing = HealthConnectPermissions.missingPermissionLabels(granted)
        val pending = uploadQueue.pendingCount()
        val report = HealthSyncReport(
            sdkStatus = status,
            grantedPermissions = granted,
            missingPermissionLabels = missing,
            enqueuedCount = 0,
            flushResult = if (pending == 0) BiometricFlushResult.Empty else BiometricFlushResult.RetryableFailure("待上传 $pending 条", pending),
            usedFallback48h = false,
            syncedAtEpochMs = clock().toEpochMilli(),
            summary = buildStatusSummary(status, granted, missing, pending),
        )
        _lastSyncReport.value = report
        return report
    }

    suspend fun syncNow(): HealthSyncReport = syncMutex.withLock {
        val now = clock()
        val status = gateway.sdkStatus()
        val granted = if (status == HealthConnectSdkStatus.AVAILABLE) {
            gateway.getGrantedPermissions().intersect(HealthConnectPermissions.REQUIRED_PERMISSIONS)
        } else {
            emptySet()
        }
        val missing = HealthConnectPermissions.missingPermissionLabels(granted)

        var metadata = syncPreferencesStore.readMetadata()
        var enqueuedCount = 0
        var usedFallback48h = false
        var updatedToken = metadata.healthConnectChangesToken
        var initialSynced = metadata.initialHistorySynced

        if (status == HealthConnectSdkStatus.AVAILABLE && granted.isNotEmpty()) {
            if (!metadata.initialHistorySynced || metadata.healthConnectChangesToken.isNullOrBlank()) {
                val start14d = now.minus(INITIAL_BASELINE_DAYS, ChronoUnit.DAYS)
                val records = runCatching {
                    gateway.readRecordsInRange(start14d, now, granted)
                }.getOrDefault(emptyList())
                enqueuedCount += uploadQueue.enqueue(records)
                updatedToken = gateway.getChangesToken(granted)
                initialSynced = true
            } else {
                when (val changes = runCatching {
                    gateway.getChanges(metadata.healthConnectChangesToken!!, granted)
                }.getOrElse { HealthChangesResult.TokenExpired }) {
                    is HealthChangesResult.Success -> {
                        enqueuedCount += uploadQueue.enqueue(changes.samples)
                        updatedToken = changes.nextToken
                    }

                    HealthChangesResult.TokenExpired -> {
                        usedFallback48h = true
                        val start48h = now.minus(EXPIRED_FALLBACK_HOURS, ChronoUnit.HOURS)
                        val fallbackRecords = runCatching {
                            gateway.readRecordsInRange(start48h, now, granted)
                        }.getOrDefault(emptyList())
                        enqueuedCount += uploadQueue.enqueue(fallbackRecords)
                        updatedToken = gateway.getChangesToken(granted)
                    }
                }
            }
        }

        val hasCredentials = !tokenStore.accessToken().isNullOrBlank() || !tokenStore.refreshToken().isNullOrBlank()
        val flushResult = if (hasCredentials) {
            uploadQueue.flushPending()
        } else {
            BiometricFlushResult.Unauthenticated
        }

        if (flushResult is BiometricFlushResult.Success && flushResult.latestEnergy != null) {
            syncPreferencesStore.saveCachedEnergyJson(ShixuJson.json.encodeToString(flushResult.latestEnergy))
            _latestSyncedEnergy.tryEmit(flushResult.latestEnergy)
        }

        val summary = buildSyncSummary(
            status = status,
            granted = granted,
            missing = missing,
            enqueuedCount = enqueuedCount,
            flushResult = flushResult,
            usedFallback48h = usedFallback48h,
        )

        syncPreferencesStore.updateHealthConnectSync(
            changesToken = updatedToken,
            initialHistorySynced = initialSynced,
            syncedAtEpochMs = now.toEpochMilli(),
            summary = summary,
        )

        val report = HealthSyncReport(
            sdkStatus = status,
            grantedPermissions = granted,
            missingPermissionLabels = missing,
            enqueuedCount = enqueuedCount,
            flushResult = flushResult,
            usedFallback48h = usedFallback48h,
            syncedAtEpochMs = now.toEpochMilli(),
            summary = summary,
        )
        _lastSyncReport.value = report
        return@withLock report
    }

    private fun buildStatusSummary(
        status: HealthConnectSdkStatus,
        granted: Set<String>,
        missing: List<String>,
        pending: Int,
    ): String = when {
        status == HealthConnectSdkStatus.UNAVAILABLE -> "当前设备未安装或不支持 Health Connect，可改用 BLE 0x180D 或测试回放"
        status == HealthConnectSdkStatus.UPDATE_REQUIRED -> "Health Connect 需要更新后方可使用"
        granted.isEmpty() -> "尚未授予 Health Connect 生理读取权限"
        missing.isNotEmpty() -> "已授权 ${granted.size}/5 项权限（缺：${missing.joinToString("、")}），待传 $pending 条"
        else -> "Health Connect 全量权限已就绪，待传队列 $pending 条"
    }

    private fun buildSyncSummary(
        status: HealthConnectSdkStatus,
        granted: Set<String>,
        missing: List<String>,
        enqueuedCount: Int,
        flushResult: BiometricFlushResult,
        usedFallback48h: Boolean,
    ): String {
        val prefix = when {
            status != HealthConnectSdkStatus.AVAILABLE -> "Health Connect 不可用"
            granted.isEmpty() -> "未授权 Health Connect"
            usedFallback48h -> "ChangesToken 已过期并完成 48h 兜底回拉（入队 $enqueuedCount 条）"
            else -> "本次拉取入队 $enqueuedCount 条"
        }
        val uploadPart = when (flushResult) {
            BiometricFlushResult.Empty -> "无待传样本"
            BiometricFlushResult.Unauthenticated -> "未登录，暂存本地队列"
            is BiometricFlushResult.Success -> "已上传 ${flushResult.acceptedCount} 条（去重 ${flushResult.deduplicatedCount}）"
            is BiometricFlushResult.RetryableFailure -> "暂存待补传 ${flushResult.remainingPendingCount} 条"
        }
        val missingPart = if (missing.isNotEmpty()) "；缺失权限：${missing.joinToString("、")}" else ""
        return "$prefix · $uploadPart$missingPart"
    }

    private companion object {
        const val INITIAL_BASELINE_DAYS = 14L
        const val EXPIRED_FALLBACK_HOURS = 48L
    }
}
