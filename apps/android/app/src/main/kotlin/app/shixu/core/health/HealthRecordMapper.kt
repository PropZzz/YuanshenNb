package app.shixu.core.health

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import app.shixu.core.database.PendingBiometricEntity
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.SleepStage
import app.shixu.core.network.generated.models.SourceType
import kotlinx.serialization.encodeToString
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * 将 Health Connect 5 类生理记录转换为确定性 externalId 幂等格式，供 Room 离线队列与批量上报使用。
 */
object HealthRecordMapper {

    fun mapRecords(records: List<Record>, nowEpochMs: Long = System.currentTimeMillis()): List<PendingBiometricEntity> =
        records.flatMap { record -> mapRecord(record, nowEpochMs) }

    fun mapRecord(record: Record, nowEpochMs: Long = System.currentTimeMillis()): List<PendingBiometricEntity> {
        val originPackage = record.metadata.dataOrigin.packageName.takeIf { it.isNotBlank() }
        val recordUid = record.metadata.id.takeIf { it.isNotBlank() }

        return when (record) {
            is HeartRateRecord -> mapHeartRate(
                recordUid = recordUid ?: "hr-${record.startTime.epochSecond}",
                originPackage = originPackage,
                samples = record.samples.map { it.time to it.beatsPerMinute },
                nowEpochMs = nowEpochMs,
            )

            is HeartRateVariabilityRmssdRecord -> listOf(
                mapHrvRmssd(
                    recordUid = recordUid ?: "hc:hrv:${record.time.epochSecond}",
                    originPackage = originPackage,
                    time = record.time,
                    rmssdMs = record.heartRateVariabilityMillis,
                    nowEpochMs = nowEpochMs,
                ),
            )

            is RestingHeartRateRecord -> listOf(
                mapRestingHeartRate(
                    recordUid = recordUid ?: "hc:rhr:${record.time.epochSecond}",
                    originPackage = originPackage,
                    time = record.time,
                    bpm = record.beatsPerMinute,
                    nowEpochMs = nowEpochMs,
                ),
            )

            is SleepSessionRecord -> mapSleepSession(
                recordUid = recordUid ?: "hc:sleep:${record.startTime.epochSecond}",
                originPackage = originPackage,
                startTime = record.startTime,
                endTime = record.endTime,
                stages = record.stages.map { Triple(it.startTime, it.endTime, it.stage) },
                nowEpochMs = nowEpochMs,
            )

            is ActiveCaloriesBurnedRecord -> mapActiveCalories(
                recordUid = recordUid ?: "hc:kcal:${record.startTime.epochSecond}",
                originPackage = originPackage,
                startTime = record.startTime,
                endTime = record.endTime,
                kilocalories = record.energy.inKilocalories,
                nowEpochMs = nowEpochMs,
            )

            else -> emptyList()
        }
    }

    fun mapHeartRate(
        recordUid: String,
        originPackage: String?,
        samples: List<Pair<Instant, Long>>,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): List<PendingBiometricEntity> =
        samples.map { (time, bpm) ->
            PendingBiometricEntity(
                sourceType = SourceType.health_connect.value,
                metricType = MetricType.heart_rate.value,
                recordedAtIso = formatUtc(time),
                endAtIso = null,
                numericValue = bpm.toDouble(),
                unit = "bpm",
                sleepStage = null,
                externalId = "hc:$recordUid:hr:${time.epochSecond}",
                metadataJson = buildOriginMetadata(originPackage),
                createdAtEpochMs = nowEpochMs,
            )
        }

    fun mapHrvRmssd(
        recordUid: String,
        originPackage: String?,
        time: Instant,
        rmssdMs: Double,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): PendingBiometricEntity =
        PendingBiometricEntity(
            sourceType = SourceType.health_connect.value,
            metricType = MetricType.hrv_rmssd.value,
            recordedAtIso = formatUtc(time),
            endAtIso = null,
            numericValue = rmssdMs,
            unit = "ms",
            sleepStage = null,
            externalId = recordUid,
            metadataJson = buildOriginMetadata(originPackage),
            createdAtEpochMs = nowEpochMs,
        )

