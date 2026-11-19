// Package api 定义以 OpenAPI 3.1 为唯一真相源的 Huma v2 请求/响应 DTO、RFC 9457 业务错误码与 WebSocket 事件契约。
// 任何字段变更后必须同步执行 `go run ./cmd/export-openapi -out ../../contracts/openapi.json`。
package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
)

// ── RFC 9457 标准业务错误码字典 ──

type ErrorCode string

const (
	ErrBadRequest                   ErrorCode = "BAD_REQUEST"
	ErrUnauthorized                 ErrorCode = "UNAUTHORIZED"
	ErrInvalidCredentials           ErrorCode = "INVALID_CREDENTIALS"
	ErrInvalidRefreshToken          ErrorCode = "INVALID_REFRESH_TOKEN"
	ErrTokenReuseDetected           ErrorCode = "TOKEN_REUSE_DETECTED"
	ErrInvalidWSTicket              ErrorCode = "INVALID_WS_TICKET"
	ErrForbiddenNotWorkspaceMember  ErrorCode = "FORBIDDEN_NOT_WORKSPACE_MEMBER"
	ErrForbiddenInsufficientRole    ErrorCode = "FORBIDDEN_INSUFFICIENT_ROLE"
	ErrForbiddenNotParticipant      ErrorCode = "FORBIDDEN_NOT_MEETING_PARTICIPANT"
	ErrNotFound                     ErrorCode = "NOT_FOUND"
	ErrInviteCodeNotFound           ErrorCode = "INVITE_CODE_NOT_FOUND"
	ErrMeetingProposalNotFound      ErrorCode = "MEETING_PROPOSAL_NOT_FOUND"
	ErrSnapshotNotFound             ErrorCode = "SNAPSHOT_NOT_FOUND"
	ErrEmailAlreadyExists           ErrorCode = "EMAIL_ALREADY_EXISTS"
	ErrAlreadyWorkspaceMember       ErrorCode = "ALREADY_WORKSPACE_MEMBER"
	ErrConflictScheduleOverlap      ErrorCode = "CONFLICT_SCHEDULE_OVERLAP"
	ErrConflictMemberBusy           ErrorCode = "CONFLICT_MEMBER_BUSY"
	ErrMeetingManagedByProposal     ErrorCode = "MEETING_MANAGED_BY_PROPOSAL"
	ErrMeetingAlreadyCancelled      ErrorCode = "MEETING_ALREADY_CANCELLED"
	ErrStaleBaselineVersion         ErrorCode = "STALE_BASELINE_VERSION"
	ErrAlreadyReverted              ErrorCode = "ALREADY_REVERTED"
	ErrSnapshotRestoreConflict      ErrorCode = "SNAPSHOT_RESTORE_CONFLICT"
	ErrValidationFailed             ErrorCode = "VALIDATION_FAILED"
	ErrRangeTooLarge                ErrorCode = "RANGE_TOO_LARGE"
	ErrInvalidTimeRange             ErrorCode = "INVALID_TIME_RANGE"
	ErrDeadlineInPast               ErrorCode = "DEADLINE_IN_PAST"
	ErrInvalidBiometricSample       ErrorCode = "INVALID_BIOMETRIC_SAMPLE"
	ErrInvalidWorkHours             ErrorCode = "INVALID_WORK_HOURS"
	ErrParticipantNotInWorkspace    ErrorCode = "PARTICIPANT_NOT_IN_WORKSPACE"
	ErrServiceUnavailable           ErrorCode = "SERVICE_UNAVAILABLE"
)

type ErrorDetailItem struct {
	Location string `json:"location"`
	Message  string `json:"message"`
	Value    any    `json:"value,omitempty"`
}

