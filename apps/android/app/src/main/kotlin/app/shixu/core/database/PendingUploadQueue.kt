package app.shixu.core.database

import app.shixu.core.network.*
import app.shixu.core.network.generated.models.*
import app.shixu.core.network.generated.apis.BiometricsApi
import kotlinx.serialization.encodeToString
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PendingUploadQueue @Inject constructor(private val pending: PendingDao, private val biometrics: BiometricsApi) {
    suspend fun enqueue(owner: String, samples: List<BiometricSampleDTO>) {
        pending.enqueue(samples.map { sample ->
            PendingBiometric("$owner:${sample.sourceType.value}:${sample.metricType.value}:${sample.externalId}", owner, ShixuJson.json.encodeToString(sample), System.currentTimeMillis())
        })
    }
    suspend fun drain(owner: String) {
        // Each request has <=500 samples. Stop at the first retryable failure and retain that batch.
        repeat(20) {
            val rows = pending.batch(owner)
            if (rows.isEmpty()) return
            val response = biometrics.ingestBiometricSamplesBatch(BiometricBatchRequest(rows.map { ShixuJson.json.decodeFromString<BiometricSampleDTO>(it.payload) }))
            when {
                response.isSuccessful -> pending.delete(rows.map { it.id })
                response.code() == 422 -> {
                    val problem = ProblemDetailParser.parse(response)
                    val invalid = if (problem?.code == ErrorCode.INVALID_BIOMETRIC_SAMPLE) QueuePolicy.invalidIndices(problem.errors.orEmpty().mapNotNull { it.location }, rows.size) else emptySet()
                    if (invalid.isEmpty()) throw ApiFailure(422, problem?.detail ?: "生理样本校验失败，队列已保留")
                    pending.delete(invalid.map { rows[it].id })
                }
                else -> response.requireBody()
            }
        }
    }
}
