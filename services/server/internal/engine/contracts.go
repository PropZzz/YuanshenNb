// Package engine 定义 P1（服务端基座与 DB）与 P2（核心算法引擎）之间的纯 Go 物理交接契约。
//
// 硬性边界约束：
// 1. 本包严禁引入 database/sql、pgx、net/http 或 Huma 依赖，所有算法均为确定性纯函数。
// 2. 团队投影结构体 MemberAvailabilityView 在类型系统层面隔离 HR/HRV/睡眠等原始生理字段。
package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ── 共享枚举常量（与 0001_init.sql CHECK 约束及 contracts/openapi.json 100% 对齐） ──

type SourceType string

const (
	SourceHealthConnect SourceType = "health_connect"
	SourceBLEGATT       SourceType = "ble_gatt"
	SourceReplayDemo    SourceType = "replay_demo"
)

type MetricType string

const (
	MetricHeartRate      MetricType = "heart_rate"
	MetricHRVRMSSD       MetricType = "hrv_rmssd"
	MetricRestingHR      MetricType = "resting_hr"
	MetricSleepSession   MetricType = "sleep_session"
	MetricSleepStage     MetricType = "sleep_stage"
	MetricActiveCalories MetricType = "active_calories"
)

type Chronotype string

const (
	ChronotypeMorningLark Chronotype = "morning_lark"
	ChronotypeBalanced    Chronotype = "balanced"
	ChronotypeNightOwl    Chronotype = "night_owl"
)

type EnergyTier string

const (
	TierPeak     EnergyTier = "peak"
	TierSteady   EnergyTier = "steady"
	TierStrained EnergyTier = "strained"
	TierDepleted EnergyTier = "depleted"
)

type DataFreshness string

const (
	FreshnessLiveWearable   DataFreshness = "live_wearable"
	FreshnessRecentWearable DataFreshness = "recent_wearable"
	FreshnessReplayDemo     DataFreshness = "replay_demo"
	FreshnessBaselineOnly   DataFreshness = "baseline_only"
)

type CognitiveLoad string

const (
	LoadHigh   CognitiveLoad = "high"
	LoadMedium CognitiveLoad = "medium"
	LoadLow    CognitiveLoad = "low"
)

type ScheduleCategory string

const (
	CategoryDeepWork ScheduleCategory = "deep_work"
	CategoryMeeting  ScheduleCategory = "meeting"
	CategoryRecovery ScheduleCategory = "recovery"
	CategoryRoutine  ScheduleCategory = "routine"
	CategoryUrgent   ScheduleCategory = "urgent"
)

type Flexibility string

const (
	FlexibilityHardLocked  Flexibility = "hard_locked"
	FlexibilityFlexible    Flexibility = "flexible"
	FlexibilityFocusShield Flexibility = "focus_shield"
)

type ScheduleStatus string

const (
	StatusPlanned    ScheduleStatus = "planned"
	StatusInProgress ScheduleStatus = "in_progress"
	StatusCompleted  ScheduleStatus = "completed"
	StatusCancelled  ScheduleStatus = "cancelled"
)

type PrivacyLevel string

const (
	PrivacyBusyOnly   PrivacyLevel = "busy_only"
	PrivacyEnergyTier PrivacyLevel = "energy_tier"
	PrivacyFullTitle  PrivacyLevel = "full_title"
)

type AvailabilitySlotKind string

const (
	SlotKindBusy        AvailabilitySlotKind = "busy"
	SlotKindFocusShield AvailabilitySlotKind = "focus_shield"
	SlotKindSoftBusy    AvailabilitySlotKind = "soft_busy"
)

type RescueStrategy string

const (
	StrategyProtectDeadline RescueStrategy = "protect_deadline"
	StrategyProtectRecovery RescueStrategy = "protect_recovery"
	StrategyMinimizeChanges RescueStrategy = "minimize_changes"
)

type RescueTriggerReason string

