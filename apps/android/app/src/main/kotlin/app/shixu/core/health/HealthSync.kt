package app.shixu.core.health

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.*
import app.shixu.core.database.PendingUploadQueue
import app.shixu.core.network.ClientServices
import app.shixu.core.network.requireBody
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.reflect.KClass

private val Context.syncTokens by preferencesDataStore("health_sync_tokens")

@Singleton
class HealthSync @Inject constructor(@ApplicationContext private val context: Context, private val queue: PendingUploadQueue, private val api: ClientServices) {
    val sdkStatus: Int get() = HealthConnectClient.getSdkStatus(context)
    private fun client() = HealthConnectClient.getOrCreate(context)
    val backgroundReadSupported: Boolean get() = sdkStatus == HealthConnectClient.SDK_AVAILABLE && client().features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    suspend fun backgroundReadGranted(): Boolean = backgroundReadSupported && HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in client().permissionController.getGrantedPermissions()
    suspend fun missingPermissions(): Set<String> = if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) PERMISSIONS else PERMISSIONS - client().permissionController.getGrantedPermissions()
    suspend fun sync(background: Boolean = false) {
        if (api.tokens.refreshToken() == null) return
        val owner = api.auth.getCurrentUser().requireBody().id.toString()
        if (sdkStatus == HealthConnectClient.SDK_AVAILABLE && (!background || backgroundReadGranted())) {
            val client = client()
            val granted = client.permissionController.getGrantedPermissions()
            val types = RECORD_TYPES.filter { HealthPermission.getReadPermission(it) in granted }.toSet()
            if (types.isNotEmpty()) {
                val key = stringPreferencesKey("$owner:${types.mapNotNull { it.simpleName }.sorted().joinToString()}")
                val token = context.syncTokens.data.first()[key]
                if (token == null) {
                    // Obtain token BEFORE history fetch, so records created during fetch remain in the change stream.
                    val next = client.getChangesToken(ChangesTokenRequest(types))
                    history(client, owner, types, Instant.now().minus(14, ChronoUnit.DAYS))
                    context.syncTokens.edit { it[key] = next }
                } else {
                    var cursor: String = token
                    do {
                        val result = client.getChanges(cursor)
                        if (result.changesTokenExpired) {
                            val next = client.getChangesToken(ChangesTokenRequest(types))
                            history(client, owner, types, Instant.now().minus(48, ChronoUnit.HOURS))
                            context.syncTokens.edit { it[key] = next }
                            break
                        }
                        queue.enqueue(owner, result.changes.filterIsInstance<UpsertionChange>().flatMap { HealthRecordConverter.convert(it.record) })
                        cursor = result.nextChangesToken
                        context.syncTokens.edit { it[key] = cursor }
                    } while (result.hasMore)
                }
            }
        }
        queue.drain(owner)
    }
    private suspend fun history(client: HealthConnectClient, owner: String, types: Set<KClass<out Record>>, from: Instant) {
        for (type in types) {
            var token: String? = null
            do {
                val records = client.readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(from, Instant.now()), pageToken = token))
                queue.enqueue(owner, records.records.flatMap(HealthRecordConverter::convert))
                token = records.pageToken
            } while (token != null)
        }
    }
    companion object {
        val RECORD_TYPES = setOf(HeartRateRecord::class, HeartRateVariabilityRmssdRecord::class, RestingHeartRateRecord::class, SleepSessionRecord::class, ActiveCaloriesBurnedRecord::class)
        val PERMISSIONS = RECORD_TYPES.map { HealthPermission.getReadPermission(it) }.toSet()
        fun schedule(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val periodic = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("health-sync-v2", ExistingPeriodicWorkPolicy.KEEP, periodic)
        }
        fun syncNow(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("health-sync-now-v2", ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<HealthSyncWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
        }
    }
}
