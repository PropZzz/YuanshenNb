// Package api 定义以 OpenAPI 3.1 为唯一真相源的 Huma v2 请求/响应 DTO、RFC 9457 业务错误码与 WebSocket 事件契约。
// 任何字段变更后必须同步执行 `go run ./cmd/export-openapi -out ../../contracts/openapi.json`。
package api

import (
	"time"

	"github.com/google/uuid"
)

// ── 共享基础 DTO ──

type DailyMinuteWindow struct {
	StartMinute int `json:"startMinute" minimum:"0" maximum:"1439"`
	EndMinute   int `json:"endMinute" minimum:"1" maximum:"1440"`
}

// ── 2.1 系统与认证 DTO ──

type HealthResponse struct {
	OK         bool           `json:"ok"`
	Version    string         `json:"version"`
	DBStatus   HealthDBStatus `json:"dbStatus"`
	ServerTime time.Time      `json:"serverTime" format:"date-time"`
}

type UserProfile struct {
	ID          uuid.UUID `json:"id" format:"uuid"`
	Email       string    `json:"email" format:"email"`
	DisplayName string    `json:"displayName" minLength:"1" maxLength:"64"`
	Timezone    string    `json:"timezone"`
	ThemeMode   ThemeMode `json:"themeMode"`
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
	ThemeMode   *ThemeMode `json:"themeMode,omitempty"`
}

type WsTicketResponse struct {
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt" format:"date-time"`
}

// ── 2.2 穿戴生理上报与精力模型 DTO ──

type BiometricSampleDTO struct {
	SourceType   SourceType     `json:"sourceType"`
	MetricType   MetricType     `json:"metricType"`
	RecordedAt   time.Time      `json:"recordedAt" format:"date-time"`
	EndAt        *time.Time     `json:"endAt,omitempty" format:"date-time"`
	NumericValue float64        `json:"numericValue"`
	Unit         string         `json:"unit"`
	SleepStage   *SleepStage    `json:"sleepStage,omitempty" doc:"metricType=sleep_stage 时的强类型睡眠分期"`
	ExternalID   string         `json:"externalId" minLength:"1" doc:"确定性幂等唯一键"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

type BiometricBatchRequest struct {
	Samples []BiometricSampleDTO `json:"samples" minItems:"1" maxItems:"500"`
}

type HourlyEnergyPoint struct {
	HourStartAt time.Time  `json:"hourStartAt" format:"date-time"`
	Score       int        `json:"score" minimum:"0" maximum:"100"`
	Tier        EnergyTier `json:"tier"`
}

type EnergyDrivers struct {
	SleepRecoveryScore       float64  `json:"sleepRecoveryScore"`
	AutonomicDeltaScore      float64  `json:"autonomicDeltaScore"`
	CircadianScore           float64  `json:"circadianScore"`
	CognitiveLoadDrainScore  float64  `json:"cognitiveLoadDrainScore"`
	RecoveryBufferBonusScore float64  `json:"recoveryBufferBonusScore"`
	SleepDurationMinutes     *int     `json:"sleepDurationMinutes,omitempty"`
	RecentHRVRMSSDMs         *float64 `json:"recentHrvRmssdMs,omitempty"`
	RecentRestingHRBpm       *float64 `json:"recentRestingHrBpm,omitempty"`
	Summary                  string   `json:"summary"`
}

type FocusShieldWindow struct {
	StartAt  time.Time         `json:"startAt" format:"date-time"`
	EndAt    time.Time         `json:"endAt" format:"date-time"`
	AvgScore int               `json:"avgScore" minimum:"0" maximum:"100"`
	Source   FocusShieldSource `json:"source"`
}

type OverloadAlert struct {
	TriggerReason       RescueTriggerReason `json:"triggerReason"`
	Severity            OverloadSeverity    `json:"severity"`
	CurrentScore        int                 `json:"currentScore" minimum:"0" maximum:"100"`
	Tier                EnergyTier          `json:"tier"`
	Message             string              `json:"message"`
	RecommendedStrategy RescueStrategy      `json:"recommendedStrategy"`
}

type EnergySourceDiagnostics struct {
	LastSyncedAt      *time.Time  `json:"lastSyncedAt,omitempty" format:"date-time"`
	PrimarySource     *SourceType `json:"primarySource,omitempty"`
	BaselineReadyDays int         `json:"baselineReadyDays" minimum:"0" maximum:"14"`
	HRVBaselineMs     *float64    `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm    *float64    `json:"rhrBaselineBpm,omitempty"`
}

