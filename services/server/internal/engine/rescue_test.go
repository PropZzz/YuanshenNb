package engine_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/shixu-app/server/internal/engine"
)

func rescueInput() engine.RescueSolverInput {
	now := moment("2026-11-19T09:00:00Z")
	in := engine.RescueSolverInput{Now: now, LocalDay: "2026-11-19", BaselineVersion: "empty:2026-11-19", TriggerReason: engine.TriggerUrgentTask, Profile: profile("UTC"), UrgentTask: &engine.UrgentTaskInput{Title: "Production repair", DurationMinutes: 60, CognitiveLoad: engine.LoadHigh, DeadlineAt: now.Add(3 * time.Hour)}}
	for i := 0; i < 48; i++ {
		in.PredictedCurve = append(in.PredictedCurve, engine.HourlyEnergyPoint{HourStartAt: now.Add(time.Duration(i) * time.Hour), Score: 65, Tier: engine.TierSteady})
	}
	return in
}
func rescue(t *testing.T, in engine.RescueSolverInput) engine.RescueSolverOutput {
	t.Helper()
	out, err := engine.NewRescueEngine().BuildOptions(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func assertRescueHardConstraints(t *testing.T, in engine.RescueSolverInput, option engine.RescueOptionPlan) {
	t.Helper()
	start, end, err := engine.RescueWindowUTC(in.LocalDay, in.Profile.Timezone)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]engine.RescueDiffItem{}
	for _, d := range option.DiffItems {
		if d.ItemID != nil {
			seen[d.ItemID.String()] = d
		}
		if !d.AfterStartAt.Before(d.AfterEndAt) {
			t.Fatalf("non-positive schedule %+v", d)
		}
		if d.Op != engine.DiffOpUnchanged && (d.AfterStartAt.Before(in.Now) || d.AfterStartAt.Before(start) || d.AfterEndAt.After(end)) {
			t.Fatalf("created or moved task outside legal horizon %+v", d)
		}
	}
	for _, item := range in.WindowSchedules {
		if item.Status == engine.StatusCancelled {
			continue
		}
		if item.Flexibility == engine.FlexibilityHardLocked || item.Category == engine.CategoryMeeting || item.Status == engine.StatusCompleted || item.Status == engine.StatusInProgress || item.StartAt.Before(in.Now) {
			d, ok := seen[item.ID.String()]
			if !ok || d.Op != engine.DiffOpUnchanged || !d.AfterStartAt.Equal(item.StartAt) || !d.AfterEndAt.Equal(item.EndAt) {
				t.Fatalf("immutable task moved or missing %+v %+v", item, d)
			}
		}
	}
	if option.Feasible {
		for i, a := range option.DiffItems {
			for _, b := range option.DiffItems[i+1:] {
				if a.AfterStartAt.Before(b.AfterEndAt) && b.AfterStartAt.Before(a.AfterEndAt) {
					t.Fatalf("feasible plan overlaps %+v %+v", a, b)
				}
			}
		}
	}
}

func TestRescueThreeStrategiesAreDeterministicAndDoNotMutate(t *testing.T) {
	in := rescueInput()
	a := task("11111111-1111-1111-1111-111111111111", in.Now, 120, engine.LoadHigh)
	a.DeadlineAt = timeptr(in.Now.Add(4 * time.Hour))
	b := task("22222222-2222-2222-2222-222222222222", in.Now.Add(2*time.Hour), 60, engine.LoadMedium)
	lock := task("33333333-3333-3333-3333-333333333333", in.Now.Add(5*time.Hour), 60, engine.LoadMedium)
	lock.Flexibility = engine.FlexibilityHardLocked
	in.WindowSchedules = []engine.ScheduleItemSnapshot{a, b, lock}
	in.BaselineVersion = engine.ComputeBaselineVersion(in.LocalDay, in.WindowSchedules)
	before, _ := json.Marshal(in)
	out := rescue(t, in)
	if len(out.Options) != 3 {
		t.Fatalf("want 3 options got %+v", out)
	}
	hashes := map[string]bool{}
	for _, o := range out.Options {
		if len(o.OptionHash) != 16 || hashes[o.OptionHash] {
			t.Fatalf("invalid option hash %+v", o)
		}
		hashes[o.OptionHash] = true
		assertRescueHardConstraints(t, in, o)
	}
	other := rescue(t, in)
	if !reflect.DeepEqual(out, other) {
		t.Fatal("nondeterministic rescue output")
	}
	after, _ := json.Marshal(in)
	if string(before) != string(after) {
		t.Fatal("rescue mutated input")
	}
	in.WindowSchedules = []engine.ScheduleItemSnapshot{lock, b, a}
	if other = rescue(t, in); !reflect.DeepEqual(out, other) {
		t.Fatal("input order changes rescue hash/plan")
	}
	if out.Options[2].MovedCount > out.Options[0].MovedCount {
		t.Fatal("minimum-change strategy moves more than deadline strategy")
	}
}

func TestRescueNeverMovesMeetingOrAlreadyStartedWork(t *testing.T) {
	in := rescueInput()
	meeting := task("11111111-1111-1111-1111-111111111111", in.Now, 120, engine.LoadHigh)
	meeting.Category = engine.CategoryMeeting
	past := task("22222222-2222-2222-2222-222222222222", in.Now.Add(-time.Hour), 30, engine.LoadHigh)
	past.Status = engine.StatusCompleted
	next := task("33333333-3333-3333-3333-333333333333", in.Now.Add(24*time.Hour), 180, engine.LoadMedium)
	next.Flexibility = engine.FlexibilityHardLocked
	in.WindowSchedules = []engine.ScheduleItemSnapshot{meeting, past, next}
	out := rescue(t, in)
	for _, o := range out.Options {
		assertRescueHardConstraints(t, in, o)
		if !o.Feasible {
			t.Fatalf("expected feasible plan %+v", o)
		}
	}
}

func TestRescueProtectRecoveryAvoidsFatigueAndInsertsRealBuffer(t *testing.T) {
	in := rescueInput()
	in.UrgentTask.DeadlineAt = in.Now.Add(8 * time.Hour)
	for i := 0; i < 9; i++ {
		tier, score := engine.TierSteady, 65
		if i < 2 {
			tier, score = engine.TierDepleted, 20
		}
		in.PredictedCurve = append(in.PredictedCurve, engine.HourlyEnergyPoint{HourStartAt: in.Now.Add(time.Duration(i) * time.Hour), Score: score, Tier: tier})
	}
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectRecovery}
	out := rescue(t, in)
	o := out.Options[0]
	if !o.Feasible || o.RecoveryMinutes < 15 {
		t.Fatalf("recovery plan lacks buffer %+v", o)
	}
	foundUrgent, foundRecovery := false, false
	for _, d := range o.DiffItems {
		if d.Category == engine.CategoryUrgent {
			foundUrgent = true
			if d.AfterStartAt.Before(in.Now.Add(2 * time.Hour)) {
				t.Fatal("high work placed in measured depleted interval")
			}
		}
		if d.Op == engine.DiffOpCreate && d.Category == engine.CategoryRecovery && d.AfterEndAt.Sub(d.AfterStartAt) >= 15*time.Minute {
			foundRecovery = true
		}
	}
	if !foundUrgent || !foundRecovery {
		t.Fatalf("missing urgent or recovery %+v", o)
	}
	assertRescueHardConstraints(t, in, o)
}

