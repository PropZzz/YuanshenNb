package engine

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
)

type teamPlannerEngine struct{}

// NewTeamPlannerEngine returns a stateless privacy projector and meeting solver.
func NewTeamPlannerEngine() TeamPlannerEngine { return teamPlannerEngine{} }

func validateMember(m MemberRawSchedulingData) (*time.Location, error) {
	if m.UserID == uuid.Nil {
		return nil, fmt.Errorf("member userId is required")
	}
	if m.PrivacyLevel != PrivacyBusyOnly && m.PrivacyLevel != PrivacyEnergyTier && m.PrivacyLevel != PrivacyFullTitle {
		return nil, fmt.Errorf("invalid member privacy level %q", m.PrivacyLevel)
	}
	return validateProfile(m.Profile)
}

func (teamPlannerEngine) ProjectAvailability(ctx context.Context, in AvailabilityProjectionInput) ([]MemberAvailabilityView, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if in.From.IsZero() || !in.From.Before(in.To) {
		return nil, fmt.Errorf("availability range must have from before to")
	}
	members := append([]MemberRawSchedulingData(nil), in.Members...)
	sort.Slice(members, func(i, j int) bool { return members[i].UserID.String() < members[j].UserID.String() })
	out := make([]MemberAvailabilityView, 0, len(members))
	seen := map[uuid.UUID]bool{}
	for _, m := range members {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, err := validateMember(m); err != nil {
			return nil, err
		}
		if seen[m.UserID] {
			return nil, fmt.Errorf("duplicate member %s", m.UserID)
		}
		seen[m.UserID] = true
		v := MemberAvailabilityView{UserID: m.UserID, DisplayName: m.DisplayName, Timezone: m.Profile.Timezone, PrivacyLevel: m.PrivacyLevel, WorkStartMinute: m.Profile.WorkStartMinute, WorkEndMinute: m.Profile.WorkEndMinute, Slots: []AvailabilitySlot{}}
		for _, it := range sortedSchedules(m.Schedules) {
			if !activeItem(it) || !overlaps(it.StartAt, it.EndAt, in.From, in.To) {
				continue
			}
			kind := SlotKindSoftBusy
			if hardCollision(it) {
				kind = SlotKindBusy
			} else if it.Flexibility == FlexibilityFocusShield {
				kind = SlotKindFocusShield
			}
			if m.PrivacyLevel == PrivacyBusyOnly {
				if kind == SlotKindSoftBusy {
					continue
				}
				kind = SlotKindBusy
			}
			slot := AvailabilitySlot{StartAt: later(it.StartAt, in.From).UTC(), EndAt: earlier(it.EndAt, in.To).UTC(), Kind: kind}
			if m.PrivacyLevel == PrivacyFullTitle {
				title := it.Title
				slot.Title = &title
			}
			v.Slots = append(v.Slots, slot)
		}
		if m.PrivacyLevel != PrivacyBusyOnly {
			v.EnergyBuckets = []PrivacyEnergyBucket{}
			curve := append([]HourlyEnergyPoint(nil), m.PredictedCurve...)
			sort.Slice(curve, func(i, j int) bool {
				if !curve[i].HourStartAt.Equal(curve[j].HourStartAt) {
					return curve[i].HourStartAt.Before(curve[j].HourStartAt)
				}
				return curve[i].Tier < curve[j].Tier
			})
			var previous time.Time
			for _, p := range curve {
				if validTier(p.Tier) && overlaps(p.HourStartAt, p.HourStartAt.Add(time.Hour), in.From, in.To) && !p.HourStartAt.Equal(previous) {
					v.EnergyBuckets = append(v.EnergyBuckets, PrivacyEnergyBucket{HourStartAt: p.HourStartAt.UTC(), Tier: p.Tier})
					previous = p.HourStartAt
				}
			}
		}
		out = append(out, v)
	}
	return out, nil
}

type meetingMember struct {
	raw      MemberRawSchedulingData
	loc      *time.Location
	required bool
}

