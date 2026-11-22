package app.shixu.feature.energy

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bluetooth
import androidx.compose.material.icons.outlined.BluetoothConnected
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.core.ble.BleConnectionState
import app.shixu.core.health.HealthConnectPermissions
import app.shixu.core.health.HealthConnectSdkStatus
import app.shixu.core.network.generated.models.EnergyDrivers
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.HourlyEnergyPoint
import app.shixu.core.network.generated.models.ReplayScenario
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.DataFreshnessChip
import app.shixu.core.ui.components.EmptyStateCard
import app.shixu.core.ui.components.EnergyTierBadge
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.LocalShixuSemanticColors
import app.shixu.core.ui.theme.TabularNumeralStyle
import java.time.ZoneId
import kotlin.math.roundToInt

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EnergyScreen(
    viewModel: EnergyViewModel = activityHiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val healthPermLauncher = rememberLauncherForActivityResult(
        contract = PermissionController.createRequestPermissionResultContract(),
    ) {
        viewModel.onHealthPermissionsResult()
    }

    val blePermLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) {
            viewModel.startBleScan()
        }
    }

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
                    Text("穿戴精力洞察", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        text = "诚实来源打标 · Health Connect 与 BLE 0x180D 双通道",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = viewModel::refreshEnergy) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新精力状态")
                }
            }
        }

        state.feedbackMessage?.let { msg ->
            item {
                StateBanner(
                    tone = TagTone.positive,
                    icon = Icons.Outlined.Sync,
                    title = "穿戴同步状态",
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
                    title = "精力接口提示",
                    message = err,
                    actionLabel = "关闭",
                    onAction = viewModel::clearFeedback,
                )
            }
        }

        item {
            val energy = state.energy
            if (energy == null) {
                EmptyStateCard(
                    icon = Icons.Outlined.FavoriteBorder,
                    title = "尚未获取到今日精力快照",
                    description = "请确保网络畅通或授权 Health Connect 同步后重试，或下方使用受控测试回放样本体验完整曲线。",
                    actionLabel = "刷新精力数据",
                    onAction = viewModel::refreshEnergy,
                )
            } else {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            EnergyTierBadge(energy.tier)
                            DataFreshnessChip(
                                freshness = energy.dataFreshness,
                                isOffline = state.isOfflineSnapshot,
                                onClick = viewModel::refreshEnergy,
                            )
                        }
                        Row(
                            verticalAlignment = Alignment.Bottom,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = energy.score.toString(),
                                style = MaterialTheme.typography.displayLarge.merge(TabularNumeralStyle),
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                text = "/ 100 · ${energy.localDay}",
                                style = MaterialTheme.typography.titleMedium.merge(TabularNumeralStyle),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 8.dp),
                            )
                        }
                        Text(energy.drivers.summary, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            text = "14 日生理基线就绪 ${energy.diagnostics.baselineReadyDays} 天" +
                                (energy.diagnostics.hrvBaselineMs?.let { " · HRV 基线 %.1f ms".format(it) }.orEmpty()) +
                                (energy.diagnostics.rhrBaselineBpm?.let { " · RHR 基线 %.0f bpm".format(it) }.orEmpty()),
                            style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        state.energy?.let { energy ->
            if (energy.hourlyCurve.isNotEmpty()) {
                item {
                    HourlyEnergyCurveCard(
                        points = energy.hourlyCurve,
                        zoneId = state.userZoneId,
                    )
                }
            }

            item {
                DriversBreakdownCard(drivers = energy.drivers)
            }
        }

        item {
            HealthConnectCard(
                state = state,
                onRequestPermissions = {
                    healthPermLauncher.launch(HealthConnectPermissions.REQUIRED_PERMISSIONS)
                },
                onOpenHealthSettings = {
                    val intent = runCatching {
                        HealthConnectClient.getHealthConnectManageDataIntent(context)
                    }.getOrElse {
                        Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
                    }
                    runCatching { context.startActivity(intent) }
                },
                onSyncNow = viewModel::syncHealthConnectNow,
            )
        }

        item {
            BleHeartRateCard(
                bleState = state.bleState,
                onStartScan = {
                    if (viewModel.hasBlePermissions()) {
                        viewModel.startBleScan()
                    } else {
                        blePermLauncher.launch(viewModel.requiredBlePermissions())
                    }
                },
                onStopScan = viewModel::stopBleScan,
                onConnect = viewModel::connectBleDevice,
                onDisconnect = viewModel::disconnectBleDevice,
            )
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Outlined.Science, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
                        Text("受控测试回放通道 (replay_demo)", style = MaterialTheme.typography.titleMedium)
                    }
                    Text(
                        text = "所有注入样本均显式标记 sourceType = replay_demo，顶部徽标诚实展示「回放测试源（仅供演示）」，绝不伪装成真实手环。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { viewModel.seedReplayScenario(ReplayScenario.well_rested) },
                            enabled = !state.isSeedingReplay,
                        ) { Text("注入：充沛状态") }
                        OutlinedButton(
                            onClick = { viewModel.seedReplayScenario(ReplayScenario.sleep_deprived) },
                            enabled = !state.isSeedingReplay,
                        ) { Text("注入：睡眠不足") }
                        OutlinedButton(
                            onClick = { viewModel.seedReplayScenario(ReplayScenario.high_stress) },
                            enabled = !state.isSeedingReplay,
                        ) { Text("注入：连续高压") }
                    }
                }
            }
        }

        item { Box(modifier = Modifier.height(16.dp)) }
    }
}

