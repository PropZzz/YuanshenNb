package app.shixu.core.health

import app.shixu.core.database.PendingBiometricEntity
import app.shixu.core.database.toDto
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.generated.apis.BiometricsApi
import app.shixu.core.network.generated.models.BiometricBatchRequest
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ErrorCode
import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.ProblemDetail
import app.shixu.core.network.safeApiCall
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

sealed interface BiometricFlushResult {
    data object Empty : BiometricFlushResult
    data object Unauthenticated : BiometricFlushResult
    data class Success(
        val acceptedCount: Int,
        val deduplicatedCount: Int,
        val evictedInvalidCount: Int,
        val latestEnergy: EnergyTodayResponse?,
    ) : BiometricFlushResult

    data class RetryableFailure(
        val reason: String,
        val remainingPendingCount: Int,
    ) : BiometricFlushResult
}

/**
 * 生理样本批量补传队列：按 <= 500 条分段上传，支持断网暂存保留原 externalId 重传及 422 坏点精准剔除。
 */
@Singleton
class BiometricUploadQueue @Inject constructor(
    private val queueStore: BiometricQueueStore,
    private val biometricsApi: BiometricsApi,
) {
    private val flushMutex = Mutex()

    val pendingCountFlow: Flow<Int> = queueStore.observePendingCount()

    suspend fun pendingCount(): Int = queueStore.countPending()

    suspend fun enqueue(items: List<PendingBiometricEntity>): Int = queueStore.enqueue(items)

    suspend fun clear() {
        queueStore.clearAll()
    }

    suspend fun flushPending(): BiometricFlushResult = flushMutex.withLock {
        var totalAccepted = 0
        var totalDeduplicated = 0
        var totalEvicted = 0
        var latestEnergy: EnergyTodayResponse? = null

        while (true) {
            val batch = queueStore.peekBatch(MAX_BATCH_SIZE)
            if (batch.isEmpty()) {
                return@withLock if (totalAccepted == 0 && totalDeduplicated == 0 && totalEvicted == 0) {
                    BiometricFlushResult.Empty
                } else {
                    BiometricFlushResult.Success(
                        acceptedCount = totalAccepted,
                        deduplicatedCount = totalDeduplicated,
                        evictedInvalidCount = totalEvicted,
                        latestEnergy = latestEnergy,
                    )
                }
            }

            val dtos = batch.map { it.toDto() }
            when (val result = safeApiCall { biometricsApi.ingestBiometricSamplesBatch(BiometricBatchRequest(dtos)) }) {
                is ApiResult.Success -> {
                    queueStore.deleteByIds(batch.map { it.id })
                    totalAccepted += result.data.acceptedCount.toInt()
                    totalDeduplicated += result.data.deduplicatedCount.toInt()
                    latestEnergy = result.data.latestEnergy
                }

                is ApiResult.HttpError -> {
                    when {
                        result.httpCode == 401 -> return@withLock BiometricFlushResult.Unauthenticated
                        result.httpCode == 422 && (
                            result.problem?.code == ErrorCode.INVALID_BIOMETRIC_SAMPLE ||
                                result.problem?.code == ErrorCode.VALIDATION_FAILED
                            ) -> {
                            val badIds = resolveInvalidBatchIds(batch, result.problem)
                            queueStore.deleteByIds(badIds)
                            totalEvicted += badIds.size
                        }
                        else -> {
                            queueStore.incrementRetry(batch.map { it.id })
                            return@withLock BiometricFlushResult.RetryableFailure(
                                reason = ErrorMessageMapper.messageFor(result),
                                remainingPendingCount = queueStore.countPending(),
                            )
                        }
                    }
                }

                is ApiResult.NetworkError -> {
                    queueStore.incrementRetry(batch.map { it.id })
                    return@withLock BiometricFlushResult.RetryableFailure(
                        reason = ErrorMessageMapper.messageFor(result),
                        remainingPendingCount = queueStore.countPending(),
                    )
                }
            }
        }
        error("Unreachable")
    }

    private fun resolveInvalidBatchIds(
        batch: List<PendingBiometricEntity>,
        problem: ProblemDetail?,
    ): List<Long> {
        val indexedBadIds = problem?.errors
            .orEmpty()
            .mapNotNull { err -> err.location }
            .flatMap { loc ->
                SAMPLE_INDEX_REGEX.findAll(loc)
                    .mapNotNull { match -> match.groupValues.getOrNull(1)?.toIntOrNull() }
                    .toList()
            }
            .filter { idx -> idx in batch.indices }
            .distinct()
            .map { idx -> batch[idx].id }

        if (indexedBadIds.isNotEmpty()) {
            return indexedBadIds
        }

        val outlierIds = batch.filter(::isPhysiologicalOutlier).map { it.id }
        if (outlierIds.isNotEmpty()) {
            return outlierIds
        }

        // 若服务端未返回字段下标且未命中本地阈值，仅剔除首条毒丸样本防止死循环重传
        return listOf(batch.first().id)
    }

    private fun isPhysiologicalOutlier(entity: PendingBiometricEntity): Boolean {
        val v = entity.numericValue
        if (!v.isFinite()) return true
        val start = runCatching { OffsetDateTime.parse(entity.recordedAtIso, DateTimeFormatter.ISO_OFFSET_DATE_TIME) }.getOrNull()
            ?: return true
        val end = entity.endAtIso?.let {
            runCatching { OffsetDateTime.parse(it, DateTimeFormatter.ISO_OFFSET_DATE_TIME) }.getOrNull() ?: return true
        }
        if (end != null && end.isBefore(start)) return true

        return when (MetricType.decode(entity.metricType)) {
            MetricType.heart_rate -> v < 30.0 || v > 220.0
            MetricType.resting_hr -> v < 25.0 || v > 180.0
            MetricType.hrv_rmssd -> v <= 0.0 || v > 250.0
            MetricType.sleep_session, MetricType.sleep_stage -> v <= 0.0 || v > 1440.0
            MetricType.active_calories -> v <= 0.0 || v > 20_000.0
            null -> true
        }
    }

    companion object {
        const val MAX_BATCH_SIZE = 500
        private val SAMPLE_INDEX_REGEX = Regex("""samples\[(\d+)]""")
    }
}
