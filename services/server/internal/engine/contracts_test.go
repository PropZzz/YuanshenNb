package engine_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
)

func TestComputeBaselineVersion_EmptyAndCancelled(t *testing.T) {
	day := "2026-11-18"
	if got := engine.ComputeBaselineVersion(day, nil); got != "empty:2026-11-18" {
		t.Fatalf("expected empty baseline, got %q", got)
	}

	cancelledOnly := []engine.ScheduleItemSnapshot{
		{
			ID:        uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"),
			Status:    engine.StatusCancelled,
			StartAt:   time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC),
			EndAt:     time.Date(2026, 11, 18, 10, 0, 0, 0, time.UTC),
			UpdatedAt: time.Date(2026, 11, 18, 8, 0, 0, 0, time.UTC),
		},
	}
	if got := engine.ComputeBaselineVersion(day, cancelledOnly); got != "empty:2026-11-18" {
		t.Fatalf("cancelled-only slice should produce empty baseline, got %q", got)
	}
}

func TestComputeBaselineVersion_OrderIndependentAndSensitive(t *testing.T) {
	day := "2026-11-18"
	t0 := time.Date(2026, 11, 18, 2, 0, 0, 0, time.UTC)
	itemA := engine.ScheduleItemSnapshot{
		ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Status:      engine.StatusPlanned,
		Flexibility: engine.FlexibilityFlexible,
		StartAt:     t0,
		EndAt:       t0.Add(60 * time.Minute),
		UpdatedAt:   t0,
	}
	itemB := engine.ScheduleItemSnapshot{
		ID:          uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		Status:      engine.StatusPlanned,
		Flexibility: engine.FlexibilityHardLocked,
		StartAt:     t0.Add(24 * time.Hour), // 次日顺延窗口内日程
		EndAt:       t0.Add(25 * time.Hour),
		UpdatedAt:   t0,
	}

	v1 := engine.ComputeBaselineVersion(day, []engine.ScheduleItemSnapshot{itemA, itemB})
	v2 := engine.ComputeBaselineVersion(day, []engine.ScheduleItemSnapshot{itemB, itemA})
	if len(v1) != 16 {
		t.Fatalf("expected 16-char hex digest, got %q (len=%d)", v1, len(v1))
	}
	if v1 != v2 {
		t.Fatalf("expected order-independent hash, got %q != %q", v1, v2)
	}

	itemBChanged := itemB
	itemBChanged.StartAt = itemB.StartAt.Add(15 * time.Minute)
	v3 := engine.ComputeBaselineVersion(day, []engine.ScheduleItemSnapshot{itemA, itemBChanged})
	if v3 == v1 {
		t.Fatalf("expected baselineVersion to change when next-day item shifts")
	}
}
