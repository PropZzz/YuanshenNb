package api

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/shixu-app/server/internal/engine"
)

func registerEnumSchema(r huma.Registry, name string, values ...any) *huma.Schema {
	if r != nil {
		m := r.Map()
		if _, exists := m[name]; !exists {
			s := &huma.Schema{
				Type: huma.TypeString,
				Enum: values,
			}
			s.PrecomputeMessages()
			m[name] = s
		}
	}
	return &huma.Schema{Ref: "#/components/schemas/" + name}
}

// UUIDParam 用于查询参数中的 UUID 字符串列表，规避 Huma 对 []uuid.UUID 查询切片解析的限制。
type UUIDParam string

func (UUIDParam) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{
		Type:   huma.TypeString,
		Format: "uuid",
	}
}

type HealthDBStatus string

const (
	DBStatusUp   HealthDBStatus = "up"
	DBStatusDown HealthDBStatus = "down"
)

func (HealthDBStatus) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "HealthDBStatus", string(DBStatusUp), string(DBStatusDown))
}

type ThemeMode string

const (
	ThemeSystem ThemeMode = "system"
	ThemeLight  ThemeMode = "light"
	ThemeDark   ThemeMode = "dark"
)

func (ThemeMode) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "ThemeMode", string(ThemeSystem), string(ThemeLight), string(ThemeDark))
}

type ReplayScenario string

const (
	ScenarioWellRested    ReplayScenario = "well_rested"
	ScenarioSleepDeprived ReplayScenario = "sleep_deprived"
	ScenarioHighStress    ReplayScenario = "high_stress"
)

func (ReplayScenario) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "ReplayScenario", string(ScenarioWellRested), string(ScenarioSleepDeprived), string(ScenarioHighStress))
}

type WorkspaceRole string

const (
	RoleOwner  WorkspaceRole = "owner"
	RoleAdmin  WorkspaceRole = "admin"
	RoleMember WorkspaceRole = "member"
)

func (WorkspaceRole) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "WorkspaceRole", string(RoleOwner), string(RoleAdmin), string(RoleMember))
}

type MeetingProposalStatus string

const (
	ProposalDraft     MeetingProposalStatus = "draft"
	ProposalConfirmed MeetingProposalStatus = "confirmed"
	ProposalCancelled MeetingProposalStatus = "cancelled"
)

func (MeetingProposalStatus) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "MeetingProposalStatus", string(ProposalDraft), string(ProposalConfirmed), string(ProposalCancelled))
}

type MeetingResponseStatus string

const (
	ResponsePending  MeetingResponseStatus = "pending"
	ResponseAccepted MeetingResponseStatus = "accepted"
	ResponseDeclined MeetingResponseStatus = "declined"
)

func (MeetingResponseStatus) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "MeetingResponseStatus", string(ResponsePending), string(ResponseAccepted), string(ResponseDeclined))
}

// MeetingDecisionStatus 表示参会人可提交的显式回执决策枚举。
type MeetingDecisionStatus string

const (
	DecisionAccepted MeetingDecisionStatus = "accepted"
	DecisionDeclined MeetingDecisionStatus = "declined"
)

func (MeetingDecisionStatus) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "MeetingDecisionStatus", string(DecisionAccepted), string(DecisionDeclined))
}

type RescueSnapshotStatus string

const (
	SnapshotApplied  RescueSnapshotStatus = "applied"
	SnapshotReverted RescueSnapshotStatus = "reverted"
)

func (RescueSnapshotStatus) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "RescueSnapshotStatus", string(SnapshotApplied), string(SnapshotReverted))
}

type SourceType string

const (
	SourceHealthConnect SourceType = SourceType(engine.SourceHealthConnect)
	SourceBLEGATT       SourceType = SourceType(engine.SourceBLEGATT)
	SourceReplayDemo    SourceType = SourceType(engine.SourceReplayDemo)
)

func (SourceType) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "SourceType", string(SourceHealthConnect), string(SourceBLEGATT), string(SourceReplayDemo))
}

type MetricType string

const (
	MetricHeartRate      MetricType = MetricType(engine.MetricHeartRate)
	MetricHRVRMSSD       MetricType = MetricType(engine.MetricHRVRMSSD)
	MetricRestingHR      MetricType = MetricType(engine.MetricRestingHR)
	MetricSleepSession   MetricType = MetricType(engine.MetricSleepSession)
	MetricSleepStage     MetricType = MetricType(engine.MetricSleepStage)
	MetricActiveCalories MetricType = MetricType(engine.MetricActiveCalories)
)

func (MetricType) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"MetricType",
		string(MetricHeartRate),
		string(MetricHRVRMSSD),
		string(MetricRestingHR),
		string(MetricSleepSession),
		string(MetricSleepStage),
		string(MetricActiveCalories),
	)
}

type SleepStage string

const (
	SleepStageDeep  SleepStage = SleepStage(engine.SleepStageDeep)
	SleepStageREM   SleepStage = SleepStage(engine.SleepStageREM)
	SleepStageLight SleepStage = SleepStage(engine.SleepStageLight)
	SleepStageAwake SleepStage = SleepStage(engine.SleepStageAwake)
)

