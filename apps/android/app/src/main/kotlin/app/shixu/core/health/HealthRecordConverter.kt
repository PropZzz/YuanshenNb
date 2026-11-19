package app.shixu.core.health

import androidx.health.connect.client.records.*
import app.shixu.core.network.generated.models.*
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

object HealthRecordConverter {
    private fun sample(record: Record, metric: MetricType, value: Double, unit: String, time: Instant, end: Instant? = null, external: String = record.metadata.id, stage: SleepStage? = null) = BiometricSampleDTO(
        externalId = external, metricType = metric, numericValue = value, recordedAt = time.atOffset(ZoneOffset.UTC), sourceType = SourceType.health_connect, unit = unit, endAt = end?.atOffset(ZoneOffset.UTC), sleepStage = stage,
    )
    fun convert(record: Record): List<BiometricSampleDTO> = when (record) {
        is HeartRateRecord -> record.samples.map { sample(record, MetricType.heart_rate, it.beatsPerMinute.toDouble(), "bpm", it.time, external = SampleIdentity.healthPoint(record.metadata.id, "heart_rate", it.time.epochSecond)) }
        is HeartRateVariabilityRmssdRecord -> listOf(sample(record, MetricType.hrv_rmssd, record.heartRateVariabilityMillis, "ms", record.time))
        is RestingHeartRateRecord -> listOf(sample(record, MetricType.resting_hr, record.beatsPerMinute.toDouble(), "bpm", record.time))
        is ActiveCaloriesBurnedRecord -> listOf(sample(record, MetricType.active_calories, record.energy.inKilocalories, "kcal", record.startTime, record.endTime))
        is SleepSessionRecord -> listOf(sample(record, MetricType.sleep_session, Duration.between(record.startTime, record.endTime).toMinutes().toDouble(), "minutes", record.startTime, record.endTime)) + record.stages.mapNotNull { part ->
            val stage = when (part.stage) {
                SleepSessionRecord.STAGE_TYPE_DEEP -> SleepStage.deep
                SleepSessionRecord.STAGE_TYPE_REM -> SleepStage.rem
                SleepSessionRecord.STAGE_TYPE_LIGHT -> SleepStage.light
                SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> SleepStage.awake
                else -> null
            }
            stage?.let { sample(record, MetricType.sleep_stage, Duration.between(part.startTime, part.endTime).seconds / 60.0, "minutes", part.startTime, part.endTime, SampleIdentity.healthPoint(record.metadata.id, "stage", part.startTime.epochSecond), it) }
        }
        else -> emptyList()
    }
}