func TestRescueImpossibleDeadlineIsHonestAndNeverDropsExistingTasks(t *testing.T) {
	in := rescueInput()
	locked := task("11111111-1111-1111-1111-111111111111", in.Now, 9*60, engine.LoadHigh)
	locked.Flexibility = engine.FlexibilityHardLocked
	in.WindowSchedules = []engine.ScheduleItemSnapshot{locked}
	in.UrgentTask.DeadlineAt = in.Now.Add(time.Hour)
	out := rescue(t, in)
	for _, o := range out.Options {
		if o.Feasible || o.OverdueRiskCount < 1 || o.Summary == "" {
			t.Fatalf("impossible deadline reported success %+v", o)
		}
		assertRescueHardConstraints(t, in, o)
	}
}

func TestRescueDeadlineDeferralAnd48HourDSTHorizon(t *testing.T) {
	in := rescueInput()
	in.Now = moment("2026-11-01T14:00:00Z")
	in.LocalDay = "2026-11-01"
	in.Profile = profile("America/New_York")
	in.UrgentTask.DeadlineAt = in.Now.Add(2 * time.Hour)
	in.UrgentTask.DurationMinutes = 120
	// DST Sunday still allows preserving existing work; new work is constrained to local work hours.
	in.WindowSchedules = []engine.ScheduleItemSnapshot{task("11111111-1111-1111-1111-111111111111", in.Now, 480, engine.LoadMedium)}
	out := rescue(t, in)
	for _, o := range out.Options {
		assertRescueHardConstraints(t, in, o)
	}
}

func TestRescueHashBindsBaselineTriggerAndActualDiff(t *testing.T) {
	in := rescueInput()
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectDeadline}
	a := rescue(t, in).Options[0].OptionHash
	in.BaselineVersion = "another"
	b := rescue(t, in).Options[0].OptionHash
	if a == b {
		t.Fatal("hash ignores baseline")
	}
	in.UrgentTask.Title = "Another urgent job"
	c := rescue(t, in).Options[0].OptionHash
	if b == c {
		t.Fatal("hash ignores diff content")
	}
}

func TestRescueValidationAndNoUrgentFatigueMode(t *testing.T) {
	in := rescueInput()
	in.UrgentTask.DeadlineAt = in.Now
	if _, err := engine.NewRescueEngine().BuildOptions(context.Background(), in); err == nil {
		t.Fatal("past urgent deadline accepted")
	}
	in = rescueInput()
	in.Strategies = []engine.RescueStrategy{"invented"}
	if _, err := engine.NewRescueEngine().BuildOptions(context.Background(), in); err == nil {
		t.Fatal("unknown strategy accepted")
	}
	in = rescueInput()
	in.TriggerReason = engine.TriggerWearableFatigue
	in.UrgentTask = nil
	out := rescue(t, in)
	if len(out.Options) != 3 {
		t.Fatal("fatigue rescue needs all 3 options")
	}
}

