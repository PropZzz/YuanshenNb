package app.shixu.feature.schedule

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.DiffOp
import app.shixu.core.network.generated.models.RescueOptionPlan
import app.shixu.core.network.generated.models.RescueSnapshotStatus
import app.shixu.core.network.generated.models.RescueTriggerReason
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.TabularNumeralStyle
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun RescueBottomSheet(
    state: RescueSheetState,
    selectedDay: LocalDate,
    zoneId: ZoneId,
    onDismiss: () -> Unit,
    onSelectTab: (Boolean) -> Unit,
    onUpdateState: ((RescueSheetState) -> RescueSheetState) -> Unit,
    onPreview: () -> Unit,
    onApply: () -> Unit,
    onUndoSnapshot: (UUID) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "三策略日程救援控制台 · $selectedDay",
                style = MaterialTheme.typography.titleLarge,
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = !state.showHistoryTab,
                    onClick = { onSelectTab(false) },
                    label = { Text("三策略预演与确认") },
                )
                FilterChip(
                    selected = state.showHistoryTab,
                    onClick = { onSelectTab(true) },
                    leadingIcon = { Icon(Icons.Outlined.History, contentDescription = null) },
                    label = { Text("救援快照撤销 (${state.historySnapshots.size})") },
                )
            }

            state.errorMessage?.let { err ->
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "操作提示",
                    message = err,
                )
            }

            state.successMessage?.let { ok ->
                StateBanner(
                    tone = TagTone.positive,
                    icon = Icons.Outlined.CheckCircleOutline,
                    title = "事务已提交",
                    message = ok,
                )
            }

            if (!state.showHistoryTab) {
                Text("触发动因", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RescueTriggerReason.entries.forEach { reason ->
                        val label = when (reason) {
                            RescueTriggerReason.urgent_task -> "突发紧急插单"
                            RescueTriggerReason.wearable_fatigue -> "穿戴疲劳过载"
                            RescueTriggerReason.team_meeting_overload -> "会议连续过载"
                        }
                        FilterChip(
                            selected = state.triggerReason == reason,
                            onClick = { onUpdateState { it.copy(triggerReason = reason, errorMessage = null) } },
                            label = { Text(label) },
                        )
                    }
                }

                if (state.triggerReason == RescueTriggerReason.urgent_task) {
                    OutlinedTextField(
                        value = state.urgentTitle,
                        onValueChange = { txt -> onUpdateState { it.copy(urgentTitle = txt, errorMessage = null) } },
                        label = { Text("紧急任务标题") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(30, 60, 90, 120).forEach { mins ->
                            FilterChip(
                                selected = state.urgentDurationMinutes == mins,
                                onClick = { onUpdateState { it.copy(urgentDurationMinutes = mins) } },
                                label = { Text("${mins} 分钟") },
                            )
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CognitiveLoad.entries.forEach { load ->
                            FilterChip(
                                selected = state.urgentCognitiveLoad == load,
                                onClick = { onUpdateState { it.copy(urgentCognitiveLoad = load) } },
                                label = { Text(ShixuFormatters.cognitiveLoadLabel(load)) },
                            )
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val dayLabel = if (state.urgentDeadlineDayOffset == 0) "当日" else "+${state.urgentDeadlineDayOffset}天"
                        Text(
                            text = "截止：$dayLabel ${ShixuFormatters.formatMinuteOfDay(state.urgentDeadlineMinuteOfDay.toLong())}",
                            style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(
                                onClick = {
                                    onUpdateState {
                                        it.copy(urgentDeadlineDayOffset = (it.urgentDeadlineDayOffset + 1) % 2)
                                    }
                                },
                            ) { Text("切换次日") }
                            OutlinedButton(
                                onClick = {
                                    onUpdateState {
                                        it.copy(urgentDeadlineMinuteOfDay = (it.urgentDeadlineMinuteOfDay + 60).coerceAtMost(23 * 60 + 55))
                                    }
                                },
                            ) { Text("+1h") }
                        }
                    }
                }

                Button(
                    onClick = onPreview,
                    enabled = !state.isPreviewLoading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.isPreviewLoading) "服务端确定性求解中..." else "预览 3 套救援方案")
                }

                if (state.options.isNotEmpty()) {
                    Text(
                        text = "硬锁定日程与团队会议绝不篡改；请对比指标后显式确认应用：",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    state.options.forEach { plan ->
                        RescuePlanCard(
                            plan = plan,
                            selected = plan.strategy == state.selectedStrategy,
                            zoneId = zoneId,
                            onSelect = { onUpdateState { it.copy(selectedStrategy = plan.strategy) } },
                        )
                    }

                    Button(
                        onClick = onApply,
                        enabled = !state.isApplying,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            if (state.isApplying) {
                                "事务校验落库中..."
                            } else {
                                "确认采纳「${ShixuFormatters.rescueStrategyLabel(state.selectedStrategy)}」"
                            },
                        )
                    }
                }
            } else {
                if (state.historyLoading && state.historySnapshots.isEmpty()) {
                    Text("加载救援快照历史...", style = MaterialTheme.typography.bodyMedium)
                } else if (state.historySnapshots.isEmpty()) {
                    Text(
                        text = "暂无救援快照记录。采纳任意救援方案后，可在此一键原子回滚。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    state.historySnapshots.forEach { snap ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
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
                                        text = "${ShixuFormatters.rescueStrategyLabel(snap.strategy)} · ${snap.localDay}",
                                        style = MaterialTheme.typography.titleSmall,
                                    )
                                    Text(
                                        text = if (snap.status == RescueSnapshotStatus.applied) "已生效" else "已撤销",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = if (snap.status == RescueSnapshotStatus.applied) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                    )
                                }
                                Text(
                                    text = "应用时间 ${ShixuFormatters.formatDateTime(snap.appliedAt, zoneId)} · 变动前后 ${snap.beforeItems.size} → ${snap.afterItems.size} 项",
                                    style = MaterialTheme.typography.bodySmall.merge(TabularNumeralStyle),
                                )
                                if (snap.status == RescueSnapshotStatus.applied) {
                                    OutlinedButton(
                                        onClick = { onUndoSnapshot(snap.id) },
                                        enabled = state.undoingSnapshotId != snap.id,
                                    ) {
                                        Icon(Icons.AutoMirrored.Outlined.Undo, contentDescription = null)
                                        Text(
                                            text = if (state.undoingSnapshotId == snap.id) "校验冲突并还原中..." else "原子撤销还原",
                                            modifier = Modifier.padding(start = 6.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) {
                Text("关闭")
            }
        }
    }
}

@Composable
private fun RescuePlanCard(
    plan: RescueOptionPlan,
    selected: Boolean,
    zoneId: ZoneId,
    onSelect: () -> Unit,
) {
    Card(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.2f)
            } else {
                MaterialTheme.colorScheme.surfaceContainerLow
            },
        ),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = ShixuFormatters.rescueStrategyLabel(plan.strategy),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = if (plan.feasible) "满足硬约束" else "存在逾期风险",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (plan.feasible) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                )
            }
            Text(plan.summary, style = MaterialTheme.typography.bodySmall)
            Text(
                text = "平移 ${plan.movedCount} · 顺延次日 ${plan.deferredCount} · 恢复缓冲 ${plan.recoveryMinutes}m · 逾期风险 ${plan.overdueRiskCount}",
                style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            HorizontalDivider()
            plan.diffItems.filter { it.op != DiffOp.unchanged }.forEach { diff ->
                val opLabel = when (diff.op) {
                    DiffOp.create -> "新增"
                    DiffOp.move -> "平移"
                    DiffOp.defer -> "顺延"
                    DiffOp.unchanged -> "不变"
                }
                val afterRange = ShixuFormatters.formatTimeRange(diff.afterStartAt, diff.afterEndAt, zoneId)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = "[$opLabel] ${diff.title} → $afterRange",
                        style = MaterialTheme.typography.bodySmall.merge(TabularNumeralStyle),
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = diff.reasonLabel,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