// ProblemDetail 遵循 RFC 9457 (application/problem+json)，扩展机器可读业务 ErrorCode，并兼容 huma.StatusError。
type ProblemDetail struct {
	Type   string            `json:"type" format:"uri"`
	Title  string            `json:"title"`
	Status int               `json:"status"`
	Detail string            `json:"detail"`
	Code   ErrorCode         `json:"code" enum:"BAD_REQUEST,UNAUTHORIZED,INVALID_CREDENTIALS,INVALID_REFRESH_TOKEN,TOKEN_REUSE_DETECTED,INVALID_WS_TICKET,FORBIDDEN_NOT_WORKSPACE_MEMBER,FORBIDDEN_INSUFFICIENT_ROLE,FORBIDDEN_NOT_MEETING_PARTICIPANT,NOT_FOUND,INVITE_CODE_NOT_FOUND,MEETING_PROPOSAL_NOT_FOUND,SNAPSHOT_NOT_FOUND,EMAIL_ALREADY_EXISTS,ALREADY_WORKSPACE_MEMBER,CONFLICT_SCHEDULE_OVERLAP,CONFLICT_MEMBER_BUSY,MEETING_MANAGED_BY_PROPOSAL,MEETING_ALREADY_CANCELLED,STALE_BASELINE_VERSION,ALREADY_REVERTED,SNAPSHOT_RESTORE_CONFLICT,VALIDATION_FAILED,RANGE_TOO_LARGE,INVALID_TIME_RANGE,DEADLINE_IN_PAST,INVALID_BIOMETRIC_SAMPLE,INVALID_WORK_HOURS,PARTICIPANT_NOT_IN_WORKSPACE,SERVICE_UNAVAILABLE"`
	Errors []ErrorDetailItem `json:"errors,omitempty"`
}

func (p *ProblemDetail) Error() string {
	if p.Detail != "" {
		return p.Detail
	}
	return p.Title
}

func (p *ProblemDetail) GetStatus() int {
	if p.Status == 0 {
		return http.StatusInternalServerError
	}
	return p.Status
}

func (p *ProblemDetail) ContentType(string) string {
	return "application/problem+json"
}

func defaultErrorCodeForStatus(status int) ErrorCode {
	switch status {
	case http.StatusBadRequest:
		return ErrBadRequest
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden:
		return ErrForbiddenNotWorkspaceMember
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusConflict:
		return ErrConflictScheduleOverlap
	case http.StatusUnprocessableEntity:
		return ErrValidationFailed
	case http.StatusServiceUnavailable:
		return ErrServiceUnavailable
	default:
		return ErrBadRequest
	}
}

// NewProblem 构造符合 RFC 9457 的标准业务异常。
func NewProblem(status int, code ErrorCode, detail string, errs ...ErrorDetailItem) *ProblemDetail {
	return &ProblemDetail{
		Type:   fmt.Sprintf("https://shixu.app/errors/%s", code),
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
		Code:   code,
		Errors: errs,
	}
}

// ConfigureHumaErrors 将 Huma 全局错误工厂统一替换为 ProblemDetail（带 ErrorCode 枚举）。
func ConfigureHumaErrors() {
	huma.NewError = func(status int, msg string, errs ...error) huma.StatusError {
		items := make([]ErrorDetailItem, 0, len(errs))
		for _, err := range errs {
			if err == nil {
				continue
			}
			if d, ok := err.(huma.ErrorDetailer); ok {
				ed := d.ErrorDetail()
				items = append(items, ErrorDetailItem{
					Location: ed.Location,
					Message:  ed.Message,
					Value:    ed.Value,
				})
				continue
			}
			items = append(items, ErrorDetailItem{Message: err.Error()})
		}
		return NewProblem(status, defaultErrorCodeForStatus(status), msg, items...)
	}
}

// ── 枚举别名（与 engine/0001_init.sql 保持单一定义） ──

type ThemeMode string

const (
	ThemeSystem ThemeMode = "system"
	ThemeLight  ThemeMode = "light"
	ThemeDark   ThemeMode = "dark"
)

type ReplayScenario string

const (
	ScenarioWellRested    ReplayScenario = "well_rested"
	ScenarioSleepDeprived ReplayScenario = "sleep_deprived"
	ScenarioHighStress    ReplayScenario = "high_stress"
)

type WorkspaceRole string

const (
	RoleOwner  WorkspaceRole = "owner"
	RoleAdmin  WorkspaceRole = "admin"
	RoleMember WorkspaceRole = "member"
)

type MeetingProposalStatus string

const (
	ProposalDraft     MeetingProposalStatus = "draft"
	ProposalConfirmed MeetingProposalStatus = "confirmed"
	ProposalCancelled MeetingProposalStatus = "cancelled"
)

type MeetingResponseStatus string

const (
	ResponsePending  MeetingResponseStatus = "pending"
	ResponseAccepted MeetingResponseStatus = "accepted"
	ResponseDeclined MeetingResponseStatus = "declined"
)

type RescueSnapshotStatus string

