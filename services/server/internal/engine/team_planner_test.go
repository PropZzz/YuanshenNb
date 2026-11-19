package engine_test

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
)

func member(id string, privacy engine.PrivacyLevel, zone string) engine.MemberRawSchedulingData {
	u := uuid.MustParse(id)
	p := profile(zone).WorkScheduleProfile
	p.UserID = u
	return engine.MemberRawSchedulingData{UserID: u, DisplayName: "Member " + id[:1], PrivacyLevel: privacy, Profile: p}
}
func TestTeamPrivacyProjectionPhysicallyRemovesSecrets(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	base := member("11111111-1111-1111-1111-111111111111", engine.PrivacyBusyOnly, "UTC")
	a := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start.Add(-15*time.Minute), 60, engine.LoadHigh)
	a.Title = "SECRET TITLE"
	a.Flexibility = engine.FlexibilityFocusShield
	base.Schedules = []engine.ScheduleItemSnapshot{a}
	base.PredictedCurve = []engine.HourlyEnergyPoint{{HourStartAt: start, Score: 87, Tier: engine.TierPeak}}
	for _, privacy := range []engine.PrivacyLevel{engine.PrivacyBusyOnly, engine.PrivacyEnergyTier, engine.PrivacyFullTitle} {
		base.PrivacyLevel = privacy
		out, err := engine.NewTeamPlannerEngine().ProjectAvailability(context.Background(), engine.AvailabilityProjectionInput{From: start, To: start.Add(2 * time.Hour), Members: []engine.MemberRawSchedulingData{base}})
		if err != nil {
			t.Fatal(err)
		}
		if len(out) != 1 || len(out[0].Slots) != 1 || !out[0].Slots[0].StartAt.Equal(start) {
			t.Fatalf("bad clipped projection %+v", out)
		}
		b, _ := json.Marshal(out)
		text := string(b)
		if strings.Contains(strings.ToLower(text), "score") || strings.Contains(text, "87") {
			t.Fatalf("exact energy leaked %s", text)
		}
		if privacy == engine.PrivacyBusyOnly {
			if out[0].Slots[0].Kind != engine.SlotKindBusy || len(out[0].EnergyBuckets) > 0 {
				t.Fatal("busy_only leaks focus or energy")
			}
		}
		if privacy != engine.PrivacyFullTitle && strings.Contains(text, "SECRET") {
			t.Fatal("title leaked")
		}
		if privacy == engine.PrivacyFullTitle && (out[0].Slots[0].Title == nil || *out[0].Slots[0].Title != "SECRET TITLE") {
			t.Fatal("opted-in title missing")
		}
	}
}

func TestTeamFindsCommonTimeRejectsLocksAndRetainsOptionalRatio(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "UTC")
	b := member("22222222-2222-2222-2222-222222222222", engine.PrivacyEnergyTier, "Europe/Paris")
	c := member("33333333-3333-3333-3333-333333333333", engine.PrivacyEnergyTier, "UTC")
	lock := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start, 60, engine.LoadHigh)
	lock.Flexibility = engine.FlexibilityHardLocked
	a.Schedules = []engine.ScheduleItemSnapshot{lock}
	lock.StartAt = start.Add(time.Hour)
	lock.EndAt = start.Add(2 * time.Hour)
	c.Schedules = []engine.ScheduleItemSnapshot{lock}
	for _, m := range []*engine.MemberRawSchedulingData{&a, &b, &c} {
		for i := 0; i < 8; i++ {
			m.PredictedCurve = append(m.PredictedCurve, engine.HourlyEnergyPoint{HourStartAt: start.Add(time.Duration(i) * time.Hour), Score: 80, Tier: engine.TierPeak})
		}
	}
	in := engine.MeetingSolverInput{Title: "Review", DurationMinutes: 60, CognitiveLoad: engine.LoadHigh, RequiredUserIDs: []uuid.UUID{a.UserID, b.UserID}, OptionalUserIDs: []uuid.UUID{c.UserID}, SearchFrom: start, SearchTo: start.Add(8 * time.Hour), RespectFocusShields: true, Members: []engine.MemberRawSchedulingData{a, b, c}}
	before, _ := json.Marshal(in)
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Recommendations) != 3 {
		t.Fatalf("want Top3 got %+v", out)
	}
	last := 101
	for i, r := range out.Recommendations {
		if r.Rank != i+1 || r.Score > last || r.Score < 0 || r.Score > 100 {
			t.Fatalf("ranking wrong %+v", out)
		}
		last = r.Score
		if r.StartAt.Before(start.Add(time.Hour)) || r.EndAt.After(start.Add(8*time.Hour)) {
			t.Fatalf("hard collision or work-hour violation %+v", r)
		}
		if r.Breakdown.OptionalAttendanceRatio != 0 && r.Breakdown.OptionalAttendanceRatio != 1 {
			t.Fatal("bad optional ratio")
		}
		if len(r.ExplanationTags) == 0 {
			t.Fatal("missing explanation")
		}
	}
	other, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
	if err != nil || !reflect.DeepEqual(out, other) {
		t.Fatal("non-deterministic recommendation")
	}
	after, _ := json.Marshal(in)
	if string(before) != string(after) {
		t.Fatal("solver mutated input")
	}
}

