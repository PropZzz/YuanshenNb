package engine

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"
)

type energyEngine struct{}

// NewEnergyEngine returns a deterministic, stateless four-factor engine.
func NewEnergyEngine() EnergyEngine { return energyEngine{} }

type dailyBaseline struct {
	days     int
	mean, sd float64
}
type energyModel struct {
	in               EnergyComputeInput
	loc              *time.Location
	start, end       time.Time
	samples          []BiometricSampleInput
	sleep, autonomic float64
	sleepMinutes     *int
	hrv, rhr         *float64
	hrvBase, rhrBase dailyBaseline
	freshness        DataFreshness
	diagnostics      EnergySourceDiagnostics
}

func (energyEngine) ComputeSnapshot(ctx context.Context, in EnergyComputeInput) (EnergyComputeOutput, error) {
	if err := ctx.Err(); err != nil {
		return EnergyComputeOutput{}, err
	}
	if in.Now.IsZero() {
		return EnergyComputeOutput{}, fmt.Errorf("now must be explicit")
	}
	loc, err := validateProfile(in.Profile.WorkScheduleProfile)
	if err != nil {
		return EnergyComputeOutput{}, err
	}
	start, end, err := LocalDayWindowUTC(in.LocalDay, in.Profile.Timezone)
	if err != nil {
		return EnergyComputeOutput{}, err
	}
	m := energyModel{in: in, loc: loc, start: start, end: end, sleep: 30, freshness: FreshnessBaselineOnly}
	m.prepare()
	out := EnergyComputeOutput{LocalDay: in.LocalDay, Timezone: in.Profile.Timezone, ComputedAt: in.Now.UTC(), DataFreshness: m.freshness, Diagnostics: m.diagnostics, HourlyCurve: []HourlyEnergyPoint{}, FocusShields: []FocusShieldWindow{}}
	out.Score, out.Drivers = m.at(in.Now)
	out.Tier = scoreTier(out.Score)
	for at := start; at.Before(end); at = at.Add(time.Hour) {
		if err := ctx.Err(); err != nil {
			return EnergyComputeOutput{}, err
		}
		score, _ := m.at(at)
		out.HourlyCurve = append(out.HourlyCurve, HourlyEnergyPoint{HourStartAt: at.UTC(), Score: score, Tier: scoreTier(score)})
	}
	if m.freshness != FreshnessBaselineOnly && m.freshness != FreshnessReplayDemo {
		if m.hrvBase.days >= 3 {
			v := m.hrvBase.mean
			out.UpdatedHRVBaseline = &v
		}
		if m.rhrBase.days >= 3 {
			v := m.rhrBase.mean
			out.UpdatedRHRBaseline = &v
		}
	}
	out.FocusShields = m.shields()
	out.OverloadAlert = m.overload(out.Score)
	return out, nil
}

func sampleTime(s BiometricSampleInput) time.Time {
	if (s.MetricType == MetricSleepSession || s.MetricType == MetricSleepStage) && s.EndAt != nil {
		return *s.EndAt
	}
	return s.RecordedAt
}
func validSample(s BiometricSampleInput, now time.Time) bool {
	if s.SourceType != SourceBLEGATT && s.SourceType != SourceHealthConnect && s.SourceType != SourceReplayDemo {
		return false
	}
	if s.RecordedAt.IsZero() || sampleTime(s).After(now) || s.RecordedAt.After(now) || sampleTime(s).Before(now.AddDate(0, 0, -14)) || math.IsNaN(s.NumericValue) || math.IsInf(s.NumericValue, 0) {
		return false
	}
	switch s.MetricType {
	case MetricHeartRate, MetricRestingHR:
		return s.NumericValue >= 30 && s.NumericValue <= 220
	case MetricHRVRMSSD:
		return s.NumericValue > 0 && s.NumericValue <= 250
	case MetricSleepSession, MetricSleepStage:
		return s.EndAt != nil && s.RecordedAt.Before(*s.EndAt) && s.EndAt.Sub(s.RecordedAt) <= 24*time.Hour
	case MetricActiveCalories:
		return s.NumericValue >= 0 && s.NumericValue <= 20000
	default:
		return false
	}
}

