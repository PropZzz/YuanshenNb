package engine_test

import (
	"context"
	"encoding/json"
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
)

func moment(s string) time.Time { return timeMust(s) }
func timeMust(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}
func floatptr(v float64) *float64    { return &v }
func timeptr(v time.Time) *time.Time { return &v }
func profile(zone string) engine.EnergyProfileInput {
	return engine.EnergyProfileInput{WorkScheduleProfile: engine.WorkScheduleProfile{Timezone: zone, WorkStartMinute: 9 * 60, WorkEndMinute: 18 * 60, Chronotype: engine.ChronotypeBalanced, MinRecoveryBufferMin: 15}}
}
func sample(source engine.SourceType, metric engine.MetricType, at time.Time, value float64) engine.BiometricSampleInput {
	return engine.BiometricSampleInput{SourceType: source, MetricType: metric, RecordedAt: at, NumericValue: value}
}
func task(id string, start time.Time, minutes int, load engine.CognitiveLoad) engine.ScheduleItemSnapshot {
	return engine.ScheduleItemSnapshot{ID: uuid.MustParse(id), Title: "Private task", Category: engine.CategoryDeepWork, CognitiveLoad: load, Flexibility: engine.FlexibilityFlexible, Status: engine.StatusPlanned, StartAt: start, EndAt: start.Add(time.Duration(minutes) * time.Minute), DurationMinutes: minutes, UpdatedAt: start.Add(-time.Hour)}
}
func compute(t *testing.T, in engine.EnergyComputeInput) engine.EnergyComputeOutput {
	t.Helper()
	out, err := engine.NewEnergyEngine().ComputeSnapshot(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestEnergyBaselineGoldenAndDST(t *testing.T) {
	for _, tt := range []struct {
		day, zone string
		hours     int
	}{{"2026-11-19", "Asia/Shanghai", 24}, {"2026-03-08", "America/New_York", 23}, {"2026-11-01", "America/New_York", 25}, {"2026-11-19", "Asia/Kathmandu", 24}} {
		t.Run(tt.day+tt.zone, func(t *testing.T) {
			start, end, err := engine.LocalDayWindowUTC(tt.day, tt.zone)
			if err != nil {
				t.Fatal(err)
			}
			in := engine.EnergyComputeInput{Now: start.Add(10 * time.Hour), LocalDay: tt.day, Profile: profile(tt.zone)}
			out := compute(t, in)
			if len(out.HourlyCurve) != tt.hours {
				t.Fatalf("curve has %d points, want %d", len(out.HourlyCurve), tt.hours)
			}
			for i, p := range out.HourlyCurve {
				if !p.HourStartAt.Equal(start.Add(time.Duration(i)*time.Hour)) || !p.HourStartAt.Before(end) {
					t.Fatalf("wrong UTC hour %v", p)
				}
			}
			if out.DataFreshness != engine.FreshnessBaselineOnly || out.Drivers.SleepRecoveryScore != 30 || out.Drivers.AutonomicDeltaScore != 0 {
				t.Fatalf("dishonest baseline: %+v", out)
			}
			if out.Diagnostics.LastSyncedAt != nil || out.Diagnostics.PrimarySource != nil || out.Diagnostics.BaselineReadyDays != 0 {
				t.Fatal("baseline exposes stale diagnostics")
			}
			if out.Score != int(math.Round(30+out.Drivers.CircadianScore)) {
				t.Fatalf("baseline formula mismatch: %+v", out.Drivers)
			}
		})
	}
}

func TestEnergyFreshnessAndArtifactFiltering(t *testing.T) {
	now := moment("2026-11-19T10:00:00Z")
	for _, tt := range []struct {
		name    string
		samples []engine.BiometricSampleInput
		want    engine.DataFreshness
	}{
		{"live", []engine.BiometricSampleInput{sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.Add(-time.Minute), 65)}, engine.FreshnessLiveWearable},
		{"recent", []engine.BiometricSampleInput{sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.Add(-4*time.Hour), 55)}, engine.FreshnessRecentWearable},
		{"replay", []engine.BiometricSampleInput{sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.Add(-time.Minute), 55)}, engine.FreshnessReplayDemo},
		{"stale", []engine.BiometricSampleInput{sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.Add(-49*time.Hour), 65)}, engine.FreshnessBaselineOnly},
		{"future", []engine.BiometricSampleInput{sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.Add(time.Hour), 65)}, engine.FreshnessBaselineOnly},
		{"artifact", []engine.BiometricSampleInput{sample(engine.SourceBLEGATT, engine.MetricHeartRate, now, 999), sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now, math.NaN())}, engine.FreshnessBaselineOnly},
		{"latest_replay", []engine.BiometricSampleInput{sample(engine.SourceHealthConnect, engine.MetricHeartRate, now.Add(-time.Hour), 65), sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.Add(-time.Minute), 55)}, engine.FreshnessReplayDemo},
	} {
		t.Run(tt.name, func(t *testing.T) {
			out := compute(t, engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: tt.samples})
			if out.DataFreshness != tt.want {
				t.Fatalf("got %s want %s", out.DataFreshness, tt.want)
			}
		})
	}
}