type EnergyTodayResponse struct {
	LocalDay      string                  `json:"localDay" format:"date"`
	Timezone      string                  `json:"timezone"`
	ComputedAt    time.Time               `json:"computedAt" format:"date-time"`
	Score         int                     `json:"score" minimum:"0" maximum:"100"`
	Tier          EnergyTier              `json:"tier"`
	DataFreshness DataFreshness           `json:"dataFreshness"`
	Drivers       EnergyDrivers           `json:"drivers"`
	HourlyCurve   []HourlyEnergyPoint     `json:"hourlyCurve"`
	FocusShields  []FocusShieldWindow     `json:"focusShields"`
	OverloadAlert *OverloadAlert          `json:"overloadAlert,omitempty"`
	Diagnostics   EnergySourceDiagnostics `json:"diagnostics"`
}

type BiometricBatchResponse struct {
	AcceptedCount     int                 `json:"acceptedCount" minimum:"0"`
	DeduplicatedCount int                 `json:"deduplicatedCount" minimum:"0"`
	LatestEnergy      EnergyTodayResponse `json:"latestEnergy"`
}

type ReplaySeedRequest struct {
	Scenario ReplayScenario `json:"scenario"`
	Day      string         `json:"day,omitempty" format:"date" doc:"本地日期 YYYY-MM-DD（默认今日）"`
}

type ReplaySeedResponse struct {
	Scenario     ReplayScenario      `json:"scenario"`
	Day          string              `json:"day" format:"date"`
	SeededCount  int                 `json:"seededCount" minimum:"0"`
	LatestEnergy EnergyTodayResponse `json:"latestEnergy"`
}

type EnergyProfileDTO struct {
	UserID                uuid.UUID           `json:"userId" format:"uuid"`
	WorkStartMinute       int                 `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute         int                 `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Chronotype            Chronotype          `json:"chronotype"`
	PreferredFocusWindows []DailyMinuteWindow `json:"preferredFocusWindows"`
	MinRecoveryBufferMin  int                 `json:"minRecoveryBufferMin" minimum:"5" maximum:"60"`
	HRVBaselineMs         *float64            `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm        *float64            `json:"rhrBaselineBpm,omitempty"`
	UpdatedAt             time.Time           `json:"updatedAt" format:"date-time"`
}

type UpdateEnergyProfileRequest struct {
	WorkStartMinute       int                 `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute         int                 `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Chronotype            Chronotype          `json:"chronotype"`
	PreferredFocusWindows []DailyMinuteWindow `json:"preferredFocusWindows"`
	MinRecoveryBufferMin  int                 `json:"minRecoveryBufferMin" minimum:"5" maximum:"60"`
}

// ── 2.3 个人日程与救援 DTO ──

// SchedulePresentation is user-selected display metadata, independent of solver categories.
// Goals currently originate from the account-isolated browser goal module.
type SchedulePresentation struct {
	AttributeTag string `json:"attributeTag,omitempty" enum:"review,collaboration,coding,research,routine,study,homework,exam,meeting,project,recovery"`
	GoalID       string `json:"goalId,omitempty" maxLength:"128"`
	GoalTitle    string `json:"goalTitle,omitempty" maxLength:"240"`
}

type ScheduleItemDTO struct {
	Presentation      *SchedulePresentation `json:"presentation,omitempty"`
	ID                uuid.UUID             `json:"id" format:"uuid"`
	UserID            uuid.UUID             `json:"userId" format:"uuid"`
	WorkspaceID       *uuid.UUID            `json:"workspaceId,omitempty" format:"uuid"`
	MeetingProposalID *uuid.UUID            `json:"meetingProposalId,omitempty" format:"uuid"`
	Title             string                `json:"title" minLength:"1" maxLength:"200"`
	Notes             string                `json:"notes"`
	Category          ScheduleCategory      `json:"category"`
	CognitiveLoad     CognitiveLoad         `json:"cognitiveLoad"`
	Flexibility       Flexibility           `json:"flexibility"`
	Status            ScheduleStatus        `json:"status"`
	StartAt           time.Time             `json:"startAt" format:"date-time"`
	EndAt             time.Time             `json:"endAt" format:"date-time"`
	DurationMinutes   int                   `json:"durationMinutes" minimum:"1"`
	DeadlineAt        *time.Time            `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes   int                   `json:"reminderMinutes" minimum:"0"`
	CreatedAt         time.Time             `json:"createdAt" format:"date-time"`
	UpdatedAt         time.Time             `json:"updatedAt" format:"date-time"`
}

