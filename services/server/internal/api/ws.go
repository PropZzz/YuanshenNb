package api

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// WsEnvelope 定义所有 WebSocket 下行消息的统一外层信封（含协议版本号以便前向演进）。
type WsEnvelope struct {
	Version    int             `json:"version" minimum:"1" default:"1"`
	EventID    uuid.UUID       `json:"eventId" format:"uuid"`
	Type       WsEventType     `json:"type"`
	OccurredAt time.Time       `json:"occurredAt" format:"date-time"`
	Payload    json.RawMessage `json:"payload"`
}

// WsPayload 由 7 类强类型下行事件 Payload 实现，禁止直接传入裸 map 绕过契约校验。
type WsPayload interface {
	wsEventType() WsEventType
}

// NewWsEnvelope 构造带统一 UUID、UTC 时间戳与版本 1 的强类型 WebSocket 下行信封。
func NewWsEnvelope(payload WsPayload) (WsEnvelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return WsEnvelope{}, err
	}
	return WsEnvelope{
		Version:    1,
		EventID:    uuid.New(),
		Type:       payload.wsEventType(),
		OccurredAt: time.Now().UTC(),
		Payload:    raw,
	}, nil
}

type WsEnergyUpdatedPayload struct {
	UserID        uuid.UUID     `json:"userId" format:"uuid"`
	LocalDay      string        `json:"localDay" format:"date"`
	Score         int           `json:"score" minimum:"0" maximum:"100"`
	Tier          EnergyTier    `json:"tier"`
	DataFreshness DataFreshness `json:"dataFreshness"`
	ComputedAt    time.Time     `json:"computedAt" format:"date-time"`
}

func (WsEnergyUpdatedPayload) wsEventType() WsEventType { return WsEnergyUpdated }

type WsEnergyOverloadAlertPayload struct {
	UserID              uuid.UUID           `json:"userId" format:"uuid"`
	LocalDay            string              `json:"localDay" format:"date"`
	TriggerReason       RescueTriggerReason `json:"triggerReason"`
	Severity            OverloadSeverity    `json:"severity"`
	CurrentScore        int                 `json:"currentScore" minimum:"0" maximum:"100"`
	Tier                EnergyTier          `json:"tier"`
	Message             string              `json:"message"`
	RecommendedStrategy RescueStrategy      `json:"recommendedStrategy"`
}

func (WsEnergyOverloadAlertPayload) wsEventType() WsEventType { return WsEnergyOverloadAlert }

type WsScheduleUpdatedPayload struct {
	UserID           uuid.UUID            `json:"userId" format:"uuid"`
	BaselineLocalDay string               `json:"baselineLocalDay" format:"date"`
	BaselineVersion  string               `json:"baselineVersion"`
	Reason           ScheduleUpdateReason `json:"reason"`
	AffectedFrom     time.Time            `json:"affectedFrom" format:"date-time"`
	AffectedTo       time.Time            `json:"affectedTo" format:"date-time"`
	ItemIDs          []uuid.UUID          `json:"itemIds"`
}

func (WsScheduleUpdatedPayload) wsEventType() WsEventType { return WsScheduleUpdated }

type WsWorkspaceMeetingConfirmedPayload struct {
	WorkspaceID    uuid.UUID     `json:"workspaceId" format:"uuid"`
	ProposalID     uuid.UUID     `json:"proposalId" format:"uuid"`
	OrganizerID    uuid.UUID     `json:"organizerId" format:"uuid"`
	Title          string        `json:"title"`
	CognitiveLoad  CognitiveLoad `json:"cognitiveLoad"`
	StartAt        time.Time     `json:"startAt" format:"date-time"`
	EndAt          time.Time     `json:"endAt" format:"date-time"`
	ParticipantIDs []uuid.UUID   `json:"participantIds"`
}

func (WsWorkspaceMeetingConfirmedPayload) wsEventType() WsEventType {
	return WsWorkspaceMeetingConfirmed
}

type WsWorkspaceMeetingCancelledPayload struct {
	WorkspaceID       uuid.UUID `json:"workspaceId" format:"uuid"`
	ProposalID        uuid.UUID `json:"proposalId" format:"uuid"`
	CancelledByUserID uuid.UUID `json:"cancelledByUserId" format:"uuid"`
	Title             string    `json:"title"`
	StartAt           time.Time `json:"startAt" format:"date-time"`
	EndAt             time.Time `json:"endAt" format:"date-time"`
	Reason            *string   `json:"reason,omitempty"`
}

func (WsWorkspaceMeetingCancelledPayload) wsEventType() WsEventType {
	return WsWorkspaceMeetingCancelled
}

type WsWorkspaceMeetingRespondedPayload struct {
	WorkspaceID    uuid.UUID             `json:"workspaceId" format:"uuid"`
	ProposalID     uuid.UUID             `json:"proposalId" format:"uuid"`
	UserID         uuid.UUID             `json:"userId" format:"uuid"`
	DisplayName    string                `json:"displayName"`
	ResponseStatus MeetingDecisionStatus `json:"responseStatus"`
	RespondedAt    time.Time             `json:"respondedAt" format:"date-time"`
}

func (WsWorkspaceMeetingRespondedPayload) wsEventType() WsEventType {
	return WsWorkspaceMeetingResponded
}

type WsAvailabilityChangedPayload struct {
	WorkspaceID  uuid.UUID                `json:"workspaceId" format:"uuid"`
	UserID       uuid.UUID                `json:"userId" format:"uuid"`
	Reason       AvailabilityChangeReason `json:"reason"`
	AffectedFrom *time.Time               `json:"affectedFrom,omitempty" format:"date-time"`
	AffectedTo   *time.Time               `json:"affectedTo,omitempty" format:"date-time"`
}

func (WsAvailabilityChangedPayload) wsEventType() WsEventType {
	return WsWorkspaceAvailabilityChange
}
