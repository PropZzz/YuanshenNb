package app.shixu.core.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 断网或弱网时暂存的生理样本队列，依托 (sourceType, metricType, externalId) 唯一约束实现本地及服务端双端幂等去重。
 */
@Entity(
    tableName = "pending_biometrics",
    indices = [
        Index(value = ["sourceType", "metricType", "externalId"], unique = true),
    ],
)
data class PendingBiometricEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0L,
    val sourceType: String,
    val metricType: String,
    val recordedAtIso: String,
    val endAtIso: String? = null,
    val numericValue: Double,
    val unit: String,
    val sleepStage: String? = null,
    val externalId: String,
    val metadataJson: String? = null,
    val createdAtEpochMs: Long,
    val retryCount: Int = 0,
)
