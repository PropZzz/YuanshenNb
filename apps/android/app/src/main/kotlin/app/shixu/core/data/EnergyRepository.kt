package app.shixu.core.data

import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.network.ApiResult
import app.shixu.core.network.ErrorMessageMapper
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.apis.BiometricsApi
import app.shixu.core.network.generated.apis.EnergyApi
import app.shixu.core.network.generated.models.EnergyProfileDTO
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ReplayScenario
import app.shixu.core.network.generated.models.ReplaySeedRequest
import app.shixu.core.network.generated.models.ReplaySeedResponse
import app.shixu.core.network.generated.models.UpdateEnergyProfileRequest
import app.shixu.core.network.safeApiCall
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EnergyRepository @Inject constructor(
    private val energyApi: EnergyApi,
    private val biometricsApi: BiometricsApi,
    private val syncPreferencesStore: SyncPreferencesStore,
) {
    private val _todayEnergy = MutableStateFlow<EnergyTodayResponse?>(null)
    val todayEnergy: StateFlow<EnergyTodayResponse?> = _todayEnergy.asStateFlow()

    private val _energyProfile = MutableStateFlow<EnergyProfileDTO?>(null)
    val energyProfile: StateFlow<EnergyProfileDTO?> = _energyProfile.asStateFlow()

    private val _isOfflineSnapshot = MutableStateFlow(false)
    val isOfflineSnapshot: StateFlow<Boolean> = _isOfflineSnapshot.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    suspend fun hydrateFromCache() {
        if (_todayEnergy.value != null) return
        val cachedRaw = syncPreferencesStore.readMetadata().cachedEnergyJson ?: return
        val decoded = runCatching {
            ShixuJson.json.decodeFromString<EnergyTodayResponse>(cachedRaw)
        }.getOrNull() ?: return
        _todayEnergy.value = decoded
        _isOfflineSnapshot.value = true
    }

    suspend fun acceptSyncedEnergy(energy: EnergyTodayResponse) {
        _todayEnergy.value = energy
        _isOfflineSnapshot.value = false
        _lastError.value = null
        syncPreferencesStore.saveCachedEnergyJson(ShixuJson.json.encodeToString(energy))
    }

    suspend fun fetchTodayEnergy(day: LocalDate? = null): ApiResult<EnergyTodayResponse> {
        hydrateFromCache()
        val result = safeApiCall { energyApi.getTodayEnergy(day) }
        when (result) {
            is ApiResult.Success -> {
                _todayEnergy.value = result.data
                _isOfflineSnapshot.value = false
                _lastError.value = null
                syncPreferencesStore.saveCachedEnergyJson(ShixuJson.json.encodeToString(result.data))
            }

            is ApiResult.HttpError -> {
                _lastError.value = ErrorMessageMapper.messageFor(result)
            }

            is ApiResult.NetworkError -> {
                _isOfflineSnapshot.value = true
                _lastError.value = ErrorMessageMapper.messageFor(result)
            }
        }
        return result
    }

    suspend fun fetchEnergyProfile(): ApiResult<EnergyProfileDTO> {
        val result = safeApiCall { energyApi.getEnergyProfile() }
        if (result is ApiResult.Success) {
            _energyProfile.value = result.data
        }
        return result
    }

    suspend fun updateEnergyProfile(request: UpdateEnergyProfileRequest): ApiResult<EnergyProfileDTO> {
        val result = safeApiCall { energyApi.updateEnergyProfile(request) }
        if (result is ApiResult.Success) {
            _energyProfile.value = result.data
            fetchTodayEnergy()
        }
        return result
    }

    suspend fun seedReplay(scenario: ReplayScenario, day: LocalDate? = null): ApiResult<ReplaySeedResponse> {
        val result = safeApiCall {
            biometricsApi.seedBiometricReplay(
                ReplaySeedRequest(
                    scenario = scenario,
                    day = day,
                ),
            )
        }
        if (result is ApiResult.Success) {
            acceptSyncedEnergy(result.data.latestEnergy)
        }
        return result
    }

    fun clear() {
        _todayEnergy.value = null
        _energyProfile.value = null
        _isOfflineSnapshot.value = false
        _lastError.value = null
    }
}
