package schedule

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/testutil"
	"testing"
	"time"
)

func TestPostgresRescueRejectsStaleAndTamperedOptionsAndUndoesAtomically(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash,timezone) VALUES($1,$2,'Test','hash','UTC')", id, id.String()+"@example.com")
	p.Exec(ctx, "INSERT INTO energy_profiles(user_id) VALUES($1)", id)
	now := time.Now().UTC()
	day := now.Format("2006-01-02")
	deadline := now.Add(30 * time.Hour)
	loader := func(ctx context.Context, q Querier, id uuid.UUID, day string, now time.Time) (engine.EnergyComputeInput, error) {
		return engine.EnergyComputeInput{Now: now, LocalDay: day, Profile: engine.EnergyProfileInput{WorkScheduleProfile: engine.WorkScheduleProfile{UserID: id, Timezone: "UTC", WorkStartMinute: 540, WorkEndMinute: 1080, Chronotype: "balanced", MinRecoveryBufferMin: 15}}}, nil
	}
	s := NewRescueService(p, engine.NewEnergyEngine(), engine.NewRescueEngine(), loader)
	urgent := &api.UrgentTaskDTO{Title: "Deadline", DurationMinutes: 30, CognitiveLoad: "high", DeadlineAt: deadline}
	preview, err := s.Options(ctx, id, api.RescueOptionsRequest{Day: day, TriggerReason: "urgent_task", UrgentTask: urgent})
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Options) != 3 {
		t.Fatal("missing strategies")
	}
	request := api.RescueApplyRequest{Day: day, BaselineVersion: "stale", Strategy: "protect_deadline", TriggerReason: "urgent_task", UrgentTask: urgent}
	if _, err = s.Apply(ctx, id, "", request); !errors.Is(err, ErrStale) {
		t.Fatalf("stale baseline accepted: %v", err)
	}
	request.BaselineVersion = preview.BaselineVersion
	request.ExpectedOptionHash = "tampered"
	if _, err = s.Apply(ctx, id, "", request); !errors.Is(err, ErrStale) {
		t.Fatalf("tampered option accepted: %v", err)
	}
	request.ExpectedOptionHash = preview.Options[0].OptionHash
	request.Strategy = preview.Options[0].Strategy
	applied, err := s.Apply(ctx, id, "one", request)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.Apply(ctx, id, "one", request)
	if err != nil || again.SnapshotID != applied.SnapshotID {
		t.Fatal("apply retry duplicated snapshot")
	}
	undone, err := s.Undo(ctx, id, applied.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if undone.Status != "reverted" {
		t.Fatal("snapshot not marked reverted")
	}
	if _, err = s.Undo(ctx, id, applied.SnapshotID); !errors.Is(err, ErrReverted) {
		t.Fatal("double undo accepted")
	}
}

func TestPostgresUndoPreservesNewItemsAndReturnsWholeWindowBaseline(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash,timezone) VALUES($1,$2,'Test','hash','UTC')", id, id.String()+"@example.com")
	p.Exec(ctx, "INSERT INTO energy_profiles(user_id) VALUES($1)", id)
	calendar := NewService(p)
	now := time.Now().UTC()
	day := now.Format("2006-01-02")
	start, _ := time.Parse("2006-01-02", day)
	start = start.Add(27 * time.Hour)
	before, err := calendar.Create(ctx, id, api.CreateScheduleItemRequest{Title: "Move me", Presentation: &api.SchedulePresentation{AttributeTag: "project", GoalID: "goal-1", GoalTitle: "Preserved goal"}, Category: "routine", CognitiveLoad: "low", Flexibility: "flexible", StartAt: start, EndAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	later := start.Add(2 * time.Hour)
	laterEnd := later.Add(time.Hour)
	after, err := calendar.Update(ctx, id, before.ID, api.UpdateScheduleItemRequest{StartAt: &later, EndAt: &laterEnd})
	if err != nil {
		t.Fatal(err)
	}
	untouched, err := calendar.Create(ctx, id, api.CreateScheduleItemRequest{Title: "Not moved by rescue", Category: "routine", CognitiveLoad: "low", Flexibility: "hard_locked", StartAt: start.Add(8 * time.Hour), EndAt: start.Add(9 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	beforeJSON, _ := json.Marshal([]api.ScheduleItemDTO{before, untouched})
	afterJSON, _ := json.Marshal([]api.ScheduleItemDTO{after, untouched})
	var snapshot uuid.UUID
	err = p.QueryRow(ctx, "INSERT INTO rescue_snapshots(user_id,local_day,baseline_version,option_hash,strategy,trigger_reason,before_items,after_items) VALUES($1,$2,'baseline','hash','minimize_changes','wearable_fatigue',$3,$4) RETURNING id", id, day, beforeJSON, afterJSON).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	_, err = calendar.Create(ctx, id, api.CreateScheduleItemRequest{Title: "Keep my new task", Category: "routine", CognitiveLoad: "low", Flexibility: "flexible", StartAt: start.Add(5 * time.Hour), EndAt: start.Add(6 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	newNotes := "Keep this later edit on an untouched item"
	if _, err = calendar.Update(ctx, id, untouched.ID, api.UpdateScheduleItemRequest{Notes: &newNotes}); err != nil {
		t.Fatal(err)
	}
	s := NewRescueService(p, nil, nil, nil)
	blocker, err := calendar.Create(ctx, id, api.CreateScheduleItemRequest{Title: "New locked commitment", Category: "routine", CognitiveLoad: "low", Flexibility: "hard_locked", StartAt: start, EndAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Undo(ctx, id, snapshot); !errors.Is(err, ErrRestoreConflict) {
		t.Fatalf("undo overwrote a new locked commitment: %v", err)
	}
	if err = calendar.Delete(ctx, id, blocker.ID); err != nil {
		t.Fatal(err)
	}
	out, err := s.Undo(ctx, id, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := calendar.Get(ctx, id, before.ID)
	if err != nil || restored.Presentation == nil || restored.Presentation.AttributeTag != "project" || restored.Presentation.GoalID != "goal-1" {
		t.Fatal("undo lost saved presentation metadata")
	}
	preserved, err := calendar.Get(ctx, id, untouched.ID)
	if err != nil || preserved.Notes != newNotes {
		t.Fatal("undo overwrote an item not changed by rescue")
	}
	_, baseline, err := calendar.Baseline(ctx, id, start.Add(-24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if out.BaselineVersion != baseline {
		t.Fatalf("undo baseline omits a newer untouched item: got %s want %s", out.BaselineVersion, baseline)
	}
}

func TestPostgresRescueHistoryCursorDoesNotSkipEqualTimestamps(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','hash')", id, id.String()+"@example.com")
	stamp := time.Now().UTC()
	for range 2 {
		if _, err := p.Exec(ctx, "INSERT INTO rescue_snapshots(user_id,local_day,baseline_version,option_hash,strategy,trigger_reason,before_items,after_items,applied_at) VALUES($1,$2,'v','h','minimize_changes','wearable_fatigue','[]','[]',$3)", id, stamp.Format("2006-01-02"), stamp); err != nil {
			t.Fatal(err)
		}
	}
	s := NewRescueService(p, nil, nil, nil)
	first, err := s.History(ctx, id, 1, "")
	if err != nil || len(first.Snapshots) != 1 || first.NextCursor == nil {
		t.Fatal("first page missing")
	}
	second, err := s.History(ctx, id, 1, *first.NextCursor)
	if err != nil || len(second.Snapshots) != 1 || second.Snapshots[0].ID == first.Snapshots[0].ID {
		t.Fatal("cursor skipped a snapshot with equal applied_at")
	}
}
