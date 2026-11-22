package app.shixu.core.health

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.shixu.core.database.PendingBiometricEntity
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.network.InMemoryTokenStore
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.apis.BiometricsApi
import app.shixu.core.network.generated.models.BiometricBatchRequest
import app.shixu.core.network.generated.models.BiometricBatchResponse
import app.shixu.core.network.generated.models.DataFreshness
import app.shixu.core.network.generated.models.EnergyDrivers
import app.shixu.core.network.generated.models.EnergySourceDiagnostics
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ReplaySeedRequest
import app.shixu.core.network.generated.models.ReplaySeedResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.Response
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.concurrent.atomic.AtomicLong

class HealthSyncCoordinatorTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    @Before
    fun setup() {
        ShixuJson.install()
    }

    @Test
    fun offlineQueuePreservesExternalIdsAndUploadsWithoutDuplicatesOnRecovery() = runTest {
        val queueStore = InMemoryBiometricQueueStore()
        val api = FakeBiometricsApi()
        api.failWithIoException = true

        val uploadQueue = BiometricUploadQueue(queueStore, api)
        val prefs = createPrefsStore("sync1")
        val tokenStore = InMemoryTokenStore().apply { saveTokens("acc", "ref") }
        val gateway = FakeHealthConnectGateway(
            granted = HealthConnectPermissions.REQUIRED_PERMISSIONS,
            rangeRecords = listOf(sampleEntity("hc:hr:1", 72.0), sampleEntity("hc:hr:2", 75.0)),
            nextToken = "tok-1",
        )
        val coordinator = HealthSyncCoordinator(
            gateway = gateway,
            uploadQueue = uploadQueue,
            syncPreferencesStore = prefs,
            tokenStore = tokenStore,
            clock = { Instant.parse("2026-11-19T08:00:00Z") },
        )

        val offlineReport = coordinator.syncNow()
        assertTrue(offlineReport.flushResult is BiometricFlushResult.RetryableFailure)
        assertEquals(2, queueStore.countPending())
        assertEquals("tok-1", prefs.readMetadata().healthConnectChangesToken)
        assertTrue(prefs.readMetadata().initialHistorySynced)

        // 恢复网络后再次同步：Changes 返回 1 条新记录，共 3 条幂等上传（保留原 externalId）
        api.failWithIoException = false
        gateway.changesResult = HealthChangesResult.Success(
            samples = listOf(sampleEntity("hc:hr:3", 68.0)),
            nextToken = "tok-2",
        )

        val onlineReport = coordinator.syncNow()
        assertTrue(onlineReport.flushResult is BiometricFlushResult.Success)
        assertEquals(0, queueStore.countPending())
        assertEquals("tok-2", prefs.readMetadata().healthConnectChangesToken)
        assertEquals(listOf("hc:hr:1", "hc:hr:2", "hc:hr:3"), api.uploadedExternalIds)
    }

    @Test
    fun expiredChangesTokenFallsBackTo48hPullAndPartialPermissionsDoNotCrash() = runTest {
        val queueStore = InMemoryBiometricQueueStore()
        val api = FakeBiometricsApi()
        val uploadQueue = BiometricUploadQueue(queueStore, api)
        val prefs = createPrefsStore("sync2")
        prefs.updateHealthConnectSync(
            changesToken = "expired-tok",
            initialHistorySynced = true,
            syncedAtEpochMs = 1000L,
            summary = "old",
        )
        val tokenStore = InMemoryTokenStore().apply { saveTokens("acc", "ref") }
        val partialGranted = setOf(HealthConnectPermissions.HEART_RATE, HealthConnectPermissions.SLEEP)
        val gateway = FakeHealthConnectGateway(
            granted = partialGranted,
            rangeRecords = listOf(sampleEntity("hc:fallback:1", 66.0)),
            nextToken = "fresh-tok",
        )
        gateway.changesResult = HealthChangesResult.TokenExpired

        val coordinator = HealthSyncCoordinator(
            gateway = gateway,
            uploadQueue = uploadQueue,
            syncPreferencesStore = prefs,
            tokenStore = tokenStore,
            clock = { Instant.parse("2026-11-19T08:00:00Z") },
        )

        val report = coordinator.syncNow()
        assertTrue(report.usedFallback48h)
        assertEquals(3, report.missingPermissionLabels.size)
        assertEquals("fresh-tok", prefs.readMetadata().healthConnectChangesToken)
        assertEquals(listOf("hc:fallback:1"), api.uploadedExternalIds)
    }

    @Test
    fun invalid422SampleEvictsBadPointWithoutInfiniteLoop() = runTest {
        val queueStore = InMemoryBiometricQueueStore()
        val api = FakeBiometricsApi()
        api.rejectInvalidOutOfBoundsHr = true

        val uploadQueue = BiometricUploadQueue(queueStore, api)
        uploadQueue.enqueue(
            listOf(
                sampleEntity("hc:ok:1", 70.0),
                sampleEntity("hc:bad:2", 999.0),
                sampleEntity("hc:ok:3", 64.0),
            ),
        )

        val result = uploadQueue.flushPending()
        assertTrue(result is BiometricFlushResult.Success)
        val success = result as BiometricFlushResult.Success
        assertEquals(2, success.acceptedCount)
        assertEquals(1, success.evictedInvalidCount)
        assertEquals(0, queueStore.countPending())
        assertEquals(listOf("hc:ok:1", "hc:ok:3"), api.uploadedExternalIds)
    }

    private fun createPrefsStore(name: String): SyncPreferencesStore {
        val ds = PreferenceDataStoreFactory.create(
            produceFile = { tempFolder.newFile("$name.preferences_pb") },
        )
        return SyncPreferencesStore(ds)
    }

    private fun sampleEntity(externalId: String, value: Double) = PendingBiometricEntity(
        sourceType = "health_connect",
        metricType = "heart_rate",
        recordedAtIso = "2026-11-19T01:00:00Z",
        endAtIso = null,
        numericValue = value,
        unit = "bpm",
        sleepStage = null,
        externalId = externalId,
        metadataJson = null,
        createdAtEpochMs = 1795000000_000L,
    )
}

