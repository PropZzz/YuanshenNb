package app.shixu.core.ble

import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.SourceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RrWindowAggregatorTest {

    @Test
    fun filtersArtifactJumpsAbove25PercentAndComputesAccurateRmssd() {
        val aggregator = RrWindowAggregator(
            deviceIdentifier = "AA:BB:CC:DD:EE:FF",
            deviceName = "Polar H10",
            nowMsProvider = { 1795000000_000L },
        )

        val bucketStart = 1795000020L // 精确对齐 60s 窗口起点
        val m1 = ParsedHeartRateMeasurement(
            heartRateBpm = 68,
            sensorContactSupported = true,
            sensorContactDetected = true,
            energyExpendedKj = null,
            // 800 -> 810 (1.25% 有效), 1200 (+48% 伪影剔除), 400 (-50% 伪影剔除), 820 (相对上个有效点 810 仅 +1.23% 有效)
            rrIntervalsMs = listOf(800.0, 810.0, 1200.0, 400.0, 820.0),
        )
        val emittedBeforeClose = aggregator.addMeasurement(m1, bucketStart + 5L)
        assertTrue(emittedBeforeClose.isEmpty())
        assertEquals(3, aggregator.totalValidRrCount)
        assertEquals(2, aggregator.totalRejectedRrCount)
        // RMSSD([800, 810, 820]) = sqrt(((10^2) + (10^2)) / 2) = 10.0 ms
        assertNotNull(aggregator.latestRmssdMs)
        assertEquals(10.0, aggregator.latestRmssdMs!!, 0.0001)

        // 进入下一 60 秒窗口时，自动输出上一窗口的 heart_rate + hrv_rmssd 两条实体
        val m2 = ParsedHeartRateMeasurement(
            heartRateBpm = 72,
            sensorContactSupported = true,
            sensorContactDetected = true,
            energyExpendedKj = null,
            rrIntervalsMs = listOf(200.0, 2500.0), // 超出 300..2000ms 范围，均应剔除
        )
        val emitted = aggregator.addMeasurement(m2, bucketStart + 65L)
        assertEquals(2, emitted.size)
        assertEquals(4, aggregator.totalRejectedRrCount)

        val expectedHash = RrWindowAggregator.deviceHash("AA:BB:CC:DD:EE:FF")
        assertEquals(8, expectedHash.length)

        val hrEntity = emitted.first { it.metricType == MetricType.heart_rate.value }
        val hrvEntity = emitted.first { it.metricType == MetricType.hrv_rmssd.value }

        assertEquals(SourceType.ble_gatt.value, hrEntity.sourceType)
        assertEquals(68.0, hrEntity.numericValue, 0.001)
        assertEquals("ble:$expectedHash:heart_rate:$bucketStart", hrEntity.externalId)

        assertEquals(SourceType.ble_gatt.value, hrvEntity.sourceType)
        assertEquals(10.0, hrvEntity.numericValue, 0.0001)
        assertEquals("ble:$expectedHash:hrv_rmssd:$bucketStart", hrvEntity.externalId)
    }
}
