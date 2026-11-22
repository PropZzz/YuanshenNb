package app.shixu.core.health

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import app.shixu.core.database.toDto
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.SleepStage
import app.shixu.core.network.generated.models.SourceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class HealthRecordMapperTest {

    @Before
    fun setup() {
        ShixuJson.install()
    }

    @Test
    fun mapsAllFiveHealthConnectRecordTypesWithDeterministicExternalIds() {
        val meta = Metadata.autoRecordedWithId(
            id = "hc-rec-001",
            device = androidx.health.connect.client.records.metadata.Device(
                type = androidx.health.connect.client.records.metadata.Device.TYPE_WATCH,
            ),
        )
        val t0 = Instant.parse("2026-11-18T22:00:00Z")
        val t1 = Instant.parse("2026-11-19T05:30:00Z")

        val hrRecord = HeartRateRecord(
            startTime = t0,
            startZoneOffset = ZoneOffset.UTC,
            endTime = t0.plusSeconds(120),
            endZoneOffset = ZoneOffset.UTC,
            samples = listOf(
                HeartRateRecord.Sample(t0, 62L),
                HeartRateRecord.Sample(t0.plusSeconds(60), 65L),
            ),
            metadata = meta,
        )
        val hrvRecord = HeartRateVariabilityRmssdRecord(
            time = t1,
            zoneOffset = ZoneOffset.UTC,
            heartRateVariabilityMillis = 59.4,
            metadata = meta,
        )
        val rhrRecord = RestingHeartRateRecord(
            time = t1,
            zoneOffset = ZoneOffset.UTC,
            beatsPerMinute = 56L,
            metadata = meta,
        )
        val sleepRecord = SleepSessionRecord(
            startTime = t0,
            startZoneOffset = ZoneOffset.UTC,
            endTime = t1,
            endZoneOffset = ZoneOffset.UTC,
            metadata = meta,
            stages = listOf(
                SleepSessionRecord.Stage(t0, t0.plusSeconds(3600), SleepSessionRecord.STAGE_TYPE_DEEP),
                SleepSessionRecord.Stage(t0.plusSeconds(3600), t0.plusSeconds(7200), SleepSessionRecord.STAGE_TYPE_REM),
                SleepSessionRecord.Stage(t0.plusSeconds(7200), t0.plusSeconds(9000), SleepSessionRecord.STAGE_TYPE_UNKNOWN),
            ),
        )
        val kcalRecord = ActiveCaloriesBurnedRecord(
            startTime = t1.plusSeconds(3600),
            startZoneOffset = ZoneOffset.UTC,
            endTime = t1.plusSeconds(5400),
            endZoneOffset = ZoneOffset.UTC,
            energy = Energy.kilocalories(245.5),
            metadata = meta,
        )

        val mapped = HealthRecordMapper.mapRecords(
            listOf(hrRecord, hrvRecord, rhrRecord, sleepRecord, kcalRecord),
            nowEpochMs = 1795000000_000L,
        )

        // 2 HR + 1 HRV + 1 RHR + (1 sleep_session + 2 valid stages, UNKNOWN skipped) + 1 active_calories = 8
        assertEquals(8, mapped.size)

        val dtos = mapped.map { it.toDto() }
        assertEquals(SourceType.health_connect, dtos.first().sourceType)

        val hrDtos = dtos.filter { it.metricType == MetricType.heart_rate }
        assertEquals("hc:hc-rec-001:hr:${t0.epochSecond}", hrDtos[0].externalId)
        assertEquals(62.0, hrDtos[0].numericValue, 0.01)

        val hrvDto = dtos.first { it.metricType == MetricType.hrv_rmssd }
        assertEquals("hc-rec-001", hrvDto.externalId)
        assertEquals("ms", hrvDto.unit)

        val rhrDto = dtos.first { it.metricType == MetricType.resting_hr }
        assertEquals("hc-rec-001", rhrDto.externalId)
        assertEquals("bpm", rhrDto.unit)

        val sessionDto = dtos.first { it.metricType == MetricType.sleep_session }
        assertEquals(450.0, sessionDto.numericValue, 0.01)
        assertNull(sessionDto.sleepStage)

        val stageDtos = dtos.filter { it.metricType == MetricType.sleep_stage }
        assertEquals(2, stageDtos.size)
        assertEquals(SleepStage.deep, stageDtos[0].sleepStage)
        assertEquals("hc:hc-rec-001:stage:0:${t0.epochSecond}", stageDtos[0].externalId)
        assertEquals(SleepStage.rem, stageDtos[1].sleepStage)

        val kcalDto = dtos.first { it.metricType == MetricType.active_calories }
        assertEquals(245.5, kcalDto.numericValue, 0.01)
        assertEquals("kcal", kcalDto.unit)

        // 覆盖 DataOrigin 透传（通过映射辅助函数验证来源包名序列化）
        val originMapped = HealthRecordMapper.mapRestingHeartRate(
            recordUid = "origin-1",
            originPackage = "com.mi.health",
            time = t1,
            bpm = 55L,
            nowEpochMs = 1795000000_000L,
        )
        assertEquals("com.mi.health", originMapped.toDto().metadata?.get("origin")?.toString()?.trim('"'))
    }
}
