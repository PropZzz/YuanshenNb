package app.shixu.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryAlert
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.Watch
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.Chronotype
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.DataFreshness
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.Flexibility
import app.shixu.core.network.generated.models.OverloadAlert
import app.shixu.core.network.generated.models.PrivacyLevel
import app.shixu.core.network.generated.models.RescueStrategy
import app.shixu.core.network.generated.models.ScheduleCategory
import app.shixu.core.network.generated.models.ScheduleStatus
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.theme.LocalShixuSemanticColors
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class FreshnessBadgeSpec(
    val label: String,
    val shortLabel: String,
    val icon: ImageVector,
    val containerColor: Color,
    val contentColor: Color,
)

@Composable
fun rememberFreshnessBadgeSpec(
    freshness: DataFreshness?,
    isOffline: Boolean = false,
): FreshnessBadgeSpec {
    val semantic = LocalShixuSemanticColors.current
    val base = when (freshness) {
        DataFreshness.live_wearable -> FreshnessBadgeSpec(
            label = "穿戴实时同步中",
            shortLabel = "穿戴实时",
            icon = Icons.Outlined.Watch,
            containerColor = semantic.positiveContainer,
            contentColor = semantic.positive,
        )

        DataFreshness.recent_wearable -> FreshnessBadgeSpec(
            label = "今日穿戴基线已加载",
            shortLabel = "最近同步",
            icon = Icons.Outlined.Watch,
            containerColor = semantic.steadyContainer,
            contentColor = semantic.steady,
        )

        DataFreshness.replay_demo -> FreshnessBadgeSpec(
            label = "回放测试源（仅供演示）",
            shortLabel = "回放测试源",
            icon = Icons.Outlined.Science,
            containerColor = semantic.warningContainer,
            contentColor = semantic.warning,
        )

        DataFreshness.baseline_only, null -> FreshnessBadgeSpec(
            label = "未连接穿戴，当前为节律基线估算",
            shortLabel = "节律基线估算",
            icon = Icons.Outlined.Timeline,
            containerColor = semantic.neutralContainer,
            contentColor = semantic.neutral,
        )
    }
    return if (isOffline) {
        base.copy(
            label = "${base.label} · 离线缓存",
            shortLabel = "${base.shortLabel} · 离线",
        )
    } else {
        base
    }
}

@Composable
fun DataFreshnessChip(
    freshness: DataFreshness?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    isOffline: Boolean = false,
    compact: Boolean = false,
) {
    val spec = rememberFreshnessBadgeSpec(freshness = freshness, isOffline = isOffline)
    AssistChip(
        onClick = onClick,
        modifier = modifier,
        leadingIcon = {
            Icon(
                imageVector = spec.icon,
                contentDescription = spec.label,
                tint = spec.contentColor,
                modifier = Modifier.size(16.dp),
            )
        },
        label = {
            Text(
                text = if (compact) spec.shortLabel else spec.label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = spec.contentColor,
            )
        },
        colors = AssistChipDefaults.assistChipColors(
            containerColor = spec.containerColor,
            labelColor = spec.contentColor,
        ),
        border = BorderStroke(1.dp, spec.contentColor.copy(alpha = 0.25f)),
    )
}

@Composable
fun EnergyTierBadge(
    tier: EnergyTier,
    modifier: Modifier = Modifier,
) {
    val semantic = LocalShixuSemanticColors.current
    val (label, icon, bg, fg) = when (tier) {
        EnergyTier.peak -> Quad("峰值专注 · Peak", Icons.Outlined.BatteryChargingFull, semantic.peakContainer, semantic.peak)
        EnergyTier.steady -> Quad("平稳协作 · Steady", Icons.Outlined.CheckCircleOutline, semantic.steadyContainer, semantic.steady)
        EnergyTier.strained -> Quad("精力偏紧 · Strained", Icons.Outlined.WarningAmber, semantic.strainedContainer, semantic.strained)
        EnergyTier.depleted -> Quad("能量告急 · Depleted", Icons.Outlined.BatteryAlert, semantic.depletedContainer, semantic.depleted)
    }
    Surface(
        modifier = modifier,
        color = bg,
        contentColor = fg,
        shape = RoundedCornerShape(999.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(14.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun StateBanner(
    tone: TagTone,
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val semantic = LocalShixuSemanticColors.current
    val (bg, fg) = when (tone) {
        TagTone.positive -> semantic.positiveContainer to semantic.positive
        TagTone.warning -> semantic.warningContainer to semantic.warning
        TagTone.neutral -> semantic.neutralContainer to semantic.neutral
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = bg,
        contentColor = fg,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, fg.copy(alpha = 0.25f)),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = title, modifier = Modifier.size(20.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                Text(message, style = MaterialTheme.typography.bodySmall)
            }
            if (actionLabel != null && onAction != null) {
                TextButton(onClick = onAction) {
                    Text(actionLabel, color = fg, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
fun OverloadAlertCard(
    alert: OverloadAlert,
    onOpenRescue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
        ),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.BatteryAlert, contentDescription = "精力过载预警")
                Text(
                    text = "精力保护建议 · 推荐 ${rescueStrategyLabel(alert.recommendedStrategy)}",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Text(alert.message, style = MaterialTheme.typography.bodyMedium)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                Button(
                    onClick = onOpenRescue,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) {
                    Text("预览 3 套救援方案")
                }
            }
        }
    }
}

@Composable
fun EmptyStateCard(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = title,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp),
            )
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (actionLabel != null && onAction != null) {
                OutlinedButton(onClick = onAction) {
                    Text(actionLabel)
                }
            }
        }
    }
}

