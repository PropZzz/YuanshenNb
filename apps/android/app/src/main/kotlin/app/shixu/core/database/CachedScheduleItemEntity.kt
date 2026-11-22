package app.shixu.core.database

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 个人日程只读离线快照，供断网浏览及本地 AlarmManager 提醒闹钟对账使用。
 */
@Entity(tableName = "cached_schedule_items")
data class CachedScheduleItemEntity(
    @PrimaryKey
    val id: String,
    val userId: String,
    val workspaceId: String?,
    val meetingProposalId: String?,
    val title: String,
    val notes: String,
    val category: String,
    val cognitiveLoad: String,
    val flexibility: String,
    val status: String,
    val startAtIso: String,
    val endAtIso: String,
    val durationMinutes: Long,
    val deadlineAtIso: String?,
    val reminderMinutes: Long,
    val createdAtIso: String,
    val updatedAtIso: String,
    val cachedAtEpochMs: Long,
)
