package app.shixu.core.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.shixu.core.database.PendingBiometricEntity
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.reflect.KClass

@Singleton
class AndroidHealthConnectGateway @Inject constructor(
    @ApplicationContext private val context: Context,
) : HealthConnectGateway {

    override fun sdkStatus(): HealthConnectSdkStatus =
        when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> HealthConnectSdkStatus.AVAILABLE
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> HealthConnectSdkStatus.UPDATE_REQUIRED
            else -> HealthConnectSdkStatus.UNAVAILABLE
        }

    private fun getClientOrNull(): HealthConnectClient? =
        if (sdkStatus() == HealthConnectSdkStatus.AVAILABLE) {
            runCatching { HealthConnectClient.getOrCreate(context) }.getOrNull()
        } else {
            null
        }

    override suspend fun getGrantedPermissions(): Set<String> {
        val client = getClientOrNull() ?: return emptySet()
        return runCatching {
            client.permissionController.getGrantedPermissions()
        }.getOrDefault(emptySet())
    }

    override suspend fun readRecordsInRange(
        start: Instant,
        end: Instant,
        grantedPermissions: Set<String>,
    ): List<PendingBiometricEntity> {
        val client = getClientOrNull() ?: return emptyList()
        val grantedTypes = HealthConnectPermissions.grantedRecordTypes(grantedPermissions)
        if (grantedTypes.isEmpty()) return emptyList()

        val timeRange = TimeRangeFilter.between(start, end)
        val collected = mutableListOf<PendingBiometricEntity>()
        for (recordType in grantedTypes) {
            // 仅读取已授权的记录类型，用户撤销部分权限时不崩溃
            collected += runCatching {
                readAllPages(client, recordType, timeRange)
            }.getOrDefault(emptyList())
        }
        return collected
    }

    override suspend fun getChangesToken(grantedPermissions: Set<String>): String? {
        val client = getClientOrNull() ?: return null
        val grantedTypes = HealthConnectPermissions.grantedRecordTypes(grantedPermissions)
        if (grantedTypes.isEmpty()) return null
        return runCatching {
            client.getChangesToken(ChangesTokenRequest(recordTypes = grantedTypes))
        }.getOrNull()
    }

    override suspend fun getChanges(token: String, grantedPermissions: Set<String>): HealthChangesResult {
        val client = getClientOrNull() ?: return HealthChangesResult.Success(emptyList(), token)
        val grantedTypes = HealthConnectPermissions.grantedRecordTypes(grantedPermissions)
        var currentToken = token
        val collected = mutableListOf<PendingBiometricEntity>()

        while (true) {
            val response = client.getChanges(currentToken)
            if (response.changesTokenExpired) {
                return HealthChangesResult.TokenExpired
            }
            val upsertRecords = response.changes
                .filterIsInstance<UpsertionChange>()
                .map { it.record }
                .filter { record ->
                    // 仅保留当前仍具备权限的记录类型
                    when (record) {
                        is HeartRateRecord -> HeartRateRecord::class in grantedTypes
                        is HeartRateVariabilityRmssdRecord -> HeartRateVariabilityRmssdRecord::class in grantedTypes
                        is RestingHeartRateRecord -> RestingHeartRateRecord::class in grantedTypes
                        is SleepSessionRecord -> SleepSessionRecord::class in grantedTypes
                        is ActiveCaloriesBurnedRecord -> ActiveCaloriesBurnedRecord::class in grantedTypes
                        else -> false
                    }
                }
            collected += HealthRecordMapper.mapRecords(upsertRecords)
            currentToken = response.nextChangesToken
            if (!response.hasMore) {
                return HealthChangesResult.Success(samples = collected, nextToken = currentToken)
            }
        }
    }

    private suspend fun <T : Record> readAllPages(
        client: HealthConnectClient,
        recordType: KClass<T>,
        timeRange: TimeRangeFilter,
    ): List<PendingBiometricEntity> {
        val results = mutableListOf<PendingBiometricEntity>()
        var pageToken: String? = null
        do {
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = recordType,
                    timeRangeFilter = timeRange,
                    pageToken = pageToken,
                ),
            )
            results += HealthRecordMapper.mapRecords(response.records)
            pageToken = response.pageToken
        } while (pageToken != null)
        return results
    }
}
