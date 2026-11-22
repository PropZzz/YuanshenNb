package app.shixu.core.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ScheduleReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val itemId = intent.getStringExtra(EXTRA_ITEM_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "日程即将开始"
        val timeLabel = intent.getStringExtra(EXTRA_TIME_LABEL).orEmpty()
        val categoryLabel = intent.getStringExtra(EXTRA_CATEGORY_LABEL) ?: "日程提醒"

        ShixuNotificationHelper(context.applicationContext)
            .showScheduleReminder(
                itemId = itemId,
                title = title,
                timeLabel = timeLabel,
                categoryLabel = categoryLabel,
            )
    }

    companion object {
        const val EXTRA_ITEM_ID = "item_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TIME_LABEL = "time_label"
        const val EXTRA_CATEGORY_LABEL = "category_label"
    }
}