func TestEnergySleepMergeStagesAndFourFactorGolden(t *testing.T) {
	now := moment("2026-11-19T10:00:00Z")
	start := moment("2026-11-18T23:00:00Z")
	deep, rem := engine.SleepStageDeep, engine.SleepStageREM
	samples := []engine.BiometricSampleInput{}
	for i, v := range []float64{40, 50, 60} {
		samples = append(samples, sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.AddDate(0, 0, -i-1), v), sample(engine.SourceHealthConnect, engine.MetricRestingHR, now.AddDate(0, 0, -i-1), 60))
	}
	first := sample(engine.SourceHealthConnect, engine.MetricSleepSession, start, 240)
	first.EndAt = timeptr(start.Add(4 * time.Hour))
	second := sample(engine.SourceHealthConnect, engine.MetricSleepSession, start.Add(4*time.Hour+30*time.Minute), 210)
	second.EndAt = timeptr(start.Add(8 * time.Hour))
	d := sample(engine.SourceHealthConnect, engine.MetricSleepStage, start, 90)
	d.EndAt = timeptr(start.Add(90 * time.Minute))
	d.SleepStage = &deep
	r := sample(engine.SourceHealthConnect, engine.MetricSleepStage, start.Add(2*time.Hour), 100)
	r.EndAt = timeptr(start.Add(220 * time.Minute))
	r.SleepStage = &rem
	samples = append(samples, first, second, d, r, sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.Add(-time.Minute), 60), sample(engine.SourceHealthConnect, engine.MetricRestingHR, now.Add(-time.Minute), 65))
	in := engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: samples}
	out := compute(t, in)
	if out.Drivers.SleepDurationMinutes == nil || *out.Drivers.SleepDurationMinutes != 450 || out.Drivers.SleepRecoveryScore != 45 {
		t.Fatalf("fragment merging or stages wrong: %+v", out.Drivers)
	}
	if out.Diagnostics.BaselineReadyDays != 3 || out.Diagnostics.HRVBaselineMs == nil || *out.Diagnostics.HRVBaselineMs != 50 {
		t.Fatalf("baseline wrong: %+v", out.Diagnostics)
	}
	want := 8*(60.0-50)/math.Sqrt(200.0/3) - 7.5
	if math.Abs(out.Drivers.AutonomicDeltaScore-want) > .011 {
		t.Fatalf("autonomic got %v want %v", out.Drivers.AutonomicDeltaScore, want)
	}
	if out.UpdatedHRVBaseline == nil || *out.UpdatedHRVBaseline != 50 {
		t.Fatal("baseline update missing")
	}
	if out.Score != 73 || out.Tier != engine.TierSteady {
		t.Fatalf("four-factor golden changed: score=%d tier=%s drivers=%+v", out.Score, out.Tier, out.Drivers)
	}
	before, _ := json.Marshal(in)
	reversed := append([]engine.BiometricSampleInput(nil), samples...)
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	in.Samples14Days = reversed
	if other := compute(t, in); !reflect.DeepEqual(out, other) {
		t.Fatal("sample ordering changed output")
	}
	in.Samples14Days = samples
	after, _ := json.Marshal(in)
	if string(before) != string(after) {
		t.Fatal("input mutated")
	}
}

func TestEnergyInsufficientBaselineDoesNotInventZScore(t *testing.T) {
	now := moment("2026-11-19T10:00:00Z")
	in := engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: []engine.BiometricSampleInput{sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.Add(-time.Minute), 25), sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.Add(-24*time.Hour), 100)}}
	in.Profile.HRVBaselineMs = floatptr(100)
	out := compute(t, in)
	if out.Drivers.AutonomicDeltaScore != 0 {
		t.Fatalf("used unearned relative HRV baseline: %+v", out.Drivers)
	}
}

