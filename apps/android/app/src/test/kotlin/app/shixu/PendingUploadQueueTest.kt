package app.shixu

import app.shixu.core.database.*
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.apis.BiometricsApi
import app.shixu.core.network.generated.models.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.Response
import java.time.OffsetDateTime

class PendingUploadQueueTest {
    @Before fun installSerialization() { ShixuJson.install() }
    @Test fun batchesAt500AndKeepsOtherAccountsIsolated() = runTest {
        val dao = MemoryDao()
        val requests = mutableListOf<Int>()
        val queue = PendingUploadQueue(dao, FakeApi { request -> requests += request.samples.size; Response.success(null) })
        queue.enqueue("a", (0..1000).map { sample(it) })
        queue.enqueue("b", listOf(sample(1)))
        queue.enqueue("a", listOf(sample(1))) // retries never duplicate a queue row
        queue.drain("a")
        assertEquals(listOf(500, 500, 1), requests)
        assertEquals(1, dao.rows.size)
        assertEquals("b", dao.rows.values.single().ownerId)
    }
    @Test fun serverFailureRetainsWholeBatchForRetry() = runTest {
        val dao = MemoryDao()
        val queue = PendingUploadQueue(dao, FakeApi { Response.error(503, "unavailable".toResponseBody()) })
        queue.enqueue("a", listOf(sample(1), sample(2)))
        runCatching { queue.drain("a") }
        assertEquals(2, dao.rows.size)
    }
    @Test fun invalidSample422DropsOnlyReferencedRowsAndRetriesValidRows() = runTest {
        val dao = MemoryDao()
        val ids = mutableListOf<List<String>>()
        val queue = PendingUploadQueue(dao, FakeApi { request ->
            ids += request.samples.map { it.externalId }
            if (ids.size == 1) Response.error(422, """{"type":"https://shixu.app/errors/INVALID_BIOMETRIC_SAMPLE","title":"Invalid","status":422,"detail":"bad sample","code":"INVALID_BIOMETRIC_SAMPLE","errors":[{"location":"body.samples[1].numericValue","message":"bad value"}]}""".toResponseBody("application/problem+json".toMediaType())) else Response.success(null)
        })
        queue.enqueue("a", listOf(sample(0), sample(1), sample(2)))
        queue.drain("a")
        assertEquals(listOf("test:0", "test:1", "test:2"), ids[0])
        assertEquals(listOf("test:0", "test:2"), ids[1])
        assertTrue(dao.rows.isEmpty())
    }
    @Test fun unrecognized422RetainsRowsInsteadOfSilentlyDiscardingSamples() = runTest {
        val dao = MemoryDao()
        val queue = PendingUploadQueue(dao, FakeApi { Response.error(422, "bad request".toResponseBody()) })
        queue.enqueue("a", listOf(sample(0)))
        assertTrue(runCatching { queue.drain("a") }.isFailure)
        assertEquals(1, dao.rows.size)
    }
    private fun sample(index: Int) = BiometricSampleDTO("test:$index", MetricType.heart_rate, 60.0, OffsetDateTime.parse("2026-11-19T00:00:00Z"), SourceType.health_connect, "bpm")
    private class FakeApi(val handler: (BiometricBatchRequest) -> Response<BiometricBatchResponse>) : BiometricsApi {
        override suspend fun ingestBiometricSamplesBatch(biometricBatchRequest: BiometricBatchRequest) = handler(biometricBatchRequest)
        override suspend fun seedBiometricReplay(replaySeedRequest: ReplaySeedRequest): Response<ReplaySeedResponse> = error("Not used by upload queue")
    }
    private class MemoryDao : PendingDao {
        val rows = linkedMapOf<String, PendingBiometric>()
        override suspend fun enqueue(samples: List<PendingBiometric>) { samples.forEach { rows.putIfAbsent(it.id, it) } }
        override suspend fun batch(owner: String) = rows.values.filter { it.ownerId == owner }.sortedWith(compareBy({ it.queuedAt }, { it.id })).take(500)
        override suspend fun delete(ids: List<String>) { ids.forEach(rows::remove) }
        override fun count(owner: String): Flow<Int> = flowOf(rows.values.count { it.ownerId == owner })
        override suspend fun saveSnapshot(snapshot: ScheduleSnapshot) = Unit
        override suspend fun snapshot(owner: String, day: String): ScheduleSnapshot? = null
    }
}
