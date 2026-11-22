package app.shixu.core.data

import app.shixu.core.database.CachedScheduleDao
import app.shixu.core.database.toDto
import app.shixu.core.database.toEntity
import app.shixu.core.datastore.SyncPreferencesStore
import app.shixu.core.network.ApiResult
import app.shixu.core.network.generated.apis.ScheduleApi
import app.shixu.core.network.generated.models.CreateScheduleItemRequest
import app.shixu.core.network.generated.models.RescueApplyRequest
import app.shixu.core.network.generated.models.RescueApplyResponse
import app.shixu.core.network.generated.models.RescueHistoryResponse
import app.shixu.core.network.generated.models.RescueOptionsRequest
import app.shixu.core.network.generated.models.RescueOptionsResponse
import app.shixu.core.network.generated.models.RescueStrategy
import app.shixu.core.network.generated.models.RescueTriggerReason
import app.shixu.core.network.generated.models.RescueUndoRequest
import app.shixu.core.network.generated.models.RescueUndoResponse
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleItemListResponse
import app.shixu.core.network.generated.models.ScheduleMutationResponse
import app.shixu.core.network.generated.models.UpdateScheduleItemRequest
import app.shixu.core.network.generated.models.UrgentTaskDTO
import app.shixu.core.network.safeApiCall
import app.shixu.core.network.safeUnitApiCall
import app.shixu.core.notifications.ScheduleAlarmScheduler
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ScheduleRepository @Inject constructor(
    private val scheduleApi: ScheduleApi,
    private val cachedScheduleDao: CachedScheduleDao,
    private val syncPreferencesStore: SyncPreferencesStore,
    private val alarmScheduler: ScheduleAlarmScheduler,
    private val clock: () -> Instant,
) {
    private val _baselineVersion = MutableStateFlow<String?>(null)
    val baselineVersion: StateFlow<String?> = _baselineVersion.asStateFlow()

    private val _baselineLocalDay = MutableStateFlow<LocalDate?>(null)
    val baselineLocalDay: StateFlow<LocalDate?> = _baselineLocalDay.asStateFlow()

    private val _isOfflineReadOnly = MutableStateFlow(false)
    val isOfflineReadOnly: StateFlow<Boolean> = _isOfflineReadOnly.asStateFlow()

    fun observeCachedItems(): Flow<List<ScheduleItemDTO>> =
        cachedScheduleDao.observeActiveItems().map { rows -> rows.map { it.toDto() } }

    suspend fun hydrateBaselineFromPrefs() {
        val meta = syncPreferencesStore.readMetadata()
        if (_baselineVersion.value == null && meta.baselineVersion != null) {
            _baselineVersion.value = meta.baselineVersion
        }
        if (_baselineLocalDay.value == null && meta.baselineLocalDay != null) {
            _baselineLocalDay.value = runCatching { LocalDate.parse(meta.baselineLocalDay) }.getOrNull()
        }
    }

    suspend fun refreshRollingWindow(zoneId: ZoneId = ZoneId.systemDefault()): ApiResult<ScheduleItemListResponse> {
        val today = LocalDate.now(zoneId)
        val from = today.minusDays(1).atStartOfDay(zoneId).toOffsetDateTime()
        val to = today.plusDays(8).atStartOfDay(zoneId).toOffsetDateTime()
        return refreshWindow(from, to, persistToRoom = true)
    }

    suspend fun refreshWindow(
        from: OffsetDateTime,
        to: OffsetDateTime,
        persistToRoom: Boolean = true,
    ): ApiResult<ScheduleItemListResponse> {
        val safeTo = if (Duration.between(from, to).toDays() > MAX_QUERY_DAYS) {
            from.plusDays(MAX_QUERY_DAYS)
        } else {
            to
        }

        val result = safeApiCall {
            scheduleApi.listScheduleItems(from = from, to = safeTo, includeCancelled = false)
        }
        when (result) {
            is ApiResult.Success -> {
                _isOfflineReadOnly.value = false
                updateBaseline(result.data.baselineLocalDay, result.data.baselineVersion)
                if (persistToRoom) {
                    val nowMs = clock().toEpochMilli()
                    cachedScheduleDao.replaceAll(result.data.items.map { it.toEntity(nowMs) })
                    alarmScheduler.reconcile(result.data.items)
                }
            }

            is ApiResult.NetworkError -> {
                _isOfflineReadOnly.value = true
            }

            is ApiResult.HttpError -> Unit
        }
        return result
    }

    suspend fun createItem(request: CreateScheduleItemRequest): ApiResult<ScheduleMutationResponse> {
        val result = safeApiCall { scheduleApi.createScheduleItem(request) }
        if (result is ApiResult.Success) {
            updateBaseline(result.data.baselineLocalDay, result.data.baselineVersion)
            refreshRollingWindow()
        }
        return result
    }

    suspend fun updateItem(id: UUID, request: UpdateScheduleItemRequest): ApiResult<ScheduleMutationResponse> {
        val result = safeApiCall { scheduleApi.updateScheduleItem(id, request) }
        if (result is ApiResult.Success) {
            updateBaseline(result.data.baselineLocalDay, result.data.baselineVersion)
            refreshRollingWindow()
        }
        return result
    }

    suspend fun deleteItem(id: UUID): ApiResult<Unit> {
        val result = safeUnitApiCall { scheduleApi.deleteScheduleItem(id) }
        if (result is ApiResult.Success) {
            refreshRollingWindow()
        }
        return result
    }

    suspend fun previewRescueOptions(
        day: LocalDate,
        triggerReason: RescueTriggerReason,
        urgentTask: UrgentTaskDTO? = null,
    ): ApiResult<RescueOptionsResponse> =
        safeApiCall {
            scheduleApi.previewRescueOptions(
                RescueOptionsRequest(
                    day = day,
                    triggerReason = triggerReason,
                    urgentTask = urgentTask,
                ),
            )
        }

    suspend fun applyRescueOption(
        day: LocalDate,
        baselineVersion: String,
        strategy: RescueStrategy,
        triggerReason: RescueTriggerReason,
        urgentTask: UrgentTaskDTO? = null,
        expectedOptionHash: String? = null,
        idempotencyKey: String = UUID.randomUUID().toString(),
    ): ApiResult<RescueApplyResponse> {
        val result = safeApiCall {
            scheduleApi.applyRescueOption(
                rescueApplyRequest = RescueApplyRequest(
                    baselineVersion = baselineVersion,
                    day = day,
                    strategy = strategy,
                    triggerReason = triggerReason,
                    expectedOptionHash = expectedOptionHash,
                    urgentTask = urgentTask,
                ),
                idempotencyKey = idempotencyKey,
            )
        }
        if (result is ApiResult.Success) {
            updateBaseline(result.data.baselineLocalDay, result.data.baselineVersion)
            refreshRollingWindow()
        }
        return result
    }

    suspend fun undoRescueSnapshot(snapshotId: UUID): ApiResult<RescueUndoResponse> {
        val result = safeApiCall {
            scheduleApi.undoRescueSnapshot(RescueUndoRequest(snapshotId = snapshotId))
        }
        if (result is ApiResult.Success) {
            updateBaseline(result.data.baselineLocalDay, result.data.baselineVersion)
            refreshRollingWindow()
        }
        return result
    }

    suspend fun listRescueHistory(limit: Long = 20L, cursor: String? = null): ApiResult<RescueHistoryResponse> =
        safeApiCall { scheduleApi.listRescueHistory(limit = limit, cursor = cursor) }

    suspend fun clearCache() {
        cachedScheduleDao.clearAll()
        alarmScheduler.cancelAll()
        _baselineVersion.value = null
        _baselineLocalDay.value = null
        _isOfflineReadOnly.value = false
    }

    private suspend fun updateBaseline(localDay: LocalDate, version: String) {
        _baselineLocalDay.value = localDay
        _baselineVersion.value = version
        syncPreferencesStore.updateScheduleBaseline(localDay.toString(), version)
    }

    private companion object {
        const val MAX_QUERY_DAYS = 62L
    }
}
