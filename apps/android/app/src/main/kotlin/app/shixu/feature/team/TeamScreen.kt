package app.shixu.feature.team

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
import androidx.compose.material.icons.automirrored.outlined.ScheduleSend
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.GroupAdd
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.core.network.generated.models.AvailabilitySlotKind
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.MeetingDecisionStatus
import app.shixu.core.network.generated.models.MeetingProposalDTO
import app.shixu.core.network.generated.models.MeetingProposalStatus
import app.shixu.core.network.generated.models.MeetingResponseStatus
import app.shixu.core.network.generated.models.MemberAvailabilityView
import app.shixu.core.network.generated.models.PrivacyLevel
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.network.generated.models.WorkspaceRole
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.EmptyStateCard
import app.shixu.core.ui.components.LoadingSkeletonCard
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.LocalShixuSemanticColors
import app.shixu.core.ui.theme.TabularNumeralStyle
import java.time.ZoneId
import java.util.UUID

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TeamScreen(
    viewModel: TeamViewModel = activityHiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val activeWorkspace = state.activeWorkspace

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
                    Text("团队协同排会", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        text = "严格脱敏投影 · 绝不暴露成员 HR/HRV/睡眠原始数值",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = viewModel::refreshActiveWorkspace) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新团队状态")
                }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(onClick = viewModel::openCreateDialog, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text("创建工作区", modifier = Modifier.padding(start = 6.dp))
                }
                OutlinedButton(onClick = viewModel::openJoinDialog, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.GroupAdd, contentDescription = null)
                    Text("邀请码加入", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }

        state.feedbackMessage?.let { msg ->
            item {
                StateBanner(
                    tone = TagTone.positive,
                    icon = Icons.Outlined.Check,
                    title = "协同更新",
                    message = msg,
                    actionLabel = "关闭",
                    onAction = viewModel::clearFeedback,
                )
            }
        }

        state.errorMessage?.let { err ->
            item {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "团队同步提示",
                    message = err,
                    actionLabel = "关闭",
                    onAction = viewModel::clearFeedback,
                )
            }
        }

        if (state.workspaces.isNotEmpty()) {
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.workspaces.forEach { ws ->
                        FilterChip(
                            selected = ws.id == activeWorkspace?.id,
                            onClick = { viewModel.selectWorkspace(ws.id) },
                            label = { Text("${ws.name} (${ws.memberCount})") },
                        )
                    }
                }
            }
        }

        if (state.isLoading && activeWorkspace == null) {
            item { LoadingSkeletonCard(lines = 4) }
        } else if (activeWorkspace == null) {
            item {
                EmptyStateCard(
                    icon = Icons.Outlined.Groups,
                    title = "尚未加入团队工作区",
                    description = "创建一个新工作区获取邀请码，或输入队友的邀请码加入协同排会。",
                    actionLabel = "创建工作区",
                    onAction = viewModel::openCreateDialog,
                )
            }
        } else {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
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
                            Column(modifier = Modifier.weight(1f)) {
                                Text(activeWorkspace.name, style = MaterialTheme.typography.titleLarge)
                                Text(
                                    text = "邀请码：${activeWorkspace.inviteCode} · ${activeWorkspace.memberCount} 名成员",
                                    style = MaterialTheme.typography.bodySmall.merge(TabularNumeralStyle),
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            Button(onClick = viewModel::openMeetingWizard) {
                                Icon(Icons.AutoMirrored.Outlined.ScheduleSend, contentDescription = null)
                                Text("发起排会", modifier = Modifier.padding(start = 6.dp))
                            }
                        }

                        Text("我在本工作区的隐私投影等级：", style = MaterialTheme.typography.labelLarge)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            PrivacyLevel.entries.forEach { level ->
                                FilterChip(
                                    selected = activeWorkspace.myPrivacyLevel == level,
                                    onClick = { viewModel.updatePrivacyLevel(level) },
                                    label = { Text(ShixuFormatters.privacyLevelLabel(level)) },
                                )
                            }
                        }
                    }
                }
            }

            item {
                Text("团队会议提案与回执 (${state.meetings.size})", style = MaterialTheme.typography.titleMedium)
            }

            if (state.meetings.isEmpty()) {
                item {
                    EmptyStateCard(
                        icon = Icons.AutoMirrored.Outlined.ScheduleSend,
                        title = "暂无团队会议提案",
                        description = "点击「发起排会」，服务端将在不泄漏个人生理原值的前提下求解全员精力最佳的 Top 3 黄金窗口。",
                        actionLabel = "发起协同排会",
                        onAction = viewModel::openMeetingWizard,
                    )
                }
            } else {
                items(state.meetings, key = { it.id.toString() }) { proposal ->
                    MeetingProposalCard(
                        proposal = proposal,
                        currentUserId = state.currentUserId,
                        myRole = activeWorkspace.myRole,
                        zoneId = state.userZoneId,
                        isBusy = state.isSubmittingAction,
                        onRespond = { decision -> viewModel.respondToMeeting(proposal.id, decision) },
                        onCancel = { viewModel.cancelMeeting(proposal.id) },
                    )
                }
            }

            item {
                Text("成员脱敏可用性网格 (${state.availability.size})", style = MaterialTheme.typography.titleMedium)
            }

            items(state.availability, key = { it.userId.toString() }) { member ->
                SanitizedMemberAvailabilityCard(
                    member = member,
                    zoneId = state.userZoneId,
                )
            }
        }

        item { Box(modifier = Modifier.height(16.dp)) }
    }

    if (state.showCreateDialog) {
        AlertDialog(
            onDismissRequest = viewModel::dismissDialogs,
            title = { Text("创建团队工作区") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = state.createName,
                        onValueChange = { viewModel.updateCreateFields(name = it) },
                        label = { Text("团队名称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = state.createDescription,
                        onValueChange = { viewModel.updateCreateFields(description = it) },
                        label = { Text("团队说明（可选）") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    state.dialogError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(onClick = viewModel::submitCreateWorkspace, enabled = !state.isSubmittingAction) {
                    Text("创建")
                }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissDialogs) { Text("取消") }
            },
        )
    }

    if (state.showJoinDialog) {
        AlertDialog(
            onDismissRequest = viewModel::dismissDialogs,
            title = { Text("通过邀请码加入工作区") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = state.joinInviteCode,
                        onValueChange = viewModel::updateJoinCode,
                        label = { Text("邀请码") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    state.dialogError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(onClick = viewModel::submitJoinWorkspace, enabled = !state.isSubmittingAction) {
                    Text("加入")
                }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissDialogs) { Text("取消") }
            },
        )
    }

    if (state.wizard.isOpen) {
        MeetingWizardSheet(
            state = state.wizard,
            members = state.members,
            zoneId = state.userZoneId,
            onDismiss = viewModel::closeMeetingWizard,
            onUpdateWizard = viewModel::updateWizard,
            onToggleRequired = viewModel::toggleRequiredMember,
            onToggleOptional = viewModel::toggleOptionalMember,
            onRecommend = viewModel::recommendGoldenWindows,
            onConfirm = viewModel::confirmSelectedWindow,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MeetingProposalCard(
    proposal: MeetingProposalDTO,
    currentUserId: UUID?,
    myRole: WorkspaceRole,
    zoneId: ZoneId,
    isBusy: Boolean,
    onRespond: (MeetingDecisionStatus) -> Unit,
    onCancel: () -> Unit,
) {
    val myParticipant = proposal.participants.firstOrNull { it.userId == currentUserId }
    val canCancel = proposal.status != MeetingProposalStatus.cancelled &&
        (proposal.organizerId == currentUserId || myRole == WorkspaceRole.owner || myRole == WorkspaceRole.admin)

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
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
                Text(proposal.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                val statusLabel = when (proposal.status) {
                    MeetingProposalStatus.draft -> "草稿"
                    MeetingProposalStatus.confirmed -> "已确认"
                    MeetingProposalStatus.cancelled -> "已取消"
                }
                Text(
                    text = statusLabel,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (proposal.status == MeetingProposalStatus.cancelled) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.primary
                    },
                )
            }

            if (proposal.confirmedStartAt != null && proposal.confirmedEndAt != null) {
                Text(
                    text = "${ShixuFormatters.formatDateTime(proposal.confirmedStartAt, zoneId)} · ${
                        ShixuFormatters.formatTimeRange(proposal.confirmedStartAt, proposal.confirmedEndAt, zoneId)
                    } (${proposal.durationMinutes}m)",
                    style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                    color = MaterialTheme.colorScheme.secondary,
                )
            }

            Text(
                text = ShixuFormatters.cognitiveLoadLabel(proposal.cognitiveLoad),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                proposal.participants.forEach { p ->
                    val respText = when (p.responseStatus) {
                        MeetingResponseStatus.pending -> "待回执"
                        MeetingResponseStatus.accepted -> "已接受"
                        MeetingResponseStatus.declined -> "已拒绝"
                    }
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text(
                            text = "${p.displayName} · $respText",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
            }

            if (proposal.status != MeetingProposalStatus.cancelled && (myParticipant != null || canCancel)) {
                HorizontalDivider()
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (myParticipant != null) {
                        Button(
                            onClick = { onRespond(MeetingDecisionStatus.accepted) },
                            enabled = !isBusy && myParticipant.responseStatus != MeetingResponseStatus.accepted,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.Check, contentDescription = null)
                            Text("接受", modifier = Modifier.padding(start = 4.dp))
                        }
                        OutlinedButton(
                            onClick = { onRespond(MeetingDecisionStatus.declined) },
                            enabled = !isBusy && myParticipant.responseStatus != MeetingResponseStatus.declined,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.Close, contentDescription = null)
                            Text("拒绝并释放", modifier = Modifier.padding(start = 4.dp))
                        }
                    }
                    if (canCancel) {
                        TextButton(onClick = onCancel, enabled = !isBusy) {
                            Icon(Icons.Outlined.Cancel, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                            Text(
                                text = "取消",
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.padding(start = 4.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SanitizedMemberAvailabilityCard(
    member: MemberAvailabilityView,
    zoneId: ZoneId,
) {
    val semantic = LocalShixuSemanticColors.current
    Card(
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
                Text(member.displayName, style = MaterialTheme.typography.titleSmall)
                Text(
                    text = "${member.timezone} · ${ShixuFormatters.formatMinuteOfDay(member.workStartMinute)}-${
                        ShixuFormatters.formatMinuteOfDay(member.workEndMinute)
                    }",
                    style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = "隐私脱敏等级：${ShixuFormatters.privacyLevelLabel(member.privacyLevel)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (member.slots.isEmpty()) {
                Text("近期无占用时段（仅工作日边界内可协作）", style = MaterialTheme.typography.bodySmall)
            } else {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    member.slots.take(6).forEach { slot ->
                        val kindLabel = when (slot.kind) {
                            AvailabilitySlotKind.busy -> "忙碌"
                            AvailabilitySlotKind.focus_shield -> "深度专注保护"
                            AvailabilitySlotKind.soft_busy -> "弹性事务"
                        }
                        val titleSuffix = slot.title?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text(
                                text = "${ShixuFormatters.formatTimeRange(slot.startAt, slot.endAt, zoneId)} $kindLabel$titleSuffix",
                                style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                    }
                }
            }

            if (!member.energyBuckets.isNullOrEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    member.energyBuckets.take(8).forEach { bucket ->
                        val (bg, fg) = when (bucket.tier) {
                            EnergyTier.peak -> semantic.peakContainer to semantic.peak
                            EnergyTier.steady -> semantic.steadyContainer to semantic.steady
                            EnergyTier.strained -> semantic.strainedContainer to semantic.strained
                            EnergyTier.depleted -> semantic.depletedContainer to semantic.depleted
                        }
                        val hr = bucket.hourStartAt.atZoneSameInstant(zoneId).hour
                        Surface(color = bg, contentColor = fg, shape = RoundedCornerShape(6.dp)) {
                            Text(
                                text = "%02d时·%s".format(hr, ShixuFormatters.tierShortLabel(bucket.tier)),
                                style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
