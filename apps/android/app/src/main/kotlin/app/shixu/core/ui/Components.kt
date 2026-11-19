package app.shixu.core.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.shixu.core.network.generated.models.DataFreshness
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

fun <T : ViewModel> modelFactory(create: () -> T): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST") override fun <V : ViewModel> create(modelClass: Class<V>): V = create() as V
}

@Composable fun PageColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
}

@Composable fun SectionCard(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            content()
        }
    }
}

@Composable fun PageHeading(eyebrow: String, title: String, description: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(eyebrow.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
        Text(title, style = MaterialTheme.typography.headlineLarge, fontFamily = FontFamily.Serif)
        Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable fun ErrorNotice(message: String?, onRetry: (() -> Unit)? = null) {
    if (message == null) return
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = "错误", tint = MaterialTheme.colorScheme.error)
                Text(message, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f))
            }
            if (onRetry != null) TextButton(onClick = onRetry) { Text("重试") }
        }
    }
}

@Composable fun LoadingNotice(busy: Boolean) { if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()) }

@Composable fun EmptyNotice(title: String, text: String) = SectionCard(title) { Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant) }

@Composable fun FormField(value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, singleLine: Boolean = true) {
    OutlinedTextField(value, onValueChange, modifier.fillMaxWidth(), label = { Text(label) }, singleLine = singleLine, shape = RoundedCornerShape(14.dp))
}

@Composable fun <T> ChoiceField(label: String, value: T, options: List<T>, text: (T) -> String = { it.toString() }, onChange: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) { Text("$label · ${text(value)}") }
        DropdownMenu(expanded, { expanded = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(text(option)) }, onClick = { onChange(option); expanded = false }) }
        }
    }
}

fun sourceLabel(source: DataFreshness?): String = when (source) {
    DataFreshness.live_wearable -> "穿戴实时同步中"
    DataFreshness.recent_wearable -> "今日穿戴基线已加载"
    DataFreshness.replay_demo -> "回放测试源 · 仅供演示"
    DataFreshness.baseline_only -> "节律基线估算 · 未连接穿戴"
    null -> "穿戴来源尚未加载"
}

fun timeLabel(value: OffsetDateTime, zone: ZoneId = ZoneId.systemDefault()): String = value.atZoneSameInstant(zone).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"))
fun clockLabel(value: OffsetDateTime, zone: ZoneId = ZoneId.systemDefault()): String = value.atZoneSameInstant(zone).format(DateTimeFormatter.ofPattern("HH:mm"))
fun minuteLabel(value: Long): String = "%02d:%02d".format(value / 60, value % 60)
fun parseMinute(value: String): Long {
    val parsed = java.time.LocalTime.parse(value)
    return (parsed.hour * 60 + parsed.minute).toLong()
}
