package app.shixu.feature.schedule

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shixu.core.network.*
import app.shixu.core.network.generated.models.*
import app.shixu.core.database.TodaySnapshotStore
import app.shixu.core.ui.ScheduleNotifications
import kotlinx.serialization.encodeToString
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.*
import java.util.UUID

class ScheduleViewModel(private val api: ClientServices, val zone: ZoneId, private val owner: String, private val snapshots: TodaySnapshotStore, private val notifications: ScheduleNotifications) : ViewModel() {
    var day by mutableStateOf(LocalDate.now(zone)); private set
    var items by mutableStateOf<List<ScheduleItemDTO>>(emptyList()); private set
    var energy by mutableStateOf<EnergyTodayResponse?>(null); private set
    var options by mutableStateOf<RescueOptionsResponse?>(null); private set
    var history by mutableStateOf<List<RescueSnapshotRecord>>(emptyList()); private set
    var busy by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<String?>(null); private set
    var offline by mutableStateOf(false); private set
    var focusDeadline by mutableStateOf<Instant?>(null); private set
    private var previewRequest: RescueOptionsRequest? = null
    init { load() }
    fun selectDay(value: LocalDate) { if (busy) return; day = value; items = emptyList(); energy = null; loaded = false; options = null; load() }
    fun updateFocusDeadline(value: Instant?) { focusDeadline = value }
    fun load() = action { refresh() }
    private suspend fun refresh() {
        val start = day.atStartOfDay(zone).toOffsetDateTime()
        val response = try {
            api.schedule.listScheduleItems(start, day.plusDays(1).atStartOfDay(zone).toOffsetDateTime()).requireBody()
        } catch (failure: java.io.IOException) {
            val cached = snapshots.get(owner, day) ?: throw failure
            items = ShixuJson.json.decodeFromString<ScheduleItemListResponse>(cached.payload).items
            offline = true; loaded = true; error = "当前离线，显示今日只读快照。联网后可继续编辑。"
            return
        }
        items = response.items; offline = false
        if (day == LocalDate.now(zone)) {
            snapshots.save(owner, day, ShixuJson.json.encodeToString(response))
            notifications.replace(owner, items)
        }
        loaded = true
        energy = api.energy.getTodayEnergy(day).requireBody()
        history = api.schedule.listRescueHistory().requireBody().snapshots
    }
    fun save(id: UUID?, request: CreateScheduleItemRequest, done: () -> Unit) = action {
        if (id == null) api.schedule.createScheduleItem(request).requireBody()
        else api.schedule.updateScheduleItem(id, UpdateScheduleItemRequest(title = request.title, notes = request.notes, startAt = request.startAt, endAt = request.endAt, cognitiveLoad = request.cognitiveLoad, category = request.category, flexibility = request.flexibility, reminderMinutes = request.reminderMinutes)).requireBody()
        notice = "日程已保存"; options = null; done(); refresh()
    }
    fun complete(item: ScheduleItemDTO) = action { api.schedule.updateScheduleItem(item.id, UpdateScheduleItemRequest(status = ScheduleStatus.completed)).requireBody(); notice = "已完成 ${item.title}"; refresh() }
    fun cancel(item: ScheduleItemDTO) = action { api.schedule.deleteScheduleItem(item.id).requireSuccess(); notice = "日程已取消"; refresh() }
    fun preview(urgent: UrgentTaskDTO?) = action {
        val request = RescueOptionsRequest(day, if (urgent == null) RescueTriggerReason.wearable_fatigue else RescueTriggerReason.urgent_task, urgent)
        options = api.schedule.previewRescueOptions(request).requireBody(); previewRequest = request
    }
    fun apply(plan: RescueOptionPlan) = action {
        val preview = options ?: return@action
        val request = previewRequest ?: return@action
        api.schedule.applyRescueOption(RescueApplyRequest(preview.baselineVersion, day, plan.strategy, request.triggerReason, plan.optionHash, request.urgentTask), UUID.randomUUID().toString()).requireBody()
        options = null; notice = "救援方案已应用，可在下方历史中撤销"; refresh()
    }
    fun undo(record: RescueSnapshotRecord) = action { api.schedule.undoRescueSnapshot(RescueUndoRequest(record.id)).requireBody(); notice = "救援已撤销"; options = null; refresh() }
    private fun action(block: suspend () -> Unit) {
        if (busy) return
        viewModelScope.launch {
            busy = true; error = null; notice = null
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.userMessage() } finally { busy = false }
        }
    }
}

