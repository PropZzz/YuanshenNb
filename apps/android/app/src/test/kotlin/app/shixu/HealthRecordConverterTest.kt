package app.shixu

import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import app.shixu.core.health.HealthRecordConverter
import app.shixu.core.network.generated.models.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class HealthRecordConverterTest {
    private val start = Instant.parse("2026-11-18T15:00:00Z")
    @Test fun convertsHeartRateSubsamplesWithUtcIdentityAndRealSource() {
        val record = HeartRateRecord(start, null, start.plusSeconds(120), null, listOf(HeartRateRecord.Sample(start, 62), HeartRateRecord.Sample(start.plusSeconds(60), 64)), Metadata.manualEntry())
        val samples = HealthRecordConverter.convert(record)
        assertEquals(2, samples.size)
        assertEquals(62.0, samples[0].numericValue, 0.0)
        assertEquals(SourceType.health_connect, samples[0].sourceType)
        assertEquals(MetricType.heart_rate, samples[0].metricType)
        assertEquals(start, samples[0].recordedAt.toInstant())
        assertNotEquals(samples[0].externalId, samples[1].externalId)
        assertEquals(samples[0].externalId, HealthRecordConverter.convert(record)[0].externalId)
    }
    @Test fun convertsSleepSessionAndTypedStagesInMinutes() {
        val record = SleepSessionRecord(start, null, start.plusSeconds(3600), null, Metadata.manualEntry(), stages = listOf(SleepSessionRecord.Stage(start, start.plusSeconds(1800), SleepSessionRecord.STAGE_TYPE_DEEP)))
        val samples = HealthRecordConverter.convert(record)
        assertEquals(2, samples.size)
        assertEquals(MetricType.sleep_session, samples[0].metricType)
        assertEquals(60.0, samples[0].numericValue, 0.0)
        assertEquals(SleepStage.deep, samples[1].sleepStage)
        assertEquals(30.0, samples[1].numericValue, 0.0)
        assertEquals("minutes", samples[1].unit)
    }
}
