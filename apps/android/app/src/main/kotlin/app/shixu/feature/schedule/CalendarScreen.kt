package app.shixu.feature.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Healing
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Shield
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.Flexibility
import app.shixu.core.network.generated.models.HourlyEnergyPoint
import app.shixu.core.network.generated.models.RescueTriggerReason
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.EmptyStateCard
import app.shixu.core.ui.components.LoadingSkeletonCard
import app.shixu.core.ui.components.OverloadAlertCard
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.LocalShixuSemanticColors
import app.shixu.core.ui.theme.TabularNumeralStyle
import java.time.ZoneId

@Composable
fun CalendarScreen(
    viewModel: ScheduleViewModel = activityHiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

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
                    Text("智能日程与救援", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        text = "本地时区 ${state.userZoneId.id}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(
                        selected = state.showEnergyOverlay,
                        onClick = viewModel::toggleEnergyOverlay,
                        label = { Text("精力叠层") },
                    )
                    IconButton(onClick = viewModel::refresh) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "刷新日程")
                    }
                }
            }
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { viewModel.shiftDay(-1L) }) {
                        Icon(Icons.Outlined.ChevronLeft, contentDescription = "前一天")
                    }
                    TextButton(onClick = { viewModel.selectDay(java.time.LocalDate.now(state.userZoneId)) }) {
                        Text(
                            text = state.selectedDay.toString(),
                            style = MaterialTheme.typography.titleMedium.merge(TabularNumeralStyle),
                        )
                    }
                    IconButton(onClick = { viewModel.shiftDay(1L) }) {
                        Icon(Icons.Outlined.ChevronRight, contentDescription = "后一天")
                    }
                }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = viewModel::openCreateEditor,
                    enabled = !state.isOfflineReadOnly,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text("新建日程", modifier = Modifier.padding(start = 6.dp))
                }
                OutlinedButton(
                    onClick = { viewModel.openRescueSheet(RescueTriggerReason.urgent_task) },
                    enabled = !state.isOfflineReadOnly,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Outlined.Healing, contentDescription = null)
                    Text("突发救援 / 撤销", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }

        if (state.isOfflineReadOnly) {
            item {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.CloudOff,
                    title = "离线只读模式",
                    message = "当前展示 Room 本地缓存的日程快照。恢复联网后可新建日程或应用三策略救援。",
                )
            }
        }

        state.feedbackMessage?.let { msg ->
            item {
                StateBanner(
                    tone = TagTone.positive,
                    icon = Icons.Outlined.CalendarToday,
                    title = "同步回执",
                    message = msg,
                    actionLabel = "关闭",
                    onAction = viewModel::clearFeedback,
                )
            }
        }

        state.energy?.overloadAlert?.let { alert ->
            item {
                OverloadAlertCard(
                    alert = alert,
                    onOpenRescue = { viewModel.openRescueSheet(alert.triggerReason) },
                )
            }
        }

        if (state.showEnergyOverlay && !state.energy?.hourlyCurve.isNullOrEmpty()) {
            item {
                HourlyEnergyHeatRibbon(
                    points = state.energy!!.hourlyCurve,
                    zoneId = state.userZoneId,
                )
            }
        }

        if (state.isLoading && state.dayItems.isEmpty()) {
            item { LoadingSkeletonCard(lines = 4) }
        } else if (state.dayItems.isEmpty()) {
            item {
                EmptyStateCard(
                    icon = Icons.Outlined.CalendarToday,
                    title = "${state.selectedDay} 暂无日程块",
                    description = "点击「新建日程」安排深度工作或恢复缓冲；如有突发插单可直接点击「突发救援」让服务端为您计算三套重排方案。",
                    actionLabel = if (!state.isOfflineReadOnly) "立即新建" else null,
                    onAction = if (!state.isOfflineReadOnly) viewModel::openCreateEditor else null,
                )
            }
        } else {
            items(state.dayItems, key = { it.id.toString() }) { item ->
                ScheduleItemCard(
                    item = item,
                    zoneId = state.userZoneId,
                    onClick = { viewModel.openEditEditor(item) },
                )
            }
        }

        item { Box(modifier = Modifier.height(16.dp)) }
    }

    state.editor?.let { editorState ->
        ScheduleEditorSheet(
            state = editorState,
            onUpdate = viewModel::updateEditor,
            onSave = viewModel::saveEditor,
            onDelete = viewModel::deleteEditingItem,
            onDismiss = viewModel::dismissEditor,
        )
    }

    if (state.rescue.isOpen) {
        RescueBottomSheet(
            state = state.rescue,
            selectedDay = state.selectedDay,
            zoneId = state.userZoneId,
            onDismiss = viewModel::closeRescueSheet,
            onSelectTab = viewModel::setRescueTab,
            onUpdateState = viewModel::updateRescueState,
            onPreview = viewModel::previewRescueOptions,
            onApply = viewModel::applySelectedRescueOption,
            onUndoSnapshot = viewModel::undoSnapshot,
        )
    }
}

