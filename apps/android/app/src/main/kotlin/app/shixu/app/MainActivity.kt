package app.shixu.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryAlert
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.shixu.core.data.AppSessionState
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.RescueTriggerReason
import app.shixu.core.network.generated.models.TagTone
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.network.generated.models.WsEnergyOverloadAlertPayload
import app.shixu.core.notifications.ShixuNotificationHelper
import app.shixu.core.ui.activityHiltViewModel
import app.shixu.core.ui.components.DataFreshnessChip
import app.shixu.core.ui.components.StateBanner
import app.shixu.core.ui.theme.ShixuTheme
import app.shixu.feature.auth.AuthScreen
import app.shixu.feature.energy.EnergyScreen
import app.shixu.feature.focus.FocusScreen
import app.shixu.feature.schedule.CalendarScreen
import app.shixu.feature.schedule.ScheduleViewModel
import app.shixu.feature.team.TeamScreen
import app.shixu.feature.settings.SettingsScreen
import dagger.hilt.android.AndroidEntryPoint

private data class ShixuDestination(
    val route: String,
    val label: String,
    val icon: ImageVector,
)

private val DESTINATIONS = listOf(
    ShixuDestination("focus", "专注", Icons.Outlined.Timer),
    ShixuDestination("calendar", "日历", Icons.Outlined.CalendarMonth),
    ShixuDestination("team", "团队", Icons.Outlined.Groups),
    ShixuDestination("energy", "精力", Icons.Outlined.FavoriteBorder),
    ShixuDestination("settings", "设置", Icons.Outlined.Settings),
)

private data class DeepLinkRequest(
    val route: String,
    val openRescue: Boolean = false,
    val rescueReason: RescueTriggerReason? = null,
)

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private var pendingDeepLink by mutableStateOf<DeepLinkRequest?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        consumeIntent(intent)
        setContent {
            ShixuRootApp(
                pendingDeepLink = pendingDeepLink,
                onDeepLinkConsumed = { pendingDeepLink = null },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeIntent(intent)
    }

    private fun consumeIntent(intent: Intent?) {
        val route = intent?.getStringExtra(ShixuNotificationHelper.EXTRA_NAV_ROUTE) ?: return
        val openRescue = intent.getBooleanExtra(ShixuNotificationHelper.EXTRA_OPEN_RESCUE, false)
        val reasonRaw = intent.getStringExtra(ShixuNotificationHelper.EXTRA_RESCUE_REASON)
        val reason = reasonRaw?.let { RescueTriggerReason.decode(it) }
        pendingDeepLink = DeepLinkRequest(
            route = route,
            openRescue = openRescue,
            rescueReason = reason,
        )
    }
}

@Composable
private fun ShixuRootApp(
    pendingDeepLink: DeepLinkRequest?,
    onDeepLinkConsumed: () -> Unit,
    sessionViewModel: AppSessionViewModel = activityHiltViewModel(),
) {
    val rootState by sessionViewModel.uiState.collectAsStateWithLifecycle()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) {
                sessionViewModel.onAppForegrounded()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    val themeMode = (rootState.session as? AppSessionState.Authenticated)?.user?.themeMode ?: ThemeMode.system
    val darkTheme = when (themeMode) {
        ThemeMode.dark -> true
        ThemeMode.light -> false
        ThemeMode.system -> isSystemInDarkTheme()
    }

    ShixuTheme(darkTheme = darkTheme) {
        when (val session = rootState.session) {
            AppSessionState.Bootstrapping -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CircularProgressIndicator()
                        Text("正在恢复安全会话与离线快照...", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            is AppSessionState.Unauthenticated -> {
                AuthScreen(
                    sessionAlertMessage = session.alertMessage,
                    onDismissSessionAlert = sessionViewModel::dismissSessionAlert,
                )
            }

            is AppSessionState.Authenticated -> {
                ShixuMainScaffold(
                    todayEnergy = rootState.todayEnergy,
                    isOfflineEnergy = rootState.isOfflineEnergy,
                    overloadBanner = rootState.overloadBanner,
                    pendingDeepLink = pendingDeepLink,
                    onDeepLinkConsumed = onDeepLinkConsumed,
                    onDismissOverloadBanner = sessionViewModel::dismissOverloadBanner,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShixuMainScaffold(
    todayEnergy: EnergyTodayResponse?,
    isOfflineEnergy: Boolean,
    overloadBanner: WsEnergyOverloadAlertPayload?,
    pendingDeepLink: DeepLinkRequest?,
    onDeepLinkConsumed: () -> Unit,
    onDismissOverloadBanner: () -> Unit,
    scheduleViewModel: ScheduleViewModel = activityHiltViewModel(),
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route ?: DESTINATIONS.first().route

    fun navigateToTab(route: String) {
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id) {
                saveState = true
            }
            launchSingleTop = true
            restoreState = true
        }
    }

    LaunchedEffect(pendingDeepLink) {
        val dl = pendingDeepLink ?: return@LaunchedEffect
        if (DESTINATIONS.any { it.route == dl.route }) {
            navigateToTab(dl.route)
        }
        if (dl.openRescue) {
            scheduleViewModel.openRescueSheet(dl.rescueReason ?: RescueTriggerReason.wearable_fatigue)
        }
        onDeepLinkConsumed()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("时序智配 V2") },
                actions = {
                    DataFreshnessChip(
                        freshness = todayEnergy?.dataFreshness,
                        isOffline = isOfflineEnergy,
                        compact = true,
                        onClick = { navigateToTab("energy") },
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
                        onClick = { navigateToTab(item.route) },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            overloadBanner?.let { alert ->
                Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                    StateBanner(
                        tone = TagTone.warning,
                        icon = Icons.Outlined.BatteryAlert,
                        title = "实时过载保护预警（${alert.currentScore} 分）",
                        message = alert.message,
                        actionLabel = "去救援",
                        onAction = {
                            onDismissOverloadBanner()
                            navigateToTab("calendar")
                            scheduleViewModel.openRescueSheet(alert.triggerReason)
                        },
                    )
                }
            }

            NavHost(
                navController = navController,
                startDestination = DESTINATIONS.first().route,
                modifier = Modifier.weight(1f),
            ) {
                composable("focus") {
                    FocusScreen(
                        onOpenEnergy = { navigateToTab("energy") },
                        onOpenCalendar = { navigateToTab("calendar") },
                        onOpenRescueFromOverload = {
                            val reason = todayEnergy?.overloadAlert?.triggerReason ?: RescueTriggerReason.wearable_fatigue
                            navigateToTab("calendar")
                            scheduleViewModel.openRescueSheet(reason)
                        },
                    )
                }
                composable("calendar") {
                    CalendarScreen()
                }
                composable("team") {
                    TeamScreen()
                }
                composable("energy") {
                    EnergyScreen()
                }
                composable("settings") {
                    SettingsScreen()
                }
            }
        }
    }
}
