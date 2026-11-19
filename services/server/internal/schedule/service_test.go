package schedule

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/testutil"
)

func TestPostgresScheduleTenantIsolationAndHalfOpenConflicts(t *testing.T) {
	pool := testutil.Postgres(t)
	s := NewService(pool)
	ctx := context.Background()
	a, b := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{a, b} {
		if _, err := pool.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','hash')", id, id.String()+"@example.com"); err != nil {
			t.Fatal(err)
		}
	}
	start := time.Now().UTC().Truncate(time.Hour).Add(24 * time.Hour)
	input := api.CreateScheduleItemRequest{Title: "Private focus", Category: "deep_work", CognitiveLoad: "high", Flexibility: "hard_locked", StartAt: start, EndAt: start.Add(time.Hour)}
	item, err := s.Create(ctx, a, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Update(ctx, b, item.ID, api.UpdateScheduleItemRequest{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user's item accessible: %v", err)
	}
	input.StartAt = start.Add(30 * time.Minute)
	input.EndAt = start.Add(90 * time.Minute)
	if _, err = s.Create(ctx, a, input); !errors.Is(err, ErrOverlap) {
		t.Fatalf("overlap should fail: %v", err)
	}
	input.StartAt = start.Add(time.Hour)
	input.EndAt = start.Add(2 * time.Hour)
	if _, err = s.Create(ctx, a, input); err != nil {
		t.Fatalf("adjacent half-open interval rejected: %v", err)
	}
	items, err := s.List(ctx, b, start, start.Add(24*time.Hour), false)
	if err != nil || len(items) != 0 {
		t.Fatal("schedule list leaked another user's records")
	}
	if err = s.Delete(ctx, a, item.ID); err != nil {
		t.Fatal(err)
	}
	items, _ = s.List(ctx, a, start, start.Add(time.Hour), false)
	if len(items) != 0 {
		t.Fatal("delete did not release active interval")
	}
}

func TestPostgresScheduleLocksEmptyCalendarForConcurrentCreates(t *testing.T) {
	pool := testutil.Postgres(t)
	s := NewService(pool)
	ctx := context.Background()
	id := uuid.New()
	pool.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','hash')", id, id.String()+"@example.com")
	start := time.Now().UTC().Add(24 * time.Hour)
	in := api.CreateScheduleItemRequest{Title: "Locked", Category: "deep_work", CognitiveLoad: "high", Flexibility: "hard_locked", StartAt: start, EndAt: start.Add(time.Hour)}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Create(ctx, id, in); results <- err }()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrOverlap) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("empty calendar lock failed: success=%d conflict=%d", success, conflict)
	}
}

func TestScheduleManagedMeetingCannotBeMovedOrDeleted(t *testing.T) {
	item := api.ScheduleItemDTO{MeetingProposalID: ptr(uuid.New()), Status: "planned"}
	start := time.Now()
	if !managedChange(item, api.UpdateScheduleItemRequest{StartAt: &start}) {
		t.Fatal("managed meeting can be moved")
	}
	status := api.ScheduleStatus(engine.StatusCompleted)
	if managedChange(item, api.UpdateScheduleItemRequest{Status: &status}) {
		t.Fatal("completing own meeting must remain allowed")
	}
}

func ptr[T any](v T) *T { return &v }