func TestRescueRecoveryCannotSucceedWithoutAnyRecoverySpace(t *testing.T) {
	in := rescueInput()
	in.UrgentTask = nil
	in.TriggerReason = engine.TriggerWearableFatigue
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectRecovery}
	a := task("11111111-1111-1111-1111-111111111111", in.Now, 9*60, engine.LoadMedium)
	a.Flexibility = engine.FlexibilityHardLocked
	b := task("22222222-2222-2222-2222-222222222222", in.Now.Add(24*time.Hour), 9*60, engine.LoadMedium)
	b.Flexibility = engine.FlexibilityHardLocked
	in.WindowSchedules = []engine.ScheduleItemSnapshot{a, b}
	out := rescue(t, in)
	if out.Options[0].Feasible || out.Options[0].RecoveryMinutes != 0 {
		t.Fatalf("recovery strategy claims success without restoration: %+v", out)
	}
}

func TestRescueDefersWithoutShorteningAndFlagsUnavoidableDeadline(t *testing.T) {
	in := rescueInput()
	in.Now = moment("2026-11-19T16:00:00Z")
	in.UrgentTask.DeadlineAt = in.Now.Add(2 * time.Hour)
	a := task("11111111-1111-1111-1111-111111111111", in.Now, 120, engine.LoadMedium)
	in.WindowSchedules = []engine.ScheduleItemSnapshot{a}
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectDeadline}
	out := rescue(t, in)
	o := out.Options[0]
	if !o.Feasible || o.DeferredCount != 1 {
		t.Fatalf("task should move to next day intact: %+v", o)
	}
	for _, d := range o.DiffItems {
		if d.ItemID != nil && d.AfterEndAt.Sub(d.AfterStartAt) != 2*time.Hour {
			t.Fatal("task duration shortened")
		}
	}
	assertRescueHardConstraints(t, in, o)
}

func TestRescueCancelledTaskIsNotResurrected(t *testing.T) {
	in := rescueInput()
	a := task("11111111-1111-1111-1111-111111111111", in.Now, 120, engine.LoadHigh)
	a.Status = engine.StatusCancelled
	in.WindowSchedules = []engine.ScheduleItemSnapshot{a}
	for _, o := range rescue(t, in).Options {
		for _, d := range o.DiffItems {
			if d.ItemID != nil && *d.ItemID == a.ID {
				t.Fatal("cancelled task resurrected")
			}
		}
	}
}

func TestRescueFatigueConstraintIsNotMislabeledAsDeadlineRisk(t *testing.T) {
	in := rescueInput()
	in.UrgentTask = nil
	in.TriggerReason = engine.TriggerWearableFatigue
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectRecovery}
	a := task("11111111-1111-1111-1111-111111111111", in.Now, 60, engine.LoadHigh)
	a.Flexibility = engine.FlexibilityHardLocked
	in.WindowSchedules = []engine.ScheduleItemSnapshot{a}
	in.PredictedCurve = []engine.HourlyEnergyPoint{{HourStartAt: in.Now, Score: 20, Tier: engine.TierDepleted}}
	o := rescue(t, in).Options[0]
	if o.Feasible || o.OverdueRiskCount != 0 {
		t.Fatalf("fatigue restriction was mislabeled as a deadline: %+v", o)
	}
}

func TestRescueShortRecoveryDoesNotSatisfyMinimumBuffer(t *testing.T) {
	in := rescueInput()
	in.UrgentTask = nil
	in.TriggerReason = engine.TriggerWearableFatigue
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectRecovery}
	in.Profile.MinRecoveryBufferMin = 30
	short := task("11111111-1111-1111-1111-111111111111", in.Now, 5, engine.LoadLow)
	short.Category = engine.CategoryRecovery
	in.WindowSchedules = []engine.ScheduleItemSnapshot{short}
	o := rescue(t, in).Options[0]
	found := false
	for _, d := range o.DiffItems {
		if d.Category == engine.CategoryRecovery && d.AfterEndAt.Sub(d.AfterStartAt) >= 30*time.Minute {
			found = true
		}
	}
	if o.Feasible && !found {
		t.Fatalf("5m recovery incorrectly satisfied 30m buffer: %+v", o)
	}
}

func TestRescueFutureLocalDayUsesSelectedHorizon(t *testing.T) {
	in := rescueInput()
	in.LocalDay = "2026-11-20"
	in.UrgentTask.DeadlineAt = moment("2026-11-20T12:00:00Z")
	in.Strategies = []engine.RescueStrategy{engine.StrategyProtectDeadline}
	o := rescue(t, in).Options[0]
	if !o.Feasible {
		t.Fatalf("future selected day is not schedulable: %+v", o)
	}
	assertRescueHardConstraints(t, in, o)
}
