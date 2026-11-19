package biometrics

import (
	"errors"
	"math"
	"testing"
	"time"

	"github.com/shixu-app/server/internal/api"
)

func TestSampleValidationIdentifiesOnlyTheOffendingBatchPoint(t *testing.T) {
	now := time.Now().UTC()
	end := now.Add(time.Hour)
	before := now.Add(-time.Minute)
	valid := api.BiometricSampleDTO{SourceType: "health_connect", MetricType: "heart_rate", RecordedAt: now, NumericValue: 72, Unit: "bpm", ExternalID: "deterministic-id"}
	for _, tc := range []struct {
		name, field string
		change      func(*api.BiometricSampleDTO)
	}{
		{"missing ID", "externalId", func(s *api.BiometricSampleDTO) { s.ExternalID = " " }},
		{"nonfinite value", "numericValue", func(s *api.BiometricSampleDTO) { s.NumericValue = math.NaN() }},
		{"missing time", "recordedAt", func(s *api.BiometricSampleDTO) { s.RecordedAt = time.Time{} }},
		{"unknown source", "sourceType", func(s *api.BiometricSampleDTO) { s.SourceType = "unknown" }},
		{"backwards interval", "endAt", func(s *api.BiometricSampleDTO) { s.EndAt = &before }},
		{"heart rate unit", "unit", func(s *api.BiometricSampleDTO) { s.Unit = "ms" }},
		{"heart rate artifact", "numericValue", func(s *api.BiometricSampleDTO) { s.NumericValue = 230 }},
		{"HRV unit", "unit", func(s *api.BiometricSampleDTO) { s.MetricType = "hrv_rmssd" }},
		{"HRV artifact", "numericValue", func(s *api.BiometricSampleDTO) { s.MetricType = "hrv_rmssd"; s.Unit = "ms"; s.NumericValue = 300 }},
		{"sleep unit", "unit", func(s *api.BiometricSampleDTO) { s.MetricType = "sleep_session" }},
		{"sleep artifact", "numericValue", func(s *api.BiometricSampleDTO) {
			s.MetricType = "sleep_session"
			s.Unit = "minutes"
			s.NumericValue = 1441
		}},
		{"sleep interval missing", "endAt", func(s *api.BiometricSampleDTO) { s.MetricType = "sleep_session"; s.Unit = "minutes" }},
		{"sleep stage missing", "sleepStage", func(s *api.BiometricSampleDTO) { s.MetricType = "sleep_stage"; s.Unit = "minutes"; s.EndAt = &end }},
		{"calorie unit", "unit", func(s *api.BiometricSampleDTO) { s.MetricType = "active_calories" }},
		{"calorie artifact", "numericValue", func(s *api.BiometricSampleDTO) {
			s.MetricType = "active_calories"
			s.Unit = "kcal"
			s.NumericValue = -1
		}},
		{"unknown metric", "metricType", func(s *api.BiometricSampleDTO) { s.MetricType = "unknown" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			invalid := valid
			tc.change(&invalid)
			err := ValidateSamples([]api.BiometricSampleDTO{valid, invalid})
			var field *SampleValidationError
			if !errors.Is(err, ErrSample) || !errors.As(err, &field) || field.Index != 1 || field.Field != tc.field {
				t.Fatalf("incorrect invalid sample location: %v", err)
			}
		})
	}
	if err := ValidateSamples([]api.BiometricSampleDTO{valid}); err != nil {
		t.Fatal(err)
	}
}
