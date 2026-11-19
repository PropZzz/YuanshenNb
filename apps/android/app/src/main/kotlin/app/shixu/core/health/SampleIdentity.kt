package app.shixu.core.health

import java.security.MessageDigest

object SampleIdentity {
    fun healthPoint(recordId: String, subType: String, epochSecond: Long) = "hc:$recordId:$subType:$epochSecond"
    fun ble(device: String, metric: String, epochSecond: Long): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(device.toByteArray()).take(4).joinToString("") { "%02x".format(it) }
        return "ble:$hash:$metric:${Math.floorDiv(epochSecond, 60) * 60}"
    }
}
