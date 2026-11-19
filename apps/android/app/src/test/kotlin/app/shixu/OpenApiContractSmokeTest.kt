package app.shixu

import app.shixu.core.network.generated.infrastructure.Serializer
import app.shixu.core.network.generated.models.BiometricSampleDTO
import app.shixu.core.network.generated.models.EnergyComputeOutput
import app.shixu.core.network.generated.models.ProblemDetail
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class OpenApiContractSmokeTest {
    @Test
    fun problemDetailEnergyAndBiometricModelsDeserializeCleanly() {
        val problemJson = """
            {
              "type": "https://shixu.app/errors/CONFLICT_MEMBER_BUSY",
              "title": "Conflict",
              "status": 409,
              "detail": "成员已有锁定日程",
              "code": "CONFLICT_MEMBER_BUSY",
              "errors": [
                {
                  "location": "body.startAt",
                  "message": "conflict",
                  "value": "2026-11-19T06:00:00Z"
                }
              ]
            }
        """.trimIndent()

        val problem = Serializer.kotlinxSerializationJson.decodeFromString<ProblemDetail>(problemJson)
        assertEquals(ProblemDetail.Code.CONFLICT_MEMBER_BUSY, problem.code)
        assertEquals(409L, problem.status)
        assertEquals(1, problem.errors?.size)
        assertEquals("2026-11-19T06:00:00Z", problem.errors?.first()?.`value`?.jsonPrimitive?.content)

        val energyJson = """
            {
              "localDay": "2026-11-19",
              "timezone": "Asia/Shanghai",
              "computedAt": "2026-11-19T02:30:00Z",
              "score": 84,
              "tier": "peak",
              "dataFreshness": "baseline_only",
              "drivers": {
                "sleepRecoveryScore": 30.0,
                "autonomicDeltaScore": 0.0,
                "circadianScore": 26.0,
                "cognitiveLoadDrainScore": 0.0,
                "recoveryBufferBonusScore": 0.0,
                "summary": "未连接穿戴，当前为节律基线估算"
              },
              "hourlyCurve": [],
              "focusShields": [],
              "diagnostics": {
                "baselineReadyDays": 0
              }
            }
        """.trimIndent()

        val energy = Serializer.kotlinxSerializationJson.decodeFromString<EnergyComputeOutput>(energyJson)
        assertEquals(EnergyComputeOutput.Tier.peak, energy.tier)
        assertEquals(EnergyComputeOutput.DataFreshness.baseline_only, energy.dataFreshness)
        assertEquals(84L, energy.score)

        val sampleJson = """
            {
              "sourceType": "health_connect",
              "metricType": "sleep_stage",
              "recordedAt": "2026-11-19T01:00:00Z",
              "endAt": "2026-11-19T02:00:00Z",
              "numericValue": 60.0,
              "unit": "minutes",
              "externalId": "hc:sleep-1:stage:0:1795046400",
              "metadata": {
                "stage": "deep",
                "confidence": 0.95
              }
            }
        """.trimIndent()

        val sample = Serializer.kotlinxSerializationJson.decodeFromString<BiometricSampleDTO>(sampleJson)
        assertEquals(BiometricSampleDTO.SourceType.health_connect, sample.sourceType)
        assertEquals(BiometricSampleDTO.MetricType.sleep_stage, sample.metricType)
        assertNotNull(sample.metadata)
        assertEquals("deep", sample.metadata?.get("stage")?.jsonPrimitive?.content)
        assertEquals(0.95, sample.metadata?.get("confidence")?.jsonPrimitive?.double ?: 0.0, 0.001)
    }
}