func (m *energyModel) prepare() {
	valid := []BiometricSampleInput{}
	for _, s := range m.in.Samples14Days {
		if validSample(s, m.in.Now) {
			valid = append(valid, s)
		}
	}
	sort.Slice(valid, func(i, j int) bool {
		a, b := valid[i], valid[j]
		if !sampleTime(a).Equal(sampleTime(b)) {
			return sampleTime(a).Before(sampleTime(b))
		}
		if a.SourceType != b.SourceType {
			return a.SourceType < b.SourceType
		}
		if a.MetricType != b.MetricType {
			return a.MetricType < b.MetricType
		}
		if a.ExternalID != b.ExternalID {
			return a.ExternalID < b.ExternalID
		}
		if !a.RecordedAt.Equal(b.RecordedAt) {
			return a.RecordedAt.Before(b.RecordedAt)
		}
		if a.NumericValue != b.NumericValue {
			return a.NumericValue < b.NumericValue
		}
		return a.SleepStage != nil && (b.SleepStage == nil || *a.SleepStage < *b.SleepStage)
	})
	if len(valid) == 0 {
		return
	}
	latest := valid[len(valid)-1]
	age := m.in.Now.Sub(sampleTime(latest))
	if age > 48*time.Hour {
		return
	}
	if latest.SourceType == SourceReplayDemo {
		m.freshness = FreshnessReplayDemo
	} else if age <= 2*time.Hour {
		m.freshness = FreshnessLiveWearable
	} else {
		m.freshness = FreshnessRecentWearable
	}
	seen := map[string]bool{}
	for _, s := range valid {
		if (s.SourceType == SourceReplayDemo) != (m.freshness == FreshnessReplayDemo) {
			continue
		}
		if s.ExternalID != "" {
			key := string(s.SourceType) + "|" + string(s.MetricType) + "|" + s.ExternalID
			if seen[key] {
				continue
			}
			seen[key] = true
		}
		m.samples = append(m.samples, s)
	}
	m.hrvBase = m.baseline(MetricHRVRMSSD)
	m.rhrBase = m.baseline(MetricRestingHR)
	m.diagnostics.BaselineReadyDays = m.hrvBase.days
	last := sampleTime(latest).UTC()
	source := latest.SourceType
	m.diagnostics.LastSyncedAt = &last
	m.diagnostics.PrimarySource = &source
	if m.hrvBase.days >= 3 {
		v := rounded(m.hrvBase.mean)
		m.diagnostics.HRVBaselineMs = &v
	}
	if m.rhrBase.days >= 3 {
		v := rounded(m.rhrBase.mean)
		m.diagnostics.RHRBaselineBpm = &v
	}
	// A sample 24–48h old can describe the last synchronization, but cannot
	// masquerade as today's physiological recovery measurement.
	m.sleep, m.sleepMinutes = m.sleepScore()
	m.hrv = m.recent(MetricHRVRMSSD)
	m.rhr = m.recent(MetricRestingHR)
	if m.hrv != nil {
		if m.hrvBase.days >= 3 {
			m.autonomic += clamp(8*(*m.hrv-m.hrvBase.mean)/math.Max(m.hrvBase.sd, 5), -15, 18)
		} else if *m.hrv < 20 {
			m.autonomic -= 8
		}
	}
	if m.rhr != nil {
		if m.rhrBase.days >= 3 {
			delta := *m.rhr - m.rhrBase.mean
			if delta >= 5 {
				m.autonomic -= math.Min(10, delta*1.5)
			} else if delta < 0 {
				m.autonomic += math.Min(7, -delta*.75)
			}
		} else if *m.rhr > 100 {
			m.autonomic -= 10
		}
	}
	m.autonomic = clamp(m.autonomic, -20, 25)
}