func TestTeamInfeasibilityDiagnostics(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "UTC")
	for _, tt := range []struct {
		name, want string
		change     func(*engine.MeetingSolverInput)
	}{
		{"no_common", "NO_COMMON_WORK_HOURS", func(in *engine.MeetingSolverInput) {
			in.Members[0].Profile.WorkStartMinute = 60
			in.Members[0].Profile.WorkEndMinute = 120
		}},
		{"locked", "REQUIRED_MEMBER_LOCKED", func(in *engine.MeetingSolverInput) {
			item := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start, 120, engine.LoadMedium)
			item.Category = engine.CategoryMeeting
			in.Members[0].Schedules = []engine.ScheduleItemSnapshot{item}
		}},
		{"shield", "SHIELD_BLOCKED_ALL_SLOTS", func(in *engine.MeetingSolverInput) {
			item := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start, 120, engine.LoadMedium)
			item.Flexibility = engine.FlexibilityFocusShield
			in.Members[0].Schedules = []engine.ScheduleItemSnapshot{item}
		}},
		{"duration", "DURATION_TOO_LONG", func(in *engine.MeetingSolverInput) { in.DurationMinutes = 180 }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			in := engine.MeetingSolverInput{DurationMinutes: 60, CognitiveLoad: engine.LoadHigh, RequiredUserIDs: []uuid.UUID{a.UserID}, SearchFrom: start, SearchTo: start.Add(2 * time.Hour), RespectFocusShields: true, Members: []engine.MemberRawSchedulingData{a}}
			tt.change(&in)
			out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
			if err != nil {
				t.Fatal(err)
			}
			if len(out.Recommendations) != 0 || len(out.BlockingDiagnostics) == 0 {
				t.Fatalf("missing unsat diagnostic %+v", out)
			}
			found := false
			for _, d := range out.BlockingDiagnostics {
				if d.Code == tt.want && len(d.BlockingUserIDs) > 0 && d.SuggestedAction != "" {
					found = true
				}
			}
			if !found {
				t.Fatalf("want %s got %+v", tt.want, out)
			}
		})
	}
}

func TestTeamRespectFocusShieldAndLowLoadPrefersSteady(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "UTC")
	a.Profile.WorkEndMinute = 11 * 60
	a.PredictedCurve = []engine.HourlyEnergyPoint{{HourStartAt: start, Score: 90, Tier: engine.TierPeak}, {HourStartAt: start.Add(time.Hour), Score: 65, Tier: engine.TierSteady}}
	in := engine.MeetingSolverInput{DurationMinutes: 60, CognitiveLoad: engine.LoadLow, RequiredUserIDs: []uuid.UUID{a.UserID}, SearchFrom: start, SearchTo: start.Add(2 * time.Hour), Members: []engine.MemberRawSchedulingData{a}}
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Recommendations) == 0 || !out.Recommendations[0].StartAt.Equal(start.Add(time.Hour)) {
		t.Fatalf("low load wastes peak: %+v", out)
	}
	shield := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start, 120, engine.LoadHigh)
	shield.Flexibility = engine.FlexibilityFocusShield
	in.Members[0].Schedules = []engine.ScheduleItemSnapshot{shield}
	out, err = engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
	if err != nil || len(out.Recommendations) == 0 || !out.Recommendations[0].AffectedMembers[0].BreaksFocusShield {
		t.Fatalf("explicit shield relaxation failed: %+v %v", out, err)
	}
}

