// Package engine 定义 P1（服务端基座与 DB）与 P2（核心算法引擎）之间的纯 Go 物理交接契约。
//
// 硬性边界约束：
// 1. 本包严禁引入 database/sql、pgx、net/http 或 Huma 依赖，所有算法均为确定性纯函数。
// 2. 团队输入/输出结构体 WorkScheduleProfile 与 MemberAvailabilityView 在类型系统层面彻底隔离 HR/HRV/睡眠等原始生理字段。
// 3. 仅使用标准库 encoding/json 标签（供 JSONB 快照持久化与测试夹具），不承载传输层 OpenAPI 校验标签。
package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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

type SleepStage string

const (
	SleepStageDeep  SleepStage = "deep"
	SleepStageREM   SleepStage = "rem"
	SleepStageLight SleepStage = "light"
	SleepStageAwake SleepStage = "awake"
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
	StartMinute int `json:"startMinute"`
	EndMinute   int `json:"endMinute"`
}

// WorkScheduleProfile 仅包含工作日边界与节律偏好，类型层面不含 HRV/RHR 等个人生理基线字段，供团队排会引擎安全使用。
type WorkScheduleProfile struct {
	UserID                uuid.UUID           `json:"userId"`
	Timezone              string              `json:"timezone"`
	WorkStartMinute       int                 `json:"workStartMinute"`
	WorkEndMinute         int                 `json:"workEndMinute"`
	Chronotype            Chronotype          `json:"chronotype"`
	PreferredFocusWindows []DailyMinuteWindow `json:"preferredFocusWindows"`
	MinRecoveryBufferMin  int                 `json:"minRecoveryBufferMin"`
}

// EnergyProfileInput 供个人精力引擎与救援引擎使用，包含个人近 14 日生理基线缓存。
type EnergyProfileInput struct {
	WorkScheduleProfile
	HRVBaselineMs  *float64 `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm *float64 `json:"rhrBaselineBpm,omitempty"`
}

type BiometricSampleInput struct {
	SourceType   SourceType     `json:"sourceType"`
	MetricType   MetricType     `json:"metricType"`
	RecordedAt   time.Time      `json:"recordedAt"`
	EndAt        *time.Time     `json:"endAt,omitempty"`
	NumericValue float64        `json:"numericValue"`
	Unit         string         `json:"unit"`
	SleepStage   *SleepStage    `json:"sleepStage,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	ExternalID   string         `json:"externalId"`
}

// ScheduleItemSnapshot 是引擎层使用的标准日程快照（只含物理时间与领域字段，无 UI 字段）。
type ScheduleItemSnapshot struct {
	ID              uuid.UUID        `json:"id"`
	UserID          uuid.UUID        `json:"userId"`
	WorkspaceID     *uuid.UUID       `json:"workspaceId,omitempty"`
	ProposalID      *uuid.UUID       `json:"meetingProposalId,omitempty"`
	Title           string           `json:"title"`
	Notes           string           `json:"notes"`
	Category        ScheduleCategory `json:"category"`
	CognitiveLoad   CognitiveLoad    `json:"cognitiveLoad"`
	Flexibility     Flexibility      `json:"flexibility"`
	Status          ScheduleStatus   `json:"status"`
	StartAt         time.Time        `json:"startAt"`
	EndAt           time.Time        `json:"endAt"`
	DurationMinutes int              `json:"durationMinutes"`
	DeadlineAt      *time.Time       `json:"deadlineAt,omitempty"`
	ReminderMinutes int              `json:"reminderMinutes"`
	UpdatedAt       time.Time        `json:"updatedAt"`
}

// ── 1. 精力推理引擎契约（EnergyEngine） ──

type EnergyComputeInput struct {
	Now           time.Time              `json:"now"`
	LocalDay      string                 `json:"localDay"` // YYYY-MM-DD
	Profile       EnergyProfileInput     `json:"profile"`
	Samples14Days []BiometricSampleInput `json:"samples14Days"`
	// DaySchedules 传入与 LocalDay（按 Profile.Timezone 换算的本地自然日 [dayStartUTC, nextDayStartUTC)）有交集的有效日程。
	DaySchedules []ScheduleItemSnapshot `json:"daySchedules"`
}

type HourlyEnergyPoint struct {
	HourStartAt time.Time  `json:"hourStartAt"`
	Score       int        `json:"score"`
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
	StartAt  time.Time `json:"startAt"`
	EndAt    time.Time `json:"endAt"`
	AvgScore int       `json:"avgScore"`
	Source   string    `json:"source"`
}

