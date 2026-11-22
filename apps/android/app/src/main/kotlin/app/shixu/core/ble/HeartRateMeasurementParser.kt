package app.shixu.core.ble

data class ParsedHeartRateMeasurement(
    val heartRateBpm: Int,
    val sensorContactSupported: Boolean,
    val sensorContactDetected: Boolean,
    val energyExpendedKj: Int?,
    val rrIntervalsMs: List<Double>,
)

/**
 * 蓝牙 SIG 标准 Heart Rate Measurement (0x2A37) 特征字节流解析器。
 * 支持 uint8/uint16 心率编码、传感器接触状态、能量消耗与多组 RR 间期 (1/1024s -> ms)。
 */
object HeartRateMeasurementParser {

    fun parse(payload: ByteArray): ParsedHeartRateMeasurement? {
        if (payload.isEmpty()) return null

        val flags = payload[0].toInt() and 0xFF
        val isUint16Hr = (flags and 0x01) != 0
        val sensorContactSupported = (flags and 0x04) != 0
        val sensorContactDetected = (flags and 0x06) == 0x06
        val hasEnergyExpended = (flags and 0x08) != 0
        val hasRrIntervals = (flags and 0x10) != 0

        var offset = 1
        val hrLength = if (isUint16Hr) 2 else 1
        if (payload.size < offset + hrLength) return null

        val heartRateBpm = if (isUint16Hr) {
            readUint16Le(payload, offset)
        } else {
            payload[offset].toInt() and 0xFF
        }
        offset += hrLength

        val energyExpendedKj = if (hasEnergyExpended) {
            if (payload.size < offset + 2) return null
            val energy = readUint16Le(payload, offset)
            offset += 2
            energy
        } else {
            null
        }

        val rrIntervalsMs = mutableListOf<Double>()
        if (hasRrIntervals) {
            while (offset + 1 < payload.size) {
                val rawRr = readUint16Le(payload, offset)
                offset += 2
                rrIntervalsMs += rawRr * 1000.0 / 1024.0
            }
        }

        return ParsedHeartRateMeasurement(
            heartRateBpm = heartRateBpm,
            sensorContactSupported = sensorContactSupported,
            sensorContactDetected = sensorContactDetected,
            energyExpendedKj = energyExpendedKj,
            rrIntervalsMs = rrIntervalsMs,
        )
    }

    private fun readUint16Le(bytes: ByteArray, offset: Int): Int {
        val low = bytes[offset].toInt() and 0xFF
        val high = bytes[offset + 1].toInt() and 0xFF
        return (high shl 8) or low
    }
}
