package app.shixu.core.health

import app.shixu.core.database.PendingBiometricEntity
import java.time.Instant

enum class HealthConnectSdkStatus {
    AVAILABLE,
    UPDATE_REQUIRED,
    UNAVAILABLE,
}

sealed interface HealthChangesResult {
    data class Success(
        val samples: List<PendingBiometricEntity>,
        val nextToken: String,
    ) : HealthChangesResult

    data object TokenExpired : HealthChangesResult
}

/**
 * Health Connect 系统读写网关抽象，屏蔽 Android Context 与系统提供方差异以便单测验证同步状态机。
 */
interface HealthConnectGateway {
    fun sdkStatus(): HealthConnectSdkStatus
    suspend fun getGrantedPermissions(): Set<String>
    suspend fun readRecordsInRange(
        start: Instant,
        end: Instant,
        grantedPermissions: Set<String>,
    ): List<PendingBiometricEntity>

    suspend fun getChangesToken(grantedPermissions: Set<String>): String?
    suspend fun getChanges(token: String, grantedPermissions: Set<String>): HealthChangesResult
}