const (
	SnapshotApplied  RescueSnapshotStatus = "applied"
	SnapshotReverted RescueSnapshotStatus = "reverted"
)

// ── 2.1 系统与认证 DTO ──

type HealthResponse struct {
	OK         bool      `json:"ok"`
	Version    string    `json:"version"`
	DBStatus   string    `json:"dbStatus" enum:"up,down"`
	ServerTime time.Time `json:"serverTime" format:"date-time"`
}

type UserProfile struct {
	ID          uuid.UUID `json:"id" format:"uuid"`
	Email       string    `json:"email" format:"email"`
	DisplayName string    `json:"displayName" minLength:"1" maxLength:"64"`
	Timezone    string    `json:"timezone"`
	ThemeMode   ThemeMode `json:"themeMode" enum:"system,light,dark"`
	CreatedAt   time.Time `json:"createdAt" format:"date-time"`
	UpdatedAt   time.Time `json:"updatedAt" format:"date-time"`
}

type RegisterRequest struct {
	Email       string `json:"email" format:"email"`
	DisplayName string `json:"displayName" minLength:"1" maxLength:"64"`
	Password    string `json:"password" minLength:"8" maxLength:"128"`
	Timezone    string `json:"timezone,omitempty" default:"Asia/Shanghai"`
	DeviceName  string `json:"deviceName,omitempty" maxLength:"120"`
}

type LoginRequest struct {
	Email      string `json:"email" format:"email"`
	Password   string `json:"password" minLength:"8" maxLength:"128"`
	DeviceName string `json:"deviceName,omitempty" maxLength:"120"`
}

type AuthTokensResponse struct {
	AccessToken      string      `json:"accessToken"`
	RefreshToken     string      `json:"refreshToken" doc:"Android 存入 EncryptedDataStore；Web 同时通过 HttpOnly Cookie rc_refresh_token 下发"`
	ExpiresInSeconds int         `json:"expiresInSeconds"`
	User             UserProfile `json:"user"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refreshToken,omitempty" doc:"Android 端必传；Web 端可省略并自动回退读取 HttpOnly Cookie"`
	DeviceName   string `json:"deviceName,omitempty" maxLength:"120"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refreshToken,omitempty" doc:"Android 端必传；Web 端可省略并自动回退读取 HttpOnly Cookie"`
}

type UpdateMeRequest struct {
	DisplayName *string    `json:"displayName,omitempty" minLength:"1" maxLength:"64"`
	Timezone    *string    `json:"timezone,omitempty"`
	ThemeMode   *ThemeMode `json:"themeMode,omitempty" enum:"system,light,dark"`
}

type WsTicketResponse struct {
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt" format:"date-time"`
}

// ── 2.2 穿戴生理与精力模型 DTO ──

type BiometricSampleDTO struct {
	SourceType   engine.SourceType `json:"sourceType" enum:"health_connect,ble_gatt,replay_demo"`
	MetricType   engine.MetricType `json:"metricType" enum:"heart_rate,hrv_rmssd,resting_hr,sleep_session,sleep_stage,active_calories"`
	RecordedAt   time.Time         `json:"recordedAt" format:"date-time"`
	EndAt        *time.Time        `json:"endAt,omitempty" format:"date-time"`
	NumericValue float64           `json:"numericValue"`
	Unit         string            `json:"unit"`
	ExternalID   string            `json:"externalId" minLength:"1" doc:"确定性幂等唯一键"`
	Metadata     map[string]any    `json:"metadata,omitempty"`
}

type BiometricBatchRequest struct {
	Samples []BiometricSampleDTO `json:"samples" minItems:"1" maxItems:"500"`
}

type EnergyTodayResponse = engine.EnergyComputeOutput

type BiometricBatchResponse struct {
	AcceptedCount     int                 `json:"acceptedCount" minimum:"0"`
	DeduplicatedCount int                 `json:"deduplicatedCount" minimum:"0"`
	LatestEnergy      EnergyTodayResponse `json:"latestEnergy"`
}

type ReplaySeedRequest struct {
	Scenario ReplayScenario `json:"scenario" enum:"well_rested,sleep_deprived,high_stress"`
	Day      string         `json:"day,omitempty" format:"date" doc:"本地日期 YYYY-MM-DD（默认今日）"`
}