func TestTeamRejectsInvalidMembersAndHonorsCancelled(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	in := engine.MeetingSolverInput{DurationMinutes: 60, CognitiveLoad: engine.LoadHigh, RequiredUserIDs: []uuid.UUID{uuid.New()}, SearchFrom: start, SearchTo: start.Add(time.Hour)}
	if _, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in); err == nil {
		t.Fatal("missing required member accepted")
	}
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyBusyOnly, "UTC")
	lock := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start, 60, engine.LoadHigh)
	lock.Flexibility = engine.FlexibilityHardLocked
	lock.Status = engine.StatusCancelled
	a.Schedules = []engine.ScheduleItemSnapshot{lock}
	in.RequiredUserIDs = []uuid.UUID{a.UserID}
	in.Members = []engine.MemberRawSchedulingData{a}
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
	if err != nil || len(out.Recommendations) != 1 || out.Recommendations[0].AffectedMembers[0].EnergyTier != nil {
		t.Fatalf("cancelled or busy-only violation %+v %v", out, err)
	}
}

func TestTeamBusyOnlyFocusRemainsOpaqueEvenWhenShieldsRelaxed(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyBusyOnly, "UTC")
	shield := task("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", start, 60, engine.LoadHigh)
	shield.Flexibility = engine.FlexibilityFocusShield
	a.Schedules = []engine.ScheduleItemSnapshot{shield}
	in := engine.MeetingSolverInput{DurationMinutes: 60, CognitiveLoad: engine.LoadHigh, RequiredUserIDs: []uuid.UUID{a.UserID}, SearchFrom: start, SearchTo: start.Add(time.Hour), RespectFocusShields: false, Members: []engine.MemberRawSchedulingData{a}}
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Recommendations) != 0 || len(out.BlockingDiagnostics) == 0 || out.BlockingDiagnostics[0].Code != "REQUIRED_MEMBER_LOCKED" {
		t.Fatalf("busy_only focus must remain opaque busy, got %+v", out)
	}
}

func TestTeamDurationTooLongForCommonWorkInterval(t *testing.T) {
	start := moment("2026-11-19T09:00:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "UTC")
	a.Profile.WorkEndMinute = 10 * 60
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), engine.MeetingSolverInput{DurationMinutes: 120, CognitiveLoad: engine.LoadMedium, RequiredUserIDs: []uuid.UUID{a.UserID}, SearchFrom: start, SearchTo: start.Add(8 * time.Hour), Members: []engine.MemberRawSchedulingData{a}})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.BlockingDiagnostics) == 0 || out.BlockingDiagnostics[0].Code != "DURATION_TOO_LONG" {
		t.Fatalf("duration diagnostic hides a real shorter common interval: %+v", out)
	}
}

func TestTeamNoCommonHoursAcrossOppositeTimezonesAndDST(t *testing.T) {
	start := moment("2026-11-02T00:00:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "Asia/Shanghai")
	b := member("22222222-2222-2222-2222-222222222222", engine.PrivacyEnergyTier, "America/New_York")
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), engine.MeetingSolverInput{DurationMinutes: 60, CognitiveLoad: engine.LoadMedium, RequiredUserIDs: []uuid.UUID{a.UserID, b.UserID}, SearchFrom: start, SearchTo: start.Add(24 * time.Hour), Members: []engine.MemberRawSchedulingData{a, b}})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Recommendations) != 0 || len(out.BlockingDiagnostics) != 1 || out.BlockingDiagnostics[0].Code != "NO_COMMON_WORK_HOURS" {
		t.Fatalf("false common time across DST and 13-hour offset: %+v", out)
	}
}

func TestTeamAcceptsContractDurationWhileAligningCandidateStarts(t *testing.T) {
	start := moment("2026-11-19T09:01:00Z")
	a := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "UTC")
	out, err := engine.NewTeamPlannerEngine().RecommendWindows(context.Background(), engine.MeetingSolverInput{DurationMinutes: 20, CognitiveLoad: engine.LoadMedium, RequiredUserIDs: []uuid.UUID{a.UserID}, SearchFrom: start, SearchTo: start.Add(time.Hour), Members: []engine.MemberRawSchedulingData{a}})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Recommendations) == 0 {
		t.Fatal("valid 20-minute meeting was rejected")
	}
	for _, r := range out.Recommendations {
		if r.StartAt.Minute()%15 != 0 || r.EndAt.Sub(r.StartAt) != 20*time.Minute {
			t.Fatalf("wrong slot granularity or duration: %+v", r)
		}
	}
}