func TestEnergyLoadContinuousPenaltyRecoveryAndCancellation(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := task("11111111-1111-1111-1111-111111111111", start, 180, engine.LoadHigh)
	in := engine.EnergyComputeInput{Now: start.Add(3 * time.Hour), LocalDay: "2026-11-19", Profile: profile("UTC"), DaySchedules: []engine.ScheduleItemSnapshot{a}}
	out := compute(t, in)
	if math.Abs(out.Drivers.CognitiveLoadDrainScore-30.15) > .001 {
		t.Fatalf("continuous penalty got %v", out.Drivers.CognitiveLoadDrainScore)
	}
	in.Now = start.Add(3*time.Hour + 30*time.Minute)
	out = compute(t, in)
	if out.Drivers.RecoveryBufferBonusScore != 8 {
		t.Fatalf("natural completed rest missing %+v", out.Drivers)
	}
	a.Status = engine.StatusCancelled
	in.DaySchedules = []engine.ScheduleItemSnapshot{a}
	out = compute(t, in)
	if out.Drivers.CognitiveLoadDrainScore != 0 || out.Drivers.RecoveryBufferBonusScore != 0 {
		t.Fatal("cancelled task contributes load or free recovery")
	}
}

func TestEnergyShieldsAndFatigueAlert(t *testing.T) {
	now := moment("2026-11-19T08:00:00Z")
	sleep := sample(engine.SourceReplayDemo, engine.MetricSleepSession, now.Add(-9*time.Hour), 450)
	sleep.EndAt = timeptr(now.Add(-90 * time.Minute))
	samples := []engine.BiometricSampleInput{sleep, sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.Add(-time.Minute), 90)}
	for i := 1; i <= 3; i++ {
		samples = append(samples, sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.AddDate(0, 0, -i), 50))
	}
	in := engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: samples}
	out := compute(t, in)
	if len(out.FocusShields) == 0 {
		t.Fatalf("no continuous high-energy shields: %+v", out)
	}
	for _, s := range out.FocusShields {
		if s.EndAt.Sub(s.StartAt) < 90*time.Minute || s.AvgScore < 75 {
			t.Fatalf("invalid shield %+v", s)
		}
	}
	in.Now = moment("2026-11-19T14:00:00Z")
	in.Samples14Days = nil
	in.DaySchedules = []engine.ScheduleItemSnapshot{task("22222222-2222-2222-2222-222222222222", in.Now.Add(time.Hour), 60, engine.LoadHigh)}
	out = compute(t, in)
	if out.Score >= 40 || out.OverloadAlert == nil || out.OverloadAlert.RecommendedStrategy != engine.StrategyProtectRecovery {
		t.Fatalf("fatigue warning missing: %+v", out)
	}
}

func TestEnergyRejectsInvalidTimeAndCancellation(t *testing.T) {
	e := engine.NewEnergyEngine()
	_, err := e.ComputeSnapshot(context.Background(), engine.EnergyComputeInput{Now: moment("2026-11-19T00:00:00Z"), LocalDay: "2026-11-19", Profile: profile("Not/AZone")})
	if err == nil {
		t.Fatal("invalid timezone accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = e.ComputeSnapshot(ctx, engine.EnergyComputeInput{})
	if err != context.Canceled {
		t.Fatalf("want cancelled got %v", err)
	}
}

func TestEnergyRestResetsContinuousLoadAndClipsLocalDay(t *testing.T) {
	now := moment("2026-11-19T12:15:00Z")
	a := task("11111111-1111-1111-1111-111111111111", moment("2026-11-19T09:00:00Z"), 90, engine.LoadHigh)
	b := task("22222222-2222-2222-2222-222222222222", moment("2026-11-19T10:45:00Z"), 90, engine.LoadHigh)
	out := compute(t, engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), DaySchedules: []engine.ScheduleItemSnapshot{b, a}})
	if out.Drivers.CognitiveLoadDrainScore != 27 || out.Drivers.RecoveryBufferBonusScore != 4 {
		t.Fatalf("15m gap did not reset uninterrupted work: %+v", out.Drivers)
	}
	a.StartAt = moment("2026-11-18T23:00:00Z")
	a.EndAt = moment("2026-11-19T01:00:00Z")
	a.DurationMinutes = 120
	out = compute(t, engine.EnergyComputeInput{Now: a.EndAt, LocalDay: "2026-11-19", Profile: profile("UTC"), DaySchedules: []engine.ScheduleItemSnapshot{a}})
	if out.Drivers.CognitiveLoadDrainScore != 9 {
		t.Fatalf("previous day leaked load into current day: %+v", out.Drivers)
	}
}

func TestEnergyTwoLowMorningHRVDaysAndHeavyMeetingAlert(t *testing.T) {
	now := moment("2026-11-19T14:00:00Z")
	morning := moment("2026-11-19T08:00:00Z")
	samples := []engine.BiometricSampleInput{sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, morning, 10), sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, morning.AddDate(0, 0, -1), 10)}
	for i := 2; i <= 7; i++ {
		samples = append(samples, sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, morning.AddDate(0, 0, -i), 50))
	}
	meeting := task("11111111-1111-1111-1111-111111111111", moment("2026-11-19T09:00:00Z"), 5*60, engine.LoadHigh)
	meeting.Category = engine.CategoryMeeting
	meeting.Flexibility = engine.FlexibilityHardLocked
	out := compute(t, engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: samples, DaySchedules: []engine.ScheduleItemSnapshot{meeting}})
	if out.OverloadAlert == nil || out.OverloadAlert.TriggerReason != engine.TriggerWearableFatigue {
		t.Fatalf("repeated low morning HRV and >4h meetings not detected: %+v", out)
	}
}