@Composable
private fun HourlyEnergyCurveCard(
    points: List<HourlyEnergyPoint>,
    zoneId: ZoneId,
) {
    val semantic = LocalShixuSemanticColors.current
    val lineColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.outlineVariant

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("24h 本地自然日精力曲线", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "${points.size} 点位",
                    style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(140.dp),
            ) {
                if (points.isEmpty()) return@Canvas
                val w = size.width
                val h = size.height

                // 75 (peak) 和 35 (depleted) 阈值辅助线
                val y75 = h * (1f - 75f / 100f)
                val y35 = h * (1f - 35f / 100f)
                drawLine(gridColor, Offset(0f, y75), Offset(w, y75), strokeWidth = 1.dp.toPx())
                drawLine(gridColor, Offset(0f, y35), Offset(w, y35), strokeWidth = 1.dp.toPx())

                val stepX = if (points.size <= 1) w else w / (points.size - 1).toFloat()
                val path = Path()
                points.forEachIndexed { idx, pt ->
                    val x = idx * stepX
                    val y = h * (1f - (pt.score.coerceIn(0L, 100L) / 100f))
                    if (idx == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(
                    path = path,
                    color = lineColor,
                    style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round),
                )
                points.forEachIndexed { idx, pt ->
                    val x = idx * stepX
                    val y = h * (1f - (pt.score.coerceIn(0L, 100L) / 100f))
                    val dotColor = when (pt.tier) {
                        EnergyTier.peak -> semantic.peak
                        EnergyTier.steady -> semantic.steady
                        EnergyTier.strained -> semantic.strained
                        EnergyTier.depleted -> semantic.depleted
                    }
                    drawCircle(color = dotColor, radius = 3.5.dp.toPx(), center = Offset(x, y))
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                val startH = points.first().hourStartAt.atZoneSameInstant(zoneId).hour
                val mid = points[points.size / 2]
                val endH = points.last().hourStartAt.atZoneSameInstant(zoneId).hour
                Text("%02d:00".format(startH), style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle))
                Text(
                    text = "中段 %02d:00 · ${mid.score}分".format(mid.hourStartAt.atZoneSameInstant(zoneId).hour),
                    style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                )
                Text("%02d:00".format(endH), style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle))
            }
        }
    }
}

@Composable
private fun DriversBreakdownCard(drivers: EnergyDrivers) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("四因子透明贡献拆解", style = MaterialTheme.typography.titleMedium)
            DriverMetricRow(
                label = "A · 睡眠恢复基线",
                value = "+${drivers.sleepRecoveryScore.roundToInt()} 分",
                detail = drivers.sleepDurationMinutes?.let { "睡眠 ${it / 60}h ${it % 60}m" },
            )
            DriverMetricRow(
                label = "B · 自主神经恢复修正",
                value = "%+.1f 分".format(drivers.autonomicDeltaScore),
                detail = listOfNotNull(
                    drivers.recentHrvRmssdMs?.let { "HRV %.1f ms".format(it) },
                    drivers.recentRestingHrBpm?.let { "静息心率 %.0f bpm".format(it) },
                ).joinToString(" · ").ifEmpty { null },
            )
            DriverMetricRow(
                label = "C · 个人昼夜节律波峰",
                value = "+${drivers.circadianScore.roundToInt()} 分",
                detail = null,
            )
            DriverMetricRow(
                label = "D · 日内认知负荷与恢复回补",
                value = "-%.1f / +%.1f 分".format(drivers.cognitiveLoadDrainScore, drivers.recoveryBufferBonusScore),
                detail = null,
            )
        }
    }
}