func (SleepStage) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "SleepStage", string(SleepStageDeep), string(SleepStageREM), string(SleepStageLight), string(SleepStageAwake))
}

type Chronotype string

const (
	ChronotypeMorningLark Chronotype = Chronotype(engine.ChronotypeMorningLark)
	ChronotypeBalanced    Chronotype = Chronotype(engine.ChronotypeBalanced)
	ChronotypeNightOwl    Chronotype = Chronotype(engine.ChronotypeNightOwl)
)

func (Chronotype) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "Chronotype", string(ChronotypeMorningLark), string(ChronotypeBalanced), string(ChronotypeNightOwl))
}

type EnergyTier string

const (
	TierPeak     EnergyTier = EnergyTier(engine.TierPeak)
	TierSteady   EnergyTier = EnergyTier(engine.TierSteady)
	TierStrained EnergyTier = EnergyTier(engine.TierStrained)
	TierDepleted EnergyTier = EnergyTier(engine.TierDepleted)
)

func (EnergyTier) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "EnergyTier", string(TierPeak), string(TierSteady), string(TierStrained), string(TierDepleted))
}

type DataFreshness string

const (
	FreshnessLiveWearable   DataFreshness = DataFreshness(engine.FreshnessLiveWearable)
	FreshnessRecentWearable DataFreshness = DataFreshness(engine.FreshnessRecentWearable)
	FreshnessReplayDemo     DataFreshness = DataFreshness(engine.FreshnessReplayDemo)
	FreshnessBaselineOnly   DataFreshness = DataFreshness(engine.FreshnessBaselineOnly)
)

func (DataFreshness) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"DataFreshness",
		string(FreshnessLiveWearable),
		string(FreshnessRecentWearable),
		string(FreshnessReplayDemo),
		string(FreshnessBaselineOnly),
	)
}

type CognitiveLoad string

const (
	LoadHigh   CognitiveLoad = CognitiveLoad(engine.LoadHigh)
	LoadMedium CognitiveLoad = CognitiveLoad(engine.LoadMedium)
	LoadLow    CognitiveLoad = CognitiveLoad(engine.LoadLow)
)

func (CognitiveLoad) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "CognitiveLoad", string(LoadHigh), string(LoadMedium), string(LoadLow))
}

type ScheduleCategory string

const (
	CategoryDeepWork ScheduleCategory = ScheduleCategory(engine.CategoryDeepWork)
	CategoryMeeting  ScheduleCategory = ScheduleCategory(engine.CategoryMeeting)
	CategoryRecovery ScheduleCategory = ScheduleCategory(engine.CategoryRecovery)
	CategoryRoutine  ScheduleCategory = ScheduleCategory(engine.CategoryRoutine)
	CategoryUrgent   ScheduleCategory = ScheduleCategory(engine.CategoryUrgent)
)

func (ScheduleCategory) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"ScheduleCategory",
		string(CategoryDeepWork),
		string(CategoryMeeting),
		string(CategoryRecovery),
		string(CategoryRoutine),
		string(CategoryUrgent),
	)
}

type Flexibility string

const (
	FlexibilityHardLocked  Flexibility = Flexibility(engine.FlexibilityHardLocked)
	FlexibilityFlexible    Flexibility = Flexibility(engine.FlexibilityFlexible)
	FlexibilityFocusShield Flexibility = Flexibility(engine.FlexibilityFocusShield)
)

func (Flexibility) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "Flexibility", string(FlexibilityHardLocked), string(FlexibilityFlexible), string(FlexibilityFocusShield))
}

type ScheduleStatus string

const (
	StatusPlanned    ScheduleStatus = ScheduleStatus(engine.StatusPlanned)
	StatusInProgress ScheduleStatus = ScheduleStatus(engine.StatusInProgress)
	StatusCompleted  ScheduleStatus = ScheduleStatus(engine.StatusCompleted)
	StatusCancelled  ScheduleStatus = ScheduleStatus(engine.StatusCancelled)
)

func (ScheduleStatus) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "ScheduleStatus", string(StatusPlanned), string(StatusInProgress), string(StatusCompleted), string(StatusCancelled))
}

type PrivacyLevel string

const (
	PrivacyBusyOnly   PrivacyLevel = PrivacyLevel(engine.PrivacyBusyOnly)
	PrivacyEnergyTier PrivacyLevel = PrivacyLevel(engine.PrivacyEnergyTier)
	PrivacyFullTitle  PrivacyLevel = PrivacyLevel(engine.PrivacyFullTitle)
)

func (PrivacyLevel) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "PrivacyLevel", string(PrivacyBusyOnly), string(PrivacyEnergyTier), string(PrivacyFullTitle))
}

type AvailabilitySlotKind string