const (
	TriggerUrgentTask          RescueTriggerReason = "urgent_task"
	TriggerTeamMeetingOverload RescueTriggerReason = "team_meeting_overload"
	TriggerWearableFatigue     RescueTriggerReason = "wearable_fatigue"
)

type DiffOp string

const (
	DiffOpCreate    DiffOp = "create"
	DiffOpMove      DiffOp = "move"
	DiffOpDefer     DiffOp = "defer"
	DiffOpUnchanged DiffOp = "unchanged"
)

type TagTone string

const (
	TonePositive TagTone = "positive"
	ToneWarning  TagTone = "warning"
	ToneNeutral  TagTone = "neutral"
)

// ── 共享基础值对象 ──

type DailyMinuteWindow struct {
	StartMinute int `json:"startMinute" minimum:"0" maximum:"1439"`
	EndMinute   int `json:"endMinute" minimum:"1" maximum:"1440"`
}

type EnergyProfileInput struct {
	UserID                uuid.UUID           `json:"userId" format:"uuid"`
	Timezone              string              `json:"timezone"`
	WorkStartMinute       int                 `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute         int                 `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Chronotype            Chronotype          `json:"chronotype" enum:"morning_lark,balanced,night_owl"`
	PreferredFocusWindows []DailyMinuteWindow `json:"preferredFocusWindows"`
	HRVBaselineMs         *float64            `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm        *float64            `json:"rhrBaselineBpm,omitempty"`
	MinRecoveryBufferMin  int                 `json:"minRecoveryBufferMin" minimum:"5" maximum:"60"`
}

type BiometricSampleInput struct {
	SourceType   SourceType     `json:"sourceType" enum:"health_connect,ble_gatt,replay_demo"`
	MetricType   MetricType     `json:"metricType" enum:"heart_rate,hrv_rmssd,resting_hr,sleep_session,sleep_stage,active_calories"`
	RecordedAt   time.Time      `json:"recordedAt" format:"date-time"`
	EndAt        *time.Time     `json:"endAt,omitempty" format:"date-time"`
	NumericValue float64        `json:"numericValue"`
	Unit         string         `json:"unit"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	ExternalID   string         `json:"externalId"`
}

// ScheduleItemSnapshot 是引擎层使用的标准日程快照（只含物理时间与领域字段，无 UI 字段）。
type ScheduleItemSnapshot struct {
	ID              uuid.UUID        `json:"id" format:"uuid"`
	UserID          uuid.UUID        `json:"userId" format:"uuid"`
	WorkspaceID     *uuid.UUID       `json:"workspaceId,omitempty" format:"uuid"`
	ProposalID      *uuid.UUID       `json:"meetingProposalId,omitempty" format:"uuid"`
	Title           string           `json:"title"`
	Notes           string           `json:"notes"`
	Category        ScheduleCategory `json:"category" enum:"deep_work,meeting,recovery,routine,urgent"`
	CognitiveLoad   CognitiveLoad    `json:"cognitiveLoad" enum:"high,medium,low"`
	Flexibility     Flexibility      `json:"flexibility" enum:"hard_locked,flexible,focus_shield"`
	Status          ScheduleStatus   `json:"status" enum:"planned,in_progress,completed,cancelled"`
	StartAt         time.Time        `json:"startAt" format:"date-time"`
	EndAt           time.Time        `json:"endAt" format:"date-time"`
	DurationMinutes int              `json:"durationMinutes" minimum:"1"`
	DeadlineAt      *time.Time       `json:"deadlineAt,omitempty" format:"date-time"`
	ReminderMinutes int              `json:"reminderMinutes" minimum:"0"`
	UpdatedAt       time.Time        `json:"updatedAt" format:"date-time"`
}

// ── 1. 精力推理引擎契约（EnergyEngine） ──

type EnergyComputeInput struct {
	Now           time.Time              `json:"now"`
	LocalDay      string                 `json:"localDay"` // YYYY-MM-DD
	Profile       EnergyProfileInput     `json:"profile"`
	Samples14Days []BiometricSampleInput `json:"samples14Days"`
	DaySchedules  []ScheduleItemSnapshot `json:"daySchedules"`
}