func (m *energyModel) baseline(metric MetricType) dailyBaseline {
	today := m.in.Now.In(m.loc).Format("2006-01-02")
	days := map[string][]float64{}
	for _, s := range m.samples {
		day := s.RecordedAt.In(m.loc).Format("2006-01-02")
		if s.MetricType == metric && day < today {
			days[day] = append(days[day], s.NumericValue)
		}
	}
	keys := make([]string, 0, len(days))
	for d := range days {
		keys = append(keys, d)
	}
	sort.Strings(keys)
	values := []float64{}
	for _, d := range keys {
		var total float64
		for _, v := range days[d] {
			total += v
		}
		values = append(values, total/float64(len(days[d])))
	}
	b := dailyBaseline{days: len(values)}
	if b.days == 0 {
		return b
	}
	for _, v := range values {
		b.mean += v
	}
	b.mean /= float64(b.days)
	for _, v := range values {
		b.sd += (v - b.mean) * (v - b.mean)
	}
	b.sd = math.Sqrt(b.sd / float64(b.days))
	return b
}
func (m *energyModel) recent(metric MetricType) *float64 {
	for i := len(m.samples) - 1; i >= 0; i-- {
		s := m.samples[i]
		if s.MetricType == metric && !s.RecordedAt.Before(m.in.Now.Add(-24*time.Hour)) {
			v := s.NumericValue
			return &v
		}
	}
	return nil
}

func (m *energyModel) sleepScore() (float64, *int) {
	sessions := []interval{}
	for _, s := range m.samples {
		if s.MetricType == MetricSleepSession && !sampleTime(s).Before(m.in.Now.Add(-24*time.Hour)) {
			sessions = append(sessions, interval{s.RecordedAt, *s.EndAt})
		}
	}
	if len(sessions) == 0 {
		return 30, nil
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].start.Before(sessions[j].start) })
	groups := [][]interval{{sessions[0]}}
	groupEnd := sessions[0].end
	for _, s := range sessions[1:] {
		if s.start.Sub(groupEnd) < time.Hour {
			groups[len(groups)-1] = append(groups[len(groups)-1], s)
			groupEnd = later(groupEnd, s.end)
		} else {
			groups = append(groups, []interval{s})
			groupEnd = s.end
		}
	}
	group := groups[len(groups)-1]
	minutes := int(unionDuration(append([]interval(nil), group...)) / time.Minute)
	durationScore := 10 * math.Pow(float64(minutes)/240, 2)
	if minutes >= 240 {
		durationScore = 10 + 22*clamp(float64(minutes-240)/210, 0, 1)
	}
	var deep, rem []interval
	hasStages := false
	for _, s := range m.samples {
		if s.MetricType != MetricSleepStage || s.SleepStage == nil {
			continue
		}
		for _, session := range group {
			a, b := later(s.RecordedAt, session.start), earlier(*s.EndAt, session.end)
			if !a.Before(b) {
				continue
			}
			hasStages = true
			if *s.SleepStage == SleepStageDeep {
				deep = append(deep, interval{a, b})
			}
			if *s.SleepStage == SleepStageREM {
				rem = append(rem, interval{a, b})
			}
		}
	}
	structure := 8.0
	if hasStages && minutes > 0 {
		total := float64(minutes) * float64(time.Minute)
		structure = 6.5*clamp(float64(unionDuration(deep))/total/.18, 0, 1) + 6.5*clamp(float64(unionDuration(rem))/total/.20, 0, 1)
	}
	return clamp(durationScore+structure, 10, 45), &minutes
}

// circadian is a smooth pair of Gaussian peaks with a calibrated lunch dip.
// The local wall-clock hour is intentionally independent of UTC offsets/DST.
func circadian(at time.Time, chronotype Chronotype, loc *time.Location) float64 {
	local := at.In(loc)
	h := float64(local.Hour()) + float64(local.Minute())/60 + float64(local.Second())/3600
	p1, p2, dip, a1, a2, target := 10.0, 16.0, 14.0, 26.0, 22.0, 7.0
	if chronotype == ChronotypeMorningLark {
		p1, p2, dip, a1, a2, target = 9.5, 15.5, 13.5, 28, 18, 6
	}
	if chronotype == ChronotypeNightOwl {
		p1, p2, dip, a1, a2, target = 11, 17.5, 14.5, 18, 28, 8
	}
	g := func(x, mean, width float64) float64 { return math.Exp(-.5 * math.Pow((x-mean)/width, 2)) }
	dipAmp := 5 + (a1-5)*g(dip, p1, 1.8) + (a2-5)*g(dip, p2, 1.6) - target
	return clamp(5+(a1-5)*g(h, p1, 1.8)+(a2-5)*g(h, p2, 1.6)-dipAmp*g(h, dip, .85), 5, 30)
}

