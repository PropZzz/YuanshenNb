package app.shixu.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.shixu.BuildConfig
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.ui.theme.ShixuTheme
import dagger.hilt.android.AndroidEntryPoint

private data class ShixuDestination(
    val route: String,
    val displayPath: String,
    val label: String,
    val icon: ImageVector,
    val summary: String,
)

private val DESTINATIONS = listOf(
    ShixuDestination("focus", "/focus", "专注", Icons.Outlined.Timer, "今日专注与实时精力保护状态入口"),
    ShixuDestination("calendar", "/calendar", "日历", Icons.Outlined.CalendarMonth, "今日日程时间轴与突发救援确认入口"),
    ShixuDestination("team", "/team", "团队", Icons.Outlined.Groups, "团队会议邀请回执与轻量排会入口"),
    ShixuDestination("energy", "/energy", "精力", Icons.Outlined.FavoriteBorder, "Health Connect / BLE 0x180D 采集与回放控制"),
    ShixuDestination("settings", "/settings", "设置", Icons.Outlined.Settings, "账号认证、隐私等级与同步诊断"),
)

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ShixuRootApp()
        }
    }
}

@Composable
fun ShixuRootApp(themeMode: ThemeMode = ThemeMode.system) {
    val darkTheme = when (themeMode) {
        ThemeMode.dark -> true
        ThemeMode.light -> false
        ThemeMode.system -> isSystemInDarkTheme()
    }
    ShixuTheme(darkTheme = darkTheme) {
        ShixuRootScaffold()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShixuRootScaffold() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route ?: DESTINATIONS.first().route

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("时序智配 V2") },
                actions = {
                    AssistChip(
                        onClick = {},
                        label = { Text("baseline_only · 未连接穿戴") },
                        modifier = Modifier.padding(end = 12.dp),
                    )
                },
            )
        },
        bottomBar = {
            NavigationBar {
                DESTINATIONS.forEach { item ->
                    NavigationBarItem(
                        selected = currentRoute == item.route,
                        onClick = {
                            navController.navigate(item.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = DESTINATIONS.first().route,
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
        ) {
            DESTINATIONS.forEach { dest ->
                composable(dest.route) {
                    DestinationStarterCard(dest)
                }
            }
        }
    }
}

@Composable
private fun DestinationStarterCard(destination: ShixuDestination) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
            ),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "${destination.displayPath} · ${destination.label}",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = destination.summary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "API Base: ${BuildConfig.API_BASE_URL}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}
