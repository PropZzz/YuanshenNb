package engine_test

import (
	"math"
	"testing"
	"time"

	"github.com/shixu-app/server/internal/engine"
)

// TestEnergyRejectsEveryInvalidSampleKind 覆盖 validSample 的每一条拒绝规则。
// 每条用例只违反一条规则，确保规则之间不会互相掩盖。
// 断言方式：单条非法样本被过滤后，没有任何有效数据，应降级为 baseline_only。
func TestEnergyRejectsEveryInvalidSampleKind(t *testing.T) {
	now := moment("2026-11-19T10:00:00Z")
	zone := profile("UTC")

	// 睡眠类样本需要 EndAt，单独构造
	endBeforeStart := now.Add(-3 * time.Hour)
	sleepBadRange := engine.BiometricSampleInput{
		SourceType:   engine.SourceHealthConnect,
		MetricType:   engine.MetricSleepSession,
		RecordedAt:   now.Add(-time.Hour),
		EndAt:        &endBeforeStart, // 结束早于开始
		NumericValue: 60,
	}
	endTooLong := now.Add(-time.Hour)
	sleepTooLong := engine.BiometricSampleInput{
		SourceType:   engine.SourceHealthConnect,
		MetricType:   engine.MetricSleepSession,
		RecordedAt:   now.Add(-30 * time.Hour), // 跨度 29 小时
		EndAt:        &endTooLong,
		NumericValue: 1740,
	}

	for _, tt := range []struct {
		name string
		s    engine.BiometricSampleInput
	}{
		{
			"source_not_allowed",
			engine.BiometricSampleInput{SourceType: engine.SourceType("manual_entry"), MetricType: engine.MetricHeartRate, RecordedAt: now, NumericValue: 70},
		},
		{
			"recorded_at_zero",
			engine.BiometricSampleInput{SourceType: engine.SourceBLEGATT, MetricType: engine.MetricHeartRate, NumericValue: 70},
		},
		{
			"recorded_in_future",
			sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.Add(time.Hour), 70),
		},
		{
			"older_than_14_days",
			sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.AddDate(0, 0, -15), 70),
		},
		{
			"heart_rate_below_floor",
			sample(engine.SourceBLEGATT, engine.MetricHeartRate, now, 29),
		},
		{
			"heart_rate_above_ceiling",
			sample(engine.SourceBLEGATT, engine.MetricHeartRate, now, 221),
		},
		{
			"hrv_zero",
			sample(engine.SourceBLEGATT, engine.MetricHRVRMSSD, now, 0),
		},
		{
			"hrv_above_ceiling",
			sample(engine.SourceBLEGATT, engine.MetricHRVRMSSD, now, 251),
		},
		{
			"hrv_nan",
			sample(engine.SourceBLEGATT, engine.MetricHRVRMSSD, now, math.NaN()),
		},
		{
			"hrv_infinite",
			sample(engine.SourceBLEGATT, engine.MetricHRVRMSSD, now, math.Inf(1)),
		},
		{
			"calories_above_ceiling",
			sample(engine.SourceHealthConnect, engine.MetricActiveCalories, now, 20001),
		},
		{
			"sleep_without_end_at",
			engine.BiometricSampleInput{SourceType: engine.SourceHealthConnect, MetricType: engine.MetricSleepSession, RecordedAt: now.Add(-8 * time.Hour), NumericValue: 480},
		},
		{
			"sleep_end_before_start",
			sleepBadRange,
		},
		{
			"sleep_longer_than_24h",
			sleepTooLong,
		},
		{
			"metric_type_unknown",
			engine.BiometricSampleInput{SourceType: engine.SourceBLEGATT, MetricType: engine.MetricType("blood_pressure"), RecordedAt: now, NumericValue: 120},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			out := compute(t, engine.EnergyComputeInput{
				Now:           now,
				LocalDay:      "2026-11-19",
				Profile:       zone,
				Samples14Days: []engine.BiometricSampleInput{tt.s},
			})
			if out.DataFreshness != engine.FreshnessBaselineOnly {
				t.Fatalf("非法样本未被过滤：freshness = %s，期望 %s", out.DataFreshness, engine.FreshnessBaselineOnly)
			}
		})
	}
}

// TestEnergyInvalidSamplesDoNotChangeFreshness 验证坏样本混入不会改变结果。
// 这是过滤逻辑真正要保证的性质：脏数据对计算透明。
func TestEnergyInvalidSamplesDoNotChangeFreshness(t *testing.T) {
	now := moment("2026-11-19T10:00:00Z")
	zone := profile("UTC")

	good := sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.Add(-time.Minute), 65)
	bad := []engine.BiometricSampleInput{
		sample(engine.SourceBLEGATT, engine.MetricHeartRate, now.Add(-time.Minute), 999),       // 超范围
		sample(engine.SourceBLEGATT, engine.MetricHRVRMSSD, now.Add(-time.Minute), math.NaN()), // NaN
		{SourceType: engine.SourceType("manual_entry"), MetricType: engine.MetricHeartRate, RecordedAt: now, NumericValue: 70},
	}

	onlyGood := compute(t, engine.EnergyComputeInput{
		Now: now, LocalDay: "2026-11-19", Profile: zone,
		Samples14Days: []engine.BiometricSampleInput{good},
	})

	mixed := compute(t, engine.EnergyComputeInput{
		Now: now, LocalDay: "2026-11-19", Profile: zone,
		Samples14Days: append(append([]engine.BiometricSampleInput{}, bad...), good),
	})

	if onlyGood.DataFreshness != mixed.DataFreshness {
		t.Fatalf("坏样本改变了数据新鲜度：只有好样本=%s，混合=%s", onlyGood.DataFreshness, mixed.DataFreshness)
	}
	if onlyGood.Score != mixed.Score {
		t.Fatalf("坏样本改变了精力分数：只有好样本=%d，混合=%d", onlyGood.Score, mixed.Score)
	}
}