type ScheduleItemSnapshot struct {
	Presentation      *SchedulePresentation `json:"presentation,omitempty"`
	ID                uuid.UUID             `json:"id" format:"uuid"`
	UserID            uuid.UUID             `json:"userId" format:"uuid"`
	WorkspaceID       *uuid.UUID            `json:"workspaceId,omitempty" format:"uuid"`
	MeetingProposalID *uuid.UUID            `json:"meetingProposalId,omitempty" format:"uuid"`
	Title             string                `json:"title"`
	Notes             string                `json:"notes"`
	Category          ScheduleCategory      `json:"category"`
	CognitiveLoad     CognitiveLoad         `json:"cognitiveLoad"`
	Flexibility       Flexibility           `json:"flexibility"`
	Status            ScheduleStatus        `json:"status"`
	StartAt           time.Time             `json:"startAt" format:"date-time"`
	EndAt             time.Time             `json:"endAt" format:"date-time"`
	DurationMinutes   int                   `json:"durationMinutes" minimum:"1"`
	DeadlineAt        *time.Time            `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes   int                   `json:"reminderMinutes" minimum:"0"`
	UpdatedAt         time.Time             `json:"updatedAt" format:"date-time"`
}

type ScheduleItemListResponse struct {
	Items            []ScheduleItemDTO `json:"items"`
	BaselineLocalDay string            `json:"baselineLocalDay" format:"date" doc:"baselineVersion 对应的用户本地锚定日期 (YYYY-MM-DD)"`
	BaselineVersion  string            `json:"baselineVersion"`
}

type ScheduleMutationResponse struct {
	Item             ScheduleItemDTO `json:"item"`
	BaselineLocalDay string          `json:"baselineLocalDay" format:"date" doc:"baselineVersion 对应的用户本地锚定日期 (YYYY-MM-DD)"`
	BaselineVersion  string          `json:"baselineVersion"`
}

type CreateScheduleItemRequest struct {
	Presentation    *SchedulePresentation `json:"presentation,omitempty"`
	Title           string                `json:"title" minLength:"1" maxLength:"200"`
	Notes           string                `json:"notes,omitempty"`
	Category        ScheduleCategory      `json:"category"`
	CognitiveLoad   CognitiveLoad         `json:"cognitiveLoad"`
	Flexibility     Flexibility           `json:"flexibility"`
	StartAt         time.Time             `json:"startAt" format:"date-time"`
	EndAt           time.Time             `json:"endAt" format:"date-time"`
	DeadlineAt      *time.Time            `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes *int                  `json:"reminderMinutes,omitempty" minimum:"0" default:"10"`
	AllowOverlap    bool                  `json:"allowOverlap,omitempty" default:"false"`
}

