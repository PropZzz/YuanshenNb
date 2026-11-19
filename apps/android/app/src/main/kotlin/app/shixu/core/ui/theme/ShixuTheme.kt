package app.shixu.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

private val BaseTypography = Typography()
private val ShixuTypography = BaseTypography.copy(
    displayLarge = BaseTypography.displayLarge.copy(fontFamily = FontFamily.Serif, fontFeatureSettings = "tnum"),
    displayMedium = BaseTypography.displayMedium.copy(fontFamily = FontFamily.Serif, fontFeatureSettings = "tnum"),
    headlineLarge = BaseTypography.headlineLarge.copy(fontFamily = FontFamily.Serif),
    headlineMedium = BaseTypography.headlineMedium.copy(fontFamily = FontFamily.Serif),
    headlineSmall = BaseTypography.headlineSmall.copy(fontFamily = FontFamily.Serif),
    labelMedium = BaseTypography.labelMedium.copy(fontFeatureSettings = "tnum"),
    labelSmall = BaseTypography.labelSmall.copy(fontFeatureSettings = "tnum"),
)

// 与 apps/web/src/styles/tokens.css 及 docs/06-design-system-v2.md 完全对齐的语义色板
private val ShixuLightColors = lightColorScheme(
    primary = Color(0xFF002727),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF163D3D),
    onPrimaryContainer = Color(0xFF81A8A7),
    secondary = Color(0xFF005DB5),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFF62A1FE),
    onSecondaryContainer = Color(0xFF00376F),
    tertiary = Color(0xFF00290A),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFF004114),
    onTertiaryContainer = Color(0xFF1DB84D),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    background = Color(0xFFFAF8FE),
    onBackground = Color(0xFF1A1B1F),
    surface = Color(0xFFFAF8FE),
    onSurface = Color(0xFF1A1B1F),
    surfaceVariant = Color(0xFFE3E2E7),
    onSurfaceVariant = Color(0xFF414848),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF4F3F8),
    surfaceContainer = Color(0xFFEFEDF3),
    surfaceContainerHigh = Color(0xFFE9E7ED),
    surfaceContainerHighest = Color(0xFFE3E2E7),
    outline = Color(0xFF717978),
    outlineVariant = Color(0xFFC0C8C7),
)

private val ShixuDarkColors = darkColorScheme(
    primary = Color(0xFFA7CECD),
    onPrimary = Color(0xFF002020),
    primaryContainer = Color(0xFF163D3D),
    onPrimaryContainer = Color(0xFFC2EAE9),
    secondary = Color(0xFF62A1FE),
    onSecondary = Color(0xFF001B3D),
    secondaryContainer = Color(0xFF00468B),
    onSecondaryContainer = Color(0xFFD6E3FF),
    tertiary = Color(0xFF53E16F),
    onTertiary = Color(0xFF002107),
    tertiaryContainer = Color(0xFF00531C),
    onTertiaryContainer = Color(0xFF72FE88),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF3D1E1B),
    onErrorContainer = Color(0xFFFFB4AB),
    background = Color(0xFF101B1D),
    onBackground = Color(0xFFE7F0ED),
    surface = Color(0xFF101B1D),
    onSurface = Color(0xFFE7F0ED),
    surfaceVariant = Color(0xFF263A3C),
    onSurfaceVariant = Color(0xFFB7C5C4),
    surfaceContainerLowest = Color(0xFF172426),
    surfaceContainerLow = Color(0xFF152426),
    surfaceContainer = Color(0xFF1C2B2E),
    surfaceContainerHigh = Color(0xFF263A3C),
    surfaceContainerHighest = Color(0xFF314749),
    outline = Color(0xFF8CA09E),
    outlineVariant = Color(0xFF38494A),
)

@Composable
fun ShixuTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) ShixuDarkColors else ShixuLightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = ShixuTypography,
        content = content,
    )
}
