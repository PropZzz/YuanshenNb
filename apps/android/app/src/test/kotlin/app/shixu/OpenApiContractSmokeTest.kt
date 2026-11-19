package app.shixu

import app.shixu.core.network.InMemoryTokenStore
import app.shixu.core.network.ProblemDetailParser
import app.shixu.core.network.ShixuJson
import app.shixu.core.network.TokenAuthenticator
import app.shixu.core.network.WsEvent
import app.shixu.core.network.WsEventParser
import app.shixu.core.network.generated.models.AuthTokensResponse
import app.shixu.core.network.generated.models.BiometricSampleDTO
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.DataFreshness
import app.shixu.core.network.generated.models.EnergyTier
import app.shixu.core.network.generated.models.EnergyTodayResponse
import app.shixu.core.network.generated.models.ErrorCode
import app.shixu.core.network.generated.models.LoginRequest
import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.ProblemDetail
import app.shixu.core.network.generated.models.SleepStage
import app.shixu.core.network.generated.models.SourceType
import app.shixu.core.network.generated.models.ThemeMode
import app.shixu.core.network.generated.models.UpdateScheduleItemRequest
import app.shixu.core.network.generated.models.UserProfile
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.OffsetDateTime
import java.util.UUID

class OpenApiContractSmokeTest {
    @Test
    fun transientRefreshFailurePreservesPersistentSessionForOfflineRetry() {
        val store = InMemoryTokenStore().apply { saveTokens("expired", "still-valid") }
        val authenticator = TokenAuthenticator(store) { throw java.io.IOException("offline") }
        val response = Response.Builder().request(Request.Builder().url("http://localhost/api/v1/auth/me").header("Authorization", "Bearer expired").build())
            .protocol(Protocol.HTTP_1_1).code(401).message("Unauthorized")
            .body("""{"type":"https://shixu.app/errors/UNAUTHORIZED","title":"Unauthorized","status":401,"detail":"expired","code":"UNAUTHORIZED"}""".toResponseBody("application/problem+json".toMediaType())).build()
        assertNull(authenticator.authenticate(null, response))
        assertEquals("still-valid", store.refreshToken())
    }
    @Before
    fun setupJson() {
        ShixuJson.install()
    }

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

        val problem = ShixuJson.json.decodeFromString<ProblemDetail>(problemJson)
        assertEquals(ErrorCode.CONFLICT_MEMBER_BUSY, problem.code)
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

        val energy = ShixuJson.json.decodeFromString<EnergyTodayResponse>(energyJson)
        assertEquals(EnergyTier.peak, energy.tier)
        assertEquals(DataFreshness.baseline_only, energy.dataFreshness)
        assertEquals(84L, energy.score)
        assertTrue(energy.hourlyCurve.isEmpty())
        assertTrue(energy.focusShields.isEmpty())

        val sampleJson = """
            {
              "sourceType": "health_connect",
              "metricType": "sleep_stage",
              "recordedAt": "2026-11-19T01:00:00Z",
              "endAt": "2026-11-19T02:00:00Z",
              "numericValue": 60.0,
              "unit": "minutes",
              "sleepStage": "deep",
              "externalId": "hc:sleep-1:stage:0:1795046400",
              "metadata": {
                "stage": "deep",
                "confidence": 0.95
              }
            }
        """.trimIndent()