type UpdateScheduleItemRequest struct {
	Presentation    *SchedulePresentation    `json:"presentation,omitempty" doc:"提供对象会替换显示属性；空对象清除属性与目标关联，省略则保留"`
	Title           *string                  `json:"title,omitempty" minLength:"1" maxLength:"200"`
	Notes           *string                  `json:"notes,omitempty"`
	Category        *ScheduleCategory        `json:"category,omitempty"`
	CognitiveLoad   *CognitiveLoad           `json:"cognitiveLoad,omitempty"`
	Flexibility     *Flexibility             `json:"flexibility,omitempty"`
	Status          *ScheduleStatus          `json:"status,omitempty"`
	StartAt         *time.Time               `json:"startAt,omitempty" format:"date-time"`
	EndAt           *time.Time               `json:"endAt,omitempty" format:"date-time"`
	DeadlineAt      NullableField[time.Time] `json:"deadlineAt,omitzero" doc:"更新截止时间；传 null 可显式清除"`
	ClearDeadline   *bool                    `json:"clearDeadline,omitempty" doc:"为 true 时显式清除截止时间（等价于 deadlineAt=null）"`
	ReminderMinutes *int                     `json:"reminderMinutes,omitempty" minimum:"0"`
	AllowOverlap    *bool                    `json:"allowOverlap,omitempty"`
}

// ShouldClearDeadline 统一判断 PATCH 请求是否要求清除 deadlineAt。
func (r UpdateScheduleItemRequest) ShouldClearDeadline() bool {
	if r.ClearDeadline != nil && *r.ClearDeadline {
		return true
	}
	return r.DeadlineAt.Set && !r.DeadlineAt.Valid
}

type UrgentTaskDTO struct {
	Title           string        `json:"title" minLength:"1" maxLength:"200"`
	Notes           string        `json:"notes,omitempty"`
	DurationMinutes int           `json:"durationMinutes" minimum:"15" maximum:"480"`
	CognitiveLoad   CognitiveLoad `json:"cognitiveLoad"`
	DeadlineAt      time.Time     `json:"deadlineAt" format:"date-time"`
}

type RescueOptionsRequest struct {
	Day           string              `json:"day" format:"date"`
	TriggerReason RescueTriggerReason `json:"triggerReason"`
	UrgentTask    *UrgentTaskDTO      `json:"urgentTask,omitempty"`
}

type RescueDiffItem struct {
	Op            DiffOp           `json:"op"`
	ItemID        *uuid.UUID       `json:"itemId,omitempty" format:"uuid"`
	Title         string           `json:"title"`
	Category      ScheduleCategory `json:"category"`
	CognitiveLoad CognitiveLoad    `json:"cognitiveLoad"`
	Flexibility   Flexibility      `json:"flexibility"`
	BeforeStartAt *time.Time       `json:"beforeStartAt,omitempty" format:"date-time"`
	BeforeEndAt   *time.Time       `json:"beforeEndAt,omitempty" format:"date-time"`
	AfterStartAt  time.Time        `json:"afterStartAt" format:"date-time"`
	AfterEndAt    time.Time        `json:"afterEndAt" format:"date-time"`
	ReasonCode    string           `json:"reasonCode"`
	ReasonLabel   string           `json:"reasonLabel"`
}

type RescueOptionPlan struct {
	Strategy         RescueStrategy   `json:"strategy"`
	OptionHash       string           `json:"optionHash"`
	Feasible         bool             `json:"feasible"`
	MovedCount       int              `json:"movedCount" minimum:"0"`
	DeferredCount    int              `json:"deferredCount" minimum:"0"`
	RecoveryMinutes  int              `json:"recoveryMinutes" minimum:"0"`
	OverdueRiskCount int              `json:"overdueRiskCount" minimum:"0"`
	Summary          string           `json:"summary"`
	DiffItems        []RescueDiffItem `json:"diffItems"`
}

type RescueOptionsResponse struct {
	Day             string             `json:"day" format:"date"`
	BaselineVersion string             `json:"baselineVersion"`
	Options         []RescueOptionPlan `json:"options" minItems:"1"`
}

type RescueApplyRequest struct {
	Day                string              `json:"day" format:"date"`
	BaselineVersion    string              `json:"baselineVersion" minLength:"1"`
	Strategy           RescueStrategy      `json:"strategy"`
	TriggerReason      RescueTriggerReason `json:"triggerReason"`
	UrgentTask         *UrgentTaskDTO      `json:"urgentTask,omitempty"`
	ExpectedOptionHash string              `json:"expectedOptionHash,omitempty"`
}