func TestEnergyPhysiologyExpiresAfter24HoursAndReplayCannotPoisonLive(t *testing.T) {
	now := moment("2026-11-19T10:00:00Z")
	samples := []engine.BiometricSampleInput{sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.Add(-25*time.Hour), 10)}
	out := compute(t, engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: samples})
	if out.DataFreshness != engine.FreshnessRecentWearable || out.Drivers.RecentHRVRMSSDMs != nil || out.Drivers.AutonomicDeltaScore != 0 || out.Drivers.SleepRecoveryScore != 30 {
		t.Fatalf("stale physiological drivers survived: %+v", out)
	}
	samples = append(samples, sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.Add(-time.Hour), 1), sample(engine.SourceHealthConnect, engine.MetricHRVRMSSD, now.Add(-time.Minute), 50))
	out = compute(t, engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC"), Samples14Days: samples})
	if out.DataFreshness != engine.FreshnessLiveWearable || out.Drivers.RecentHRVRMSSDMs == nil || *out.Drivers.RecentHRVRMSSDMs != 50 || out.Drivers.AutonomicDeltaScore != 0 {
		t.Fatalf("old replay contaminated live source: %+v", out)
	}
}

func TestEnergyChronotypeAndPreferredShieldCannotOverlapMeetings(t *testing.T) {
	now := moment("2026-11-19T08:00:00Z")
	p := profile("UTC")
	p.Chronotype = engine.ChronotypeMorningLark
	lark := compute(t, engine.EnergyComputeInput{Now: moment("2026-11-19T09:30:00Z"), LocalDay: "2026-11-19", Profile: p})
	p.Chronotype = engine.ChronotypeNightOwl
	owl := compute(t, engine.EnergyComputeInput{Now: moment("2026-11-19T09:30:00Z"), LocalDay: "2026-11-19", Profile: p})
	if lark.Drivers.CircadianScore <= owl.Drivers.CircadianScore {
		t.Fatal("chronotype preference ignored")
	}
	p = profile("UTC")
	p.PreferredFocusWindows = []engine.DailyMinuteWindow{{StartMinute: 9 * 60, EndMinute: 12 * 60}}
	sleep := sample(engine.SourceReplayDemo, engine.MetricSleepSession, now.Add(-9*time.Hour), 450)
	sleep.EndAt = timeptr(now.Add(-90 * time.Minute))
	samples := []engine.BiometricSampleInput{sleep, sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.Add(-time.Minute), 90)}
	for i := 1; i <= 3; i++ {
		samples = append(samples, sample(engine.SourceReplayDemo, engine.MetricHRVRMSSD, now.AddDate(0, 0, -i), 50))
	}
	meeting := task("11111111-1111-1111-1111-111111111111", moment("2026-11-19T10:00:00Z"), 60, engine.LoadLow)
	meeting.Category = engine.CategoryMeeting
	out := compute(t, engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: p, Samples14Days: samples, DaySchedules: []engine.ScheduleItemSnapshot{meeting}})
	for _, s := range out.FocusShields {
		if s.StartAt.Before(moment("2026-11-19T09:00:00Z")) || s.EndAt.After(moment("2026-11-19T12:00:00Z")) || (s.StartAt.Before(meeting.EndAt) && meeting.StartAt.Before(s.EndAt)) {
			t.Fatalf("shield escaped preference or overlaps confirmed meeting: %+v", s)
		}
	}
}

func TestEnergyContiguousRestMergesNaturalAndExplicitRecovery(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := task("11111111-1111-1111-1111-111111111111", start, 90, engine.LoadHigh)
	rest := task("22222222-2222-2222-2222-222222222222", start.Add(100*time.Minute), 10, engine.LoadLow)
	rest.Category = engine.CategoryRecovery
	b := task("33333333-3333-3333-3333-333333333333", start.Add(120*time.Minute), 90, engine.LoadHigh)
	out := compute(t, engine.EnergyComputeInput{Now: start.Add(210 * time.Minute), LocalDay: "2026-11-19", Profile: profile("UTC"), DaySchedules: []engine.ScheduleItemSnapshot{a, rest, b}})
	if out.Drivers.CognitiveLoadDrainScore != 27 || out.Drivers.RecoveryBufferBonusScore != 8 {
		t.Fatalf("a contiguous 30m rest was split by its labels: %+v", out.Drivers)
	}
}
