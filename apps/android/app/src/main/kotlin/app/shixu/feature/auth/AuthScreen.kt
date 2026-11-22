package app.shixu.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.NetworkCheck
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.shixu.BuildConfig
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.StateBanner

@Composable
fun AuthScreen(
    sessionAlertMessage: String?,
    onDismissSessionAlert: () -> Unit,
    viewModel: AuthViewModel = activityHiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "时序智配 · Shixu V2",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = "穿戴精力护航 · 个人专注与团队黄金排会移动端",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (!sessionAlertMessage.isNullOrBlank()) {
                StateBanner(
                    tone = TagTone.warning,
                    icon = Icons.Outlined.WarningAmber,
                    title = "会话需要重新认证",
                    message = sessionAlertMessage,
                    actionLabel = "知道了",
                    onAction = onDismissSessionAlert,
                )
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = !state.isRegisterMode,
                            onClick = { viewModel.toggleMode(false) },
                            label = { Text("账号登录") },
                        )
                        FilterChip(
                            selected = state.isRegisterMode,
                            onClick = { viewModel.toggleMode(true) },
                            label = { Text("注册新账号") },
                        )
                    }

                    OutlinedTextField(
                        value = state.email,
                        onValueChange = viewModel::updateEmail,
                        label = { Text("工作邮箱") },
                        singleLine = true,
                        isError = state.emailError != null,
                        supportingText = state.emailError?.let { err -> { Text(err) } },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    if (state.isRegisterMode) {
                        OutlinedTextField(
                            value = state.displayName,
                            onValueChange = viewModel::updateDisplayName,
                            label = { Text("成员昵称") },
                            singleLine = true,
                            isError = state.displayNameError != null,
                            supportingText = state.displayNameError?.let { err -> { Text(err) } },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    OutlinedTextField(
                        value = state.password,
                        onValueChange = viewModel::updatePassword,
                        label = { Text("密码（至少 8 位）") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        isError = state.passwordError != null,
                        supportingText = state.passwordError?.let { err -> { Text(err) } },
                        leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    if (state.isRegisterMode) {
                        OutlinedTextField(
                            value = state.timezone,
                            onValueChange = viewModel::updateTimezone,
                            label = { Text("IANA 时区（用于本地昼夜节律）") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (!state.errorMessage.isNullOrBlank()) {
                        StateBanner(
                            tone = TagTone.warning,
                            icon = Icons.Outlined.WarningAmber,
                            title = "认证未完成",
                            message = state.errorMessage!!,
                        )
                    }

                    Button(
                        onClick = viewModel::submit,
                        enabled = !state.isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (state.isSubmitting) {
                            CircularProgressIndicator(
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                                modifier = Modifier.height(18.dp),
                            )
                        } else {
                            Text(if (state.isRegisterMode) "注册并开启穿戴同步" else "登录进入工作台")
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
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
                            Text("后端联调地址", style = MaterialTheme.typography.labelLarge)
                            Text(
                                text = BuildConfig.API_BASE_URL,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        OutlinedButton(
                            onClick = viewModel::probeHealth,
                            enabled = !state.isCheckingHealth,
                        ) {
                            Icon(Icons.Outlined.NetworkCheck, contentDescription = null)
                            Text(
                                text = if (state.isCheckingHealth) "探测中" else "健康探针",
                                modifier = Modifier.padding(start = 6.dp),
                            )
                        }
                    }
                    state.healthCheckMessage?.let { msg ->
                        Text(
                            text = msg,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    TextButton(
                        onClick = { viewModel.toggleMode(!state.isRegisterMode) },
                        modifier = Modifier.align(Alignment.End),
                    ) {
                        Text(if (state.isRegisterMode) "已有账号？去登录" else "没有账号？立即注册")
                    }
                }
            }
        }
    }
}