type RescueApplyResponse struct {
	SnapshotID       uuid.UUID         `json:"snapshotId" format:"uuid"`
	Strategy         RescueStrategy    `json:"strategy"`
	BaselineLocalDay string            `json:"baselineLocalDay" format:"date"`
	BaselineVersion  string            `json:"baselineVersion"`
	AppliedItems     []ScheduleItemDTO `json:"appliedItems"`
}

type RescueUndoRequest struct {
	SnapshotID uuid.UUID `json:"snapshotId" format:"uuid"`
}

type RescueUndoResponse struct {
	SnapshotID       uuid.UUID            `json:"snapshotId" format:"uuid"`
	Status           RescueSnapshotStatus `json:"status"`
	BaselineLocalDay string               `json:"baselineLocalDay" format:"date"`
	BaselineVersion  string               `json:"baselineVersion"`
	RestoredItems    []ScheduleItemDTO    `json:"restoredItems"`
}

type RescueSnapshotRecord struct {
	ID              uuid.UUID              `json:"id" format:"uuid"`
	UserID          uuid.UUID              `json:"userId" format:"uuid"`
	LocalDay        string                 `json:"localDay" format:"date"`
	Strategy        RescueStrategy         `json:"strategy"`
	TriggerReason   RescueTriggerReason    `json:"triggerReason"`
	BaselineVersion string                 `json:"baselineVersion"`
	OptionHash      string                 `json:"optionHash"`
	Status          RescueSnapshotStatus   `json:"status"`
	BeforeItems     []ScheduleItemSnapshot `json:"beforeItems"`
	AfterItems      []ScheduleItemSnapshot `json:"afterItems"`
	AppliedAt       time.Time              `json:"appliedAt" format:"date-time"`
	RevertedAt      *time.Time             `json:"revertedAt,omitempty" format:"date-time"`
}

type RescueHistoryResponse struct {
	Snapshots  []RescueSnapshotRecord `json:"snapshots"`
	NextCursor *string                `json:"nextCursor,omitempty"`
}

// ── 2.4 团队空间与协同排会 DTO ──

type WorkspaceDTO struct {
	ID             uuid.UUID     `json:"id" format:"uuid"`
	Name           string        `json:"name" minLength:"1" maxLength:"64"`
	Description    string        `json:"description"`
	InviteCode     string        `json:"inviteCode"`
	OwnerID        uuid.UUID     `json:"ownerId" format:"uuid"`
	MyRole         WorkspaceRole `json:"myRole"`
	MyPrivacyLevel PrivacyLevel  `json:"myPrivacyLevel"`
	MemberCount    int           `json:"memberCount" minimum:"1"`
	CreatedAt      time.Time     `json:"createdAt" format:"date-time"`
	UpdatedAt      time.Time     `json:"updatedAt" format:"date-time"`
}

type CreateWorkspaceRequest struct {
	Name         string        `json:"name" minLength:"1" maxLength:"64"`
	Description  string        `json:"description,omitempty"`
	PrivacyLevel *PrivacyLevel `json:"privacyLevel,omitempty"`
}

type WorkspaceListResponse struct {
	Workspaces []WorkspaceDTO `json:"workspaces"`
}

type JoinWorkspaceRequest struct {
	InviteCode   string        `json:"inviteCode" minLength:"4" maxLength:"32"`
	PrivacyLevel *PrivacyLevel `json:"privacyLevel,omitempty"`
}

type UpdateWorkspaceMemberConfigRequest struct {
	PrivacyLevel PrivacyLevel `json:"privacyLevel"`
}

type WorkspaceMemberDTO struct {
	WorkspaceID  uuid.UUID     `json:"workspaceId" format:"uuid"`
	UserID       uuid.UUID     `json:"userId" format:"uuid"`
	DisplayName  string        `json:"displayName"`
	Role         WorkspaceRole `json:"role"`
	Timezone     string        `json:"timezone"`
	PrivacyLevel PrivacyLevel  `json:"privacyLevel"`
	JoinedAt     time.Time     `json:"joinedAt" format:"date-time"`
}

type WorkspaceMemberListResponse struct {
	WorkspaceID uuid.UUID            `json:"workspaceId" format:"uuid"`
	Members     []WorkspaceMemberDTO `json:"members"`
}

