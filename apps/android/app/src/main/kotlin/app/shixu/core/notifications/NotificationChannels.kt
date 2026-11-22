package app.shixu.core.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

object NotificationChannels {
    const val CHANNEL_OVERLOAD = "shixu_overload_alerts"
    const val CHANNEL_REMINDERS = "shixu_schedule_reminders"
    const val CHANNEL_TEAM = "shixu_team_updates"

    fun ensureCreated(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            NotificationChannel(
                CHANNEL_OVERLOAD,
                "精力过载保护预警",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "穿戴疲劳或高负荷会议连续预警，点击直达日程救援确认页"
            },
            NotificationChannel(
                CHANNEL_REMINDERS,
                "日程与协同会议提前提醒",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "依据跨端同步日程自动校准的本地提前提醒闹钟"
            },
            NotificationChannel(
                CHANNEL_TEAM,
                "团队排会动态",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "团队协同会议确认与取消即时通知"
            },
        )
        manager.createNotificationChannels(channels)
    }
}