type HourlyEnergyPoint struct {
	HourStartAt time.Time  `json:"hourStartAt" format:"date-time"`
	Score       int        `json:"score" minimum:"0" maximum:"100"`
	Tier        EnergyTier `json:"tier" enum:"peak,steady,strained,depleted"`
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
	StartAt  time.Time `json:"startAt" format:"date-time"`
	EndAt    time.Time `json:"endAt" format:"date-time"`
	AvgScore int       `json:"avgScore" minimum:"0" maximum:"100"`
	Source   string    `json:"source" enum:"preferred_window,auto_peak"`
}

type OverloadAlert struct {
	TriggerReason       RescueTriggerReason `json:"triggerReason" enum:"urgent_task,team_meeting_overload,wearable_fatigue"`
	Severity            string              `json:"severity" enum:"warning,critical"`
	CurrentScore        int                 `json:"currentScore" minimum:"0" maximum:"100"`
	Tier                EnergyTier          `json:"tier" enum:"peak,steady,strained,depleted"`
	Message             string              `json:"message"`
	RecommendedStrategy RescueStrategy      `json:"recommendedStrategy" enum:"protect_deadline,protect_recovery,minimize_changes"`
}

type EnergySourceDiagnostics struct {
	LastSyncedAt      *time.Time  `json:"lastSyncedAt,omitempty" format:"date-time"`
	PrimarySource     *SourceType `json:"primarySource,omitempty" enum:"health_connect,ble_gatt,replay_demo"`
	BaselineReadyDays int         `json:"baselineReadyDays" minimum:"0" maximum:"14"`
	HRVBaselineMs     *float64    `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm    *float64    `json:"rhrBaselineBpm,omitempty"`
}

type EnergyComputeOutput struct {
	LocalDay      string                  `json:"localDay" format:"date"`
	Timezone      string                  `json:"timezone"`
	ComputedAt    time.Time               `json:"computedAt" format:"date-time"`
	Score         int                     `json:"score" minimum:"0" maximum:"100"`
	Tier          EnergyTier              `json:"tier" enum:"peak,steady,strained,depleted"`
	DataFreshness DataFreshness           `json:"dataFreshness" enum:"live_wearable,recent_wearable,replay_demo,baseline_only"`
	Drivers       EnergyDrivers           `json:"drivers"`
	HourlyCurve   []HourlyEnergyPoint     `json:"hourlyCurve"`
	FocusShields  []FocusShieldWindow     `json:"focusShields"`
	OverloadAlert *OverloadAlert          `json:"overloadAlert,omitempty"`
	Diagnostics   EnergySourceDiagnostics `json:"diagnostics"`
	// UpdatedHRVBaseline / UpdatedRHRBaseline 供 P1 持久化写回 energy_profiles，不在 HTTP 响应体重复序列化（前端读取 diagnostics）。
	UpdatedHRVBaseline *float64 `json:"-"`
	UpdatedRHRBaseline *float64 `json:"-"`
}

type EnergyEngine interface {
	ComputeSnapshot(in EnergyComputeInput) (EnergyComputeOutput, error)
}

// ── 2. 团队隐私投影与协同排会引擎契约（TeamPlannerEngine） ──

type MemberRawSchedulingData struct {
	UserID       uuid.UUID              `json:"userId"`
	DisplayName  string                 `json:"displayName"`
	PrivacyLevel PrivacyLevel           `json:"privacyLevel"`
	Profile      EnergyProfileInput     `json:"profile"`
	Schedules    []ScheduleItemSnapshot `json:"schedules"`
	// PredictedCurve 由后端预先按成员个体数据算好传入投影器，投影后仅允许输出 Tier，绝不透出 Score 或原始生理样本。
	PredictedCurve []HourlyEnergyPoint `json:"predictedCurve"`
}

type AvailabilityProjectionInput struct {
	From    time.Time                 `json:"from"`
	To      time.Time                 `json:"to"`
	Members []MemberRawSchedulingData `json:"members"`
}

type AvailabilitySlot struct {
	StartAt time.Time            `json:"startAt" format:"date-time"`
	EndAt   time.Time            `json:"endAt" format:"date-time"`
	Kind    AvailabilitySlotKind `json:"kind" enum:"busy,focus_shield,soft_busy"`
	Title   *string              `json:"title,omitempty"` // 仅 privacyLevel == full_title 时非空
}

// PrivacyEnergyBucket 物理剔除 Score 字段，保证团队视图无法反推个人精确生理状态。
type PrivacyEnergyBucket struct {
	HourStartAt time.Time  `json:"hourStartAt" format:"date-time"`
	Tier        EnergyTier `json:"tier" enum:"peak,steady,strained,depleted"`
}

type MemberAvailabilityView struct {
	UserID          uuid.UUID             `json:"userId" format:"uuid"`
	DisplayName     string                `json:"displayName"`
	Timezone        string                `json:"timezone"`
	PrivacyLevel    PrivacyLevel          `json:"privacyLevel" enum:"busy_only,energy_tier,full_title"`
	WorkStartMinute int                   `json:"workStartMinute" minimum:"0" maximum:"1439"`
	WorkEndMinute   int                   `json:"workEndMinute" minimum:"1" maximum:"1440"`
	Slots           []AvailabilitySlot    `json:"slots"`
	EnergyBuckets   []PrivacyEnergyBucket `json:"energyBuckets,omitempty"`
}

type MeetingSolverInput struct {
	Title               string                    `json:"title"`
	DurationMinutes     int                       `json:"durationMinutes"`
	CognitiveLoad       CognitiveLoad             `json:"cognitiveLoad"`
	RequiredUserIDs     []uuid.UUID               `json:"requiredUserIds"`
	OptionalUserIDs     []uuid.UUID               `json:"optionalUserIds"`
	SearchFrom          time.Time                 `json:"searchFrom"`
	SearchTo            time.Time                 `json:"searchTo"`
	RespectFocusShields bool                      `json:"respectFocusShields"`
	Members             []MemberRawSchedulingData `json:"members"`
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
	EnergyTier               *EnergyTier `json:"energyTier,omitempty" enum:"peak,steady,strained,depleted"`
	BreaksFocusShield        bool        `json:"breaksFocusShield"`
	CausesContinuousOverload bool        `json:"causesContinuousOverload"`
}

type ExplanationTag struct {
	Code  string  `json:"code"`
	Tone  TagTone `json:"tone" enum:"positive,warning,neutral"`
	Label string  `json:"label"`
}

type GoldenWindowRecommendation struct {
	Rank            int                  `json:"rank" minimum:"1" maximum:"3"`
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

type MeetingSolverOutput struct {
	Recommendations     []GoldenWindowRecommendation `json:"recommendations"`
	BlockingDiagnostics []BlockingDiagnostic         `json:"blockingDiagnostics"`
}

type TeamPlannerEngine interface {
	ProjectAvailability(in AvailabilityProjectionInput) ([]MemberAvailabilityView, error)
	RecommendWindows(in MeetingSolverInput) (MeetingSolverOutput, error)
}

// ── 3. 个人日程救援引擎契约（RescueEngine） ──

type UrgentTaskInput struct {
	Title           string        `json:"title"`
	Notes           string        `json:"notes"`
	DurationMinutes int           `json:"durationMinutes"`
	CognitiveLoad   CognitiveLoad `json:"cognitiveLoad"`
	DeadlineAt      time.Time     `json:"deadlineAt"`
}

type RescueSolverInput struct {
	Now             time.Time              `json:"now"`
	LocalDay        string                 `json:"localDay"` // YYYY-MM-DD
	BaselineVersion string                 `json:"baselineVersion"`
	TriggerReason   RescueTriggerReason    `json:"triggerReason"`
	UrgentTask      *UrgentTaskInput       `json:"urgentTask,omitempty"`
	Profile         EnergyProfileInput     `json:"profile"`
	PredictedCurve  []HourlyEnergyPoint    `json:"predictedCurve"`
	WindowSchedules []ScheduleItemSnapshot `json:"windowSchedules"` // 覆盖 [dayStartUTC, dayStartUTC + 48h)
}

type RescueDiffItem struct {
	Op            DiffOp           `json:"op" enum:"create,move,defer,unchanged"`
	ItemID        *uuid.UUID       `json:"itemId,omitempty" format:"uuid"`
	Title         string           `json:"title"`
	Category      ScheduleCategory `json:"category" enum:"deep_work,meeting,recovery,routine,urgent"`
	CognitiveLoad CognitiveLoad    `json:"cognitiveLoad" enum:"high,medium,low"`
	Flexibility   Flexibility      `json:"flexibility" enum:"hard_locked,flexible,focus_shield"`
	BeforeStartAt *time.Time       `json:"beforeStartAt,omitempty" format:"date-time"`
	BeforeEndAt   *time.Time       `json:"beforeEndAt,omitempty" format:"date-time"`
	AfterStartAt  time.Time        `json:"afterStartAt" format:"date-time"`
	AfterEndAt    time.Time        `json:"afterEndAt" format:"date-time"`
	ReasonCode    string           `json:"reasonCode"`
	ReasonLabel   string           `json:"reasonLabel"`
}

type RescueOptionPlan struct {
	Strategy         RescueStrategy   `json:"strategy" enum:"protect_deadline,protect_recovery,minimize_changes"`
	OptionHash       string           `json:"optionHash"`
	Feasible         bool             `json:"feasible"`
	MovedCount       int              `json:"movedCount" minimum:"0"`
	DeferredCount    int              `json:"deferredCount" minimum:"0"`
	RecoveryMinutes  int              `json:"recoveryMinutes" minimum:"0"`
	OverdueRiskCount int              `json:"overdueRiskCount" minimum:"0"`
	Summary          string           `json:"summary"`
	DiffItems        []RescueDiffItem `json:"diffItems"`
}

type RescueSolverOutput struct {
	LocalDay        string             `json:"localDay"`
	BaselineVersion string             `json:"baselineVersion"`
	Options         []RescueOptionPlan `json:"options"` // 严格按 protect_deadline, protect_recovery, minimize_changes 产出 3 套方案
}

type RescueEngine interface {
	BuildOptions(in RescueSolverInput) (RescueSolverOutput, error)
}

// ── 确定性乐观锁基线版本号计算（P1 与 P2 共享单一规范实现） ──

// ComputeBaselineVersion 按 docs/01 4.2.2 规范计算 48h 影响窗口的确定性乐观锁摘要。
// 调用方须确保传入的 items 为 [dayStartUTC, dayStartUTC + 48h) 窗口内 status <> 'cancelled' 的日程快照。
func ComputeBaselineVersion(localDay string, items []ScheduleItemSnapshot) string {
	active := make([]ScheduleItemSnapshot, 0, len(items))
	for _, it := range items {
		if it.Status == StatusCancelled {
			continue
		}
		active = append(active, it)
	}
	if len(active) == 0 {
		return "empty:" + localDay
	}

	sort.Slice(active, func(i, j int) bool {
		return active[i].ID.String() < active[j].ID.String()
	})

	var b strings.Builder
	b.WriteString(localDay)
	for _, it := range active {
		fmt.Fprintf(
			&b,
			"|%s|%s|%s|%s|%s|%s",
			it.ID.String(),
			it.StartAt.UTC().Format(time.RFC3339Nano),
			it.EndAt.UTC().Format(time.RFC3339Nano),
			it.Status,
			it.Flexibility,
			it.UpdatedAt.UTC().Format(time.RFC3339Nano),
		)
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])[:16]
}
