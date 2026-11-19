package api

import (
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
)

// FromEngineEnergyOutput 将纯算法精力输出转换为对外 HTTP 响应 DTO，保证切片字段恒非 nil。
func FromEngineEnergyOutput(out engine.EnergyComputeOutput) EnergyTodayResponse {
	hourly := make([]HourlyEnergyPoint, len(out.HourlyCurve))
	for i, pt := range out.HourlyCurve {
		hourly[i] = HourlyEnergyPoint{
			HourStartAt: pt.HourStartAt,
			Score:       pt.Score,
			Tier:        EnergyTier(pt.Tier),
		}
	}

	shields := make([]FocusShieldWindow, len(out.FocusShields))
	for i, w := range out.FocusShields {
		shields[i] = FocusShieldWindow{
			StartAt:  w.StartAt,
			EndAt:    w.EndAt,
			AvgScore: w.AvgScore,
			Source:   FocusShieldSource(w.Source),
		}
	}

	var alert *OverloadAlert
	if out.OverloadAlert != nil {
		alert = &OverloadAlert{
			TriggerReason:       RescueTriggerReason(out.OverloadAlert.TriggerReason),
			Severity:            OverloadSeverity(out.OverloadAlert.Severity),
			CurrentScore:        out.OverloadAlert.CurrentScore,
			Tier:                EnergyTier(out.OverloadAlert.Tier),
			Message:             out.OverloadAlert.Message,
			RecommendedStrategy: RescueStrategy(out.OverloadAlert.RecommendedStrategy),
		}
	}

	var primarySource *SourceType
	if out.Diagnostics.PrimarySource != nil {
		src := SourceType(*out.Diagnostics.PrimarySource)
		primarySource = &src
	}

	return EnergyTodayResponse{
		LocalDay:      out.LocalDay,
		Timezone:      out.Timezone,
		ComputedAt:    out.ComputedAt,
		Score:         out.Score,
		Tier:          EnergyTier(out.Tier),
		DataFreshness: DataFreshness(out.DataFreshness),
		Drivers: EnergyDrivers{
			SleepRecoveryScore:       out.Drivers.SleepRecoveryScore,
			AutonomicDeltaScore:      out.Drivers.AutonomicDeltaScore,
			CircadianScore:           out.Drivers.CircadianScore,
			CognitiveLoadDrainScore:  out.Drivers.CognitiveLoadDrainScore,
			RecoveryBufferBonusScore: out.Drivers.RecoveryBufferBonusScore,
			SleepDurationMinutes:     out.Drivers.SleepDurationMinutes,
			RecentHRVRMSSDMs:         out.Drivers.RecentHRVRMSSDMs,
			RecentRestingHRBpm:       out.Drivers.RecentRestingHRBpm,
			Summary:                  out.Drivers.Summary,
		},
		HourlyCurve:   hourly,
		FocusShields:  shields,
		OverloadAlert: alert,
		Diagnostics: EnergySourceDiagnostics{
			LastSyncedAt:      out.Diagnostics.LastSyncedAt,
			PrimarySource:     primarySource,
			BaselineReadyDays: out.Diagnostics.BaselineReadyDays,
			HRVBaselineMs:     out.Diagnostics.HRVBaselineMs,
			RHRBaselineBpm:    out.Diagnostics.RHRBaselineBpm,
		},
	}
}

// FromEngineAvailabilityViews 将脱敏投影后的成员可用性列表转换为对外 DTO。
func FromEngineAvailabilityViews(in []engine.MemberAvailabilityView) []MemberAvailabilityView {
	out := make([]MemberAvailabilityView, len(in))
	for i, m := range in {
		slots := make([]AvailabilitySlot, len(m.Slots))
		for j, s := range m.Slots {
			slots[j] = AvailabilitySlot{
				StartAt: s.StartAt,
				EndAt:   s.EndAt,
				Kind:    AvailabilitySlotKind(s.Kind),
				Title:   s.Title,
			}
		}

		var buckets []PrivacyEnergyBucket
		if len(m.EnergyBuckets) > 0 {
			buckets = make([]PrivacyEnergyBucket, len(m.EnergyBuckets))
			for j, b := range m.EnergyBuckets {
				buckets[j] = PrivacyEnergyBucket{
					HourStartAt: b.HourStartAt,
					Tier:        EnergyTier(b.Tier),
				}
			}
		}

		out[i] = MemberAvailabilityView{
			UserID:          m.UserID,
			DisplayName:     m.DisplayName,
			Timezone:        m.Timezone,
			PrivacyLevel:    PrivacyLevel(m.PrivacyLevel),
			WorkStartMinute: m.WorkStartMinute,
			WorkEndMinute:   m.WorkEndMinute,
			Slots:           slots,
			EnergyBuckets:   buckets,
		}
	}
	return out
}

