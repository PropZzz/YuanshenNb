package app.shixu.feature.schedule

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
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.Flexibility
import app.shixu.core.network.generated.models.ScheduleCategory
import app.shixu.core.network.generated.models.ScheduleStatus
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.TabularNumeralStyle

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ScheduleEditorSheet(
    state: ScheduleEditorState,
    onUpdate: ((ScheduleEditorState) -> ScheduleEditorState) -> Unit,
    onSave: (Boolean) -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val isTeamManaged = state.isTeamManagedMeeting

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
                text = when {
                    state.editingItem == null -> "新建日程时间块"
                    isTeamManaged -> "团队协同会议详情"
                    else -> "编辑个人日程"
                },
                style = MaterialTheme.typography.titleLarge,
            )

            if (isTeamManaged) {
                StateBanner(
                    tone = TagTone.neutral,
                    icon = Icons.Outlined.Lock,
                    title = "由团队会议提案托管",
                    message = "仅可修改个人备注、提前提醒分钟数或标为已完成；改期或拒绝请前往「团队」页处理。",
                )
            }

            OutlinedTextField(
                value = state.title,
                onValueChange = { txt -> onUpdate { it.copy(title = txt, errorMessage = null) } },
                label = { Text("日程标题") },
                enabled = !isTeamManaged,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = state.notes,
                onValueChange = { txt -> onUpdate { it.copy(notes = txt) } },
                label = { Text("备注说明") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )

            if (!isTeamManaged) {
                Text("类别", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ScheduleCategory.entries.forEach { cat ->
                        FilterChip(
                            selected = state.category == cat,
                            onClick = { onUpdate { it.copy(category = cat) } },
                            label = { Text(ShixuFormatters.categoryLabel(cat)) },
                        )
                    }
                }

                Text("认知负荷", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CognitiveLoad.entries.forEach { load ->
                        FilterChip(
                            selected = state.cognitiveLoad == load,
                            onClick = { onUpdate { it.copy(cognitiveLoad = load) } },
                            label = { Text(ShixuFormatters.cognitiveLoadLabel(load)) },
                        )
                    }
                }

                Text("弹性约束", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Flexibility.entries.forEach { flex ->
                        FilterChip(
                            selected = state.flexibility == flex,
                            onClick = { onUpdate { it.copy(flexibility = flex) } },
                            label = { Text(ShixuFormatters.flexibilityLabel(flex)) },
                        )
                    }
                }

                Text("开始时间与持续时长", style = MaterialTheme.typography.labelLarge)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "开始：${ShixuFormatters.formatMinuteOfDay(state.startMinuteOfDay.toLong())}",
                        style = MaterialTheme.typography.titleMedium.merge(TabularNumeralStyle),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedButton(
                            onClick = {
                                onUpdate {
                                    it.copy(startMinuteOfDay = (it.startMinuteOfDay - 30).coerceAtLeast(0))
                                }
                            },
                        ) { Text("-30m") }
                        OutlinedButton(
                            onClick = {
                                onUpdate {
                                    it.copy(startMinuteOfDay = (it.startMinuteOfDay + 30).coerceAtMost(23 * 60 + 30))
                                }
                            },
                        ) { Text("+30m") }
                    }
                }

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(30, 45, 60, 90, 120).forEach { mins ->
                        FilterChip(
                            selected = state.durationMinutes == mins,
                            onClick = { onUpdate { it.copy(durationMinutes = mins) } },
                            label = { Text("${mins} 分钟") },
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("设置硬截止时间 (Deadline)", style = MaterialTheme.typography.bodyMedium)
                    Switch(
                        checked = state.hasDeadline,
                        onCheckedChange = { checked -> onUpdate { it.copy(hasDeadline = checked) } },
                    )
                }

                if (state.hasDeadline) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "截止：${ShixuFormatters.formatMinuteOfDay(state.deadlineMinuteOfDay.toLong())}",
                            style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(
                                onClick = {
                                    onUpdate {
                                        it.copy(deadlineMinuteOfDay = (it.deadlineMinuteOfDay - 60).coerceAtLeast(60))
                                    }
                                },
                            ) { Text("-1h") }
                            OutlinedButton(
                                onClick = {
                                    onUpdate {
                                        it.copy(deadlineMinuteOfDay = (it.deadlineMinuteOfDay + 60).coerceAtMost(23 * 60 + 55))
                                    }
                                },
                            ) { Text("+1h") }
                        }
                    }
                }
            }

            if (state.editingItem != null) {
                Text("执行状态", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val allowed = if (isTeamManaged) {
                        listOf(state.editingItem.status, ScheduleStatus.completed).distinct()
                    } else {
                        listOf(ScheduleStatus.planned, ScheduleStatus.in_progress, ScheduleStatus.completed)
                    }
                    allowed.forEach { st ->
                        FilterChip(
                            selected = state.status == st,
                            onClick = { onUpdate { it.copy(status = st) } },
                            label = { Text(ShixuFormatters.scheduleStatusLabel(st)) },
                        )
                    }
                }
            }

            Text("本地闹钟提前提醒", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0, 5, 10, 15, 30).forEach { rem ->
                    FilterChip(
                        selected = state.reminderMinutes == rem,
                        onClick = { onUpdate { it.copy(reminderMinutes = rem) } },
                        label = { Text(if (rem == 0) "不提醒" else "提前 ${rem}m") },
                    )
                }
            }

            state.overlapConflictDetail?.let { conflict ->
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "检测到硬锁定或团队会议重叠",
                    message = conflict,
                    actionLabel = "仍强制重叠保存",
                    onAction = { onSave(true) },
                )
            }

            state.errorMessage?.let { err ->
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "保存失败",
                    message = err,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.editingItem != null && !isTeamManaged) {
                    OutlinedButton(
                        onClick = onDelete,
                        enabled = !state.isSaving,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) {
                        Icon(Icons.Outlined.DeleteOutline, contentDescription = null)
                        Text("取消日程", modifier = Modifier.padding(start = 4.dp))
                    }
                }
                Button(
                    onClick = { onSave(false) },
                    enabled = !state.isSaving,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (state.isSaving) "保存中..." else "保存并同步")
                }
            }

            TextButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.End),
            ) {
                Text("关闭")
            }
        }
    }
}
