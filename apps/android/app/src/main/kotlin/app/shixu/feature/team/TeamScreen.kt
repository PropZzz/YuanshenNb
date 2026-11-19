package app.shixu.feature.team

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.*
import app.shixu.core.ui.*
import app.shixu.feature.schedule.loadLabel
import java.time.LocalDate

@Composable fun TeamScreen(model: TeamViewModel) {
    var workspaceName by remember { mutableStateOf("") }
    var inviteCode by remember { mutableStateOf("") }
    var meetingEditor by remember { mutableStateOf(false) }
    var confirmWindow by remember { mutableStateOf<GoldenWindowRecommendation?>(null) }
    PageColumn {
        PageHeading("BETTER TOGETHER", "一起，找到好时间", "尊重每个人的专注边界，再开启高效协作。")
        LoadingNotice(model.busy); ErrorNotice(model.error, model::load)
        model.notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        if (model.workspaces.isNotEmpty()) ChoiceField("工作区", model.selected ?: model.workspaces.first(), model.workspaces, { it.name }) { model.select(it) }
        val workspace = model.selected
        if (workspace != null) {
            SectionCard(workspace.name) {
                Text("${workspace.memberCount} 位成员 · ${workspace.myRole.value}")
                Text("邀请码 ${workspace.inviteCode}", style = MaterialTheme.typography.labelMedium)
                ChoiceField("我的分享范围", workspace.myPrivacyLevel, PrivacyLevel.entries, ::privacyLabel) { model.privacy(it) }
                Text(privacyDescription(workspace.myPrivacyLevel), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { meetingEditor = true }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("寻找黄金协作窗口") }
            }
            model.recommendations?.let { response ->
                response.blockingDiagnostics.forEach { diagnostic -> SectionCard("暂未找到合适窗口") { Text(diagnostic.message); Text(diagnostic.suggestedAction) } }
                response.recommendations.forEach { window ->
                    SectionCard("黄金窗口 ${window.rank} · 匹配度 ${window.score}") {
                        Text("${timeLabel(window.startAt, model.zone)} — ${timeLabel(window.endAt, model.zone)}", style = MaterialTheme.typography.titleMedium)
                        Text(window.summary)
                        Text("精力匹配 ${window.breakdown.energyMatchScore} · 专注保护 ${window.breakdown.focusShieldScore} · 紧凑度 ${window.breakdown.compactnessScore}", style = MaterialTheme.typography.bodySmall)
                        window.explanationTags.forEach { tag -> Text(tag.label, style = MaterialTheme.typography.labelSmall) }
                        Button(onClick = { confirmWindow = window }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("确认这个时间") }
                    }
                }
            }
            SectionCard("成员的今日状态") {
                if (model.members.isEmpty()) Text("正在读取成员名册")
                model.members.forEach { member ->
                    val view = model.availability?.members?.firstOrNull { it.userId == member.userId }
                    Text(member.displayName, style = MaterialTheme.typography.titleSmall)
                    Text("${member.timezone} · ${privacyLabel(member.privacyLevel)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (view == null) Text("状态尚未加载", style = MaterialTheme.typography.bodySmall)
                    else if (view.slots.isEmpty()) Text("暂无忙碌或保护时间块", style = MaterialTheme.typography.bodySmall)
                    else view.slots.take(6).forEach { slot -> Text("${clockLabel(slot.startAt, model.zone)}–${clockLabel(slot.endAt, model.zone)} · ${slotLabel(slot.kind)}${slot.title?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall) }
                    HorizontalDivider()
                }
            }
            if (model.meetings.isEmpty() && !model.busy) EmptyNotice("会议邀请", "目前没有会议提案。可以寻找一个适合大家的协作窗口。")
            model.meetings.forEach { meeting ->
                SectionCard(meeting.title) {
                    Text(meeting.confirmedStartAt?.let { timeLabel(it, model.zone) } ?: "时间待确认")
                    Text("${meeting.durationMinutes} 分钟 · ${meeting.status.value}", style = MaterialTheme.typography.bodySmall)
                    meeting.participants.forEach { Text("${it.displayName} · ${it.responseStatus.value}", style = MaterialTheme.typography.bodySmall) }
                    if (meeting.status == MeetingProposalStatus.confirmed && meeting.participants.any { it.userId == model.myId }) Row {
                        Button(onClick = { model.respond(meeting, MeetingDecisionStatus.accepted) }, enabled = !model.busy) { Text("接受") }
                        TextButton(onClick = { model.respond(meeting, MeetingDecisionStatus.declined) }, enabled = !model.busy) { Text("拒绝并释放时段") }
                    }
                    if (meeting.status == MeetingProposalStatus.confirmed && (meeting.organizerId == model.myId || workspace.myRole == WorkspaceRole.owner || workspace.myRole == WorkspaceRole.admin)) TextButton(onClick = { model.cancel(meeting) }, enabled = !model.busy) { Text("取消会议") }
                }
            }
        } else if (model.loaded) EmptyNotice("建立你的协作空间", "创建工作区，或通过邀请码加入团队。")
        SectionCard("创建或加入工作区") {
            FormField(workspaceName, { workspaceName = it }, "新工作区名称")
            OutlinedButton(onClick = { model.create(workspaceName) }, enabled = !model.busy && workspaceName.isNotBlank()) { Text("创建工作区") }
            FormField(inviteCode, { inviteCode = it }, "团队邀请码")
            OutlinedButton(onClick = { model.join(inviteCode) }, enabled = !model.busy && inviteCode.isNotBlank()) { Text("加入工作区") }
        }
    }
    if (meetingEditor) MeetingEditor(model) { meetingEditor = false }
    confirmWindow?.let { window -> AlertDialog(onDismissRequest = { confirmWindow = null }, title = { Text("确认团队会议") }, text = { Text("将按 ${timeLabel(window.startAt, model.zone)} 的推荐时间创建会议并同步参会人的日程。") }, confirmButton = { Button(onClick = { model.confirm(window); confirmWindow = null }) { Text("确认并通知参会人") } }, dismissButton = { TextButton(onClick = { confirmWindow = null }) { Text("再看看") } }) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun MeetingEditor(model: TeamViewModel, onDismiss: () -> Unit) {
    var title by remember { mutableStateOf("") }
    var duration by remember { mutableStateOf("30") }
    var day by remember { mutableStateOf(LocalDate.now(model.zone).toString()) }
    var days by remember { mutableStateOf("3") }
    var load by remember { mutableStateOf(CognitiveLoad.medium) }
    var selected by remember { mutableStateOf(model.members.map { it.userId.toString() }.toSet()) }
    var error by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        PageColumn {
            PageHeading("GOLDEN WINDOW", "找到大家都好的时刻", "服务端会综合工作时间、隐私边界与专注保护求解。")
            FormField(title, { title = it }, "会议主题")
            FormField(duration, { duration = it }, "会议分钟数")
            FormField(day, { day = it }, "搜索起始日期 YYYY-MM-DD")
            FormField(days, { days = it }, "搜索天数 1–14")
            ChoiceField("认知负荷", load, CognitiveLoad.entries, ::loadLabel) { load = it }
            model.members.forEach { member -> Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(member.userId.toString() in selected, { checked -> selected = if (checked) selected + member.userId.toString() else selected - member.userId.toString() }); Text(member.displayName) } }
            ErrorNotice(error ?: model.error)
            Button(onClick = {
                runCatching {
                    require(title.isNotBlank() && selected.isNotEmpty()) { "请输入主题并选择参会人" }
                    val length = duration.toLong().also { require(it in 5..480) { "会议时长需在 5–480 分钟之间" } }
                    val range = days.toLong().also { require(it in 1..14) { "搜索范围需为 1–14 天" } }
                    val start = LocalDate.parse(day).atStartOfDay(model.zone).toOffsetDateTime()
                    model.recommend(RecommendMeetingRequest(load, length, selected.toList(), start, LocalDate.parse(day).plusDays(range).atStartOfDay(model.zone).toOffsetDateTime(), title.trim()))
                    onDismiss()
                }.onFailure { error = it.message ?: "请检查会议参数" }
            }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("生成最多三个推荐窗口") }
        }
    }
}

fun privacyLabel(level: PrivacyLevel): String = when (level) { PrivacyLevel.busy_only -> "仅忙闲"; PrivacyLevel.energy_tier -> "忙闲与精力档位"; PrivacyLevel.full_title -> "授权日程标题" }
fun privacyDescription(level: PrivacyLevel): String = when (level) { PrivacyLevel.busy_only -> "仅分享是否忙碌，不分享日程标题或生理指标。"; PrivacyLevel.energy_tier -> "分享忙闲和脱敏精力档位，心率、HRV 与睡眠原始数据始终私密。"; PrivacyLevel.full_title -> "授权团队查看日程标题，生理原始数据仍保持私密。" }
private fun slotLabel(kind: AvailabilitySlotKind): String = when (kind) { AvailabilitySlotKind.busy -> "忙碌"; AvailabilitySlotKind.focus_shield -> "深度专注保护"; AvailabilitySlotKind.soft_busy -> "可协调" }
