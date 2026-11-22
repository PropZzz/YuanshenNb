package app.shixu.feature.settings

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
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.BuildConfig
import app.shixu.core.network.WsConnectionState
import app.shixu.core.network.generated.models.Chronotype
import app.shixu.core.network.generated.models.PrivacyLevel
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.ShixuFormatters
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.TabularNumeralStyle

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel = activityHiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val draft = state.draft

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
                    Text("账号与隐私配置", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        text = state.user?.email ?: "未登录",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = viewModel::refreshAllSettings) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新配置")
                }
            }
        }

        draft.feedbackMessage?.let { msg ->
            item {
                StateBanner(
                    tone = TagTone.positive,
                    icon = Icons.Outlined.CheckCircleOutline,
                    title = "保存成功",
                    message = msg,
                    actionLabel = "关闭",
                    onAction = viewModel::clearMessages,
                )
            }
        }

        draft.errorMessage?.let { err ->
            item {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "设置校验提示",
                    message = err,
                    actionLabel = "关闭",
                    onAction = viewModel::clearMessages,
                )
            }
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("账号档案与外观主题", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(
                        value = draft.displayName,
                        onValueChange = { txt -> viewModel.updateDraft { it.copy(displayName = txt) } },
                        label = { Text("显示昵称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = draft.timezone,
                        onValueChange = { txt -> viewModel.updateDraft { it.copy(timezone = txt) } },
                        label = { Text("IANA 时区（如 Asia/Shanghai）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text("主题模式（双端同步）", style = MaterialTheme.typography.labelLarge)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            ThemeMode.system to "跟随系统",
                            ThemeMode.light to "浅色瓷白",
                            ThemeMode.dark to "深色护眼",
                        ).forEach { (mode, label) ->
                            FilterChip(
                                selected = draft.themeMode == mode,
                                onClick = { viewModel.selectThemeMode(mode) },
                                label = { Text(label) },
                            )
                        }
                    }
                    Button(
                        onClick = viewModel::saveUserProfile,
                        enabled = !draft.isSavingProfile,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (draft.isSavingProfile) "保存中..." else "保存档案与时区")
                    }
                }
            }
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("昼夜节律与个人工作窗", style = MaterialTheme.typography.titleMedium)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "工作开始：${ShixuFormatters.formatMinuteOfDay(draft.workStartMinute)}",
                            style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(
                                onClick = {
                                    viewModel.updateDraft {
                                        it.copy(workStartMinute = (it.workStartMinute - 30L).coerceAtLeast(0L))
                                    }
                                },
                            ) { Text("-30m") }
                            OutlinedButton(
                                onClick = {
                                    viewModel.updateDraft {
                                        it.copy(workStartMinute = (it.workStartMinute + 30L).coerceAtMost(1410L))
                                    }
                                },
                            ) { Text("+30m") }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "工作结束：${ShixuFormatters.formatMinuteOfDay(draft.workEndMinute)}",
                            style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(
                                onClick = {
                                    viewModel.updateDraft {
                                        it.copy(workEndMinute = (it.workEndMinute - 30L).coerceAtLeast(60L))
                                    }
                                },
                            ) { Text("-30m") }
                            OutlinedButton(
                                onClick = {
                                    viewModel.updateDraft {
                                        it.copy(workEndMinute = (it.workEndMinute + 30L).coerceAtMost(1440L))
                                    }
                                },
                            ) { Text("+30m") }
                        }
                    }

                    Text("节律类型 (Chronotype)", style = MaterialTheme.typography.labelLarge)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chronotype.entries.forEach { ct ->
                            FilterChip(
                                selected = draft.chronotype == ct,
                                onClick = { viewModel.updateDraft { it.copy(chronotype = ct) } },
                                label = { Text(ShixuFormatters.chronotypeLabel(ct)) },
                            )
                        }
                    }

                    Text("高负荷后最少恢复缓冲 (分钟)", style = MaterialTheme.typography.labelLarge)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(10L, 15L, 20L, 30L, 45L).forEach { buf ->
                            FilterChip(
                                selected = draft.minRecoveryBufferMin == buf,
                                onClick = { viewModel.updateDraft { it.copy(minRecoveryBufferMin = buf) } },
                                label = { Text("${buf}m") },
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("偏好心流窗口 (${draft.preferredFocusWindows.size})", style = MaterialTheme.typography.labelLarge)
                        TextButton(onClick = viewModel::addDefaultFocusWindow) {
                            Icon(Icons.Outlined.Add, contentDescription = null)
                            Text("添加 09:00-12:00")
                        }
                    }

                    draft.preferredFocusWindows.forEachIndexed { idx, win ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "${ShixuFormatters.formatMinuteOfDay(win.startMinute)} ~ ${
                                    ShixuFormatters.formatMinuteOfDay(win.endMinute)
                                }",
                                style = MaterialTheme.typography.bodyMedium.merge(TabularNumeralStyle),
                            )
                            IconButton(onClick = { viewModel.removeFocusWindowAt(idx) }) {
                                Icon(Icons.Outlined.DeleteOutline, contentDescription = "移除心流窗")
                            }
                        }
                    }

                    state.energyProfile?.let { ep ->
                        Text(
                            text = "14 日个人基线（仅本人可见）：HRV ${
                                ep.hrvBaselineMs?.let { "%.1f ms".format(it) } ?: "未就绪"
                            } · RHR ${ep.rhrBaselineBpm?.let { "%.0f bpm".format(it) } ?: "未就绪"}",
                            style = MaterialTheme.typography.labelSmall.merge(TabularNumeralStyle),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Button(
                        onClick = viewModel::saveEnergyProfile,
                        enabled = !draft.isSavingEnergyProfile,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (draft.isSavingEnergyProfile) "更新节律模型中..." else "保存节律配置并重算当日精力")
                    }
                }
            }
        }

        if (state.workspaces.isNotEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("团队隐私脱敏颗粒度开关", style = MaterialTheme.typography.titleMedium)
                        state.workspaces.forEach { ws ->
                            HorizontalDivider()
                            Text(ws.name, style = MaterialTheme.typography.titleSmall)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                PrivacyLevel.entries.forEach { level ->
                                    FilterChip(
                                        selected = ws.myPrivacyLevel == level,
                                        onClick = { viewModel.updateWorkspacePrivacy(ws.id, level) },
                                        label = { Text(ShixuFormatters.privacyLevelLabel(level)) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("同步诊断与离线队列", style = MaterialTheme.typography.titleMedium)
                    Text("API Base: ${BuildConfig.API_BASE_URL}", style = MaterialTheme.typography.bodySmall)
                    val wsLabel = when (state.wsState) {
                        WsConnectionState.Connected -> "WebSocket 已连接"
                        WsConnectionState.Connecting -> "WebSocket 握手中"
                        is WsConnectionState.Reconnecting -> "WebSocket 指数退避重连中 (#${(state.wsState as WsConnectionState.Reconnecting).attempt})"
                        WsConnectionState.Disconnected -> "WebSocket 已断开"
                    }
                    Text("实时通道：$wsLabel", style = MaterialTheme.typography.bodySmall)
                    Text(
                        text = "Room 待补传生理队列：${state.pendingQueueCount} 条",
                        style = MaterialTheme.typography.bodySmall.merge(TabularNumeralStyle),
                    )
                    state.syncMetadata.lastHealthSyncSummary?.let { summary ->
                        Text("穿戴同步：$summary", style = MaterialTheme.typography.bodySmall)
                    }
                    draft.healthProbeResult?.let { probe ->
                        Text("健康探针：$probe", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = viewModel::probeHealth, modifier = Modifier.weight(1f)) {
                            Text("测试 /health")
                        }
                        OutlinedButton(
                            onClick = viewModel::flushPendingBiometrics,
                            enabled = !draft.isFlushingQueue,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(if (draft.isFlushingQueue) "补传中..." else "立即补传队列")
                        }
                    }
                }
            }
        }

        item {
            OutlinedButton(
                onClick = viewModel::logout,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null)
                Text("退出当前账号并清空本地密钥", modifier = Modifier.padding(start = 8.dp))
            }
        }

        item { Box(modifier = Modifier.height(16.dp)) }
    }
}
