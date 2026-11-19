package app.shixu.core.database

import app.shixu.core.network.ClientServices
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.requireBody
import app.shixu.core.ui.ScheduleNotifications
import kotlinx.serialization.encodeToString
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TodaySnapshotStore @Inject constructor(private val api: ClientServices, private val pending: PendingDao, private val notifications: ScheduleNotifications) {
    suspend fun refresh(owner: String, zone: ZoneId) {
        val day = LocalDate.now(zone)
        val items = api.schedule.listScheduleItems(day.atStartOfDay(zone).toOffsetDateTime(), day.plusDays(1).atStartOfDay(zone).toOffsetDateTime()).requireBody()
        save(owner, day, ShixuJson.json.encodeToString(items))
        notifications.replace(owner, items.items)
    }
    suspend fun save(owner: String, day: LocalDate, payload: String) = pending.saveSnapshot(ScheduleSnapshot(owner, day.toString(), payload, System.currentTimeMillis()))
    suspend fun get(owner: String, day: LocalDate) = pending.snapshot(owner, day.toString())
}
