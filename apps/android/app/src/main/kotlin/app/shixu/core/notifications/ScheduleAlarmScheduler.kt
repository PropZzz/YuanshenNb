package app.shixu.core.notifications

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.edit
import app.shixu.core.network.generated.models.ScheduleCategory
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleStatus
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 依据服务端最新日程对账本地 AlarmManager 提醒闹钟，确保会议新增、改期或取消后秒级校准/注销。
 */
@Singleton
class ScheduleAlarmScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val clock: () -> Instant,
) {
    private val alarmManager: AlarmManager? = context.getSystemService(AlarmManager::class.java)
    private val registry = context.getSharedPreferences("shixu_alarm_registry", Context.MODE_PRIVATE)

    @Synchronized
    fun reconcile(items: List<ScheduleItemDTO>) {
        val manager = alarmManager ?: return
        val nowMs = clock().toEpochMilli()
        val previousIds = registry.getStringSet(KEY_ACTIVE_IDS, emptySet()).orEmpty()

        val activeTargets = items.filter { item ->
            (item.status == ScheduleStatus.planned || item.status == ScheduleStatus.in_progress) &&
                item.reminderMinutes > 0L &&
                item.startAt.toInstant().minusSeconds(item.reminderMinutes * 60L).toEpochMilli() > nowMs
        }
        val nextIds = activeTargets.map { it.id.toString() }.toSet()

        for (staleId in previousIds - nextIds) {
            cancelAlarmForId(manager, staleId)
        }

        for (item in activeTargets) {
            val triggerAtMs = item.startAt.toInstant()
                .minusSeconds(item.reminderMinutes * 60L)
                .toEpochMilli()
            val pendingIntent = buildPendingIntent(item)
            scheduleAlarmSafely(manager, triggerAtMs, pendingIntent)
        }

        registry.edit { putStringSet(KEY_ACTIVE_IDS, nextIds) }
    }

    @Synchronized
    fun cancelAll() {
        val manager = alarmManager ?: return
        val previousIds = registry.getStringSet(KEY_ACTIVE_IDS, emptySet()).orEmpty()
        for (id in previousIds) {
            cancelAlarmForId(manager, id)
        }
        registry.edit { remove(KEY_ACTIVE_IDS) }
    }

    @SuppressLint("MissingPermission")
    private fun scheduleAlarmSafely(
        manager: AlarmManager,
        triggerAtMs: Long,
        pendingIntent: PendingIntent,
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
            try {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
                return
            } catch (_: SecurityException) {
                // Fallback gracefully to inexact alarm if exact alarm privilege was revoked at runtime
            }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
    }

    private fun cancelAlarmForId(manager: AlarmManager, itemId: String) {
        val intent = Intent(context, ScheduleReminderReceiver::class.java)
        val existing = PendingIntent.getBroadcast(
            context,
            itemId.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        )
        if (existing != null) {
            manager.cancel(existing)
            existing.cancel()
        }
    }

    private fun buildPendingIntent(item: ScheduleItemDTO): PendingIntent {
        val zone = ZoneId.systemDefault()
        val startLocal = TIME_FORMAT.format(item.startAt.atZoneSameInstant(zone))
        val endLocal = TIME_FORMAT.format(item.endAt.atZoneSameInstant(zone))
        val intent = Intent(context, ScheduleReminderReceiver::class.java).apply {
            putExtra(ScheduleReminderReceiver.EXTRA_ITEM_ID, item.id.toString())
            putExtra(ScheduleReminderReceiver.EXTRA_TITLE, item.title)
            putExtra(ScheduleReminderReceiver.EXTRA_TIME_LABEL, "$startLocal - $endLocal")
            putExtra(ScheduleReminderReceiver.EXTRA_CATEGORY_LABEL, categoryLabel(item.category))
        }
        return PendingIntent.getBroadcast(
            context,
            item.id.toString().hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun categoryLabel(category: ScheduleCategory): String = when (category) {
        ScheduleCategory.deep_work -> "深度专注"
        ScheduleCategory.meeting -> "协同会议"
        ScheduleCategory.recovery -> "恢复缓冲"
        ScheduleCategory.routine -> "常规日程"
        ScheduleCategory.urgent -> "紧急任务"
    }

    private companion object {
        const val KEY_ACTIVE_IDS = "active_alarm_item_ids"
        val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
    }
}
