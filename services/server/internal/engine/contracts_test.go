package engine_test

import (
	"reflect"
	"strings"
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

func TestLocalDayWindowUTC_StandardAndDST(t *testing.T) {
	// 1. 标准时区（Asia/Shanghai 恒定 UTC+8，24 小时）
	start, end, err := engine.LocalDayWindowUTC("2026-11-18", "Asia/Shanghai")
	if err != nil {
		t.Fatalf("Asia/Shanghai failed: %v", err)
	}
	wantStart := time.Date(2026, 11, 17, 16, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) {
		t.Fatalf("expected start %v, got %v", wantStart, start)
	}
	if diff := end.Sub(start); diff != 24*time.Hour {
		t.Fatalf("expected 24h duration, got %v", diff)
	}

	// 2. 美国夏令时开始日（2026-03-08 America/New_York，23 小时）
	springStart, springEnd, err := engine.LocalDayWindowUTC("2026-03-08", "America/New_York")
	if err != nil {
		t.Fatalf("America/New_York spring DST failed: %v", err)
	}
	if diff := springEnd.Sub(springStart); diff != 23*time.Hour {
		t.Fatalf("expected 23h spring DST day, got %v", diff)
	}

	// 3. 美国夏令时结束日（2026-11-01 America/New_York，25 小时）
	fallStart, fallEnd, err := engine.LocalDayWindowUTC("2026-11-01", "America/New_York")
	if err != nil {
		t.Fatalf("America/New_York fall DST failed: %v", err)
	}
	if diff := fallEnd.Sub(fallStart); diff != 25*time.Hour {
		t.Fatalf("expected 25h fall DST day, got %v", diff)
	}

	// 4. 48h 救援窗口校验
	rescueStart, rescueEnd, err := engine.RescueWindowUTC("2026-11-18", "Asia/Shanghai")
	if err != nil {
		t.Fatalf("RescueWindowUTC failed: %v", err)
	}
	if !rescueStart.Equal(wantStart) || rescueEnd.Sub(rescueStart) != 48*time.Hour {
		t.Fatalf("unexpected rescue window: [%v, %v)", rescueStart, rescueEnd)
	}

	// 5. 非法输入校验
	if _, _, err := engine.LocalDayWindowUTC("2026/11/18", "Asia/Shanghai"); err == nil {
		t.Fatalf("expected error for malformed localDay")
	}
	if _, _, err := engine.LocalDayWindowUTC("2026-11-18", "Invalid/Zone"); err == nil {
		t.Fatalf("expected error for invalid timezone")
	}
}

func TestMemberRawSchedulingData_NoBiometricFields(t *testing.T) {
	forbidden := []string{"hrv", "rhr", "heart", "sleep", "biometric", "score"}
	assertNoForbiddenFields(t, reflect.TypeOf(engine.MemberRawSchedulingData{}), "MemberRawSchedulingData", forbidden, map[reflect.Type]bool{})
	assertNoForbiddenFields(t, reflect.TypeOf(engine.MemberAvailabilityView{}), "MemberAvailabilityView", forbidden, map[reflect.Type]bool{})
}

func assertNoForbiddenFields(t *testing.T, typ reflect.Type, path string, forbidden []string, visited map[reflect.Type]bool) {
	t.Helper()
	for typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Slice || typ.Kind() == reflect.Array {
		typ = typ.Elem()
	}
	if typ.Kind() != reflect.Struct {
		return
	}
	if visited[typ] {
		return
	}
	visited[typ] = true

	// PredictedCurve 允许在输入侧作为内部逐小时能量点传入（投影后仅保留 Tier），跳过对 PredictedCurve 本身的 Score 误报
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if f.Name == "PredictedCurve" {
			continue
		}
		lowerName := strings.ToLower(f.Name)
		lowerJSON := strings.ToLower(strings.Split(f.Tag.Get("json"), ",")[0])
		for _, kw := range forbidden {
			if strings.Contains(lowerName, kw) || strings.Contains(lowerJSON, kw) {
				t.Fatalf("forbidden biometric/score field %q (json %q) exposed at %s.%s", f.Name, lowerJSON, path, f.Name)
			}
		}
		assertNoForbiddenFields(t, f.Type, path+"."+f.Name, forbidden, visited)
	}
}
