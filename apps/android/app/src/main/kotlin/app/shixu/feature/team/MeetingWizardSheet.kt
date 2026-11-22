package app.shixu.feature.team

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.GoldenWindowRecommendation
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.network.generated.models.WorkspaceMemberDTO
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.LocalShixuSemanticColors
import app.shixu.core.ui.theme.TabularNumeralStyle
import java.time.ZoneId
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MeetingWizardSheet(
    state: MeetingWizardState,
    members: List<WorkspaceMemberDTO>,
    zoneId: ZoneId,
    onDismiss: () -> Unit,
    onUpdateWizard: ((MeetingWizardState) -> MeetingWizardState) -> Unit,
    onToggleRequired: (UUID) -> Unit,
    onToggleOptional: (UUID) -> Unit,
    onRecommend: () -> Unit,
    onConfirm: () -> Unit,
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
            Text("轻量协同排会向导", style = MaterialTheme.typography.titleLarge)

            OutlinedTextField(
                value = state.title,
                onValueChange = { txt -> onUpdateWizard { it.copy(title = txt, errorMessage = null) } },
                label = { Text("会议主题") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Text("认知强度与时长", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CognitiveLoad.entries.forEach { load ->
                    FilterChip(
                        selected = state.cognitiveLoad == load,
                        onClick = { onUpdateWizard { it.copy(cognitiveLoad = load) } },
                        label = { Text(ShixuFormatters.cognitiveLoadLabel(load)) },
                    )
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(30, 45, 60, 90).forEach { mins ->
                    FilterChip(
                        selected = state.durationMinutes == mins,
                        onClick = { onUpdateWizard { it.copy(durationMinutes = mins) } },
                        label = { Text("${mins}m") },
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("优先避开成员深度专注保护盾", style = MaterialTheme.typography.bodyMedium)
                Switch(
                    checked = state.respectFocusShields,
                    onCheckedChange = { checked -> onUpdateWizard { it.copy(respectFocusShields = checked) } },
                )
            }

            Text("必选参会人（不可冲突）", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                members.forEach { m ->
                    FilterChip(
                        selected = m.userId in state.requiredIds,
                        onClick = { onToggleRequired(m.userId) },
                        label = { Text(m.displayName) },
                    )
                }
            }

            Text("可选参会人（计入参与度权重）", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                members.forEach { m ->
                    FilterChip(
                        selected = m.userId in state.optionalIds,
                        onClick = { onToggleOptional(m.userId) },
                        label = { Text(m.displayName) },
                    )
                }
            }

            state.errorMessage?.let { err ->
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "排会提示",
                    message = err,
                )
            }

            Button(
                onClick = onRecommend,
                enabled = !state.isRecommending,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.isRecommending) "黄金窗口求解中..." else "求解 Top 3 黄金协作窗口")
            }

            if (state.diagnostics.isNotEmpty()) {
                state.diagnostics.forEach { diag ->
                    StateBanner(
                        tone = TagTone.warning,
                        icon = Icons.Outlined.WarningAmber,
                        title = "无解阻断诊断 · ${diag.code}",
                        message = "${diag.message}\n建议：${diag.suggestedAction}",
                    )
                }
            }

            if (state.recommendations.isNotEmpty()) {
                state.recommendations.forEach { rec ->
                    GoldenWindowCard(
                        recommendation = rec,
                        selected = rec.rank == state.selectedRank,
                        zoneId = zoneId,
                        onSelect = { onUpdateWizard { it.copy(selectedRank = rec.rank) } },
                    )
                }

                Button(
                    onClick = onConfirm,
                    enabled = !state.isConfirming,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.isConfirming) "加锁确认落库中..." else "确认锁定并下发全员日程")
                }
            }

            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) {
                Text("关闭")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GoldenWindowCard(
    recommendation: GoldenWindowRecommendation,
    selected: Boolean,
    zoneId: ZoneId,
    onSelect: () -> Unit,
) {
    val semantic = LocalShixuSemanticColors.current
    Card(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.22f)
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
                    text = "Top ${recommendation.rank} · ${ShixuFormatters.formatDateTime(recommendation.startAt, zoneId)}",
                    style = MaterialTheme.typography.titleMedium.merge(TabularNumeralStyle),
                )
                Text(
                    text = "综合分 ${recommendation.score}",
                    style = MaterialTheme.typography.labelLarge.merge(TabularNumeralStyle),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            Text(
                text = ShixuFormatters.formatTimeRange(recommendation.startAt, recommendation.endAt, zoneId),
                style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                color = MaterialTheme.colorScheme.secondary,
            )
            Text(recommendation.summary, style = MaterialTheme.typography.bodySmall)

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                recommendation.explanationTags.forEach { tag ->
                    val (bg, fg) = when (tag.tone) {
                        TagTone.positive -> semantic.positiveContainer to semantic.positive
                        TagTone.warning -> semantic.warningContainer to semantic.warning
                        TagTone.neutral -> semantic.neutralContainer to semantic.neutral
                    }
                    Surface(color = bg, contentColor = fg, shape = RoundedCornerShape(999.dp)) {
                        Text(
                            text = tag.label,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
            }

            Text(
                text = "分项：精力契合 ${recommendation.breakdown.energyMatchScore} · 保护盾 ${recommendation.breakdown.focusShieldScore} · 紧凑度 ${recommendation.breakdown.compactnessScore}",
                style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