type AvailabilitySlot struct {
	StartAt time.Time            `json:"startAt" format:"date-time"`
	EndAt   time.Time            `json:"endAt" format:"date-time"`
	Kind    AvailabilitySlotKind `json:"kind"`
	Title   *string              `json:"title,omitempty"`
}

type PrivacyEnergyBucket struct {
	HourStartAt time.Time  `json:"hourStartAt" format:"date-time"`
	Tier        EnergyTier `json:"tier"`
}

type MemberAvailabilityView struct {
	UserID          uuid.UUID             `json:"userId" format:"uuid"`
	DisplayName     string                `json:"displayName"`
	Timezone        string                `json:"timezone"`
	PrivacyLevel    PrivacyLevel          `json:"privacyLevel"`
	WorkStartMinute int                   `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute   int                   `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Slots           []AvailabilitySlot    `json:"slots"`
	EnergyBuckets   []PrivacyEnergyBucket `json:"energyBuckets,omitempty"`
}

type WorkspaceAvailabilityResponse struct {
	WorkspaceID uuid.UUID                `json:"workspaceId" format:"uuid"`
	From        time.Time                `json:"from" format:"date-time"`
	To          time.Time                `json:"to" format:"date-time"`
	Members     []MemberAvailabilityView `json:"members"`
}

type RecommendMeetingRequest struct {
	Title               string        `json:"title" minLength:"1" maxLength:"200"`
	Description         string        `json:"description,omitempty"`
	DurationMinutes     int           `json:"durationMinutes" minimum:"15" maximum:"480"`
	CognitiveLoad       CognitiveLoad `json:"cognitiveLoad"`
	ParticipantIDs      []uuid.UUID   `json:"participantIds" minItems:"1"`
	OptionalIDs         []uuid.UUID   `json:"optionalIds,omitempty"`
	SearchFrom          time.Time     `json:"searchFrom" format:"date-time"`
	SearchTo            time.Time     `json:"searchTo" format:"date-time"`
	RespectFocusShields *bool         `json:"respectFocusShields,omitempty" default:"true"`
	MaxResults          *int          `json:"maxResults,omitempty" minimum:"1" maximum:"10" default:"3"`
}

type ScoreBreakdown struct {
	EnergyMatchScore        int     `json:"energyMatchScore" minimum:"0" maximum:"100"`
	FocusShieldScore        int     `json:"focusShieldScore" minimum:"0" maximum:"100"`
	CompactnessScore        int     `json:"compactnessScore" minimum:"0" maximum:"100"`
	OptionalAttendanceRatio float64 `json:"optionalAttendanceRatio" minimum:"0" maximum:"1"`
	EarlinessScore          int     `json:"earlinessScore" minimum:"0" maximum:"100"`
}

type MemberWindowImpact struct {
	UserID                   uuid.UUID   `json:"userId" format:"uuid"`
	DisplayName              string      `json:"displayName"`
	Required                 bool        `json:"required"`
	EnergyTier               *EnergyTier `json:"energyTier,omitempty"`
	BreaksFocusShield        bool        `json:"breaksFocusShield"`
	CausesContinuousOverload bool        `json:"causesContinuousOverload"`
}

type ExplanationTag struct {
	Code  string  `json:"code"`
	Tone  TagTone `json:"tone"`
	Label string  `json:"label"`
}

type GoldenWindowRecommendation struct {
	Rank            int                  `json:"rank" minimum:"1"`
	StartAt         time.Time            `json:"startAt" format:"date-time"`
	EndAt           time.Time            `json:"endAt" format:"date-time"`
	Score           int                  `json:"score" minimum:"0" maximum:"100"`
	Breakdown       ScoreBreakdown       `json:"breakdown"`
	AffectedMembers []MemberWindowImpact `json:"affectedMembers"`
	ExplanationTags []ExplanationTag     `json:"explanationTags"`
	Summary         string               `json:"summary"`
}

