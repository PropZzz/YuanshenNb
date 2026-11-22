package app.shixu.feature.energy

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.cash.turbine.test
import app.shixu.core.data.EnergyRepository
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.apis.BiometricsApi
import app.shixu.core.network.generated.apis.EnergyApi
import app.shixu.core.network.generated.models.BiometricBatchRequest
import app.shixu.core.network.generated.models.BiometricBatchResponse
import app.shixu.core.network.generated.models.Chronotype
import app.shixu.core.network.generated.models.DataFreshness
import app.shixu.core.network.generated.models.EnergyDrivers
import app.shixu.core.network.generated.models.EnergyProfileDTO
import app.shixu.core.network.generated.models.EnergySourceDiagnostics
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ReplayScenario
import app.shixu.core.network.generated.models.ReplaySeedRequest
import app.shixu.core.network.generated.models.ReplaySeedResponse
import app.shixu.core.network.generated.models.UpdateEnergyProfileRequest
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.Response
import java.io.IOException
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.UUID

class EnergyHonestyStateTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    @Before
    fun setup() {
        ShixuJson.install()
    }

    @Test
    fun repositoryPreservesServerDataFreshnessAndMarksOfflineSnapshotHonestly() = runTest {
        val ds = PreferenceDataStoreFactory.create(produceFile = { tempFolder.newFile("energy.preferences_pb") })
        val prefs = SyncPreferencesStore(ds)
        val energyApi = StubEnergyApi()
        val bioApi = StubBiometricsApi()
        val repo = EnergyRepository(energyApi, bioApi, prefs)

        repo.todayEnergy.test {
            assertNull(awaitItem())

            // 1. 无穿戴数据 -> 服务端返回 baseline_only
            energyApi.nextToday = sampleEnergy(DataFreshness.baseline_only, 68L)
            assertTrue(repo.fetchTodayEnergy() is ApiResult.Success)
            val baseline = awaitItem()!!
            assertEquals(DataFreshness.baseline_only, baseline.dataFreshness)
            assertFalse(repo.isOfflineSnapshot.value)

            // 2. 显式触发回放种子 -> 切换到 replay_demo，绝不伪装成真实手环
            assertTrue(repo.seedReplay(ReplayScenario.high_stress) is ApiResult.Success)
            val replay = awaitItem()!!
            assertEquals(DataFreshness.replay_demo, replay.dataFreshness)
            assertEquals(39L, replay.score)

            // 3. 断网查询 -> 保留缓存但 isOfflineSnapshot 为 true，且不篡改 dataFreshness
            energyApi.throwIo = true
            assertTrue(repo.fetchTodayEnergy() is ApiResult.NetworkError)
            assertTrue(repo.isOfflineSnapshot.value)
            assertEquals(DataFreshness.replay_demo, repo.todayEnergy.value?.dataFreshness)

            cancelAndIgnoreRemainingEvents()
        }
    }

    private class StubEnergyApi : EnergyApi {
        var throwIo = false
        var nextToday: EnergyTodayResponse = sampleEnergy(DataFreshness.baseline_only, 70L)

        override suspend fun getEnergyProfile(): Response<EnergyProfileDTO> = Response.success(
            EnergyProfileDTO(
                chronotype = Chronotype.balanced,
                minRecoveryBufferMin = 15L,
                preferredFocusWindows = emptyList(),
                updatedAt = OffsetDateTime.parse("2026-11-19T00:00:00Z"),
                userId = UUID.fromString("11111111-1111-1111-1111-111111111111"),
                workEndMinute = 1080L,
                workStartMinute = 540L,
            ),
        )

        override suspend fun getTodayEnergy(day: LocalDate?): Response<EnergyTodayResponse> {
            if (throwIo) throw IOException("offline")
            return Response.success(nextToday)
        }

        override suspend fun updateEnergyProfile(
            updateEnergyProfileRequest: UpdateEnergyProfileRequest,
        ): Response<EnergyProfileDTO> = getEnergyProfile()
    }

    private class StubBiometricsApi : BiometricsApi {
        override suspend fun ingestBiometricSamplesBatch(
            biometricBatchRequest: BiometricBatchRequest,
        ): Response<BiometricBatchResponse> = Response.success(
            BiometricBatchResponse(
                acceptedCount = 1L,
                deduplicatedCount = 0L,
                latestEnergy = sampleEnergy(DataFreshness.live_wearable, 84L),
            ),
        )

        override suspend fun seedBiometricReplay(
            replaySeedRequest: ReplaySeedRequest,
        ): Response<ReplaySeedResponse> = Response.success(
            ReplaySeedResponse(
                day = LocalDate.parse("2026-11-19"),
                latestEnergy = sampleEnergy(DataFreshness.replay_demo, 39L),
                scenario = replaySeedRequest.scenario,
                seededCount = 16L,
            ),
        )
    }

    private companion object {
        fun sampleEnergy(freshness: DataFreshness, score: Long) = EnergyTodayResponse(
            computedAt = OffsetDateTime.parse("2026-11-19T08:00:00Z"),
            dataFreshness = freshness,
            diagnostics = EnergySourceDiagnostics(baselineReadyDays = if (freshness == DataFreshness.baseline_only) 0L else 14L),
            drivers = EnergyDrivers(
                autonomicDeltaScore = 0.0,
                circadianScore = 24.0,
                cognitiveLoadDrainScore = 0.0,
                recoveryBufferBonusScore = 0.0,
                sleepRecoveryScore = 30.0,
                summary = freshness.value,
            ),
            focusShields = emptyList(),
            hourlyCurve = emptyList(),
            localDay = LocalDate.parse("2026-11-19"),
            score = score,
            tier = EnergyTier.steady,
            timezone = "Asia/Shanghai",
        )
    }
}