// FromEngineMeetingOutput 将团队排会求解输出转换为对外响应 DTO。
func FromEngineMeetingOutput(out engine.MeetingSolverOutput) RecommendMeetingResponse {
	recs := make([]GoldenWindowRecommendation, len(out.Recommendations))
	for i, r := range out.Recommendations {
		affected := make([]MemberWindowImpact, len(r.AffectedMembers))
		for j, m := range r.AffectedMembers {
			var tier *EnergyTier
			if m.EnergyTier != nil {
				t := EnergyTier(*m.EnergyTier)
				tier = &t
			}
			affected[j] = MemberWindowImpact{
				UserID:                   m.UserID,
				DisplayName:              m.DisplayName,
				Required:                 m.Required,
				EnergyTier:               tier,
				BreaksFocusShield:        m.BreaksFocusShield,
				CausesContinuousOverload: m.CausesContinuousOverload,
			}
		}

		tags := make([]ExplanationTag, len(r.ExplanationTags))
		for j, tag := range r.ExplanationTags {
			tags[j] = ExplanationTag{
				Code:  tag.Code,
				Tone:  TagTone(tag.Tone),
				Label: tag.Label,
			}
		}

		recs[i] = GoldenWindowRecommendation{
			Rank:    r.Rank,
			StartAt: r.StartAt,
			EndAt:   r.EndAt,
			Score:   r.Score,
			Breakdown: ScoreBreakdown{
				EnergyMatchScore:        r.Breakdown.EnergyMatchScore,
				FocusShieldScore:        r.Breakdown.FocusShieldScore,
				CompactnessScore:        r.Breakdown.CompactnessScore,
				OptionalAttendanceRatio: r.Breakdown.OptionalAttendanceRatio,
				EarlinessScore:          r.Breakdown.EarlinessScore,
			},
			AffectedMembers: affected,
			ExplanationTags: tags,
			Summary:         r.Summary,
		}
	}

	diags := make([]BlockingDiagnostic, len(out.BlockingDiagnostics))
	for i, d := range out.BlockingDiagnostics {
		userIDs := append([]uuid.UUID(nil), d.BlockingUserIDs...)
		if userIDs == nil {
			userIDs = []uuid.UUID{}
		}
		names := append([]string(nil), d.BlockingDisplayNames...)
		if names == nil {
			names = []string{}
		}
		diags[i] = BlockingDiagnostic{
			Code:                 d.Code,
			Day:                  d.Day,
			Message:              d.Message,
			BlockingUserIDs:      userIDs,
			BlockingDisplayNames: names,
			SuggestedAction:      d.SuggestedAction,
		}
	}

	return RecommendMeetingResponse{
		Recommendations:     recs,
		BlockingDiagnostics: diags,
	}
}

// FromEngineRescueOptions 将救援引擎输出方案列表转换为对外 DTO。
func FromEngineRescueOptions(in []engine.RescueOptionPlan) []RescueOptionPlan {
	out := make([]RescueOptionPlan, len(in))
	for i, opt := range in {
		diffs := make([]RescueDiffItem, len(opt.DiffItems))
		for j, d := range opt.DiffItems {
			diffs[j] = RescueDiffItem{
				Op:            DiffOp(d.Op),
				ItemID:        d.ItemID,
				Title:         d.Title,
				Category:      ScheduleCategory(d.Category),
				CognitiveLoad: CognitiveLoad(d.CognitiveLoad),
				Flexibility:   Flexibility(d.Flexibility),
				BeforeStartAt: d.BeforeStartAt,
				BeforeEndAt:   d.BeforeEndAt,
				AfterStartAt:  d.AfterStartAt,
				AfterEndAt:    d.AfterEndAt,
				ReasonCode:    d.ReasonCode,
				ReasonLabel:   d.ReasonLabel,
			}
		}
		out[i] = RescueOptionPlan{
			Strategy:         RescueStrategy(opt.Strategy),
			OptionHash:       opt.OptionHash,
			Feasible:         opt.Feasible,
			MovedCount:       opt.MovedCount,
			DeferredCount:    opt.DeferredCount,
			RecoveryMinutes:  opt.RecoveryMinutes,
			OverdueRiskCount: opt.OverdueRiskCount,
			Summary:          opt.Summary,
			DiffItems:        diffs,
		}
	}
	return out
}

// ToEngineBiometricSamples 将请求中的穿戴样本 DTO 切片转换为纯引擎输入。
func ToEngineBiometricSamples(in []BiometricSampleDTO) []engine.BiometricSampleInput {
	out := make([]engine.BiometricSampleInput, len(in))
	for i, s := range in {
		var stage *engine.SleepStage
		if s.SleepStage != nil {
			st := engine.SleepStage(*s.SleepStage)
			stage = &st
		}
		out[i] = engine.BiometricSampleInput{
			SourceType:   engine.SourceType(s.SourceType),
			MetricType:   engine.MetricType(s.MetricType),
			RecordedAt:   s.RecordedAt,
			EndAt:        s.EndAt,
			NumericValue: s.NumericValue,
			Unit:         s.Unit,
			SleepStage:   stage,
			Metadata:     s.Metadata,
			ExternalID:   s.ExternalID,
		}
	}
	return out
}

// ToEngineUrgentTask 将救援请求中的突发任务 DTO 转换为纯引擎输入。
func ToEngineUrgentTask(in *UrgentTaskDTO) *engine.UrgentTaskInput {
	if in == nil {
		return nil
	}
	return &engine.UrgentTaskInput{
		Title:           in.Title,
		Notes:           in.Notes,
		DurationMinutes: in.DurationMinutes,
		CognitiveLoad:   engine.CognitiveLoad(in.CognitiveLoad),
		DeadlineAt:      in.DeadlineAt,
	}
}