    fun mapRestingHeartRate(
        recordUid: String,
        originPackage: String?,
        time: Instant,
        bpm: Long,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): PendingBiometricEntity =
        PendingBiometricEntity(
            sourceType = SourceType.health_connect.value,
            metricType = MetricType.resting_hr.value,
            recordedAtIso = formatUtc(time),
            endAtIso = null,
            numericValue = bpm.toDouble(),
            unit = "bpm",
            sleepStage = null,
            externalId = recordUid,
            metadataJson = buildOriginMetadata(originPackage),
            createdAtEpochMs = nowEpochMs,
        )

    fun mapSleepSession(
        recordUid: String,
        originPackage: String?,
        startTime: Instant,
        endTime: Instant,
        stages: List<Triple<Instant, Instant, Int>>,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): List<PendingBiometricEntity> {
        val result = mutableListOf<PendingBiometricEntity>()
        val sessionMinutes = durationMinutes(startTime, endTime)
        if (sessionMinutes > 0.0) {
            result += PendingBiometricEntity(
                sourceType = SourceType.health_connect.value,
                metricType = MetricType.sleep_session.value,
                recordedAtIso = formatUtc(startTime),
                endAtIso = formatUtc(endTime),
                numericValue = sessionMinutes,
                unit = "minutes",
                sleepStage = null,
                externalId = recordUid,
                metadataJson = buildOriginMetadata(originPackage),
                createdAtEpochMs = nowEpochMs,
            )
        }

        stages.forEachIndexed { idx, (stageStart, stageEnd, stageCode) ->
            val mappedStage = mapSleepStage(stageCode) ?: return@forEachIndexed
            val stageMinutes = durationMinutes(stageStart, stageEnd)
            if (stageMinutes <= 0.0) return@forEachIndexed

            result += PendingBiometricEntity(
                sourceType = SourceType.health_connect.value,
                metricType = MetricType.sleep_stage.value,
                recordedAtIso = formatUtc(stageStart),
                endAtIso = formatUtc(stageEnd),
                numericValue = stageMinutes,
                unit = "minutes",
                sleepStage = mappedStage.value,
                externalId = "hc:$recordUid:stage:$idx:${stageStart.epochSecond}",
                metadataJson = buildOriginMetadata(originPackage),
                createdAtEpochMs = nowEpochMs,
            )
        }
        return result
    }

    fun mapActiveCalories(
        recordUid: String,
        originPackage: String?,
        startTime: Instant,
        endTime: Instant,
        kilocalories: Double,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): List<PendingBiometricEntity> {
        if (kilocalories <= 0.0 || !endTime.isAfter(startTime)) return emptyList()
        return listOf(
            PendingBiometricEntity(
                sourceType = SourceType.health_connect.value,
                metricType = MetricType.active_calories.value,
                recordedAtIso = formatUtc(startTime),
                endAtIso = formatUtc(endTime),
                numericValue = kilocalories,
                unit = "kcal",
                sleepStage = null,
                externalId = recordUid,
                metadataJson = buildOriginMetadata(originPackage),
                createdAtEpochMs = nowEpochMs,
            ),
        )
    }

    fun mapSleepStage(hcStageType: Int): SleepStage? = when (hcStageType) {
        SleepSessionRecord.STAGE_TYPE_DEEP -> SleepStage.deep
        SleepSessionRecord.STAGE_TYPE_REM -> SleepStage.rem
        SleepSessionRecord.STAGE_TYPE_LIGHT,
        SleepSessionRecord.STAGE_TYPE_SLEEPING,
        -> SleepStage.light

        SleepSessionRecord.STAGE_TYPE_AWAKE,
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED,
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
        -> SleepStage.awake

        else -> null
    }

    private fun durationMinutes(start: Instant, end: Instant): Double {
        if (!end.isAfter(start)) return 0.0
        return Duration.between(start, end).toMillis() / 60_000.0
    }

    private fun formatUtc(instant: Instant): String =
        DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(instant.atOffset(ZoneOffset.UTC))

    private fun buildOriginMetadata(originPackage: String?): String? {
        val pkg = originPackage?.takeIf { it.isNotBlank() } ?: return null
        return ShixuJson.json.encodeToString(mapOf("origin" to pkg))
    }
}