type ReplaySeedResponse struct {
	Scenario     ReplayScenario      `json:"scenario" enum:"well_rested,sleep_deprived,high_stress"`
	Day          string              `json:"day" format:"date"`
	SeededCount  int                 `json:"seededCount" minimum:"0"`
	LatestEnergy EnergyTodayResponse `json:"latestEnergy"`
}

type EnergyProfileDTO struct {
	UserID                uuid.UUID                  `json:"userId" format:"uuid"`
	WorkStartMinute       int                        `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute         int                        `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Chronotype            engine.Chronotype          `json:"chronotype" enum:"morning_lark,balanced,night_owl"`
	PreferredFocusWindows []engine.DailyMinuteWindow `json:"preferredFocusWindows"`
	MinRecoveryBufferMin  int                        `json:"minRecoveryBufferMin" minimum:"5" maximum:"60"`
	HRVBaselineMs         *float64                   `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm        *float64                   `json:"rhrBaselineBpm,omitempty"`
	UpdatedAt             time.Time                  `json:"updatedAt" format:"date-time"`
}

type UpdateEnergyProfileRequest struct {
	WorkStartMinute       int                        `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute         int                        `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Chronotype            engine.Chronotype          `json:"chronotype" enum:"morning_lark,balanced,night_owl"`
	PreferredFocusWindows []engine.DailyMinuteWindow `json:"preferredFocusWindows"`
	MinRecoveryBufferMin  int                        `json:"minRecoveryBufferMin" minimum:"5" maximum:"60"`
}

// ── 2.3 个人日程与救援 DTO ──

type ScheduleItemDTO struct {
	ID                uuid.UUID               `json:"id" format:"uuid"`
	UserID            uuid.UUID               `json:"userId" format:"uuid"`
	WorkspaceID       *uuid.UUID              `json:"workspaceId,omitempty" format:"uuid"`
	MeetingProposalID *uuid.UUID              `json:"meetingProposalId,omitempty" format:"uuid"`
	Title             string                  `json:"title" minLength:"1" maxLength:"200"`
	Notes             string                  `json:"notes"`
	Category          engine.ScheduleCategory `json:"category" enum:"deep_work,meeting,recovery,routine,urgent"`
	CognitiveLoad     engine.CognitiveLoad    `json:"cognitiveLoad" enum:"high,medium,low"`
	Flexibility       engine.Flexibility      `json:"flexibility" enum:"hard_locked,flexible,focus_shield"`
	Status            engine.ScheduleStatus   `json:"status" enum:"planned,in_progress,completed,cancelled"`
	StartAt           time.Time               `json:"startAt" format:"date-time"`
	EndAt             time.Time               `json:"endAt" format:"date-time"`
	DurationMinutes   int                     `json:"durationMinutes" minimum:"1"`
	DeadlineAt        *time.Time              `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes   int                     `json:"reminderMinutes" minimum:"0"`
	CreatedAt         time.Time               `json:"createdAt" format:"date-time"`
	UpdatedAt         time.Time               `json:"updatedAt" format:"date-time"`
}

type ScheduleItemListResponse struct {
	Items           []ScheduleItemDTO `json:"items"`
	BaselineVersion string            `json:"baselineVersion"`
}

type ScheduleMutationResponse struct {
	Item            ScheduleItemDTO `json:"item"`
	BaselineVersion string          `json:"baselineVersion"`
}

type CreateScheduleItemRequest struct {
	Title           string                  `json:"title" minLength:"1" maxLength:"200"`
	Notes           string                  `json:"notes,omitempty"`
	Category        engine.ScheduleCategory `json:"category" enum:"deep_work,meeting,recovery,routine,urgent"`
	CognitiveLoad   engine.CognitiveLoad    `json:"cognitiveLoad" enum:"high,medium,low"`
	Flexibility     engine.Flexibility      `json:"flexibility" enum:"hard_locked,flexible,focus_shield"`
	StartAt         time.Time               `json:"startAt" format:"date-time"`
	EndAt           time.Time               `json:"endAt" format:"date-time"`
	DeadlineAt      *time.Time              `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes *int                    `json:"reminderMinutes,omitempty" minimum:"0" default:"10"`
	AllowOverlap    bool                    `json:"allowOverlap,omitempty" default:"false"`
}

type UpdateScheduleItemRequest struct {
	Title           *string                  `json:"title,omitempty" minLength:"1" maxLength:"200"`
	Notes           *string                  `json:"notes,omitempty"`
	Category        *engine.ScheduleCategory `json:"category,omitempty" enum:"deep_work,meeting,recovery,routine,urgent"`
	CognitiveLoad   *engine.CognitiveLoad    `json:"cognitiveLoad,omitempty" enum:"high,medium,low"`
	Flexibility     *engine.Flexibility      `json:"flexibility,omitempty" enum:"hard_locked,flexible,focus_shield"`
	Status          *engine.ScheduleStatus   `json:"status,omitempty" enum:"planned,in_progress,completed,cancelled"`
	StartAt         *time.Time               `json:"startAt,omitempty" format:"date-time"`
	EndAt           *time.Time               `json:"endAt,omitempty" format:"date-time"`
	DeadlineAt      *time.Time               `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes *int                     `json:"reminderMinutes,omitempty" minimum:"0"`
	AllowOverlap    *bool                    `json:"allowOverlap,omitempty"`
}

