package app.shixu.app

import android.app.Application
import app.shixu.core.data.RealtimeSyncCoordinator
import app.shixu.core.network.ShixuJson
import app.shixu.core.notifications.NotificationChannels
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class ShixuApplication : Application() {

    @Inject
    lateinit var realtimeSyncCoordinator: RealtimeSyncCoordinator

    override fun onCreate() {
        super.onCreate()
        ShixuJson.install()
        NotificationChannels.ensureCreated(this)
        realtimeSyncCoordinator.startObserving()
    }
}
