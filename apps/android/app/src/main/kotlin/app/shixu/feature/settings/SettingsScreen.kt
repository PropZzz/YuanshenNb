package app.shixu.feature.settings

import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.shixu.core.network.generated.models.*
import app.shixu.core.ui.*

@Composable fun AuthenticationScreen(model: AccountViewModel) {
    var register by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    PageColumn {
        Spacer(Modifier.height(36.dp))
        PageHeading("SHIXU / TIME MAP", "让时间，\n顺应你的节律。", "连接个人精力与团队协作，从今天的时间地图开始。")
        SectionCard(if (register) "创建时序账号" else "欢迎回来") {
            if (register) FormField(name, { name = it }, "你的昵称")
            OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("邮箱") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("密码 · 至少 8 位") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            LoadingNotice(model.busy)
            ErrorNotice(model.error)
            if (model.error != null) TextButton(onClick = model::bootstrap, enabled = !model.busy) { Text("重试恢复已有会话") }
            Button(onClick = { model.authenticate(email, password, if (register) name else null) }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text(if (register) "创建账号并进入" else "登录工作台") }
            TextButton(onClick = { register = !register }, enabled = !model.busy) { Text(if (register) "已有账号？登录" else "首次使用？创建账号") }
        }
        Text("生理数据仅用于个人精力洞察。团队只接收你授权的脱敏状态。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable fun SettingsScreen(model: AccountViewModel) {
    val context = LocalContext.current
    var notificationsAllowed by remember { mutableStateOf(Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notificationsAllowed = it }
    val user = model.user ?: return
    var name by remember(user.updatedAt) { mutableStateOf(user.displayName) }
    var timezone by remember(user.updatedAt) { mutableStateOf(user.timezone) }
    var theme by remember(user.updatedAt) { mutableStateOf(user.themeMode) }
    val profile = model.profile
    var workStart by remember(profile) { mutableStateOf(minuteLabel(profile?.workStartMinute ?: 540)) }
    var workEnd by remember(profile) { mutableStateOf(minuteLabel(profile?.workEndMinute ?: 1080)) }
    var recovery by remember(profile) { mutableStateOf((profile?.minRecoveryBufferMin ?: 15).toString()) }
    var chronotype by remember(profile) { mutableStateOf(profile?.chronotype ?: Chronotype.balanced) }
    var validation by remember { mutableStateOf<String?>(null) }
    PageColumn {
        PageHeading("ACCOUNT & PRIVACY", "为自己设定边界", "工作、恢复与分享，都由你决定。")
        LoadingNotice(model.busy)
        ErrorNotice(validation ?: model.error)
        SectionCard("账户通行证") {
            Text(user.email, style = MaterialTheme.typography.bodyMedium)
            FormField(name, { name = it }, "显示名称")
            FormField(timezone, { timezone = it }, "IANA 时区，例如 Asia/Shanghai")
            ChoiceField("外观", theme, ThemeMode.entries, { when(it) { ThemeMode.system -> "跟随系统"; ThemeMode.light -> "瓷白"; ThemeMode.dark -> "深松绿" } }) { theme = it }
            Button(onClick = { model.updateAccount(name, timezone, theme) }, enabled = !model.busy) { Text("保存账户设置") }
        }
        SectionCard("工作节律") {
            if (profile == null) {
                Text("尚未读取节律配置")
                TextButton(onClick = model::bootstrap) { Text("重新读取") }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    FormField(workStart, { workStart = it }, "开始 HH:mm", Modifier.weight(1f))
                    FormField(workEnd, { workEnd = it }, "结束 HH:mm", Modifier.weight(1f))
                }
                ChoiceField("昼夜类型", chronotype, Chronotype.entries, { when(it) { Chronotype.balanced -> "均衡型"; Chronotype.morning_lark -> "晨间型"; Chronotype.night_owl -> "夜间型" } }) { chronotype = it }
                FormField(recovery, { recovery = it }, "最小恢复缓冲（分钟）")
                Button(onClick = {
                    runCatching {
                        val from = parseMinute(workStart); val to = parseMinute(workEnd)
                        require(from < to) { "工作结束时间必须晚于开始时间" }
                        model.updateEnergy(UpdateEnergyProfileRequest(chronotype, recovery.toLong(), profile.preferredFocusWindows, to, from))
                        validation = null
                    }.onFailure { validation = it.message ?: "请检查工作时段与分钟数" }
                }, enabled = !model.busy) { Text("保存节律偏好") }
                Text("精力曲线由服务端结合生理样本和日程统一计算。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        SectionCard("日程与精力提醒") {
            Text(if (notificationsAllowed) "系统通知已授权。提醒使用系统允许的非精确闹钟，可能受省电策略影响。" else "尚未授权系统通知；应用内仍会显示精力保护建议。")
            if (!notificationsAllowed && Build.VERSION.SDK_INT >= 33) OutlinedButton(onClick = { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("允许系统通知") }
        }
        OutlinedButton(onClick = model::logout, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("退出当前设备") }
    }
}