type UrgentTaskDTO struct {
	Title           string               `json:"title" minLength:"1" maxLength:"200"`
	Notes           string               `json:"notes,omitempty"`
	DurationMinutes int                  `json:"durationMinutes" minimum:"15" maximum:"480"`
	CognitiveLoad   engine.CognitiveLoad `json:"cognitiveLoad" enum:"high,medium,low"`
	DeadlineAt      time.Time            `json:"deadlineAt" format:"date-time"`
}

type RescueOptionsRequest struct {
	Day           string                     `json:"day" format:"date"`
	TriggerReason engine.RescueTriggerReason `json:"triggerReason" enum:"urgent_task,team_meeting_overload,wearable_fatigue"`
	UrgentTask    *UrgentTaskDTO             `json:"urgentTask,omitempty"`
}

type RescueOptionsResponse struct {
	Day             string                    `json:"day" format:"date"`
	BaselineVersion string                    `json:"baselineVersion"`
	Options         []engine.RescueOptionPlan `json:"options" minItems:"3" maxItems:"3"`
}

type RescueApplyRequest struct {
	Day                string                     `json:"day" format:"date"`
	BaselineVersion    string                     `json:"baselineVersion" minLength:"1"`
	Strategy           engine.RescueStrategy      `json:"strategy" enum:"protect_deadline,protect_recovery,minimize_changes"`
	TriggerReason      engine.RescueTriggerReason `json:"triggerReason" enum:"urgent_task,team_meeting_overload,wearable_fatigue"`
	UrgentTask         *UrgentTaskDTO             `json:"urgentTask,omitempty"`
	ExpectedOptionHash string                     `json:"expectedOptionHash,omitempty"`
}

type RescueApplyResponse struct {
	SnapshotID      uuid.UUID             `json:"snapshotId" format:"uuid"`
	Strategy        engine.RescueStrategy `json:"strategy" enum:"protect_deadline,protect_recovery,minimize_changes"`
	BaselineVersion string                `json:"baselineVersion"`
	AppliedItems    []ScheduleItemDTO     `json:"appliedItems"`
}

type RescueUndoRequest struct {
	SnapshotID uuid.UUID `json:"snapshotId" format:"uuid"`
}

type RescueUndoResponse struct {
	SnapshotID      uuid.UUID            `json:"snapshotId" format:"uuid"`
	Status          RescueSnapshotStatus `json:"status" enum:"applied,reverted"`
	BaselineVersion string               `json:"baselineVersion"`
	RestoredItems   []ScheduleItemDTO    `json:"restoredItems"`
}

type RescueSnapshotRecord struct {
	ID              uuid.UUID                     `json:"id" format:"uuid"`
	UserID          uuid.UUID                     `json:"userId" format:"uuid"`
	LocalDay        string                        `json:"localDay" format:"date"`
	Strategy        engine.RescueStrategy         `json:"strategy" enum:"protect_deadline,protect_recovery,minimize_changes"`
	TriggerReason   engine.RescueTriggerReason    `json:"triggerReason" enum:"urgent_task,team_meeting_overload,wearable_fatigue"`
	BaselineVersion string                        `json:"baselineVersion"`
	OptionHash      string                        `json:"optionHash"`
	Status          RescueSnapshotStatus          `json:"status" enum:"applied,reverted"`
	BeforeItems     []engine.ScheduleItemSnapshot `json:"beforeItems"`
	AfterItems      []engine.ScheduleItemSnapshot `json:"afterItems"`
	AppliedAt       time.Time                     `json:"appliedAt" format:"date-time"`
	RevertedAt      *time.Time                    `json:"revertedAt,omitempty" format:"date-time"`
}