@Composable
fun LoadingSkeletonCard(
    modifier: Modifier = Modifier,
    lines: Int = 3,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            repeat(lines) { idx ->
                val widthFraction = if (idx == lines - 1) 0.55f else 0.9f
                Box(
                    modifier = Modifier
                        .fillMaxWidth(widthFraction)
                        .height(14.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                )
            }
        }
    }
}

object ShixuFormatters {
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)
    private val dateTimeFormatter = DateTimeFormatter.ofPattern("MM-dd HH:mm", Locale.ROOT)

    fun formatTimeRange(
        startAt: OffsetDateTime,
        endAt: OffsetDateTime,
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): String {
        val s = timeFormatter.format(startAt.atZoneSameInstant(zoneId))
        val e = timeFormatter.format(endAt.atZoneSameInstant(zoneId))
        return "$s - $e"
    }

    fun formatDateTime(
        at: OffsetDateTime,
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): String = dateTimeFormatter.format(at.atZoneSameInstant(zoneId))

    fun formatMinuteOfDay(minute: Long): String {
        val clamped = minute.coerceIn(0L, 1440L)
        return "%02d:%02d".format(clamped / 60L, clamped % 60L)
    }

    fun categoryLabel(category: ScheduleCategory): String = when (category) {
        ScheduleCategory.deep_work -> "深度专注"
        ScheduleCategory.meeting -> "协同会议"
        ScheduleCategory.recovery -> "恢复缓冲"
        ScheduleCategory.routine -> "常规事务"
        ScheduleCategory.urgent -> "紧急任务"
    }

    fun cognitiveLoadLabel(load: CognitiveLoad): String = when (load) {
        CognitiveLoad.high -> "高认知负荷"
        CognitiveLoad.medium -> "中认知负荷"
        CognitiveLoad.low -> "低认知负荷"
    }

    fun flexibilityLabel(flexibility: Flexibility): String = when (flexibility) {
        Flexibility.hard_locked -> "硬锁定"
        Flexibility.flexible -> "弹性可调"
        Flexibility.focus_shield -> "专注保护盾"
    }

    fun scheduleStatusLabel(status: ScheduleStatus): String = when (status) {
        ScheduleStatus.planned -> "待开始"
        ScheduleStatus.in_progress -> "进行中"
        ScheduleStatus.completed -> "已完成"
        ScheduleStatus.cancelled -> "已取消"
    }

    fun rescueStrategyLabel(strategy: RescueStrategy): String = when (strategy) {
        RescueStrategy.protect_deadline -> "保住截止期"
        RescueStrategy.protect_recovery -> "保留恢复精力"
        RescueStrategy.minimize_changes -> "最少改动原计划"
    }

    fun privacyLevelLabel(privacy: PrivacyLevel): String = when (privacy) {
        PrivacyLevel.busy_only -> "仅忙闲 (busy_only)"
        PrivacyLevel.energy_tier -> "精力档位 (energy_tier)"
        PrivacyLevel.full_title -> "完整日程标题 (full_title)"
    }

    fun chronotypeLabel(chronotype: Chronotype): String = when (chronotype) {
        Chronotype.morning_lark -> "晨型人 (上午高峰)"
        Chronotype.balanced -> "均衡型 (双峰节律)"
        Chronotype.night_owl -> "夜型人 (午后晚峰)"
    }

    fun tierShortLabel(tier: EnergyTier): String = when (tier) {
        EnergyTier.peak -> "峰值"
        EnergyTier.steady -> "平稳"
        EnergyTier.strained -> "偏紧"
        EnergyTier.depleted -> "透支"
    }
}

private data class Quad<A, B, C, D>(
    val first: A,
    val second: B,
    val third: C,
    val fourth: D,
)

private fun rescueStrategyLabel(strategy: RescueStrategy): String = ShixuFormatters.rescueStrategyLabel(strategy)
