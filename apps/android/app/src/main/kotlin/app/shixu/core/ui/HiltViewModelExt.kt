package app.shixu.core.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable
inline fun <reified VM : ViewModel> activityHiltViewModel(): VM {
    val activity = LocalContext.current.findComponentActivity()
        ?: error("activityHiltViewModel must be called inside a ComponentActivity")
    return viewModel(viewModelStoreOwner = activity)
}

fun Context.findComponentActivity(): ComponentActivity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is ComponentActivity) return current
        current = current.baseContext
    }
    return null
}
