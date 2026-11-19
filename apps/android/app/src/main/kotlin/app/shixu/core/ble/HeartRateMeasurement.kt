package app.shixu.core.ble

import kotlin.math.abs
import kotlin.math.sqrt

data class HeartRateMeasurement(val bpm: Int, val rrMillis: List<Double>) {
    companion object {
        fun parse(value: ByteArray): HeartRateMeasurement? {
            if (value.size < 2) return null
            val flags = value[0].toInt() and 0xff
            var offset = 1
            fun u16(): Int? {
                if (offset + 1 >= value.size) return null
                return ((value[offset++].toInt() and 0xff) or ((value[offset++].toInt() and 0xff) shl 8))
            }
            val bpm = if (flags and 1 != 0) u16() ?: return null else value[offset++].toInt() and 0xff
            if (flags and 8 != 0) u16() ?: return null
            val rr = mutableListOf<Double>()
            if (flags and 16 != 0) {
                if ((value.size - offset) % 2 != 0) return null
                while (offset < value.size) rr += (u16() ?: return null) * 1000.0 / 1024.0
            }
            return HeartRateMeasurement(bpm, rr)
        }
    }
}

/** Signal processing only. Energy inference remains exclusively on the server. */
class RrWindow {
    private val intervals = mutableListOf<Double>()
    fun add(values: List<Double>) {
        values.filter { it in 273.0..2000.0 }.forEach { rr ->
            val prior = intervals.lastOrNull()
            if (prior == null || abs(rr - prior) / prior <= .25) intervals += rr
        }
    }
    fun rmssd(): Double? = if (intervals.size < 2) null else sqrt(intervals.zipWithNext { a, b -> (b - a) * (b - a) }.average())
    fun clear() = intervals.clear()
}
