package app.shixu

import app.shixu.core.ble.HeartRateMeasurement
import app.shixu.core.ble.RrWindow
import app.shixu.core.database.QueuePolicy
import app.shixu.core.datastore.EncryptedTokenVault
import app.shixu.core.health.SampleIdentity
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class AcquisitionTest {
    @Test fun parses16BitHeartRateEnergyAndRrInProtocolOrder() {
        val value = HeartRateMeasurement.parse(byteArrayOf(0x19, 0x2c, 0x01, 0x10, 0, 0, 4, 0x10, 4))!!
        assertEquals(300, value.bpm)
        assertEquals(listOf(1000.0, 1015.625), value.rrMillis)
        assertNull(HeartRateMeasurement.parse(byteArrayOf(1, 10)))
        assertNull(HeartRateMeasurement.parse(byteArrayOf(0x10, 70, 1)))
    }
    @Test fun rmssdFiltersContactArtifactsAndRequiresTwoIntervals() {
        val window = RrWindow()
        assertNull(window.rmssd())
        window.add(listOf(1000.0, 1020.0, 1800.0, 1000.0))
        assertEquals(20.0, window.rmssd()!!, 0.001)
    }
    @Test fun deterministicIdsRemainStableAcrossRetryAndAlignBleWindow() {
        assertEquals("hc:record:hr:60", SampleIdentity.healthPoint("record", "hr", 60))
        assertEquals(SampleIdentity.ble("AB:CD", "heart_rate", 121), SampleIdentity.ble("AB:CD", "heart_rate", 179))
        assertTrue(SampleIdentity.ble("AB:CD", "heart_rate", 121).endsWith(":120"))
    }
    @Test fun invalidSampleLocationsOnlyRemoveReferencedRows() {
        assertEquals(setOf(0, 12), QueuePolicy.invalidIndices(listOf("body.samples[0].numericValue", "body.samples.12.unit", "body.samples[999].unit", "body.other"), 20))
        assertEquals(500, QueuePolicy.BATCH_LIMIT)
    }
    @Test fun tokensSurviveVaultRecreationAndCiphertextDoesNotExposeSecrets() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        var persisted: String? = null
        val first = EncryptedTokenVault({ persisted }, { persisted = it }, { key })
        first.saveTokens("access-secret", "refresh-secret")
        assertFalse(persisted!!.contains("secret"))
        val second = EncryptedTokenVault({ persisted }, { persisted = it }, { key })
        assertEquals("access-secret", second.accessToken())
        assertEquals("refresh-secret", second.refreshToken())
        second.clear()
        assertNull(first.refreshToken())
    }
    @Test fun corruptedTokenStorageFailsClosed() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = EncryptedTokenVault({ "corrupt" }, {}, { key })
        assertNull(vault.accessToken())
        assertNull(vault.refreshToken())
    }
}