const (
	SlotKindBusy        AvailabilitySlotKind = AvailabilitySlotKind(engine.SlotKindBusy)
	SlotKindFocusShield AvailabilitySlotKind = AvailabilitySlotKind(engine.SlotKindFocusShield)
	SlotKindSoftBusy    AvailabilitySlotKind = AvailabilitySlotKind(engine.SlotKindSoftBusy)
)

func (AvailabilitySlotKind) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "AvailabilitySlotKind", string(SlotKindBusy), string(SlotKindFocusShield), string(SlotKindSoftBusy))
}

type RescueStrategy string

const (
	StrategyProtectDeadline RescueStrategy = RescueStrategy(engine.StrategyProtectDeadline)
	StrategyProtectRecovery RescueStrategy = RescueStrategy(engine.StrategyProtectRecovery)
	StrategyMinimizeChanges RescueStrategy = RescueStrategy(engine.StrategyMinimizeChanges)
)

func (RescueStrategy) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "RescueStrategy", string(StrategyProtectDeadline), string(StrategyProtectRecovery), string(StrategyMinimizeChanges))
}

type RescueTriggerReason string

const (
	TriggerUrgentTask          RescueTriggerReason = RescueTriggerReason(engine.TriggerUrgentTask)
	TriggerTeamMeetingOverload RescueTriggerReason = RescueTriggerReason(engine.TriggerTeamMeetingOverload)
	TriggerWearableFatigue     RescueTriggerReason = RescueTriggerReason(engine.TriggerWearableFatigue)
)

func (RescueTriggerReason) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "RescueTriggerReason", string(TriggerUrgentTask), string(TriggerTeamMeetingOverload), string(TriggerWearableFatigue))
}

type DiffOp string

const (
	DiffOpCreate    DiffOp = DiffOp(engine.DiffOpCreate)
	DiffOpMove      DiffOp = DiffOp(engine.DiffOpMove)
	DiffOpDefer     DiffOp = DiffOp(engine.DiffOpDefer)
	DiffOpUnchanged DiffOp = DiffOp(engine.DiffOpUnchanged)
)

func (DiffOp) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "DiffOp", string(DiffOpCreate), string(DiffOpMove), string(DiffOpDefer), string(DiffOpUnchanged))
}

type TagTone string

const (
	TonePositive TagTone = TagTone(engine.TonePositive)
	ToneWarning  TagTone = TagTone(engine.ToneWarning)
	ToneNeutral  TagTone = TagTone(engine.ToneNeutral)
)

func (TagTone) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "TagTone", string(TonePositive), string(ToneWarning), string(ToneNeutral))
}

type FocusShieldSource string

const (
	FocusShieldPreferredWindow FocusShieldSource = "preferred_window"
	FocusShieldAutoPeak        FocusShieldSource = "auto_peak"
)

func (FocusShieldSource) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "FocusShieldSource", string(FocusShieldPreferredWindow), string(FocusShieldAutoPeak))
}

type OverloadSeverity string

const (
	SeverityWarning  OverloadSeverity = "warning"
	SeverityCritical OverloadSeverity = "critical"
)

func (OverloadSeverity) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(r, "OverloadSeverity", string(SeverityWarning), string(SeverityCritical))
}

type ScheduleUpdateReason string

const (
	ScheduleReasonItemCreated       ScheduleUpdateReason = "item_created"
	ScheduleReasonItemUpdated       ScheduleUpdateReason = "item_updated"
	ScheduleReasonItemCancelled     ScheduleUpdateReason = "item_cancelled"
	ScheduleReasonRescueApplied     ScheduleUpdateReason = "rescue_applied"
	ScheduleReasonRescueReverted    ScheduleUpdateReason = "rescue_reverted"
	ScheduleReasonTeamMeetingSynced ScheduleUpdateReason = "team_meeting_synced"
)

func (ScheduleUpdateReason) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"ScheduleUpdateReason",
		string(ScheduleReasonItemCreated),
		string(ScheduleReasonItemUpdated),
		string(ScheduleReasonItemCancelled),
		string(ScheduleReasonRescueApplied),
		string(ScheduleReasonRescueReverted),
		string(ScheduleReasonTeamMeetingSynced),
	)
}

type AvailabilityChangeReason string

const (
	AvailabilityReasonScheduleChanged   AvailabilityChangeReason = "schedule_changed"
	AvailabilityReasonPrivacyChanged    AvailabilityChangeReason = "privacy_changed"
	AvailabilityReasonEnergyTierChanged AvailabilityChangeReason = "energy_tier_changed"
)

func (AvailabilityChangeReason) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"AvailabilityChangeReason",
		string(AvailabilityReasonScheduleChanged),
		string(AvailabilityReasonPrivacyChanged),
		string(AvailabilityReasonEnergyTierChanged),
	)
}

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

func (WsEventType) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"WsEventType",
		string(WsEnergyUpdated),
		string(WsEnergyOverloadAlert),
		string(WsScheduleUpdated),
		string(WsWorkspaceMeetingConfirmed),
		string(WsWorkspaceMeetingCancelled),
		string(WsWorkspaceMeetingResponded),
		string(WsWorkspaceAvailabilityChange),
	)
}