func meetingMembers(in MeetingSolverInput) ([]meetingMember, error) {
	byID := map[uuid.UUID]MemberRawSchedulingData{}
	for _, m := range in.Members {
		if _, ok := byID[m.UserID]; ok {
			return nil, fmt.Errorf("duplicate member %s", m.UserID)
		}
		byID[m.UserID] = m
	}
	if len(in.RequiredUserIDs) == 0 {
		return nil, fmt.Errorf("at least one required participant is needed")
	}
	out := []meetingMember{}
	seen := map[uuid.UUID]bool{}
	for _, ids := range []struct {
		list     []uuid.UUID
		required bool
	}{{in.RequiredUserIDs, true}, {in.OptionalUserIDs, false}} {
		sortedIDs := append([]uuid.UUID(nil), ids.list...)
		sort.Slice(sortedIDs, func(i, j int) bool { return sortedIDs[i].String() < sortedIDs[j].String() })
		for _, id := range sortedIDs {
			if seen[id] {
				return nil, fmt.Errorf("duplicate participant %s", id)
			}
			seen[id] = true
			m, ok := byID[id]
			if !ok {
				return nil, fmt.Errorf("participant %s has no scheduling data", id)
			}
			loc, err := validateMember(m)
			if err != nil {
				return nil, err
			}
			out = append(out, meetingMember{raw: m, loc: loc, required: ids.required})
		}
	}
	return out, nil
}

func memberBlocks(m meetingMember, start, end time.Time, respectShield bool) (outside, hard, shield bool) {
	outside = !inWorkWindow(start, end, m.raw.Profile, m.loc, true)
	for _, it := range m.raw.Schedules {
		if !activeItem(it) || !overlaps(start, end, it.StartAt, it.EndAt) {
			continue
		}
		if hardCollision(it) {
			hard = true
		}
		if it.Flexibility == FlexibilityFocusShield {
			// busy_only exposes an opaque busy interval. Relaxing negotiated
			// shields must not reveal which of those intervals is a shield.
			if m.raw.PrivacyLevel == PrivacyBusyOnly {
				hard = true
			} else {
				shield = true
			}
		}
	}
	return outside, hard, respectShield && shield
}

