package app.shixu.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

data class SyncMetadata(
    val healthConnectChangesToken: String? = null,
    val initialHistorySynced: Boolean = false,
    val lastHealthSyncAtEpochMs: Long? = null,
    val lastHealthSyncSummary: String? = null,
    val lastBleDeviceAddress: String? = null,
    val lastBleDeviceName: String? = null,
    val baselineLocalDay: String? = null,
    val baselineVersion: String? = null,
    val cachedUserJson: String? = null,
    val cachedEnergyJson: String? = null,
)

/**
 * 持久化 Health Connect 增量 ChangesToken、穿戴诊断元信息及离线恢复所需的用户/精力快照。
 */
@Singleton
class SyncPreferencesStore @Inject constructor(
    @SyncPreferencesDataStore private val dataStore: DataStore<Preferences>,
) {
    val metadataFlow: Flow<SyncMetadata> = dataStore.data
        .catch { err ->
            if (err is IOException) emit(emptyPreferences()) else throw err
        }
        .map { prefs -> prefs.toSyncMetadata() }

    suspend fun readMetadata(): SyncMetadata = metadataFlow.first()

    suspend fun updateHealthConnectSync(
        changesToken: String?,
        initialHistorySynced: Boolean,
        syncedAtEpochMs: Long,
        summary: String,
    ) {
        dataStore.edit { prefs ->
            if (changesToken != null) {
                prefs[KEY_HC_CHANGES_TOKEN] = changesToken
            } else {
                prefs.remove(KEY_HC_CHANGES_TOKEN)
            }
            prefs[KEY_HC_INITIAL_SYNCED] = initialHistorySynced
            prefs[KEY_HC_LAST_SYNC_MS] = syncedAtEpochMs
            prefs[KEY_HC_LAST_SUMMARY] = summary
        }
    }

    suspend fun clearHealthChangesToken() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_HC_CHANGES_TOKEN)
        }
    }

    suspend fun updateLastBleDevice(address: String?, name: String?) {
        dataStore.edit { prefs ->
            if (address != null) prefs[KEY_BLE_ADDRESS] = address else prefs.remove(KEY_BLE_ADDRESS)
            if (name != null) prefs[KEY_BLE_NAME] = name else prefs.remove(KEY_BLE_NAME)
        }
    }

    suspend fun updateScheduleBaseline(localDay: String, baselineVersion: String) {
        dataStore.edit { prefs ->
            prefs[KEY_BASELINE_LOCAL_DAY] = localDay
            prefs[KEY_BASELINE_VERSION] = baselineVersion
        }
    }

    suspend fun saveCachedUserJson(rawJson: String) {
        dataStore.edit { prefs ->
            prefs[KEY_CACHED_USER_JSON] = rawJson
        }
    }

    suspend fun saveCachedEnergyJson(rawJson: String) {
        dataStore.edit { prefs ->
            prefs[KEY_CACHED_ENERGY_JSON] = rawJson
        }
    }

    suspend fun clearUserScopedData() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_HC_CHANGES_TOKEN)
            prefs.remove(KEY_HC_INITIAL_SYNCED)
            prefs.remove(KEY_HC_LAST_SYNC_MS)
            prefs.remove(KEY_HC_LAST_SUMMARY)
            prefs.remove(KEY_BASELINE_LOCAL_DAY)
            prefs.remove(KEY_BASELINE_VERSION)
            prefs.remove(KEY_CACHED_USER_JSON)
            prefs.remove(KEY_CACHED_ENERGY_JSON)
        }
    }

    private fun Preferences.toSyncMetadata(): SyncMetadata = SyncMetadata(
        healthConnectChangesToken = this[KEY_HC_CHANGES_TOKEN],
        initialHistorySynced = this[KEY_HC_INITIAL_SYNCED] ?: false,
        lastHealthSyncAtEpochMs = this[KEY_HC_LAST_SYNC_MS],
        lastHealthSyncSummary = this[KEY_HC_LAST_SUMMARY],
        lastBleDeviceAddress = this[KEY_BLE_ADDRESS],
        lastBleDeviceName = this[KEY_BLE_NAME],
        baselineLocalDay = this[KEY_BASELINE_LOCAL_DAY],
        baselineVersion = this[KEY_BASELINE_VERSION],
        cachedUserJson = this[KEY_CACHED_USER_JSON],
        cachedEnergyJson = this[KEY_CACHED_ENERGY_JSON],
    )

    private companion object {
        val KEY_HC_CHANGES_TOKEN = stringPreferencesKey("hc_changes_token")
        val KEY_HC_INITIAL_SYNCED = booleanPreferencesKey("hc_initial_history_synced")
        val KEY_HC_LAST_SYNC_MS = longPreferencesKey("hc_last_sync_epoch_ms")
        val KEY_HC_LAST_SUMMARY = stringPreferencesKey("hc_last_sync_summary")
        val KEY_BLE_ADDRESS = stringPreferencesKey("ble_last_address")
        val KEY_BLE_NAME = stringPreferencesKey("ble_last_name")
        val KEY_BASELINE_LOCAL_DAY = stringPreferencesKey("schedule_baseline_local_day")
        val KEY_BASELINE_VERSION = stringPreferencesKey("schedule_baseline_version")
        val KEY_CACHED_USER_JSON = stringPreferencesKey("cached_user_json")
        val KEY_CACHED_ENERGY_JSON = stringPreferencesKey("cached_energy_json")
    }
}
