package app.shixu.core.ble

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HeartRateMeasurementParserTest {

    @Test
    fun parsesUint8HeartRateWithoutRrOrEnergy() {
        val packet = byteArrayOf(0x00, 72.toByte())
        val parsed = HeartRateMeasurementParser.parse(packet)

        assertNotNull(parsed)
        assertEquals(72, parsed!!.heartRateBpm)
        assertFalse(parsed.sensorContactSupported)
        assertFalse(parsed.sensorContactDetected)
        assertNull(parsed.energyExpendedKj)
        assertTrue(parsed.rrIntervalsMs.isEmpty())
    }

    @Test
    fun parsesUint16HeartRateWithContactEnergyAndMultipleRrIntervals() {
        // flags: bit0=1(uint16 HR), bit1-2=11(contact supported+detected), bit3=1(energy), bit4=1(RR) => 0x1F
        // HR = 260 (0x04, 0x01)
        // Energy = 420 kJ (0xA4, 0x01)
        // RR1 = 1024 (0x00, 0x04) -> 1000.0 ms
        // RR2 = 819  (0x33, 0x03) -> 819 * 1000 / 1024 = 799.8046875 ms
        val packet = byteArrayOf(
            0x1F,
            0x04, 0x01,
            0xA4.toByte(), 0x01,
            0x00, 0x04,
            0x33, 0x03,
        )
        val parsed = HeartRateMeasurementParser.parse(packet)

        assertNotNull(parsed)
        assertEquals(260, parsed!!.heartRateBpm)
        assertTrue(parsed.sensorContactSupported)
        assertTrue(parsed.sensorContactDetected)
        assertEquals(420, parsed.energyExpendedKj)
        assertEquals(2, parsed.rrIntervalsMs.size)
        assertEquals(1000.0, parsed.rrIntervalsMs[0], 0.001)
        assertEquals(799.8046875, parsed.rrIntervalsMs[1], 0.001)
    }

    @Test
    fun returnsNullOnEmptyOrTruncatedPackets() {
        assertNull(HeartRateMeasurementParser.parse(byteArrayOf()))
        assertNull(HeartRateMeasurementParser.parse(byteArrayOf(0x01, 0x50))) // uint16 缺高字节
        assertNull(HeartRateMeasurementParser.parse(byteArrayOf(0x08, 0x48, 0x10))) // energy 缺高字节
    }
}
