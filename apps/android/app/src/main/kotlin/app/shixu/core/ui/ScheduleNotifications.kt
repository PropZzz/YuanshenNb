package app.shixu.core.ui

import android.Manifest
import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.shixu.app.MainActivity
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleStatus
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ScheduleNotifications @Inject constructor(@ApplicationContext private val context: Context) {
    private val preferences = context.getSharedPreferences("schedule_alarms", Context.MODE_PRIVATE)
    private val alarms = context.getSystemService(AlarmManager::class.java)
    @Synchronized fun replace(owner: String, items: List<ScheduleItemDTO>) {
        clear()
        val identities = mutableSetOf<String>()
        items.filter { it.status == ScheduleStatus.planned && it.reminderMinutes > 0 }.forEach { item ->
            val at = item.startAt.toInstant().minusSeconds(item.reminderMinutes * 60).toEpochMilli()
            if (at <= Instant.now().toEpochMilli()) return@forEach
            val identity = "$owner/${item.id}"
            val intent = Intent(context, ReminderReceiver::class.java).setData(Uri.parse("shixu://reminder/$identity")).putExtra("title", item.title)
            val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            // Inexact alarms do not require special exact-alarm access and remain safe on Android 12+.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            identities += identity
        }
        preferences.edit().putStringSet("registered", identities).apply()
    }
    @Synchronized fun clear() {
        preferences.getStringSet("registered", emptySet()).orEmpty().forEach { identity ->
            val intent = Intent(context, ReminderReceiver::class.java).setData(Uri.parse("shixu://reminder/$identity"))
            PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let { alarms.cancel(it); it.cancel() }
        }
        preferences.edit().remove("registered").apply()
    }
    fun overload(message: String) = show(context, "精力保护建议", message, "rescue", 7001)
    companion object {
        private const val CHANNEL = "shixu_schedule_protection"
        fun createChannel(context: Context) { context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "日程与精力保护", NotificationManager.IMPORTANCE_HIGH)) }
        fun show(context: Context, title: String, message: String, route: String, id: Int) {
            createChannel(context)
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val launch = PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java).putExtra("destination", route).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(title).setContentText(message).setStyle(NotificationCompat.BigTextStyle().bigText(message)).setContentIntent(launch).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
            NotificationManagerCompat.from(context).notify(id, notification)
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ScheduleNotifications.show(context, "日程即将开始", intent.getStringExtra("title") ?: "查看时间地图中的日程安排", "calendar", intent.dataString.hashCode())
    }
}