func (m *energyModel) at(at time.Time) (int, EnergyDrivers) {
	drain, recovery := m.load(at)
	c := circadian(at, m.in.Profile.Chronotype, m.loc)
	score := int(math.Round(clamp(m.sleep+m.autonomic+c-drain+recovery, 0, 100)))
	// Recovery may repay cognitive drain, but cannot manufacture sleep recovery.
	if recovery > drain {
		recovery = drain
		score = int(math.Round(clamp(m.sleep+m.autonomic+c, 0, 100)))
	}
	d := EnergyDrivers{SleepRecoveryScore: rounded(m.sleep), AutonomicDeltaScore: rounded(m.autonomic), CircadianScore: rounded(c), CognitiveLoadDrainScore: rounded(drain), RecoveryBufferBonusScore: rounded(recovery), SleepDurationMinutes: m.sleepMinutes, RecentHRVRMSSDMs: m.hrv, RecentRestingHRBpm: m.rhr, Summary: fmt.Sprintf("睡眠恢复 %.1f，自主神经 %+.1f，节律 +%.1f，认知负荷 -%.1f，恢复 +%.1f（%s）", m.sleep, m.autonomic, c, drain, recovery, m.freshness)}
	return score, d
}

func (m *energyModel) load(at time.Time) (float64, float64) {
	until := earlier(at, m.end)
	if !m.start.Before(until) {
		return 0, 0
	}
	boundaries := []time.Time{m.start, until}
	items := []ScheduleItemSnapshot{}
	for _, it := range m.in.DaySchedules {
		if activeItem(it) && overlaps(it.StartAt, it.EndAt, m.start, until) {
			items = append(items, it)
			boundaries = append(boundaries, later(it.StartAt, m.start), earlier(it.EndAt, until))
		}
	}
	if len(items) == 0 {
		return 0, 0
	}
	work := workWindow(m.start, m.in.Profile.WorkScheduleProfile, m.loc)
	if work.start.After(m.start) && work.start.Before(until) {
		boundaries = append(boundaries, work.start)
	}
	if work.end.After(m.start) && work.end.Before(until) {
		boundaries = append(boundaries, work.end)
	}
	sort.Slice(boundaries, func(i, j int) bool { return boundaries[i].Before(boundaries[j]) })
	type segment struct {
		duration              float64
		rate                  float64
		heavy, rest, explicit bool
	}
	segments := []segment{}
	seenLoad := false
	for i := 0; i < len(boundaries)-1; i++ {
		a, b := boundaries[i], boundaries[i+1]
		if !a.Before(b) {
			continue
		}
		seg := segment{duration: b.Sub(a).Minutes()}
		hasWork := false
		for _, it := range items {
			if !overlaps(it.StartAt, it.EndAt, a, b) {
				continue
			}
			if it.Category == CategoryRecovery {
				seg.explicit = true
				continue
			}
			hasWork = true
			rate := 2.0
			if it.CognitiveLoad == LoadHigh {
				rate = 9
			} else if it.CognitiveLoad == LoadMedium {
				rate = 5
			}
			seg.rate = math.Max(seg.rate, rate)
		}
		seg.heavy = seg.rate >= 5
		seg.rest = !hasWork && (seg.explicit || (seenLoad && !a.Before(work.start) && !b.After(work.end)))
		if hasWork {
			seenLoad = true
		}
		if len(segments) > 0 {
			prev := &segments[len(segments)-1]
			if (prev.rest && seg.rest) || (prev.rate == seg.rate && prev.rest == seg.rest && prev.explicit == seg.explicit) {
				prev.duration += seg.duration
				continue
			}
		}
		segments = append(segments, seg)
	}
	var drain, recovery, continuous float64
	for _, s := range segments {
		if s.rest {
			if s.duration >= 15 {
				continuous = 0
				recovery += clamp(math.Floor(s.duration/15)*4, 4, 8)
			}
			continue
		}
		if s.heavy {
			normal := math.Min(s.duration, math.Max(0, 120-continuous))
			drain += s.rate * (normal + (s.duration-normal)*1.35) / 60
			continuous += s.duration
		} else {
			drain += s.rate * s.duration / 60
		}
	}
	return drain, math.Min(16, recovery)
}

