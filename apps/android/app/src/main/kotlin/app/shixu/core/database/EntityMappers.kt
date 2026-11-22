package app.shixu.core.database

import app.shixu.core.network.ShixuJson
import app.shixu.core.network.generated.models.BiometricSampleDTO
import app.shixu.core.network.generated.models.CognitiveLoad
import app.shixu.core.network.generated.models.Flexibility
import app.shixu.core.network.generated.models.MetricType
import app.shixu.core.network.generated.models.ScheduleCategory
import app.shixu.core.network.generated.models.ScheduleItemDTO
import app.shixu.core.network.generated.models.ScheduleStatus
import app.shixu.core.network.generated.models.SleepStage
import app.shixu.core.network.generated.models.SourceType
import kotlinx.serialization.json.JsonElement
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

fun PendingBiometricEntity.toDto(): BiometricSampleDTO {
    val parsedSource = SourceType.decode(sourceType)
        ?: throw IllegalArgumentException("Unknown sourceType: $sourceType")
    val parsedMetric = MetricType.decode(metricType)
        ?: throw IllegalArgumentException("Unknown metricType: $metricType")
    val parsedRecordedAt = OffsetDateTime.parse(recordedAtIso, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    val parsedEndAt = endAtIso?.let { OffsetDateTime.parse(it, DateTimeFormatter.ISO_OFFSET_DATE_TIME) }
    val parsedStage = sleepStage?.let { SleepStage.decode(it) }
    val parsedMetadata = metadataJson?.let { raw ->
        runCatching {
            ShixuJson.json.decodeFromString<Map<String, JsonElement?>>(raw)
        }.getOrNull()
    }

    return BiometricSampleDTO(
        externalId = externalId,
        metricType = parsedMetric,
        numericValue = numericValue,
        recordedAt = parsedRecordedAt,
        sourceType = parsedSource,
        unit = unit,
        endAt = parsedEndAt,
        metadata = parsedMetadata,
        sleepStage = parsedStage,
    )
}

fun ScheduleItemDTO.toEntity(nowEpochMs: Long = System.currentTimeMillis()): CachedScheduleItemEntity =
    CachedScheduleItemEntity(
        id = id.toString(),
        userId = userId.toString(),
        workspaceId = workspaceId?.toString(),
        meetingProposalId = meetingProposalId?.toString(),
        title = title,
        notes = notes,
        category = category.value,
        cognitiveLoad = cognitiveLoad.value,
        flexibility = flexibility.value,
        status = status.value,
        startAtIso = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(startAt),
        endAtIso = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(endAt),
        durationMinutes = durationMinutes,
        deadlineAtIso = deadlineAt?.let { DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(it) },
        reminderMinutes = reminderMinutes,
        createdAtIso = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(createdAt),
        updatedAtIso = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(updatedAt),
        cachedAtEpochMs = nowEpochMs,
    )

fun CachedScheduleItemEntity.toDto(): ScheduleItemDTO =
    ScheduleItemDTO(
        id = UUID.fromString(id),
        userId = UUID.fromString(userId),
        workspaceId = workspaceId?.let(UUID::fromString),
        meetingProposalId = meetingProposalId?.let(UUID::fromString),
        title = title,
        notes = notes,
        category = ScheduleCategory.decode(category) ?: ScheduleCategory.routine,
        cognitiveLoad = CognitiveLoad.decode(cognitiveLoad) ?: CognitiveLoad.medium,
        flexibility = Flexibility.decode(flexibility) ?: Flexibility.flexible,
        status = ScheduleStatus.decode(status) ?: ScheduleStatus.planned,
        startAt = OffsetDateTime.parse(startAtIso, DateTimeFormatter.ISO_OFFSET_DATE_TIME),
        endAt = OffsetDateTime.parse(endAtIso, DateTimeFormatter.ISO_OFFSET_DATE_TIME),
        durationMinutes = durationMinutes,
        deadlineAt = deadlineAtIso?.let { OffsetDateTime.parse(it, DateTimeFormatter.ISO_OFFSET_DATE_TIME) },
        reminderMinutes = reminderMinutes,
        createdAt = OffsetDateTime.parse(createdAtIso, DateTimeFormatter.ISO_OFFSET_DATE_TIME),
        updatedAt = OffsetDateTime.parse(updatedAtIso, DateTimeFormatter.ISO_OFFSET_DATE_TIME),
    )
