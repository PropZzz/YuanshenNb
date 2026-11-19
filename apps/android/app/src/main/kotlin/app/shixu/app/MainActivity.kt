package app.shixu.app

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import app.shixu.core.ble.BleHeartRateManager
import app.shixu.core.database.ShixuDatabase
import app.shixu.core.database.TodaySnapshotStore
import app.shixu.core.health.HealthSync
import app.shixu.core.network.ClientServices
import app.shixu.core.network.RealtimeClient
import app.shixu.core.network.SessionEvents
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.ui.*
import app.shixu.core.ui.theme.ShixuTheme
import app.shixu.feature.energy.*
import app.shixu.feature.schedule.*
import app.shixu.feature.settings.*
import app.shixu.feature.team.*
import dagger.hilt.android.AndroidEntryPoint
import java.time.ZoneId
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var api: ClientServices
    @Inject lateinit var health: HealthSync
    @Inject lateinit var ble: BleHeartRateManager
    @Inject lateinit var database: ShixuDatabase
    @Inject lateinit var snapshots: TodaySnapshotStore
    @Inject lateinit var notifications: ScheduleNotifications
    @Inject lateinit var realtime: RealtimeClient
    @Inject lateinit var sessionEvents: SessionEvents
    private var requestedRoute by mutableStateOf<String?>(null)
    private val account by viewModels<AccountViewModel> { modelFactory { AccountViewModel(api) { user ->
        ble.setOwner(user?.id?.toString())
        realtime.start(user)
        if (user != null) { HealthSync.schedule(applicationContext); HealthSync.syncNow(applicationContext) }
    } } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestedRoute = intent?.getStringExtra("destination")
        setContent { ShixuRootApp(account, api, health, ble, database, snapshots, notifications, realtime, sessionEvents, requestedRoute) { requestedRoute = null } }
    }
    override fun onStart() { super.onStart(); if (::api.isInitialized && api.tokens.refreshToken() != null) HealthSync.syncNow(applicationContext) }
    override fun onStop() { if (::ble.isInitialized) ble.disconnect(); super.onStop() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); requestedRoute = intent.getStringExtra("destination") }
}

@Composable fun ShixuRootApp(account: AccountViewModel, api: ClientServices, health: HealthSync, ble: BleHeartRateManager, database: ShixuDatabase, snapshots: TodaySnapshotStore, notifications: ScheduleNotifications, realtime: RealtimeClient, sessionEvents: SessionEvents, requestedRoute: String?, routeHandled: () -> Unit) {
    LaunchedEffect(sessionEvents) { sessionEvents.expirations.collect { account.forgetLocalSession() } }
    val dark = when (account.user?.themeMode ?: ThemeMode.system) { ThemeMode.dark -> true; ThemeMode.light -> false; ThemeMode.system -> isSystemInDarkTheme() }
    ShixuTheme(darkTheme = dark) {
        Surface(Modifier.fillMaxSize()) {
            when {
                !account.bootstrapped -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center) { Text("正在恢复你的时间地图…"); LoadingNotice(true) }
                account.user == null -> AuthenticationScreen(account)
                else -> WorkspaceScaffold(account, api, health, ble, database, snapshots, notifications, realtime, requestedRoute, routeHandled)
            }
        }
    }
}

private val destinations = listOf("focus" to "专注", "calendar" to "日历", "team" to "团队", "energy" to "精力", "settings" to "设置")

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun WorkspaceScaffold(account: AccountViewModel, api: ClientServices, health: HealthSync, ble: BleHeartRateManager, database: ShixuDatabase, snapshots: TodaySnapshotStore, notifications: ScheduleNotifications, realtime: RealtimeClient, requestedRoute: String?, routeHandled: () -> Unit) {
    val user = account.user ?: return
    val zone = remember(user.timezone) { runCatching { ZoneId.of(user.timezone) }.getOrDefault(ZoneId.systemDefault()) }
    val schedule: ScheduleViewModel = viewModel(key = "schedule-${user.id}-${user.timezone}", factory = modelFactory { ScheduleViewModel(api, zone, user.id.toString(), snapshots, notifications) })
    val energy: EnergyViewModel = viewModel(key = "energy-${user.id}", factory = modelFactory { EnergyViewModel(api, health) })
    val team: TeamViewModel = viewModel(key = "team-${user.id}-${user.timezone}", factory = modelFactory { TeamViewModel(api, zone, user.id) })
    val pending by remember(user.id) { database.pending().count(user.id.toString()) }.collectAsStateWithLifecycle(initialValue = 0)
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route ?: "focus"
    var openRescue by remember { mutableStateOf(false) }
    val realtimeStatus by realtime.status.collectAsStateWithLifecycle()
    LaunchedEffect(requestedRoute) {
        requestedRoute?.let { requested ->
            openRescue = requested == "rescue"
            nav.navigate(if (requested == "rescue") "calendar" else requested.takeIf { path -> destinations.any { it.first == path } } ?: "focus") { launchSingleTop = true }
            routeHandled()
        }
    }
    LaunchedEffect(realtime, user.id) {
        realtime.updates.collect { update ->
            if (update.energy) energy.load()
            if (update.schedule) schedule.load()
            if (update.team) team.load()
        }
    }
    LaunchedEffect(route) {
        when (route) { "focus" -> { val today = java.time.LocalDate.now(zone); if (schedule.day != today) schedule.selectDay(today) else schedule.load() }; "calendar" -> schedule.load(); "energy" -> energy.load(); "team" -> team.load() }
    }
    Scaffold(
        topBar = {
            TopAppBar(title = {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("时序智配", fontFamily = FontFamily.Serif, style = MaterialTheme.typography.titleLarge)
                    Text(sourceLabel(energy.energy?.dataFreshness), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }, actions = {
                Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.padding(end = 16.dp)) {
                    Text("${energy.energy?.score ?: "—"} · $realtimeStatus", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.labelMedium)
                }
            })
        },
        bottomBar = {
            NavigationBar {
                destinations.forEach { (path, label) -> NavigationBarItem(selected = route == path, onClick = { nav.navigate(path) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true } }, icon = { Icon(when (path) { "focus" -> Icons.Outlined.Timer; "calendar" -> Icons.Outlined.CalendarMonth; "team" -> Icons.Outlined.Groups; "energy" -> Icons.Outlined.FavoriteBorder; else -> Icons.Outlined.Settings }, contentDescription = label) }, label = { Text(label) }) }
            }
        },
    ) { padding ->
        NavHost(navController = nav, startDestination = "focus", modifier = Modifier.fillMaxSize().padding(padding)) {
            composable("focus") { FocusScreen(schedule) }
            composable("calendar") { ScheduleScreen(schedule, openRescue) { openRescue = false } }
            composable("team") { TeamScreen(team) }
            composable("energy") { EnergyScreen(energy, ble, pending) }
            composable("settings") { SettingsScreen(account) }
        }
    }
}