func (m *energyModel) shields() []FocusShieldWindow {
	out := []FocusShieldWindow{}
	var start time.Time
	total, count := 0, 0
	source := "energy_prediction"
	if len(m.in.Profile.PreferredFocusWindows) > 0 {
		source = "preferred_focus_window"
	}
	flush := func(end time.Time) {
		if !start.IsZero() && end.Sub(start) >= 90*time.Minute {
			out = append(out, FocusShieldWindow{StartAt: start.UTC(), EndAt: end.UTC(), AvgScore: int(math.Round(float64(total) / float64(count))), Source: source})
		}
		start = time.Time{}
		total, count = 0, 0
	}
	begin := ceilQuarter(later(m.start, m.in.Now))
	for at := begin; at.Before(m.end); at = at.Add(15 * time.Minute) {
		end := at.Add(15 * time.Minute)
		score, _ := m.at(at)
		eligible := score >= 75 && inWorkWindow(at, end, m.in.Profile.WorkScheduleProfile, m.loc, false)
		if len(m.in.Profile.PreferredFocusWindows) > 0 {
			within := false
			for _, w := range m.in.Profile.PreferredFocusWindows {
				if !at.Before(localMinute(at, w.StartMinute, m.loc)) && !end.After(localMinute(at, w.EndMinute, m.loc)) {
					within = true
				}
			}
			eligible = eligible && within
		}
		for _, it := range m.in.DaySchedules {
			if activeItem(it) && hardCollision(it) && overlaps(at, end, it.StartAt, it.EndAt) {
				eligible = false
				break
			}
		}
		if eligible {
			if start.IsZero() {
				start = at
			}
			total += score
			count++
		} else {
			flush(at)
		}
	}
	flush(m.end)
	return out
}

func (m *energyModel) overload(score int) *OverloadAlert {
	lowFuture := false
	if score < 40 {
		for _, it := range m.in.DaySchedules {
			if activeItem(it) && it.CognitiveLoad == LoadHigh && it.Flexibility == FlexibilityFlexible && overlaps(it.StartAt, it.EndAt, m.in.Now, m.in.Now.Add(2*time.Hour)) {
				lowFuture = true
			}
		}
	}
	meetings := []interval{}
	for _, it := range m.in.DaySchedules {
		if activeItem(it) && it.Category == CategoryMeeting && overlaps(it.StartAt, it.EndAt, m.start, m.end) {
			meetings = append(meetings, interval{later(it.StartAt, m.start), earlier(it.EndAt, m.end)})
		}
	}
	lowDays := 0
	if m.hrvBase.days >= 3 {
		for offset := 0; offset < 2; offset++ {
			day := m.in.Now.In(m.loc).AddDate(0, 0, -offset).Format("2006-01-02")
			var sum float64
			count := 0
			for _, s := range m.samples {
				local := s.RecordedAt.In(m.loc)
				if s.MetricType == MetricHRVRMSSD && local.Format("2006-01-02") == day && local.Hour() < 12 {
					sum += s.NumericValue
					count++
				}
			}
			if count > 0 && sum/float64(count) < m.hrvBase.mean-1.2*math.Max(m.hrvBase.sd, 5) {
				lowDays++
			}
		}
	}
	if !lowFuture && !(lowDays == 2 && unionDuration(meetings) > 4*time.Hour) {
		return nil
	}
	message := "当前预测精力低于 40，未来两小时仍有高负荷弹性任务，建议预览恢复方案"
	if !lowFuture {
		message = "连续两日晨间 HRV 偏低，且当日会议超过四小时，建议减少连续认知负荷"
	}
	severity := "warning"
	if score < 35 {
		severity = "critical"
	}
	return &OverloadAlert{TriggerReason: TriggerWearableFatigue, Severity: severity, CurrentScore: score, Tier: scoreTier(score), Message: message, RecommendedStrategy: StrategyProtectRecovery}
}
