package app.shixu.core.ble

import app.shixu.core.database.PendingBiometricEntity
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.SourceType
import kotlinx.serialization.encodeToString
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * BLE 0x2A37 60 秒滑窗聚合器：
 * - 剔除超出 300..2000ms 范围或相对上一有效点跳变 > 25% 的伪影 RR 间期；
 * - 按 60 秒窗口聚合均值 heart_rate 与 RMSSD hrv_rmssd；
 * - 生成确定性幂等键 ble:{deviceHash}:{metricType}:{recordedAtEpochSec}。
 */
class RrWindowAggregator(
    private val deviceIdentifier: String,
    private val deviceName: String? = null,
    private val nowMsProvider: () -> Long = { System.currentTimeMillis() },
) {
    val devHash: String = deviceHash(deviceIdentifier)

    private var currentBucketStartSec: Long? = null
    private var lastPacketEpochSec: Long? = null
    private var lastAcceptedRrMs: Double? = null

    private val bucketHeartRates = mutableListOf<Int>()
    private val bucketCleanRrMs = mutableListOf<Double>()

    var totalValidRrCount: Int = 0
        private set
    var totalRejectedRrCount: Int = 0
        private set
    var latestRmssdMs: Double? = null
        private set

    fun addMeasurement(
        measurement: ParsedHeartRateMeasurement,
        timestampEpochSec: Long,
    ): List<PendingBiometricEntity> {
        val bucketStartSec = (timestampEpochSec / WINDOW_SECONDS) * WINDOW_SECONDS
        val emitted = mutableListOf<PendingBiometricEntity>()

        val previousBucket = currentBucketStartSec
        if (previousBucket != null && bucketStartSec > previousBucket) {
            emitted += emitBucket(previousBucket)
        }

        // 若断连或停顿超过 15 秒，重置前值参考避免误杀新佩戴周期的首个正常 RR 间期
        val prevPacket = lastPacketEpochSec
        if (prevPacket != null && (timestampEpochSec - prevPacket) > CONTINUITY_GAP_SECONDS) {
            lastAcceptedRrMs = null
        }

        currentBucketStartSec = bucketStartSec
        lastPacketEpochSec = timestampEpochSec

        if (measurement.heartRateBpm in MIN_HR_BPM..MAX_HR_BPM) {
            bucketHeartRates += measurement.heartRateBpm
        }

        for (rr in measurement.rrIntervalsMs) {
            if (!rr.isFinite() || rr < MIN_RR_MS || rr > MAX_RR_MS) {
                totalRejectedRrCount++
                continue
            }
            val prevRr = lastAcceptedRrMs
            if (prevRr != null && abs(rr - prevRr) / prevRr > MAX_RR_JUMP_RATIO) {
                totalRejectedRrCount++
                continue
            }
            bucketCleanRrMs += rr
            lastAcceptedRrMs = rr
            totalValidRrCount++
        }

        latestRmssdMs = computeRmssd(bucketCleanRrMs) ?: latestRmssdMs
        return emitted
    }

    fun flushCurrentWindow(): List<PendingBiometricEntity> {
        val bucket = currentBucketStartSec ?: return emptyList()
        currentBucketStartSec = null
        return emitBucket(bucket)
    }

    private fun emitBucket(bucketStartSec: Long): List<PendingBiometricEntity> {
        val hrValues = bucketHeartRates.toList()
        val rrValues = bucketCleanRrMs.toList()
        bucketHeartRates.clear()
        bucketCleanRrMs.clear()

        if (hrValues.isEmpty() && rrValues.size < 2) {
            return emptyList()
        }

        val recordedIso = formatUtc(Instant.ofEpochSecond(bucketStartSec))
        val endIso = formatUtc(Instant.ofEpochSecond(bucketStartSec + WINDOW_SECONDS))
        val metadata = buildDeviceMetadata()
        val createdAtMs = nowMsProvider()
        val entities = mutableListOf<PendingBiometricEntity>()

        if (hrValues.isNotEmpty()) {
            val meanHr = hrValues.average()
            if (meanHr in MIN_HR_BPM.toDouble()..MAX_HR_BPM.toDouble()) {
                entities += PendingBiometricEntity(
                    sourceType = SourceType.ble_gatt.value,
                    metricType = MetricType.heart_rate.value,
                    recordedAtIso = recordedIso,
                    endAtIso = endIso,
                    numericValue = meanHr,
                    unit = "bpm",
                    sleepStage = null,
                    externalId = deterministicExternalId(devHash, MetricType.heart_rate, bucketStartSec),
                    metadataJson = metadata,
                    createdAtEpochMs = createdAtMs,
                )
            }
        }

        val rmssd = computeRmssd(rrValues)
        if (rmssd != null && rmssd in MIN_VALID_RMSSD_MS..MAX_VALID_RMSSD_MS) {
            latestRmssdMs = rmssd
            entities += PendingBiometricEntity(
                sourceType = SourceType.ble_gatt.value,
                metricType = MetricType.hrv_rmssd.value,
                recordedAtIso = recordedIso,
                endAtIso = endIso,
                numericValue = rmssd,
                unit = "ms",
                sleepStage = null,
                externalId = deterministicExternalId(devHash, MetricType.hrv_rmssd, bucketStartSec),
                metadataJson = metadata,
                createdAtEpochMs = createdAtMs,
            )
        }

        return entities
    }

    private fun buildDeviceMetadata(): String? {
        val name = deviceName?.takeIf { it.isNotBlank() } ?: return null
        return ShixuJson.json.encodeToString(mapOf("deviceName" to name, "deviceHash" to devHash))
    }

    private fun formatUtc(instant: Instant): String =
        DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(instant.atOffset(ZoneOffset.UTC))

    companion object {
        const val WINDOW_SECONDS = 60L
        const val MAX_RR_JUMP_RATIO = 0.25
        const val MIN_RR_MS = 300.0
        const val MAX_RR_MS = 2000.0
        const val MIN_HR_BPM = 30
        const val MAX_HR_BPM = 220
        const val MIN_VALID_RMSSD_MS = 1.0
        const val MAX_VALID_RMSSD_MS = 250.0
        private const val CONTINUITY_GAP_SECONDS = 15L

        fun deviceHash(deviceIdentifier: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(deviceIdentifier.trim().lowercase().toByteArray(Charsets.UTF_8))
            return digest.take(4).joinToString("") { byte -> "%02x".format(byte) }
        }

        fun deterministicExternalId(
            deviceHash: String,
            metricType: MetricType,
            windowStartEpochSec: Long,
        ): String = "ble:$deviceHash:${metricType.value}:$windowStartEpochSec"

        fun computeRmssd(cleanRrMs: List<Double>): Double? {
            if (cleanRrMs.size < 2) return null
            var sumSquaredDiff = 0.0
            for (i in 0 until cleanRrMs.size - 1) {
                val diff = cleanRrMs[i + 1] - cleanRrMs[i]
                sumSquaredDiff += diff * diff
            }
            return sqrt(sumSquaredDiff / (cleanRrMs.size - 1))
        }
    }
}