@Composable
private fun HourlyEnergyHeatRibbon(
    points: List<HourlyEnergyPoint>,
    zoneId: ZoneId,
) {
    val semantic = LocalShixuSemanticColors.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("当日精力热区色带（${points.size} 个本地整点）", style = MaterialTheme.typography.labelLarge)
                Text("深绿峰值 · 蓝平稳 · 琥珀偏紧 · 红透支", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(22.dp)
                    .clip(RoundedCornerShape(6.dp)),
                horizontalArrangement = Arrangement.spacedBy(1.dp),
            ) {
                points.forEach { pt ->
                    val color = when (pt.tier) {
                        EnergyTier.peak -> semantic.peak
                        EnergyTier.steady -> semantic.steady
                        EnergyTier.strained -> semantic.strained
                        EnergyTier.depleted -> semantic.depleted
                    }
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .background(color),
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                val firstHour = points.firstOrNull()?.hourStartAt?.atZoneSameInstant(zoneId)?.hour ?: 0
                val midPoint = points.getOrNull(points.size / 2)
                val lastHour = points.lastOrNull()?.hourStartAt?.atZoneSameInstant(zoneId)?.hour ?: 23
                Text("%02d:00".format(firstHour), style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle))
                midPoint?.let {
                    Text(
                        text = "%02d:00 (${it.score})".format(it.hourStartAt.atZoneSameInstant(zoneId).hour),
                        style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                    )
                }
                Text("%02d:00".format(lastHour), style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle))
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduleItemCard(
    item: ScheduleItemDTO,
    zoneId: ZoneId,
    onClick: () -> Unit,
) {
    val semantic = LocalShixuSemanticColors.current
    val accent = when (item.flexibility) {
        Flexibility.hard_locked -> MaterialTheme.colorScheme.error
        Flexibility.focus_shield -> semantic.peak
        Flexibility.flexible -> MaterialTheme.colorScheme.secondary
    }
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
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
                Text(
                    text = ShixuFormatters.formatTimeRange(item.startAt, item.endAt, zoneId),
                    style = MaterialTheme.typography.labelLarge.merge(TabularNumeralStyle),
                    color = accent,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "${item.durationMinutes} min · ${ShixuFormatters.scheduleStatusLabel(item.status)}",
                    style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(item.title, style = MaterialTheme.typography.titleMedium)
            if (item.notes.isNotBlank()) {
                Text(
                    text = item.notes,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                TagPill(ShixuFormatters.categoryLabel(item.category))
                TagPill(ShixuFormatters.cognitiveLoadLabel(item.cognitiveLoad))
                TagPill(ShixuFormatters.flexibilityLabel(item.flexibility))
                if (item.reminderMinutes > 0L) {
                    TagPill("提前 ${item.reminderMinutes}m 闹钟")
                }
                if (item.meetingProposalId != null) {
                    TagPill("团队会议托管", icon = Icons.Outlined.Lock)
                } else if (item.flexibility == Flexibility.focus_shield) {
                    TagPill("心流保护", icon = Icons.Outlined.Shield)
                }
            }
        }
    }
}

@Composable
private fun TagPill(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(999.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            icon?.let {
                Icon(it, contentDescription = null, modifier = Modifier.padding(end = 1.dp))
            }
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}
