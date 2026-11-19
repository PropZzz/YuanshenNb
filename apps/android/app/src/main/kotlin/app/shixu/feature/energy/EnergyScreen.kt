package app.shixu.feature.energy

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.core.ble.BleHeartRateManager
import app.shixu.core.health.HealthSync
import app.shixu.core.network.generated.models.*
import app.shixu.core.ui.*
import java.time.ZoneId

@Composable fun EnergyScreen(model: EnergyViewModel, ble: BleHeartRateManager, pending: Int) {
    val context = LocalContext.current
    val state by ble.state.collectAsStateWithLifecycle()
    val healthLauncher = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) { model.refreshPermissions() }
    val bleLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { if (ble.hasPermissions()) ble.scan() }
    var replay by remember { mutableStateOf<ReplayScenario?>(null) }
    PageColumn {
        PageHeading("LISTEN TO YOUR RHYTHM", "看见精力的起伏", "真实来源，可解释的预测，为恢复留一份空间。")
        LoadingNotice(model.busy); ErrorNotice(model.error, model::load)
        model.syncNotice?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        val energy = model.energy
        val zone = remember(energy?.timezone) { runCatching { ZoneId.of(energy?.timezone ?: ZoneId.systemDefault().id) }.getOrDefault(ZoneId.systemDefault()) }
        SectionCard(sourceLabel(energy?.dataFreshness)) {
            Text(energy?.score?.toString() ?: "—", style = MaterialTheme.typography.displayLarge, fontFamily = FontFamily.Serif)
            Text("当前精力 / 100", style = MaterialTheme.typography.labelMedium)
            energy?.drivers?.summary?.let { Text(it) }
            if (energy?.dataFreshness == DataFreshness.baseline_only) Text("尚无有效穿戴样本。当前为服务端节律与日程估算，不能替代生理实测。", style = MaterialTheme.typography.bodySmall)
            if (energy?.dataFreshness == DataFreshness.replay_demo) Text("模拟回放数据（仅供演示），并非真实手环采样。", color = MaterialTheme.colorScheme.error)
        }
        if (energy != null) {
            SectionCard("今日节律 · 服务端预测") {
                EnergyCurve(energy.hourlyCurve, zone)
                Text("显示时区 ${energy.timezone} · ${energy.hourlyCurve.size} 个本地自然日整点", style = MaterialTheme.typography.labelSmall)
            }
            SectionCard("影响因子") {
                val drivers = energy.drivers
                Text("睡眠恢复 ${"%.1f".format(drivers.sleepRecoveryScore)}")
                Text("自主神经修正 ${"%+.1f".format(drivers.autonomicDeltaScore)}")
                Text("昼夜节律 ${"%+.1f".format(drivers.circadianScore)}")
                Text("日程负荷消耗 ${"%.1f".format(drivers.cognitiveLoadDrainScore)}")
                Text("恢复缓冲回补 ${"%+.1f".format(drivers.recoveryBufferBonusScore)}")
                HorizontalDivider()
                Text("最近 HRV ${drivers.recentHrvRmssdMs?.let { "%.1f ms".format(it) } ?: "无实测"} · 静息心率 ${drivers.recentRestingHrBpm?.let { "%.0f bpm".format(it) } ?: "无实测"}", style = MaterialTheme.typography.bodySmall)
                Text("睡眠时长 ${drivers.sleepDurationMinutes?.let { "$it 分钟" } ?: "无实测"}", style = MaterialTheme.typography.bodySmall)
            }
            SectionCard("来源与同步诊断") {
                Text("主来源 ${energy.diagnostics.primarySource?.value ?: "无穿戴来源"}")
                Text("最近同步 ${energy.diagnostics.lastSyncedAt?.let { timeLabel(it, zone) } ?: "尚无同步"}")
                Text("基线有效天数 ${energy.diagnostics.baselineReadyDays} / 14")
                Text("待补传样本 $pending 条", style = MaterialTheme.typography.labelMedium)
            }
        }
        SectionCard("Health Connect") {
            Text(if (model.healthAvailable) "读取心率、HRV、静息心率、睡眠与活动热量。首次同步近 14 天，之后每 15 分钟增量同步。" else "当前设备尚未提供可用的 Health Connect。可安装或更新系统健康连接服务。")
            if (model.missing.isNotEmpty()) Text("缺失权限：${model.missing.joinToString("、") { permissionLabel(it) }}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Button(onClick = {
                if (model.healthAvailable) healthLauncher.launch(HealthSync.PERMISSIONS)
                else runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata"))) }
            }, modifier = Modifier.fillMaxWidth()) { Text(if (model.healthAvailable) "管理健康读取权限" else "安装或更新 Health Connect") }
            OutlinedButton(onClick = model::sync, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("立即同步并补传队列") }
            if (model.backgroundReadSupported && !model.backgroundReadGranted) {
                Text("前台同步已可用。若希望离开应用后也读取新样本，请另外授权后台健康读取。", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { healthLauncher.launch(setOf(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)) }, modifier = Modifier.fillMaxWidth()) { Text("允许后台健康同步") }
            } else Text(if (model.backgroundReadGranted) "后台读取已授权；系统周期任务最短每 15 分钟运行，可能受省电策略推迟。" else "此系统暂不支持后台健康读取；请在应用前台同步，已入队样本仍可后台补传。", style = MaterialTheme.typography.bodySmall)
        }
        SectionCard("标准 BLE 心率设备") {
            Text(state.message)
            if (state.bpm != null) Text("${state.bpm} bpm", style = MaterialTheme.typography.headlineMedium, fontFamily = FontFamily.Monospace)
            Text(state.rmssd?.let { "当前窗口 RMSSD %.1f ms".format(it) } ?: "等待设备 RR 间期；不提供 RR 的设备不会生成 HRV", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { if (ble.hasPermissions()) ble.scan() else bleLauncher.launch(BleHeartRateManager.requiredPermissions()) }, modifier = Modifier.fillMaxWidth()) { Text("扫描 0x180D 心率设备") }
            state.devices.forEach { device -> OutlinedButton(onClick = { ble.connect(device.address) }, modifier = Modifier.fillMaxWidth()) { Text("连接 ${device.name}") } }
            if (state.status == "Streaming" || state.status == "Connecting" || state.status == "Scanning") TextButton(onClick = ble::disconnect) { Text("停止采集并断开") }
        }
        SectionCard("受控演示回放") {
            Text("仅在你确认后向服务端注入 replay_demo 测试样本。所有洞察都会明确标记回放测试源。", style = MaterialTheme.typography.bodySmall)
            ReplayScenario.entries.forEach { scenario -> OutlinedButton(onClick = { replay = scenario }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text(replayLabel(scenario)) } }
        }
    }
    replay?.let { scenario -> AlertDialog(onDismissRequest = { replay = null }, title = { Text("加载回放测试源？") }, text = { Text("将注入“${replayLabel(scenario)}”模拟样本，影响今日精力分析。该来源会明确标记为 replay_demo。") }, confirmButton = { Button(onClick = { model.replay(scenario); replay = null }) { Text("确认加载测试回放") } }, dismissButton = { TextButton(onClick = { replay = null }) { Text("取消") } }) }
}