type OverloadAlert struct {
	TriggerReason       RescueTriggerReason `json:"triggerReason"`
	Severity            string              `json:"severity"`
	CurrentScore        int                 `json:"currentScore"`
	Tier                EnergyTier          `json:"tier"`
	Message             string              `json:"message"`
	RecommendedStrategy RescueStrategy      `json:"recommendedStrategy"`
}

type EnergySourceDiagnostics struct {
	LastSyncedAt      *time.Time  `json:"lastSyncedAt,omitempty"`
	PrimarySource     *SourceType `json:"primarySource,omitempty"`
	BaselineReadyDays int         `json:"baselineReadyDays"`
	HRVBaselineMs     *float64    `json:"hrvBaselineMs,omitempty"`
	RHRBaselineBpm    *float64    `json:"rhrBaselineBpm,omitempty"`
}

type EnergyComputeOutput struct {
	LocalDay      string        `json:"localDay"`
	Timezone      string        `json:"timezone"`
	ComputedAt    time.Time     `json:"computedAt"`
	Score         int           `json:"score"`
	Tier          EnergyTier    `json:"tier"`
	DataFreshness DataFreshness `json:"dataFreshness"`
	Drivers       EnergyDrivers `json:"drivers"`
	// HourlyCurve 严格覆盖 LocalDay 在 Profile.Timezone 下的本地自然日所有整点小时 [dayStartLocal, nextDayStartLocal)
	//（常规日期 24 个点位，DST 切换日 23 或 25 个点位）。
	HourlyCurve   []HourlyEnergyPoint     `json:"hourlyCurve"`
	FocusShields  []FocusShieldWindow     `json:"focusShields"`
	OverloadAlert *OverloadAlert          `json:"overloadAlert,omitempty"`
	Diagnostics   EnergySourceDiagnostics `json:"diagnostics"`
	// UpdatedHRVBaseline / UpdatedRHRBaseline 供 P1 持久化写回 energy_profiles，不直接作为 HTTP 响应透出。
	UpdatedHRVBaseline *float64 `json:"-"`
	UpdatedRHRBaseline *float64 `json:"-"`
}

type EnergyEngine interface {
	ComputeSnapshot(ctx context.Context, in EnergyComputeInput) (EnergyComputeOutput, error)
}

// ── 2. 团队隐私投影与协同排会引擎契约（TeamPlannerEngine） ──

type MemberRawSchedulingData struct {
	UserID       uuid.UUID              `json:"userId"`
	DisplayName  string                 `json:"displayName"`
	PrivacyLevel PrivacyLevel           `json:"privacyLevel"`
	Profile      WorkScheduleProfile    `json:"profile"`
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
	StartAt time.Time            `json:"startAt"`
	EndAt   time.Time            `json:"endAt"`
	Kind    AvailabilitySlotKind `json:"kind"`
	Title   *string              `json:"title,omitempty"` // 仅 privacyLevel == full_title 时非空
}

// PrivacyEnergyBucket 物理剔除 Score 字段，保证团队视图无法反推个人精确生理状态。
type PrivacyEnergyBucket struct {
	HourStartAt time.Time  `json:"hourStartAt"`
	Tier        EnergyTier `json:"tier"`
}

type MemberAvailabilityView struct {
	UserID          uuid.UUID             `json:"userId"`
	DisplayName     string                `json:"displayName"`
	Timezone        string                `json:"timezone"`
	PrivacyLevel    PrivacyLevel          `json:"privacyLevel"`
	WorkStartMinute int                   `json:"workStartMinute"`
	WorkEndMinute   int                   `json:"workEndMinute"`
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
	MaxResults          int                       `json:"maxResults,omitempty"` // <= 0 时默认返回最多 3 个推荐窗口
	Members             []MemberRawSchedulingData `json:"members"`
}

type ScoreBreakdown struct {
	EnergyMatchScore        int     `json:"energyMatchScore"`
	FocusShieldScore        int     `json:"focusShieldScore"`
	CompactnessScore        int     `json:"compactnessScore"`
	OptionalAttendanceRatio float64 `json:"optionalAttendanceRatio"`
	EarlinessScore          int     `json:"earlinessScore"`
}

