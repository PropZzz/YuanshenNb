package app.shixu.core.database

object QueuePolicy {
    const val BATCH_LIMIT = 500
    private val location = Regex("(?:body\\.)?samples(?:\\[(\\d+)\\]|\\.(\\d+))(?:\\.|$)")
    fun invalidIndices(locations: List<String>, batchSize: Int): Set<Int> = locations.mapNotNull {
        location.find(it)?.let { match -> (match.groupValues[1].ifEmpty { match.groupValues[2] }).toIntOrNull() }
    }.filter { it in 0 until batchSize }.toSet()
}
