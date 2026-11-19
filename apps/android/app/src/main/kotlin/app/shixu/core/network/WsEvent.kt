package app.shixu.core.network

import app.shixu.core.network.generated.models.WsAvailabilityChangedPayload
import app.shixu.core.network.generated.models.WsEnergyOverloadAlertPayload
import app.shixu.core.network.generated.models.WsEnergyUpdatedPayload
import app.shixu.core.network.generated.models.WsEnvelope
import app.shixu.core.network.generated.models.WsEventType
import app.shixu.core.network.generated.models.WsScheduleUpdatedPayload
import app.shixu.core.network.generated.models.WsWorkspaceMeetingCancelledPayload
import app.shixu.core.network.generated.models.WsWorkspaceMeetingConfirmedPayload
import app.shixu.core.network.generated.models.WsWorkspaceMeetingRespondedPayload
import kotlinx.serialization.json.decodeFromJsonElement
import java.time.OffsetDateTime
import java.util.UUID

sealed interface WsEvent {
    val version: Long
    val eventId: UUID
    val occurredAt: OffsetDateTime

    data class EnergyUpdated(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsEnergyUpdatedPayload,
    ) : WsEvent

    data class EnergyOverloadAlert(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsEnergyOverloadAlertPayload,
    ) : WsEvent

    data class ScheduleUpdated(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsScheduleUpdatedPayload,
    ) : WsEvent

    data class WorkspaceMeetingConfirmed(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsWorkspaceMeetingConfirmedPayload,
    ) : WsEvent

    data class WorkspaceMeetingCancelled(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsWorkspaceMeetingCancelledPayload,
    ) : WsEvent

    data class WorkspaceMeetingResponded(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsWorkspaceMeetingRespondedPayload,
    ) : WsEvent

    data class AvailabilityChanged(
        override val version: Long,
        override val eventId: UUID,
        override val occurredAt: OffsetDateTime,
        val payload: WsAvailabilityChangedPayload,
    ) : WsEvent
}

object WsEventParser {
    fun parse(raw: String): WsEvent? =
        runCatching {
            val json = ShixuJson.json
            val envelope = json.decodeFromString<WsEnvelope>(raw)
            if (envelope.version < 1L) return null
            val payloadElement = envelope.payload ?: return null

            when (envelope.type) {
                WsEventType.energyPeriodUpdated -> WsEvent.EnergyUpdated(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsEnergyUpdatedPayload>(payloadElement),
                )

                WsEventType.energyPeriodOverload_alert -> WsEvent.EnergyOverloadAlert(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsEnergyOverloadAlertPayload>(payloadElement),
                )

                WsEventType.schedulePeriodUpdated -> WsEvent.ScheduleUpdated(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsScheduleUpdatedPayload>(payloadElement),
                )

                WsEventType.workspacePeriodMeeting_confirmed -> WsEvent.WorkspaceMeetingConfirmed(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsWorkspaceMeetingConfirmedPayload>(payloadElement),
                )

                WsEventType.workspacePeriodMeeting_cancelled -> WsEvent.WorkspaceMeetingCancelled(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsWorkspaceMeetingCancelledPayload>(payloadElement),
                )

                WsEventType.workspacePeriodMeeting_responded -> WsEvent.WorkspaceMeetingResponded(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsWorkspaceMeetingRespondedPayload>(payloadElement),
                )

                WsEventType.workspacePeriodAvailability_changed -> WsEvent.AvailabilityChanged(
                    version = envelope.version,
                    eventId = envelope.eventId,
                    occurredAt = envelope.occurredAt,
                    payload = json.decodeFromJsonElement<WsAvailabilityChangedPayload>(payloadElement),
                )
            }
        }.getOrNull()
}
