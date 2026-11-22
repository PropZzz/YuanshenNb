package app.shixu.core.health

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import kotlin.reflect.KClass

object HealthConnectPermissions {
    val HEART_RATE: String = HealthPermission.getReadPermission(HeartRateRecord::class)
    val HRV_RMSSD: String = HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class)
    val RESTING_HEART_RATE: String = HealthPermission.getReadPermission(RestingHeartRateRecord::class)
    val SLEEP: String = HealthPermission.getReadPermission(SleepSessionRecord::class)
    val ACTIVE_CALORIES: String = HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)

    val REQUIRED_PERMISSIONS: Set<String> = setOf(
        HEART_RATE,
        HRV_RMSSD,
        RESTING_HEART_RATE,
        SLEEP,
        ACTIVE_CALORIES,
    )

    val PERMISSION_TO_RECORD_TYPE: Map<String, KClass<out Record>> = mapOf(
        HEART_RATE to HeartRateRecord::class,
        HRV_RMSSD to HeartRateVariabilityRmssdRecord::class,
        RESTING_HEART_RATE to RestingHeartRateRecord::class,
        SLEEP to SleepSessionRecord::class,
        ACTIVE_CALORIES to ActiveCaloriesBurnedRecord::class,
    )

    val PERMISSION_LABELS: Map<String, String> = mapOf(
        HEART_RATE to "心率",
        HRV_RMSSD to "心率变异性 (HRV RMSSD)",
        RESTING_HEART_RATE to "静息心率",
        SLEEP to "睡眠分期",
        ACTIVE_CALORIES to "活动消耗热量",
    )

    fun missingPermissionLabels(granted: Set<String>): List<String> =
        REQUIRED_PERMISSIONS
            .filterNot { it in granted }
            .mapNotNull { PERMISSION_LABELS[it] }

    fun grantedRecordTypes(granted: Set<String>): Set<KClass<out Record>> =
        granted.mapNotNull { PERMISSION_TO_RECORD_TYPE[it] }.toSet()
}