type BlockingDiagnostic struct {
	Code                 string      `json:"code"`
	Day                  *string     `json:"day,omitempty" format:"date"`
	Message              string      `json:"message"`
	BlockingUserIDs      []uuid.UUID `json:"blockingUserIds"`
	BlockingDisplayNames []string    `json:"blockingDisplayNames"`
	SuggestedAction      string      `json:"suggestedAction"`
}

type RecommendMeetingResponse struct {
	Recommendations     []GoldenWindowRecommendation `json:"recommendations"`
	BlockingDiagnostics []BlockingDiagnostic         `json:"blockingDiagnostics"`
}

type MeetingRecommendationMeta struct {
	Rank            int              `json:"rank,omitempty" minimum:"1"`
	Score           int              `json:"score,omitempty" minimum:"0" maximum:"100"`
	Breakdown       *ScoreBreakdown  `json:"breakdown,omitempty"`
	ExplanationTags []ExplanationTag `json:"explanationTags,omitempty"`
	Summary         string           `json:"summary,omitempty"`
}

type MeetingParticipantView struct {
	UserID         uuid.UUID             `json:"userId" format:"uuid"`
	DisplayName    string                `json:"displayName"`
	Required       bool                  `json:"required"`
	ResponseStatus MeetingResponseStatus `json:"responseStatus"`
}

type MeetingProposalDTO struct {
	ID                 uuid.UUID                  `json:"id" format:"uuid"`
	WorkspaceID        uuid.UUID                  `json:"workspaceId" format:"uuid"`
	OrganizerID        uuid.UUID                  `json:"organizerId" format:"uuid"`
	Title              string                     `json:"title"`
	Description        string                     `json:"description"`
	DurationMinutes    int                        `json:"durationMinutes"`
	CognitiveLoad      CognitiveLoad              `json:"cognitiveLoad"`
	Status             MeetingProposalStatus      `json:"status"`
	ConfirmedStartAt   *time.Time                 `json:"confirmedStartAt,omitempty" format:"date-time"`
	ConfirmedEndAt     *time.Time                 `json:"confirmedEndAt,omitempty" format:"date-time"`
	Participants       []MeetingParticipantView   `json:"participants"`
	RecommendationMeta *MeetingRecommendationMeta `json:"recommendationMeta,omitempty"`
	CreatedAt          time.Time                  `json:"createdAt" format:"date-time"`
	UpdatedAt          time.Time                  `json:"updatedAt" format:"date-time"`
}

type ConfirmMeetingRequest struct {
	ProposalID         *uuid.UUID                 `json:"proposalId,omitempty" format:"uuid"`
	Title              string                     `json:"title" minLength:"1" maxLength:"200"`
	Description        string                     `json:"description,omitempty"`
	CognitiveLoad      CognitiveLoad              `json:"cognitiveLoad"`
	ParticipantIDs     []uuid.UUID                `json:"participantIds" minItems:"1"`
	OptionalIDs        []uuid.UUID                `json:"optionalIds,omitempty"`
	StartAt            time.Time                  `json:"startAt" format:"date-time"`
	EndAt              time.Time                  `json:"endAt" format:"date-time"`
	RecommendationMeta *MeetingRecommendationMeta `json:"recommendationMeta,omitempty"`
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
	ResponseStatus MeetingDecisionStatus `json:"responseStatus"`
}

type RespondMeetingResponse struct {
	ProposalID     uuid.UUID             `json:"proposalId" format:"uuid"`
	UserID         uuid.UUID             `json:"userId" format:"uuid"`
	ResponseStatus MeetingDecisionStatus `json:"responseStatus"`
	ScheduleStatus ScheduleStatus        `json:"scheduleStatus"`
	UpdatedAt      time.Time             `json:"updatedAt" format:"date-time"`
}

type CancelMeetingRequest struct {
	Reason string `json:"reason,omitempty" maxLength:"280"`
}

type CancelMeetingResponse struct {
	ProposalID             uuid.UUID             `json:"proposalId" format:"uuid"`
	Status                 MeetingProposalStatus `json:"status"`
	CancelledScheduleCount int                   `json:"cancelledScheduleCount" minimum:"0"`
	UpdatedAt              time.Time             `json:"updatedAt" format:"date-time"`
}
