package app.shixu.feature.focus

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.core.network.WsConnectionState
import app.shixu.core.network.generated.models.ScheduleCategory
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleStatus
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.DataFreshnessChip
import app.shixu.core.ui.components.EmptyStateCard
import app.shixu.core.ui.components.EnergyTierBadge
import app.shixu.core.ui.components.OverloadAlertCard
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.LocalShixuSemanticColors
import app.shixu.core.ui.theme.TabularNumeralStyle

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FocusScreen(
    onOpenEnergy: () -> Unit,
    onOpenCalendar: () -> Unit,
    onOpenRescueFromOverload: () -> Unit,
    viewModel: FocusViewModel = activityHiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val energy = state.energy

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("今日专注与精力", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        text = energy?.localDay?.toString() ?: "基于本地时区动态同步",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = viewModel::refreshAll) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新今日专注状态")
                }
            }
        }

        if (state.isOfflineEnergy || state.isOfflineSchedule) {
            item {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.CloudOff,
                    title = "离线只读快照模式",
                    message = "当前网络不可用，展示最近一次同步的本地日程与精力快照，重排和状态修改需联网完成。",
                )
            }
        }

        state.feedbackMessage?.let { msg ->
            item {
                StateBanner(
                    tone = TagTone.neutral,
                    icon = Icons.Outlined.Timer,
                    title = "专注状态",
                    message = msg,
                    actionLabel = "关闭",
                    onAction = viewModel::clearFeedback,
                )
            }
        }

        energy?.overloadAlert?.let { alert ->
            item {
                OverloadAlertCard(
                    alert = alert,
                    onOpenRescue = onOpenRescueFromOverload,
                )
            }
        }

        item {
            val activeCount = state.todayItems.count { it.status != ScheduleStatus.completed }
            val deepCount = state.todayItems.count { it.category == ScheduleCategory.deep_work }
            val shieldCount = energy?.focusShields?.size ?: 0
            val wsLabel = when (state.wsState) {
                WsConnectionState.Connected -> "实时在线"
                WsConnectionState.Connecting -> "握手连接"
                is WsConnectionState.Reconnecting -> "重连中"
                WsConnectionState.Disconnected -> "未连接"
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FocusKpiCard(
                        title = "实时精力分",
                        value = energy?.score?.toString() ?: "--",
                        subtitle = energy?.tier?.let(ShixuFormatters::tierShortLabel) ?: "等待加载",
                        modifier = Modifier.weight(1f),
                    )
                    FocusKpiCard(
                        title = "今日待执行",
                        value = activeCount.toString(),
                        subtitle = "深度块 $deepCount 个",
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FocusKpiCard(
                        title = "专注保护盾",
                        value = shieldCount.toString(),
                        subtitle = "推荐黄金心流窗",
                        modifier = Modifier.weight(1f),
                    )
                    FocusKpiCard(
                        title = "协同通道",
                        value = wsLabel,
                        subtitle = "WebSocket 推流",
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        item {
            FocusTimerCard(
                timer = state.timer,
                energyScore = energy?.score,
                energyTier = energy?.tier,
                freshness = energy?.dataFreshness,
                isOffline = state.isOfflineEnergy,
                selectedTask = state.todayItems.firstOrNull { it.id == state.timer.selectedTaskId }
                    ?: state.todayItems.firstOrNull { it.status == ScheduleStatus.in_progress }
                    ?: state.todayItems.firstOrNull { it.status == ScheduleStatus.planned },
                onSelectMode = viewModel::selectMode,
                onSelectPreset = viewModel::selectPresetMinutes,
                onToggleStartPause = viewModel::toggleStartPause,
                onReset = viewModel::resetTimer,
                onOpenEnergy = onOpenEnergy,
            )
        }

        if (!energy?.focusShields.isNullOrEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(Icons.Outlined.Shield, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Text("今日深度专注保护盾", style = MaterialTheme.typography.titleMedium)
                        }
                        energy?.focusShields.orEmpty().forEach { shield ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    text = ShixuFormatters.formatTimeRange(shield.startAt, shield.endAt, state.userZoneId),
                                    style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                                )
                                Text(
                                    text = "均分 ${shield.avgScore}",
                                    style = MaterialTheme.typography.labelLarge.merge(TabularNumeralStyle),
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("今日待执行日程", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onOpenCalendar) {
                    Text("管理日程与救援")
                }
            }
        }

        if (state.todayItems.isEmpty()) {
            item {
                EmptyStateCard(
                    icon = Icons.Outlined.CalendarMonth,
                    title = "今日暂无日程安排",
                    description = "前往日历添加深度专注块或突发插单救援，服务端将自动结合你的穿戴生理曲线匹配黄金窗口。",
                    actionLabel = "前往日历",
                    onAction = onOpenCalendar,
                )
            }
        } else {
            items(state.todayItems, key = { it.id.toString() }) { item ->
                FocusScheduleRow(
                    item = item,
                    selected = item.id == state.timer.selectedTaskId,
                    isMutating = state.isMutatingTask,
                    zoneId = state.userZoneId,
                    onSelect = { viewModel.selectTask(item.id) },
                    onStart = { viewModel.updateTaskStatus(item, ScheduleStatus.in_progress) },
                    onComplete = { viewModel.updateTaskStatus(item, ScheduleStatus.completed) },
                )
            }
        }

        item { Box(modifier = Modifier.padding(bottom = 16.dp)) }
    }
}

@Composable
private fun FocusKpiCard(
    title: String,
    value: String,
    subtitle: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.headlineSmall.merge(TabularNumeralStyle))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FocusTimerCard(
    timer: FocusTimerState,
    energyScore: Long?,
    energyTier: app.shixu.core.network.generated.models.EnergyTier?,
    freshness: app.shixu.core.network.generated.models.DataFreshness?,
    isOffline: Boolean,
    selectedTask: ScheduleItemDTO?,
    onSelectMode: (FocusTimerMode) -> Unit,
    onSelectPreset: (Int) -> Unit,
    onToggleStartPause: () -> Unit,
    onReset: () -> Unit,
    onOpenEnergy: () -> Unit,
) {
    val semantic = LocalShixuSemanticColors.current
    val ringColor = MaterialTheme.colorScheme.primary
    val trackColor = MaterialTheme.colorScheme.surfaceContainerHigh

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                energyTier?.let { EnergyTierBadge(it) } ?: Text(
                    text = "精力评估加载中",
                    style = MaterialTheme.typography.labelMedium,
                )
                DataFreshnessChip(
                    freshness = freshness,
                    isOffline = isOffline,
                    compact = true,
                    onClick = onOpenEnergy,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = timer.mode == FocusTimerMode.POMODORO,
                    onClick = { onSelectMode(FocusTimerMode.POMODORO) },
                    label = { Text("番茄倒计时") },
                )
                FilterChip(
                    selected = timer.mode == FocusTimerMode.FLOW,
                    onClick = { onSelectMode(FocusTimerMode.FLOW) },
                    label = { Text("正向心流计时") },
                )
            }

            if (timer.mode == FocusTimerMode.POMODORO) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(25, 45, 60, 90).forEach { mins ->
                        FilterChip(
                            selected = timer.presetMinutes == mins,
                            onClick = { onSelectPreset(mins) },
                            label = { Text("${mins}m") },
                        )
                    }
                }
            }

            Box(
                modifier = Modifier.size(180.dp),
                contentAlignment = Alignment.Center,
            ) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val stroke = Stroke(width = 12.dp.toPx(), cap = StrokeCap.Round)
                    drawArc(
                        color = trackColor,
                        startAngle = -90f,
                        sweepAngle = 360f,
                        useCenter = false,
                        style = stroke,
                    )
                    drawArc(
                        color = ringColor,
                        startAngle = -90f,
                        sweepAngle = (360f * timer.progress).coerceIn(0f, 360f),
                        useCenter = false,
                        style = stroke,
                    )
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    val mins = timer.displaySeconds / 60L
                    val secs = timer.displaySeconds % 60L
                    Text(
                        text = "%02d:%02d".format(mins, secs),
                        style = MaterialTheme.typography.displayLarge.merge(TabularNumeralStyle),
                    )
                    Text(
                        text = selectedTask?.title ?: "自由深度专注",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (energyScore != null && energyScore < 40L) {
                Surface(
                    color = semantic.warningContainer,
                    contentColor = semantic.warning,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        text = "当前精力分 $energyScore 偏低，建议先插入 15–20 分钟恢复缓冲或降低任务认知负荷。",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Button(
                    onClick = onToggleStartPause,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(
                        imageVector = if (timer.isRunning) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                        contentDescription = null,
                    )
                    Text(
                        text = if (timer.isRunning) "暂停专注" else "开始专注",
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
                OutlinedButton(onClick = onReset) {
                    Icon(Icons.Outlined.RestartAlt, contentDescription = "重置计时器")
                    Text("重置", modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun FocusScheduleRow(
    item: ScheduleItemDTO,
    selected: Boolean,
    isMutating: Boolean,
    zoneId: java.time.ZoneId,
    onSelect: () -> Unit,
    onStart: () -> Unit,
    onComplete: () -> Unit,
) {
    Card(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.25f)
            } else {
                MaterialTheme.colorScheme.surfaceContainerLowest
            },
        ),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(item.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Text(
                    text = ShixuFormatters.scheduleStatusLabel(item.status),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Text(
                text = "${ShixuFormatters.formatTimeRange(item.startAt, item.endAt, zoneId)} · ${ShixuFormatters.categoryLabel(item.category)} · ${ShixuFormatters.cognitiveLoadLabel(item.cognitiveLoad)}",
                style = MaterialTheme.typography.bodySmall.merge(TabularNumeralStyle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (item.status != ScheduleStatus.completed) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (item.status == ScheduleStatus.planned) {
                        TextButton(onClick = onStart, enabled = !isMutating) {
                            Text("标为进行中")
                        }
                    }
                    OutlinedButton(onClick = onComplete, enabled = !isMutating) {
                        Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("完成", modifier = Modifier.padding(start = 4.dp))
                    }
                }
            }
        }
    }
}