type RescueHistoryResponse struct {
	Snapshots  []RescueSnapshotRecord `json:"snapshots"`
	NextCursor *string                `json:"nextCursor,omitempty"`
}

// ── 2.4 团队空间与协同排会 DTO ──

type WorkspaceDTO struct {
	ID             uuid.UUID           `json:"id" format:"uuid"`
	Name           string              `json:"name" minLength:"1" maxLength:"64"`
	Description    string              `json:"description"`
	InviteCode     string              `json:"inviteCode"`
	OwnerID        uuid.UUID           `json:"ownerId" format:"uuid"`
	MyRole         WorkspaceRole       `json:"myRole" enum:"owner,admin,member"`
	MyPrivacyLevel engine.PrivacyLevel `json:"myPrivacyLevel" enum:"busy_only,energy_tier,full_title"`
	MemberCount    int                 `json:"memberCount" minimum:"1"`
	CreatedAt      time.Time           `json:"createdAt" format:"date-time"`
	UpdatedAt      time.Time           `json:"updatedAt" format:"date-time"`
}

type CreateWorkspaceRequest struct {
	Name         string               `json:"name" minLength:"1" maxLength:"64"`
	Description  string               `json:"description,omitempty"`
	PrivacyLevel *engine.PrivacyLevel `json:"privacyLevel,omitempty" enum:"busy_only,energy_tier,full_title"`
}

type WorkspaceListResponse struct {
	Workspaces []WorkspaceDTO `json:"workspaces"`
}

type JoinWorkspaceRequest struct {
	InviteCode   string               `json:"inviteCode" minLength:"4" maxLength:"32"`
	PrivacyLevel *engine.PrivacyLevel `json:"privacyLevel,omitempty" enum:"busy_only,energy_tier,full_title"`
}

type UpdateWorkspaceMemberConfigRequest struct {
	PrivacyLevel engine.PrivacyLevel `json:"privacyLevel" enum:"busy_only,energy_tier,full_title"`
}

type WorkspaceMemberDTO struct {
	WorkspaceID  uuid.UUID           `json:"workspaceId" format:"uuid"`
	UserID       uuid.UUID           `json:"userId" format:"uuid"`
	DisplayName  string              `json:"displayName"`
	Role         WorkspaceRole       `json:"role" enum:"owner,admin,member"`
	Timezone     string              `json:"timezone"`
	PrivacyLevel engine.PrivacyLevel `json:"privacyLevel" enum:"busy_only,energy_tier,full_title"`
	JoinedAt     time.Time           `json:"joinedAt" format:"date-time"`
}

type WorkspaceMemberListResponse struct {
	WorkspaceID uuid.UUID            `json:"workspaceId" format:"uuid"`
	Members     []WorkspaceMemberDTO `json:"members"`
}

type WorkspaceAvailabilityResponse struct {
	WorkspaceID uuid.UUID                       `json:"workspaceId" format:"uuid"`
	From        time.Time                       `json:"from" format:"date-time"`
	To          time.Time                       `json:"to" format:"date-time"`
	Members     []engine.MemberAvailabilityView `json:"members"`
}

type RecommendMeetingRequest struct {
	Title               string               `json:"title" minLength:"1" maxLength:"200"`
	Description         string               `json:"description,omitempty"`
	DurationMinutes     int                  `json:"durationMinutes" minimum:"15" maximum:"480"`
	CognitiveLoad       engine.CognitiveLoad `json:"cognitiveLoad" enum:"high,medium,low"`
	ParticipantIDs      []uuid.UUID          `json:"participantIds" minItems:"1"`
	OptionalIDs         []uuid.UUID          `json:"optionalIds,omitempty"`
	SearchFrom          time.Time            `json:"searchFrom" format:"date-time"`
	SearchTo            time.Time            `json:"searchTo" format:"date-time"`
	RespectFocusShields *bool                `json:"respectFocusShields,omitempty" default:"true"`
}

type RecommendMeetingResponse = engine.MeetingSolverOutput

