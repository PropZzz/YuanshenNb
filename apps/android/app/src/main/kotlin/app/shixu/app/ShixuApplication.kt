package app.shixu.app

import android.app.Application
import app.shixu.core.network.ShixuJson
import app.shixu.core.ui.ScheduleNotifications
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ShixuApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ShixuJson.install()
        ScheduleNotifications.createChannel(this)
    }
}