private class InMemoryBiometricQueueStore : BiometricQueueStore {
    private val seq = AtomicLong(1L)
    private val rows = mutableListOf<PendingBiometricEntity>()
    private val countFlow = MutableStateFlow(0)

    override suspend fun enqueue(items: List<PendingBiometricEntity>): Int {
        var added = 0
        for (item in items) {
            val dup = rows.any {
                it.sourceType == item.sourceType &&
                    it.metricType == item.metricType &&
                    it.externalId == item.externalId
            }
            if (!dup) {
                rows += item.copy(id = seq.getAndIncrement())
                added++
            }
        }
        countFlow.value = rows.size
        return added
    }

    override suspend fun peekBatch(limit: Int): List<PendingBiometricEntity> = rows.take(limit)

    override suspend fun deleteByIds(ids: List<Long>) {
        rows.removeAll { it.id in ids }
        countFlow.value = rows.size
    }

    override suspend fun incrementRetry(ids: List<Long>) {
        for (i in rows.indices) {
            if (rows[i].id in ids) {
                rows[i] = rows[i].copy(retryCount = rows[i].retryCount + 1)
            }
        }
    }

    override suspend fun countPending(): Int = rows.size

    override fun observePendingCount(): Flow<Int> = countFlow

    override suspend fun clearAll() {
        rows.clear()
        countFlow.value = 0
    }
}

private class FakeHealthConnectGateway(
    private val granted: Set<String>,
    private val rangeRecords: List<PendingBiometricEntity>,
    private val nextToken: String,
) : HealthConnectGateway {
    var changesResult: HealthChangesResult = HealthChangesResult.Success(emptyList(), nextToken)

    override fun sdkStatus(): HealthConnectSdkStatus = HealthConnectSdkStatus.AVAILABLE

    override suspend fun getGrantedPermissions(): Set<String> = granted

    override suspend fun readRecordsInRange(
        start: Instant,
        end: Instant,
        grantedPermissions: Set<String>,
    ): List<PendingBiometricEntity> = rangeRecords

    override suspend fun getChangesToken(grantedPermissions: Set<String>): String = nextToken

    override suspend fun getChanges(token: String, grantedPermissions: Set<String>): HealthChangesResult =
        changesResult
}

private class FakeBiometricsApi : BiometricsApi {
    var failWithIoException = false
    var rejectInvalidOutOfBoundsHr = false
    val uploadedExternalIds = mutableListOf<String>()

    override suspend fun ingestBiometricSamplesBatch(
        biometricBatchRequest: BiometricBatchRequest,
    ): Response<BiometricBatchResponse> {
        if (failWithIoException) throw IOException("Network offline")

        if (rejectInvalidOutOfBoundsHr) {
            val badIdx = biometricBatchRequest.samples.indexOfFirst { it.numericValue > 220.0 }
            if (badIdx >= 0) {
                val errJson = """
                    {
                      "type": "https://shixu.app/errors/INVALID_BIOMETRIC_SAMPLE",
                      "title": "Invalid Sample",
                      "status": 422,
                      "detail": "heart_rate out of range",
                      "code": "INVALID_BIOMETRIC_SAMPLE",
                      "errors": [{"location": "body.samples[$badIdx].numericValue", "message": "exceeds 220"}]
                    }
                """.trimIndent()
                return Response.error(422, errJson.toResponseBody("application/problem+json".toMediaType()))
            }
        }

        val accepted = biometricBatchRequest.samples.size.toLong()
        uploadedExternalIds += biometricBatchRequest.samples.map { it.externalId }
        return Response.success(
            BiometricBatchResponse(
                acceptedCount = accepted,
                deduplicatedCount = 0L,
                latestEnergy = sampleEnergyResponse(DataFreshness.live_wearable),
            ),
        )
    }

    override suspend fun seedBiometricReplay(replaySeedRequest: ReplaySeedRequest): Response<ReplaySeedResponse> {
        return Response.success(
            ReplaySeedResponse(
                day = LocalDate.parse("2026-11-19"),
                latestEnergy = sampleEnergyResponse(DataFreshness.replay_demo),
                scenario = replaySeedRequest.scenario,
                seededCount = 12L,
            ),
        )
    }

    private fun sampleEnergyResponse(freshness: DataFreshness) = EnergyTodayResponse(
        computedAt = OffsetDateTime.parse("2026-11-19T08:00:00Z"),
        dataFreshness = freshness,
        diagnostics = EnergySourceDiagnostics(baselineReadyDays = 14L),
        drivers = EnergyDrivers(
            autonomicDeltaScore = 8.0,
            circadianScore = 24.0,
            cognitiveLoadDrainScore = 0.0,
            recoveryBufferBonusScore = 0.0,
            sleepRecoveryScore = 38.0,
            summary = "测试摘要",
        ),
        focusShields = emptyList(),
        hourlyCurve = emptyList(),
        localDay = LocalDate.parse("2026-11-19"),
        score = 80L,
        tier = EnergyTier.peak,
        timezone = "Asia/Shanghai",
    )
}