type MeetingParticipantView struct {
	UserID         uuid.UUID             `json:"userId" format:"uuid"`
	DisplayName    string                `json:"displayName"`
	Required       bool                  `json:"required"`
	ResponseStatus MeetingResponseStatus `json:"responseStatus" enum:"pending,accepted,declined"`
}

type MeetingProposalDTO struct {
	ID                 uuid.UUID                `json:"id" format:"uuid"`
	WorkspaceID        uuid.UUID                `json:"workspaceId" format:"uuid"`
	OrganizerID        uuid.UUID                `json:"organizerId" format:"uuid"`
	Title              string                   `json:"title"`
	Description        string                   `json:"description"`
	DurationMinutes    int                      `json:"durationMinutes"`
	CognitiveLoad      engine.CognitiveLoad     `json:"cognitiveLoad" enum:"high,medium,low"`
	Status             MeetingProposalStatus    `json:"status" enum:"draft,confirmed,cancelled"`
	ConfirmedStartAt   *time.Time               `json:"confirmedStartAt,omitempty" format:"date-time"`
	ConfirmedEndAt     *time.Time               `json:"confirmedEndAt,omitempty" format:"date-time"`
	Participants       []MeetingParticipantView `json:"participants"`
	RecommendationMeta map[string]any           `json:"recommendationMeta"`
	CreatedAt          time.Time                `json:"createdAt" format:"date-time"`
	UpdatedAt          time.Time                `json:"updatedAt" format:"date-time"`
}

type ConfirmMeetingRequest struct {
	ProposalID         *uuid.UUID           `json:"proposalId,omitempty" format:"uuid"`
	Title              string               `json:"title" minLength:"1" maxLength:"200"`
	Description        string               `json:"description,omitempty"`
	DurationMinutes    int                  `json:"durationMinutes" minimum:"15" maximum:"480"`
	CognitiveLoad      engine.CognitiveLoad `json:"cognitiveLoad" enum:"high,medium,low"`
	ParticipantIDs     []uuid.UUID          `json:"participantIds" minItems:"1"`
	OptionalIDs        []uuid.UUID          `json:"optionalIds,omitempty"`
	StartAt            time.Time            `json:"startAt" format:"date-time"`
	EndAt              time.Time            `json:"endAt" format:"date-time"`
	RecommendationMeta map[string]any       `json:"recommendationMeta,omitempty"`
}

type ConfirmMeetingResponse struct {
	Proposal             MeetingProposalDTO `json:"proposal"`
	CreatedScheduleCount int                `json:"createdScheduleCount" minimum:"1"`
}

type MeetingProposalListResponse struct {
	Meetings   []MeetingProposalDTO `json:"meetings"`
	NextCursor *string              `json:"nextCursor,omitempty"`
}

type RespondMeetingRequest struct {
	ResponseStatus string `json:"responseStatus" enum:"accepted,declined"`
}

type RespondMeetingResponse struct {
	ProposalID     uuid.UUID             `json:"proposalId" format:"uuid"`
	UserID         uuid.UUID             `json:"userId" format:"uuid"`
	ResponseStatus MeetingResponseStatus `json:"responseStatus" enum:"accepted,declined"`
	ScheduleStatus engine.ScheduleStatus `json:"scheduleStatus" enum:"planned,in_progress,completed,cancelled"`
	UpdatedAt      time.Time             `json:"updatedAt" format:"date-time"`
}

type CancelMeetingRequest struct {
	Reason string `json:"reason,omitempty" maxLength:"280"`
}

type CancelMeetingResponse struct {
	ProposalID             uuid.UUID             `json:"proposalId" format:"uuid"`
	Status                 MeetingProposalStatus `json:"status" enum:"cancelled"`
	CancelledScheduleCount int                   `json:"cancelledScheduleCount" minimum:"0"`
	UpdatedAt              time.Time             `json:"updatedAt" format:"date-time"`
}

// ── 4. WebSocket 实时事件信封与 7 大下行 Payload ──

type WsEventType string

const (
	WsEnergyUpdated               WsEventType = "energy.updated"
	WsEnergyOverloadAlert         WsEventType = "energy.overload_alert"
	WsScheduleUpdated             WsEventType = "schedule.updated"
	WsWorkspaceMeetingConfirmed   WsEventType = "workspace.meeting_confirmed"
	WsWorkspaceMeetingCancelled   WsEventType = "workspace.meeting_cancelled"
	WsWorkspaceMeetingResponded   WsEventType = "workspace.meeting_responded"
	WsWorkspaceAvailabilityChange WsEventType = "workspace.availability_changed"
)