@Composable
private fun DriverMetricRow(
    label: String,
    value: String,
    detail: String?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            detail?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(
            text = value,
            style = MaterialTheme.typography.titleSmall.merge(TabularNumeralStyle),
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun HealthConnectCard(
    state: EnergyUiState,
    onRequestPermissions: () -> Unit,
    onOpenHealthSettings: () -> Unit,
    onSyncNow: () -> Unit,
) {
    val report = state.healthReport
    val sdkStatus = report?.sdkStatus ?: HealthConnectSdkStatus.UNAVAILABLE
    val missing = report?.missingPermissionLabels.orEmpty()

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Outlined.HealthAndSafety, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text("Health Connect 系统健康中枢", style = MaterialTheme.typography.titleMedium)
                }
                Text(
                    text = "队列待传 ${state.pendingQueueCount} 条",
                    style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                    color = MaterialTheme.colorScheme.secondary,
                )
            }

            if (sdkStatus != HealthConnectSdkStatus.AVAILABLE) {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = if (sdkStatus == HealthConnectSdkStatus.UPDATE_REQUIRED) "需要更新 Health Connect" else "Health Connect 不可用",
                    message = "可点击下方打开系统 Health Connect 设置，或使用 BLE 0x180D 心率直连 / 回放测试源。",
                    actionLabel = "打开设置",
                    onAction = onOpenHealthSettings,
                )
            } else if (missing.isNotEmpty()) {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "存在未授予的最小必要生理权限（已优雅降级）",
                    message = "缺失：${missing.joinToString("、")}。已授权项仍可正常同步，点击一键补全权限。",
                    actionLabel = "一键重授",
                    onAction = onRequestPermissions,
                )
            }

            state.syncMetadata.lastHealthSyncSummary?.let { summary ->
                Text(
                    text = "最近同步摘要：$summary",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onSyncNow,
                    enabled = !state.isSyncingHealth,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (state.isSyncingHealth) "增量同步中..." else "立即同步 15m/增量")
                }
                if (sdkStatus == HealthConnectSdkStatus.AVAILABLE) {
                    OutlinedButton(onClick = onRequestPermissions) {
                        Text("权限管理")
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BleHeartRateCard(
    bleState: BleConnectionState,
    onStartScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (String) -> Unit,
    onDisconnect: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    imageVector = if (bleState is BleConnectionState.Streaming) {
                        Icons.Outlined.BluetoothConnected
                    } else {
                        Icons.Outlined.Bluetooth
                    },
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                )
                Text("BLE GATT (0x180D / 0x2A37) 实时心率通道", style = MaterialTheme.typography.titleMedium)
            }

            when (bleState) {
                is BleConnectionState.Disconnected -> {
                    Text(
                        text = bleState.message ?: "未连接标准蓝牙心率带/手表；支持 60 秒滑窗去噪 RMSSD 计算并自动批量补传。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(onClick = onStartScan, modifier = Modifier.fillMaxWidth()) {
                        Text("扫描附近 0x180D 心率设备")
                    }
                }

                is BleConnectionState.Scanning -> {
                    Text(
                        text = "正在扫描广播 0x180D Heart Rate 服务的蓝牙设备...",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    bleState.devices.forEach { dev ->
                        Surface(
                            onClick = { onConnect(dev.address) },
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text(dev.name, style = MaterialTheme.typography.titleSmall)
                                    Text(dev.address, style = MaterialTheme.typography.labelSmall)
                                }
                                Text(
                                    text = "${dev.rssi} dBm · 连接",
                                    style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                    OutlinedButton(onClick = onStopScan, modifier = Modifier.fillMaxWidth()) {
                        Text("停止扫描")
                    }
                }

                is BleConnectionState.Connecting -> {
                    Text("正在连接 ${bleState.device.name} (${bleState.device.address})...", style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) {
                        Text("取消连接")
                    }
                }

                is BleConnectionState.Streaming -> {
                    Text(
                        text = "已连接：${bleState.device.name} · 实时采样中",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    HorizontalDivider()
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column {
                            Text("实时心率", style = MaterialTheme.typography.labelSmall)
                            Text(
                                text = bleState.hrBpm?.let { "$it bpm" } ?: "-- bpm",
                                style = MaterialTheme.typography.headlineSmall.merge(TabularNumeralStyle),
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("60s 窗口 RMSSD", style = MaterialTheme.typography.labelSmall)
                            Text(
                                text = bleState.latestRmssdMs?.let { "%.1f ms".format(it) } ?: "等待 ≥2 RR",
                                style = MaterialTheme.typography.headlineSmall.merge(TabularNumeralStyle),
                            )
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "有效 RR ${bleState.validRrCount}",
                            style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                        )
                        Text(
                            text = "剔除伪影 (>25% 跳变) ${bleState.rejectedRrCount}",
                            style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                        )
                        Text(
                            text = "已上报窗口 ${bleState.uploadedWindowsCount}",
                            style = MaterialTheme.typography.labelMedium.merge(TabularNumeralStyle),
                        )
                    }
                    OutlinedButton(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) {
                        Text("断开并冲刷当前窗口")
                    }
                }
            }
        }
    }
}
