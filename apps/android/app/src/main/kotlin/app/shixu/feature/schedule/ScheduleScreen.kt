package app.shixu.feature.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.*
import app.shixu.core.ui.*
import java.time.*
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

@Composable fun ScheduleScreen(model: ScheduleViewModel, openRescue: Boolean = false, rescueHandled: () -> Unit = {}) {
    var editor by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ScheduleItemDTO?>(null) }
    var rescue by remember { mutableStateOf(false) }
    LaunchedEffect(openRescue) { if (openRescue) { rescue = true; rescueHandled() } }
    PageColumn {
        PageHeading("YOUR TIME MAP", "让今天，从容有序", model.day.format(DateTimeFormatter.ofPattern("yyyy 年 M 月 d 日 · EEEE")))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (-3L..3L).forEach { offset ->
                val date = model.day.plusDays(offset)
                FilterChip(selected = offset == 0L, onClick = { model.selectDay(date) }, label = { Text(date.format(DateTimeFormatter.ofPattern("E dd"))) })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { editing = null; editor = true }, enabled = !model.busy && !model.offline, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Add, null); Text("新建日程") }
            OutlinedButton(onClick = { rescue = true }, enabled = !model.busy && !model.offline, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Bolt, null); Text("精力救援") }
            IconButton(onClick = model::load, enabled = !model.busy) { Icon(Icons.Outlined.Refresh, "刷新日程") }
        }
        LoadingNotice(model.busy)
        ErrorNotice(model.error, model::load)
        model.notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        model.energy?.overloadAlert?.let { alert -> SectionCard("精力保护建议") { Text(alert.message); TextButton(onClick = { rescue = true }) { Text("预览恢复方案") } } }
        if (model.loaded && model.items.isEmpty()) EmptyNotice("今天留有余地", "还没有日程。创建一个专注时间块，让计划从容展开。")
        model.items.sortedBy { it.startAt }.forEach { item ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.width(49.dp).padding(top = 20.dp)) {
                    Text(clockLabel(item.startAt, model.zone), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace)
                    Text(clockLabel(item.endAt, model.zone), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline, fontFamily = FontFamily.Monospace)
                }
                SectionCard(item.title, Modifier.weight(1f)) {
                    Text("${categoryLabel(item.category)} · ${loadLabel(item.cognitiveLoad)} · ${item.durationMinutes} 分钟", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                    if (item.notes.isNotBlank()) Text(item.notes, style = MaterialTheme.typography.bodySmall)
                    Text("${flexibilityLabel(item.flexibility)} · ${statusLabel(item.status)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.status != ScheduleStatus.completed && item.status != ScheduleStatus.cancelled) {
                        Row {
                            TextButton(onClick = { model.complete(item) }, enabled = !model.busy && !model.offline) { Text("完成") }
                            TextButton(onClick = { editing = item; editor = true }, enabled = !model.busy && !model.offline) { Text("编辑") }
                            TextButton(onClick = { model.cancel(item) }, enabled = !model.busy && !model.offline) { Text("取消") }
                        }
                    }
                }
            }
        }
        if (model.history.isNotEmpty()) SectionCard("可撤销的救援记录") {
            model.history.take(5).forEach { record ->
                Text("${strategyLabel(record.strategy)} · ${timeLabel(record.appliedAt, model.zone)}")
                if (record.status == RescueSnapshotStatus.applied) OutlinedButton(onClick = { model.undo(record) }, enabled = !model.busy && !model.offline) { Text("撤销这次救援") }
                else Text("已撤销", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
    if (editor) ScheduleEditor(model, editing, onDismiss = { editor = false })
    if (rescue) RescueSheet(model, onDismiss = { rescue = false })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ScheduleEditor(model: ScheduleViewModel, item: ScheduleItemDTO?, onDismiss: () -> Unit) {
    var title by remember { mutableStateOf(item?.title ?: "") }
    var notes by remember { mutableStateOf(item?.notes ?: "") }
    var date by remember { mutableStateOf((item?.startAt?.atZoneSameInstant(model.zone)?.toLocalDate() ?: model.day).toString()) }
    var time by remember { mutableStateOf(item?.let { clockLabel(it.startAt, model.zone) } ?: "09:00") }
    var duration by remember { mutableStateOf((item?.durationMinutes ?: 60).toString()) }
    var category by remember { mutableStateOf(item?.category ?: ScheduleCategory.deep_work) }
    var load by remember { mutableStateOf(item?.cognitiveLoad ?: CognitiveLoad.medium) }
    var flexibility by remember { mutableStateOf(item?.flexibility ?: Flexibility.flexible) }
    var validation by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        PageColumn {
            Text(if (item == null) "安排一段好时光" else "编辑日程", style = MaterialTheme.typography.headlineSmall)
            FormField(title, { title = it }, "日程标题")
            FormField(date, { date = it }, "日期 YYYY-MM-DD")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FormField(time, { time = it }, "开始 HH:mm", Modifier.weight(1f))
                FormField(duration, { duration = it }, "分钟", Modifier.weight(1f))
            }
            ChoiceField("类别", category, ScheduleCategory.entries, ::categoryLabel) { category = it }
            ChoiceField("认知负荷", load, CognitiveLoad.entries, ::loadLabel) { load = it }
            ChoiceField("时间弹性", flexibility, Flexibility.entries, ::flexibilityLabel) { flexibility = it }
            FormField(notes, { notes = it }, "备注", singleLine = false)
            LoadingNotice(model.busy)
            ErrorNotice(validation ?: model.error)
            Button(onClick = {
                runCatching {
                    require(title.isNotBlank()) { "请填写日程标题" }
                    val start = LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(model.zone).toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC)
                    val minutes = duration.toLong().also { require(it in 1..1440) { "时长需在 1–1440 分钟之间" } }
                    model.save(item?.id, CreateScheduleItemRequest(category, load, start.plusMinutes(minutes), flexibility, start, title.trim(), notes = notes.trim(), reminderMinutes = item?.reminderMinutes ?: 10)) { onDismiss() }
                    validation = null
                }.onFailure { validation = it.message ?: "请检查日期与时间" }
            }, enabled = !model.busy && !model.offline, modifier = Modifier.fillMaxWidth()) { Text("保存日程") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun RescueSheet(model: ScheduleViewModel, onDismiss: () -> Unit) {
    var urgent by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("45") }
    var deadline by remember { mutableStateOf("${model.day}T18:00") }
    var validation by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        PageColumn {
            PageHeading("ENERGY RESCUE", "为突发，留出余地", "先比较服务端提供的三套方案，确认后才修改日程。")
            Row(verticalAlignment = Alignment.CenterVertically) { Switch(urgent, { urgent = it }); Text("插入紧急任务", Modifier.padding(start = 10.dp)) }
            if (urgent) {
                FormField(title, { title = it }, "紧急任务标题")
                FormField(minutes, { minutes = it }, "所需分钟")
                FormField(deadline, { deadline = it }, "截止本地时间 YYYY-MM-DDTHH:mm")
            }
            OutlinedButton(onClick = {
                runCatching {
                    val task = if (!urgent) null else UrgentTaskDTO(CognitiveLoad.high, LocalDateTime.parse(deadline).atZone(model.zone).toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC), minutes.toLong(), title.trim().also { require(it.isNotBlank()) { "请填写紧急任务标题" } })
                    model.preview(task); validation = null
                }.onFailure { validation = it.message ?: "请检查紧急任务信息" }
            }, enabled = !model.busy && !model.offline, modifier = Modifier.fillMaxWidth()) { Text(if (urgent) "计算紧急插单方案" else "计算精力恢复方案") }
            LoadingNotice(model.busy)
            ErrorNotice(validation ?: model.error)
            model.options?.options?.forEach { plan ->
                SectionCard(strategyLabel(plan.strategy)) {
                    Text(plan.summary)
                    Text("移动 ${plan.movedCount} · 延后 ${plan.deferredCount} · 恢复 ${plan.recoveryMinutes} 分钟 · 逾期风险 ${plan.overdueRiskCount}", style = MaterialTheme.typography.bodySmall)
                    plan.diffItems.forEach { diff ->
                        Text("${diff.title} · ${diff.reasonLabel}", style = MaterialTheme.typography.labelMedium)
                        diff.beforeStartAt?.let { Text("原 ${timeLabel(it, model.zone)} → ${diff.beforeEndAt?.let { end -> timeLabel(end, model.zone) } ?: "—"}", style = MaterialTheme.typography.bodySmall) }
                        Text("新 ${timeLabel(diff.afterStartAt, model.zone)} → ${timeLabel(diff.afterEndAt, model.zone)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                    }
                    Button(onClick = { model.apply(plan) }, enabled = plan.feasible && !model.busy && !model.offline, modifier = Modifier.fillMaxWidth()) { Text(if (plan.feasible) "确认应用此方案" else "方案不可行") }
                }
            }
            model.notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        }
    }
}

@Composable fun FocusScreen(model: ScheduleViewModel) {
    var now by remember { mutableStateOf(Instant.now()) }
    val deadline = model.focusDeadline
    LaunchedEffect(Unit) { while (true) { now = Instant.now(); delay(1000) } }
    val current = model.items.firstOrNull { it.status != ScheduleStatus.completed && it.status != ScheduleStatus.cancelled && it.startAt.toInstant() <= now && it.endAt.toInstant() > now }
    val next = model.items.filter { it.status == ScheduleStatus.planned && it.startAt.toInstant() > now }.minByOrNull { it.startAt }
    val seconds = deadline?.let { Duration.between(now, it).seconds.coerceAtLeast(0) }
    PageColumn {
        PageHeading("MAKE ROOM FOR FOCUS", "此刻，只做重要的事", "把专注交给当下，把恢复留在计划里。")
        LoadingNotice(model.busy); ErrorNotice(model.error, model::load)
        SectionCard("今日精力") {
            Text(model.energy?.score?.toString() ?: "—", style = MaterialTheme.typography.displayLarge, fontFamily = FontFamily.Serif)
            Text(sourceLabel(model.energy?.dataFreshness), color = MaterialTheme.colorScheme.onSurfaceVariant)
            model.energy?.drivers?.summary?.let { Text(it) }
        }
        SectionCard(current?.title ?: "开启一段安静时间") {
            Text(if (seconds == null) "25:00" else "%02d:%02d".format(seconds / 60, seconds % 60), style = MaterialTheme.typography.displayLarge, fontFamily = FontFamily.Monospace)
            Text(if (seconds == 0L) "本轮专注结束，起身恢复一下。" else "专注计时使用真实时钟，离开页面也不会增加时间。", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { model.updateFocusDeadline(if (deadline == null || seconds == 0L) Instant.now().plusSeconds(25 * 60) else null) }, modifier = Modifier.fillMaxWidth()) { Text(if (deadline == null || seconds == 0L) "开始 25 分钟专注" else "结束本轮") }
            current?.let { TextButton(onClick = { model.complete(it) }, enabled = !model.busy && !model.offline) { Text("标记当前日程完成") } }
        }
        if (next == null) EmptyNotice("接下来", "暂无后续日程。可以到日历安排你的下一段专注。")
        else SectionCard("接下来") { Text(next.title); Text("${clockLabel(next.startAt, model.zone)} — ${clockLabel(next.endAt, model.zone)}", fontFamily = FontFamily.Monospace) }
    }
}

fun categoryLabel(value: ScheduleCategory) = when (value) { ScheduleCategory.deep_work -> "深度专注"; ScheduleCategory.meeting -> "团队会议"; ScheduleCategory.recovery -> "恢复缓冲"; ScheduleCategory.routine -> "日常事务"; ScheduleCategory.urgent -> "紧急任务" }
fun loadLabel(value: CognitiveLoad) = when (value) { CognitiveLoad.high -> "高认知"; CognitiveLoad.medium -> "中认知"; CognitiveLoad.low -> "低认知" }
fun strategyLabel(value: RescueStrategy) = when (value) { RescueStrategy.minimize_changes -> "最小改动"; RescueStrategy.protect_recovery -> "优先恢复"; RescueStrategy.protect_deadline -> "截止优先" }
fun statusLabel(value: ScheduleStatus) = when (value) { ScheduleStatus.planned -> "计划中"; ScheduleStatus.in_progress -> "进行中"; ScheduleStatus.completed -> "已完成"; ScheduleStatus.cancelled -> "已取消" }
fun flexibilityLabel(value: Flexibility) = when (value) { Flexibility.hard_locked -> "固定锁定"; Flexibility.flexible -> "可弹性调整"; Flexibility.focus_shield -> "深度专注保护" }