type MemberWindowImpact struct {
	UserID                   uuid.UUID   `json:"userId"`
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
	Rank            int                  `json:"rank"`
	StartAt         time.Time            `json:"startAt"`
	EndAt           time.Time            `json:"endAt"`
	Score           int                  `json:"score"`
	Breakdown       ScoreBreakdown       `json:"breakdown"`
	AffectedMembers []MemberWindowImpact `json:"affectedMembers"`
	ExplanationTags []ExplanationTag     `json:"explanationTags"`
	Summary         string               `json:"summary"`
}

type BlockingDiagnostic struct {
	Code                 string      `json:"code"`
	Day                  *string     `json:"day,omitempty"`
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
	ProjectAvailability(ctx context.Context, in AvailabilityProjectionInput) ([]MemberAvailabilityView, error)
	RecommendWindows(ctx context.Context, in MeetingSolverInput) (MeetingSolverOutput, error)
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
	Strategies      []RescueStrategy       `json:"strategies,omitempty"` // 为空时默认求解全部 3 套标准策略
	Profile         EnergyProfileInput     `json:"profile"`
	PredictedCurve  []HourlyEnergyPoint    `json:"predictedCurve"`
	WindowSchedules []ScheduleItemSnapshot `json:"windowSchedules"` // 覆盖 [dayStartUTC, dayStartUTC + 48h)
}

type RescueDiffItem struct {
	Op            DiffOp           `json:"op"`
	ItemID        *uuid.UUID       `json:"itemId,omitempty"`
	Title         string           `json:"title"`
	Category      ScheduleCategory `json:"category"`
	CognitiveLoad CognitiveLoad    `json:"cognitiveLoad"`
	Flexibility   Flexibility      `json:"flexibility"`
	BeforeStartAt *time.Time       `json:"beforeStartAt,omitempty"`
	BeforeEndAt   *time.Time       `json:"beforeEndAt,omitempty"`
	AfterStartAt  time.Time        `json:"afterStartAt"`
	AfterEndAt    time.Time        `json:"afterEndAt"`
	ReasonCode    string           `json:"reasonCode"`
	ReasonLabel   string           `json:"reasonLabel"`
}

type RescueOptionPlan struct {
	Strategy         RescueStrategy   `json:"strategy"`
	OptionHash       string           `json:"optionHash"`
	Feasible         bool             `json:"feasible"`
	MovedCount       int              `json:"movedCount"`
	DeferredCount    int              `json:"deferredCount"`
	RecoveryMinutes  int              `json:"recoveryMinutes"`
	OverdueRiskCount int              `json:"overdueRiskCount"`
	Summary          string           `json:"summary"`
	DiffItems        []RescueDiffItem `json:"diffItems"`
}

type RescueSolverOutput struct {
	LocalDay        string             `json:"localDay"`
	BaselineVersion string             `json:"baselineVersion"`
	Options         []RescueOptionPlan `json:"options"`
}

type RescueEngine interface {
	BuildOptions(ctx context.Context, in RescueSolverInput) (RescueSolverOutput, error)
}

// ── 本地日期时间窗与确定性乐观锁基线版本号计算（P1 与 P2 共享单一规范实现） ──

// LocalDayWindowUTC 将本地日历日 YYYY-MM-DD 与 IANA 时区换算为 UTC 半开区间 [dayStartUTC, nextDayStartUTC)。
func LocalDayWindowUTC(localDay, timezone string) (dayStartUTC, nextDayStartUTC time.Time, err error) {
	if len(localDay) != len("2006-01-02") {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid localDay %q: expected YYYY-MM-DD", localDay)
	}
	parsed, err := time.Parse("2006-01-02", localDay)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid localDay %q: %w", localDay, err)
	}
	if strings.TrimSpace(timezone) == "" {
		return time.Time{}, time.Time{}, errors.New("timezone must not be empty")
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid timezone %q: %w", timezone, err)
	}
	dayStartLocal := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, loc)
	nextDayLocal := dayStartLocal.AddDate(0, 0, 1)
	return dayStartLocal.UTC(), nextDayLocal.UTC(), nil
}

// RescueWindowUTC 计算 48 小时救援乐观锁与搜索影响窗口 [dayStartUTC, dayStartUTC + 48h)。
func RescueWindowUTC(localDay, timezone string) (startUTC, endUTC time.Time, err error) {
	dayStartUTC, _, err := LocalDayWindowUTC(localDay, timezone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return dayStartUTC, dayStartUTC.Add(48 * time.Hour), nil
}

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
