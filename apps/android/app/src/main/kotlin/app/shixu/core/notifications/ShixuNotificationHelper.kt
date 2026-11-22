package app.shixu.core.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.shixu.R
import app.shixu.app.MainActivity
import app.shixu.core.network.generated.models.WsEnergyOverloadAlertPayload
import app.shixu.core.network.generated.models.WsWorkspaceMeetingCancelledPayload
import app.shixu.core.network.generated.models.WsWorkspaceMeetingConfirmedPayload
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ShixuNotificationHelper @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun canPostNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun showOverloadAlert(payload: WsEnergyOverloadAlertPayload) {
        if (!canPostNotifications()) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NAV_ROUTE, "calendar")
            putExtra(EXTRA_OPEN_RESCUE, true)
            putExtra(EXTRA_RESCUE_REASON, payload.triggerReason.value)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            REQ_OVERLOAD,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, NotificationChannels.CHANNEL_OVERLOAD)
            .setSmallIcon(R.drawable.ic_shixu_notify)
            .setContentTitle("精力保护预警（当前 ${payload.currentScore} 分）")
            .setContentText(payload.message)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${payload.message}\n点击打开三策略日程救援方案对比"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(context).notify(NOTIF_ID_OVERLOAD, notification)
    }

    @SuppressLint("MissingPermission")
    fun showMeetingConfirmed(payload: WsWorkspaceMeetingConfirmedPayload) {
        if (!canPostNotifications()) return
        val timeText = TIME_FORMAT.format(payload.startAt.atZoneSameInstant(ZoneId.systemDefault()))
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NAV_ROUTE, "team")
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            payload.proposalId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, NotificationChannels.CHANNEL_TEAM)
            .setSmallIcon(R.drawable.ic_shixu_notify)
            .setContentTitle("已确认团队会议：${payload.title}")
            .setContentText("开始时间 $timeText · 本地提醒闹钟已自动对齐")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(context).notify(payload.proposalId.hashCode(), notification)
    }

    @SuppressLint("MissingPermission")
    fun showMeetingCancelled(payload: WsWorkspaceMeetingCancelledPayload) {
        if (!canPostNotifications()) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NAV_ROUTE, "team")
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            payload.proposalId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val reason = payload.reason?.takeIf { it.isNotBlank() }?.let { "（$it）" }.orEmpty()
        val notification = NotificationCompat.Builder(context, NotificationChannels.CHANNEL_TEAM)
            .setSmallIcon(R.drawable.ic_shixu_notify)
            .setContentTitle("团队会议已取消：${payload.title}")
            .setContentText("已同步释放时间窗并取消本地提醒闹钟$reason")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(context).notify(payload.proposalId.hashCode(), notification)
    }

    @SuppressLint("MissingPermission")
    fun showScheduleReminder(
        itemId: String,
        title: String,
        timeLabel: String,
        categoryLabel: String,
    ) {
        if (!canPostNotifications()) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NAV_ROUTE, "calendar")
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            itemId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, NotificationChannels.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_shixu_notify)
            .setContentTitle("即将开始：$title")
            .setContentText("$categoryLabel · $timeLabel")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(context).notify(itemId.hashCode(), notification)
    }

    companion object {
        const val EXTRA_NAV_ROUTE = "shixu_nav_route"
        const val EXTRA_OPEN_RESCUE = "shixu_open_rescue"
        const val EXTRA_RESCUE_REASON = "shixu_rescue_reason"

        private const val REQ_OVERLOAD = 9001
        private const val NOTIF_ID_OVERLOAD = 9001
        private val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("MM-dd HH:mm")
    }
}