@Composable private fun EnergyCurve(points: List<HourlyEnergyPoint>, zone: ZoneId) {
    if (points.isEmpty()) { Text("服务端尚未返回节律曲线"); return }
    val line = MaterialTheme.colorScheme.secondary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.height(150.dp), verticalArrangement = Arrangement.SpaceBetween) { Text("100", style = MaterialTheme.typography.labelSmall); Text("50", style = MaterialTheme.typography.labelSmall); Text("0", style = MaterialTheme.typography.labelSmall) }
        Canvas(Modifier.weight(1f).height(150.dp)) {
            listOf(0f, .5f, 1f).forEach { factor -> drawLine(grid, Offset(0f, size.height * factor), Offset(size.width, size.height * factor), 1.dp.toPx()) }
            val first = points.first().hourStartAt.toInstant().toEpochMilli()
            val span = (points.last().hourStartAt.toInstant().toEpochMilli() - first).coerceAtLeast(1)
            val path = Path()
            points.forEachIndexed { index, point ->
                val x = (point.hourStartAt.toInstant().toEpochMilli() - first).toFloat() / span * size.width
                val y = (1f - point.score.coerceIn(0, 100).toFloat() / 100f) * size.height
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                drawCircle(line, 2.dp.toPx(), Offset(x, y))
            }
            drawPath(path, line, style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        listOf(points.first(), points[points.size / 2], points.last()).forEach { Text(clockLabel(it.hourStartAt, zone), style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace) }
    }
}

private fun permissionLabel(permission: String) = when (permission.substringAfterLast('.')) { "READ_HEART_RATE" -> "心率"; "READ_HEART_RATE_VARIABILITY" -> "HRV"; "READ_RESTING_HEART_RATE" -> "静息心率"; "READ_SLEEP" -> "睡眠"; "READ_ACTIVE_CALORIES_BURNED" -> "活动热量"; else -> permission.substringAfterLast('.') }
private fun replayLabel(scenario: ReplayScenario) = when (scenario) { ReplayScenario.well_rested -> "充沛状态"; ReplayScenario.sleep_deprived -> "睡眠不足"; ReplayScenario.high_stress -> "连续高压" }