func (teamPlannerEngine) RecommendWindows(ctx context.Context, in MeetingSolverInput) (MeetingSolverOutput, error) {
	out := MeetingSolverOutput{Recommendations: []GoldenWindowRecommendation{}, BlockingDiagnostics: []BlockingDiagnostic{}}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if in.SearchFrom.IsZero() || !in.SearchFrom.Before(in.SearchTo) {
		return out, fmt.Errorf("meeting search range must have from before to")
	}
	if in.DurationMinutes < 15 || in.DurationMinutes > 480 {
		return out, fmt.Errorf("meeting duration must be 15–480 minutes")
	}
	if !validLoad(in.CognitiveLoad) {
		return out, fmt.Errorf("invalid meeting cognitive load")
	}
	members, err := meetingMembers(in)
	if err != nil {
		return out, err
	}
	duration := time.Duration(in.DurationMinutes) * time.Minute
	workCount, hardFree, shieldFree := 0, 0, 0
	workBlocked, hardBlocked, shieldBlocked := map[uuid.UUID]bool{}, map[uuid.UUID]bool{}, map[uuid.UUID]bool{}
	for start := ceilQuarter(in.SearchFrom); !start.Add(duration).After(in.SearchTo); start = start.Add(15 * time.Minute) {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		end := start.Add(duration)
		workOK, hardOK, shieldOK := true, true, true
		for _, m := range members {
			if !m.required {
				continue
			}
			outside, hard, shield := memberBlocks(m, start, end, in.RespectFocusShields)
			if outside {
				workOK = false
				workBlocked[m.raw.UserID] = true
			}
			if hard {
				hardOK = false
				hardBlocked[m.raw.UserID] = true
			}
			if shield {
				shieldOK = false
				shieldBlocked[m.raw.UserID] = true
			}
		}
		if !workOK {
			continue
		}
		workCount++
		if !hardOK {
			continue
		}
		hardFree++
		if !shieldOK {
			continue
		}
		shieldFree++
		out.Recommendations = append(out.Recommendations, scoreMeeting(start, end, in, members))
	}
	if len(out.Recommendations) == 0 {
		code, message, action := "NO_COMMON_WORK_HOURS", "必选成员在搜索范围内没有足够的共同工作时间", "调整搜索日期或成员工作时间，或减少必选成员"
		blocking := workBlocked
		if workCount == 0 && in.DurationMinutes > 15 {
			for at := ceilQuarter(in.SearchFrom); !at.Add(15 * time.Minute).After(in.SearchTo); at = at.Add(15 * time.Minute) {
				if err := ctx.Err(); err != nil {
					return out, err
				}
				common := true
				for _, m := range members {
					if m.required && !inWorkWindow(at, at.Add(15*time.Minute), m.raw.Profile, m.loc, true) {
						common = false
						break
					}
				}
				if common {
					code, message, action = "DURATION_TOO_LONG", "存在较短的共同工作窗口，但无法容纳当前会议时长", "缩短会议时长或扩大搜索日期范围"
					break
				}
			}
		}
		if in.SearchTo.Sub(in.SearchFrom) < duration {
			code, message, action = "DURATION_TOO_LONG", "会议时长超过整个搜索窗口", "缩短会议时长或扩大搜索范围"
			blocking = map[uuid.UUID]bool{}
		}
		if workCount > 0 && hardFree == 0 {
			code, message, action = "REQUIRED_MEMBER_LOCKED", "共同工作时间被必选成员的锁定日程、会议或恢复块占用", "改选日期、缩短时长或与阻断成员协商其他时间"
			blocking = hardBlocked
		}
		if hardFree > 0 && shieldFree == 0 {
			code, message, action = "SHIELD_BLOCKED_ALL_SLOTS", "所有可用窗口都与必选成员的专注保护盾冲突", "关闭尊重专注保护盾后重新预览，或扩大搜索日期"
			blocking = shieldBlocked
		}
		ids, names := []uuid.UUID{}, []string{}
		for _, m := range members {
			if m.required && (len(blocking) == 0 || blocking[m.raw.UserID]) {
				ids = append(ids, m.raw.UserID)
				names = append(names, m.raw.DisplayName)
			}
		}
		out.BlockingDiagnostics = append(out.BlockingDiagnostics, BlockingDiagnostic{Code: code, Message: message, BlockingUserIDs: ids, BlockingDisplayNames: names, SuggestedAction: action})
		return out, nil
	}
	sort.Slice(out.Recommendations, func(i, j int) bool {
		a, b := out.Recommendations[i], out.Recommendations[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Breakdown.FocusShieldScore != b.Breakdown.FocusShieldScore {
			return a.Breakdown.FocusShieldScore > b.Breakdown.FocusShieldScore
		}
		return a.StartAt.Before(b.StartAt)
	})
	limit := in.MaxResults
	if limit <= 0 || limit > 3 {
		limit = 3
	}
	if len(out.Recommendations) > limit {
		out.Recommendations = out.Recommendations[:limit]
	}
	for i := range out.Recommendations {
		out.Recommendations[i].Rank = i + 1
	}
	return out, nil
}

func loadTierMatch(load CognitiveLoad, tier EnergyTier) float64 {
	switch load {
	case LoadHigh:
		switch tier {
		case TierPeak:
			return 100
		case TierSteady:
			return 80
		case TierStrained:
			return 25
		default:
			return 0
		}
	case LoadLow:
		switch tier {
		case TierPeak:
			return 72
		case TierSteady:
			return 100
		case TierStrained:
			return 65
		default:
			return 25
		}
	default:
		switch tier {
		case TierPeak:
			return 90
		case TierSteady:
			return 100
		case TierStrained:
			return 50
		default:
			return 10
		}
	}
}

func compactness(m meetingMember, start, end time.Time) float64 {
	w := workWindow(start, m.raw.Profile, m.loc)
	left, right := w.start, w.end
	for _, it := range m.raw.Schedules {
		if !activeItem(it) {
			continue
		}
		if !it.EndAt.After(start) && it.EndAt.After(left) {
			left = it.EndAt
		}
		if !it.StartAt.Before(end) && it.StartAt.Before(right) {
			right = it.StartAt
		}
		if overlaps(it.StartAt, it.EndAt, start, end) {
			return 85
		}
	}
	a, b := start.Sub(left).Minutes(), right.Sub(end).Minutes()
	if a <= 15 || b <= 15 || right.Sub(left) < 60*time.Minute {
		return 100
	}
	if a >= 60 && b >= 60 {
		return 15
	}
	return 55
}

func continuousOverload(m meetingMember, start, end time.Time, load CognitiveLoad) bool {
	if load == LoadLow {
		return false
	}
	blocks := []interval{{start, end}}
	for _, it := range m.raw.Schedules {
		if activeItem(it) && it.Category != CategoryRecovery && (it.CognitiveLoad == LoadHigh || it.CognitiveLoad == LoadMedium) {
			blocks = append(blocks, interval{it.StartAt, it.EndAt})
		}
	}
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].start.Before(blocks[j].start) })
	a, b := blocks[0].start, blocks[0].end
	for _, x := range blocks[1:] {
		if x.start.Sub(b) < 15*time.Minute {
			b = later(b, x.end)
		} else {
			if overlaps(a, b, start, end) && b.Sub(a) > 120*time.Minute {
				return true
			}
			a, b = x.start, x.end
		}
	}
	return overlaps(a, b, start, end) && b.Sub(a) > 120*time.Minute
}