        val sample = ShixuJson.json.decodeFromString<BiometricSampleDTO>(sampleJson)
        assertEquals(SourceType.health_connect, sample.sourceType)
        assertEquals(MetricType.sleep_stage, sample.metricType)
        assertEquals(SleepStage.deep, sample.sleepStage)
        assertNotNull(sample.metadata)
        assertEquals("deep", sample.metadata?.get("stage")?.jsonPrimitive?.content)
        assertEquals(0.95, sample.metadata?.get("confidence")?.jsonPrimitive?.double ?: 0.0, 0.001)
    }

    @Test
    fun requestSerializationOmitsNullsAndSchemaField() {
        val loginRaw = ShixuJson.json.encodeToString(
            LoginRequest(
                email = "dev@shixu.app",
                password = "password123",
            )
        )
        assertFalse("LoginRequest must not serialize \$schema: $loginRaw", loginRaw.contains("\$schema"))
        assertFalse("LoginRequest must not serialize null fields: $loginRaw", loginRaw.contains(":null"))
        val loginObj = ShixuJson.json.parseToJsonElement(loginRaw).jsonObject
        assertEquals(setOf("email", "password"), loginObj.keys)

        val patchTitleRaw = ShixuJson.json.encodeToString(
            UpdateScheduleItemRequest(
                title = "深度开发",
                cognitiveLoad = CognitiveLoad.high,
            )
        )
        assertFalse("PATCH must not serialize \$schema: $patchTitleRaw", patchTitleRaw.contains("\$schema"))
        assertFalse("PATCH must not serialize null fields: $patchTitleRaw", patchTitleRaw.contains(":null"))
        val patchObj = ShixuJson.json.parseToJsonElement(patchTitleRaw).jsonObject
        assertEquals(setOf("title", "cognitiveLoad"), patchObj.keys)

        val clearDeadlineRaw = ShixuJson.json.encodeToString(
            UpdateScheduleItemRequest(clearDeadline = true)
        )
        val clearObj = ShixuJson.json.parseToJsonElement(clearDeadlineRaw).jsonObject
        assertEquals(setOf("clearDeadline"), clearObj.keys)
        assertEquals("true", clearObj["clearDeadline"]?.jsonPrimitive?.content)
    }

    @Test
    fun wsEventParserAndProblemDetailParserHandleValidAndInvalidInputs() {
        val scheduleEventRaw = """
            {
              "version": 1,
              "eventId": "01933e6a-8c3b-7000-8000-000000000002",
              "type": "schedule.updated",
              "occurredAt": "2026-11-19T03:00:00Z",
              "payload": {
                "userId": "11111111-1111-1111-1111-111111111111",
                "baselineLocalDay": "2026-11-19",
                "baselineVersion": "9a8b7c6d5e4f3a2b",
                "reason": "rescue_applied",
                "affectedFrom": "2026-11-18T16:00:00Z",
                "affectedTo": "2026-11-20T16:00:00Z",
                "itemIds": ["550e8400-e29b-41d4-a716-446655440000"]
              }
            }
        """.trimIndent()

        val parsed = WsEventParser.parse(scheduleEventRaw)
        assertTrue(parsed is WsEvent.ScheduleUpdated)
        val scheduleEvent = parsed as WsEvent.ScheduleUpdated
        assertEquals(1L, scheduleEvent.version)
        assertEquals("9a8b7c6d5e4f3a2b", scheduleEvent.payload.baselineVersion)
        assertEquals(1, scheduleEvent.payload.itemIds.size)

        assertNull(WsEventParser.parse("invalid json"))
        assertNull(
            WsEventParser.parse(
                """{"version":0,"eventId":"01933e6a-8c3b-7000-8000-000000000002","type":"energy.updated","occurredAt":"2026-11-19T03:00:00Z","payload":{}}"""
            )
        )

        val problem = ProblemDetailParser.parseRaw(
            """{"type":"https://shixu.app/errors/UNAUTHORIZED","title":"Unauthorized","status":401,"detail":"expired","code":"UNAUTHORIZED"}"""
        )
        assertEquals(ErrorCode.UNAUTHORIZED, problem?.code)
        assertNull(ProblemDetailParser.parseRaw("not-json"))
    }

    @Test
    fun tokenAuthenticatorRefreshesOnceAndClearsOnFailure() {
        val store = InMemoryTokenStore().apply {
            saveTokens("expired-access", "valid-refresh")
        }
        val authenticator = TokenAuthenticator(store) { refreshTok ->
            assertEquals("valid-refresh", refreshTok)
            AuthTokensResponse(
                accessToken = "new-access",
                expiresInSeconds = 900L,
                refreshToken = "new-refresh",
                user = UserProfile(
                    createdAt = OffsetDateTime.parse("2026-11-19T00:00:00Z"),
                    displayName = "测试",
                    email = "dev@shixu.app",
                    id = UUID.fromString("11111111-1111-1111-1111-111111111111"),
                    themeMode = ThemeMode.dark,
                    timezone = "Asia/Shanghai",
                    updatedAt = OffsetDateTime.parse("2026-11-19T00:00:00Z"),
                ),
            )
        }

        val req = Request.Builder()
            .url("http://localhost:8080/api/v1/auth/me")
            .header("Authorization", "Bearer expired-access")
            .build()
        val unauthResp = Response.Builder()
            .request(req)
            .protocol(Protocol.HTTP_1_1)
            .code(401)
            .message("Unauthorized")
            .body(
                """{"type":"https://shixu.app/errors/UNAUTHORIZED","title":"Unauthorized","status":401,"detail":"expired","code":"UNAUTHORIZED"}"""
                    .toResponseBody("application/problem+json".toMediaType())
            )
            .build()

        val retried = authenticator.authenticate(null, unauthResp)
        assertNotNull(retried)
        assertEquals("Bearer new-access", retried?.header("Authorization"))
        assertEquals("new-access", store.accessToken())
        assertEquals("new-refresh", store.refreshToken())

        // 并发场景：若另一个线程已刷新（store 内已是 new-access，而旧请求仍带 expired-access），直接复用最新令牌而不重复刷新
        var extraRefreshCalls = 0
        val concurrentAuthenticator = TokenAuthenticator(store) {
            extraRefreshCalls++
            null
        }
        val retriedConcurrent = concurrentAuthenticator.authenticate(null, unauthResp)
        assertEquals("Bearer new-access", retriedConcurrent?.header("Authorization"))
        assertEquals(0, extraRefreshCalls)

        // 当最新令牌也返回 401 UNAUTHORIZED 且刷新失败时，应清空 TokenStore 并返回 null
        val staleNewReq = Request.Builder()
            .url("http://localhost:8080/api/v1/auth/me")
            .header("Authorization", "Bearer new-access")
            .build()
        val unauthNewResp = Response.Builder()
            .request(staleNewReq)
            .protocol(Protocol.HTTP_1_1)
            .code(401)
            .message("Unauthorized")
            .body(
                """{"type":"https://shixu.app/errors/UNAUTHORIZED","title":"Unauthorized","status":401,"detail":"expired","code":"UNAUTHORIZED"}"""
                    .toResponseBody("application/problem+json".toMediaType())
            )
            .build()

        val failAuthenticator = TokenAuthenticator(store) { null }
        val retriedFail = failAuthenticator.authenticate(null, unauthNewResp)
        assertNull(retriedFail)
        assertNull(store.accessToken())
        assertNull(store.refreshToken())
    }
}