type WsEnvelope struct {
	EventID    uuid.UUID      `json:"eventId" format:"uuid"`
	Type       WsEventType    `json:"type" enum:"energy.updated,energy.overload_alert,schedule.updated,workspace.meeting_confirmed,workspace.meeting_cancelled,workspace.meeting_responded,workspace.availability_changed"`
	OccurredAt time.Time      `json:"occurredAt" format:"date-time"`
	Payload    map[string]any `json:"payload"`
}

type WsEnergyUpdatedPayload struct {
	UserID        uuid.UUID            `json:"userId" format:"uuid"`
	LocalDay      string               `json:"localDay" format:"date"`
	Score         int                  `json:"score" minimum:"0" maximum:"100"`
	Tier          engine.EnergyTier    `json:"tier" enum:"peak,steady,strained,depleted"`
	DataFreshness engine.DataFreshness `json:"dataFreshness" enum:"live_wearable,recent_wearable,replay_demo,baseline_only"`
	ComputedAt    time.Time            `json:"computedAt" format:"date-time"`
}

type WsEnergyOverloadAlertPayload struct {
	UserID              uuid.UUID                  `json:"userId" format:"uuid"`
	LocalDay            string                     `json:"localDay" format:"date"`
	TriggerReason       engine.RescueTriggerReason `json:"triggerReason" enum:"urgent_task,team_meeting_overload,wearable_fatigue"`
	Severity            string                     `json:"severity" enum:"warning,critical"`
	CurrentScore        int                        `json:"currentScore" minimum:"0" maximum:"100"`
	Tier                engine.EnergyTier          `json:"tier" enum:"peak,steady,strained,depleted"`
	Message             string                     `json:"message"`
	RecommendedStrategy engine.RescueStrategy      `json:"recommendedStrategy" enum:"protect_deadline,protect_recovery,minimize_changes"`
}

type WsScheduleUpdatedPayload struct {
	UserID          uuid.UUID   `json:"userId" format:"uuid"`
	BaselineVersion string      `json:"baselineVersion"`
	Reason          string      `json:"reason" enum:"item_created,item_updated,item_cancelled,rescue_applied,rescue_reverted,team_meeting_synced"`
	AffectedFrom    time.Time   `json:"affectedFrom" format:"date-time"`
	AffectedTo      time.Time   `json:"affectedTo" format:"date-time"`
	ItemIDs         []uuid.UUID `json:"itemIds"`
}

type WsWorkspaceMeetingConfirmedPayload struct {
	WorkspaceID    uuid.UUID            `json:"workspaceId" format:"uuid"`
	ProposalID     uuid.UUID            `json:"proposalId" format:"uuid"`
	OrganizerID    uuid.UUID            `json:"organizerId" format:"uuid"`
	Title          string               `json:"title"`
	CognitiveLoad  engine.CognitiveLoad `json:"cognitiveLoad" enum:"high,medium,low"`
	StartAt        time.Time            `json:"startAt" format:"date-time"`
	EndAt          time.Time            `json:"endAt" format:"date-time"`
	ParticipantIDs []uuid.UUID          `json:"participantIds"`
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

type WsWorkspaceMeetingRespondedPayload struct {
	WorkspaceID    uuid.UUID             `json:"workspaceId" format:"uuid"`
	ProposalID     uuid.UUID             `json:"proposalId" format:"uuid"`
	UserID         uuid.UUID             `json:"userId" format:"uuid"`
	DisplayName    string                `json:"displayName"`
	ResponseStatus MeetingResponseStatus `json:"responseStatus" enum:"accepted,declined"`
	RespondedAt    time.Time             `json:"respondedAt" format:"date-time"`
}

type WsAvailabilityChangedPayload struct {
	WorkspaceID  uuid.UUID  `json:"workspaceId" format:"uuid"`
	UserID       uuid.UUID  `json:"userId" format:"uuid"`
	Reason       string     `json:"reason" enum:"schedule_changed,privacy_changed,energy_tier_changed"`
	AffectedFrom *time.Time `json:"affectedFrom,omitempty" format:"date-time"`
	AffectedTo   *time.Time `json:"affectedTo,omitempty" format:"date-time"`
}