func scoreMeeting(start, end time.Time, in MeetingSolverInput, members []meetingMember) GoldenWindowRecommendation {
	r := GoldenWindowRecommendation{StartAt: start.UTC(), EndAt: end.UTC(), AffectedMembers: []MemberWindowImpact{}, ExplanationTags: []ExplanationTag{}}
	required, optional, optionalFree, shieldCount, overloads := 0, 0, 0, 0, 0
	var energy, compact float64
	allStrong, hasPeak := true, false
	for _, m := range members {
		outside, hard, shield := memberBlocks(m, start, end, in.RespectFocusShields)
		available := !outside && !hard && !shield
		if !m.required {
			optional++
			if available {
				optionalFree++
			} else {
				continue
			}
		}
		curve := m.raw.PredictedCurve
		if m.raw.PrivacyLevel == PrivacyBusyOnly {
			curve = nil
		}
		tier := curveTierAt(curve, start, m.raw.Profile, m.loc)
		impact := MemberWindowImpact{UserID: m.raw.UserID, DisplayName: m.raw.DisplayName, Required: m.required}
		if m.raw.PrivacyLevel != PrivacyBusyOnly {
			copyTier := tier
			impact.EnergyTier = &copyTier
		}
		for _, it := range m.raw.Schedules {
			if m.raw.PrivacyLevel != PrivacyBusyOnly && activeItem(it) && it.Flexibility == FlexibilityFocusShield && overlaps(start, end, it.StartAt, it.EndAt) {
				impact.BreaksFocusShield = true
			}
		}
		impact.CausesContinuousOverload = m.raw.PrivacyLevel != PrivacyBusyOnly && continuousOverload(m, start, end, in.CognitiveLoad)
		if impact.CausesContinuousOverload {
			overloads++
		}
		r.AffectedMembers = append(r.AffectedMembers, impact)
		if m.required {
			required++
			energy += loadTierMatch(in.CognitiveLoad, tier)
			compact += compactness(m, start, end)
			if impact.BreaksFocusShield {
				shieldCount++
			}
			if tier != TierPeak && tier != TierSteady {
				allStrong = false
			}
			hasPeak = hasPeak || tier == TierPeak
		}
	}
	shieldScore := clamp(100-100*float64(shieldCount)/float64(required), 0, 100)
	ratio := 1.0
	if optional > 0 {
		ratio = float64(optionalFree) / float64(optional)
	}
	early := clamp(100*(1-start.Sub(in.SearchFrom).Seconds()/in.SearchTo.Sub(in.SearchFrom).Seconds()), 0, 100)
	r.Breakdown = ScoreBreakdown{EnergyMatchScore: int(math.Round(energy / float64(required))), FocusShieldScore: int(math.Round(shieldScore)), CompactnessScore: int(math.Round(compact / float64(required))), OptionalAttendanceRatio: rounded(ratio), EarlinessScore: int(math.Round(early))}
	b := r.Breakdown
	r.Score = int(math.Round(.35*float64(b.EnergyMatchScore) + .30*float64(b.FocusShieldScore) + .20*float64(b.CompactnessScore) + .10*ratio*100 + .05*float64(b.EarlinessScore)))
	if allStrong {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "ALL_PEAK_OR_STEADY", Tone: TonePositive, Label: "必选成员均处于高峰或平稳精力窗"})
	}
	if in.CognitiveLoad == LoadLow && !hasPeak {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "LOW_LOAD_SAVES_PEAK", Tone: TonePositive, Label: "低负荷同步避开宝贵的高峰专注时段"})
	}
	if shieldCount == 0 {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "ZERO_FOCUS_SHIELD_INTRUSION", Tone: TonePositive, Label: "未打断任何必选成员的专注保护盾"})
	} else {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "SHIELD_INTRUSION_PENALTY", Tone: ToneWarning, Label: fmt.Sprintf("需协商突破 %d 位必选成员的专注保护盾", shieldCount)})
	}
	if b.CompactnessScore >= 85 {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "COMPACT_ADJACENT_SLOT", Tone: ToneNeutral, Label: "紧贴既有日程或工作边界，减少空闲时间碎片"})
	}
	if optional > 0 {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "OPTIONAL_ATTENDANCE", Tone: ToneNeutral, Label: fmt.Sprintf("%d/%d 位可选成员可参与", optionalFree, optional)})
	}
	if overloads > 0 {
		r.ExplanationTags = append(r.ExplanationTags, ExplanationTag{Code: "CONTINUOUS_OVERLOAD_RISK", Tone: ToneWarning, Label: fmt.Sprintf("%d 位成员可能连续认知负荷超过两小时", overloads)})
	}
	r.Summary = fmt.Sprintf("%d 位必选成员满足工作边界和硬约束；精力匹配 %d，专注保护 %d，紧凑度 %d，可选参与 %.0f%%", required, b.EnergyMatchScore, b.FocusShieldScore, b.CompactnessScore, ratio*100)
	return r
}
