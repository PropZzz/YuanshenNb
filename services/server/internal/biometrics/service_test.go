package biometrics

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/testutil"
	"testing"
	"time"
)

func TestPostgresBiometricsDeduplicateAndKeepSourcesHonest(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash,timezone) VALUES($1,$2,'Test','hash','UTC')", id, id.String()+"@example.com")
	p.Exec(ctx, "INSERT INTO energy_profiles(user_id) VALUES($1)", id)
	s := NewService(p, engine.NewEnergyEngine())
	baseline, err := s.Compute(ctx, id, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if baseline.DataFreshness != "baseline_only" {
		t.Fatal("missing wearable data mislabeled")
	}
	sample := api.BiometricSampleDTO{SourceType: "replay_demo", MetricType: "hrv_rmssd", NumericValue: 55, Unit: "ms", RecordedAt: time.Now().UTC().Add(-time.Minute), ExternalID: "explicit-replay-1"}
	first, err := s.Ingest(ctx, id, []api.BiometricSampleDTO{sample})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Ingest(ctx, id, []api.BiometricSampleDTO{sample})
	if err != nil {
		t.Fatal(err)
	}
	if first.AcceptedCount != 1 || second.AcceptedCount != 0 || second.DeduplicatedCount != 1 || second.LatestEnergy.DataFreshness != "replay_demo" {
		t.Fatalf("incorrect idempotency/source labels: %+v %+v", first, second)
	}
	invalid := sample
	invalid.ExternalID = "invalid"
	invalid.NumericValue = 400
	if _, err = s.Ingest(ctx, id, []api.BiometricSampleDTO{invalid}); !errors.Is(err, ErrSample) {
		t.Fatalf("artifact accepted: %v", err)
	}
	var count int
	p.QueryRow(ctx, "SELECT count(*) FROM biometric_samples WHERE user_id=$1", id).Scan(&count)
	if count != 1 {
		t.Fatal("invalid batch partially persisted")
	}
	profile, _ := s.Profile(ctx, id)
	profile.WorkEndMinute = profile.WorkStartMinute
	if _, err = s.UpdateProfile(ctx, id, api.UpdateEnergyProfileRequest{WorkStartMinute: profile.WorkStartMinute, WorkEndMinute: profile.WorkEndMinute, Chronotype: profile.Chronotype, PreferredFocusWindows: profile.PreferredFocusWindows, MinRecoveryBufferMin: 15}); !errors.Is(err, ErrHours) {
		t.Fatal("invalid work hours accepted")
	}
}

func TestPostgresHistoricalEnergyDoesNotEraseCurrentPhysiologicalBaseline(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash,timezone) VALUES($1,$2,'Test','hash','UTC')", id, id.String()+"@example.com")
	p.Exec(ctx, "INSERT INTO energy_profiles(user_id,hrv_baseline_ms,rhr_baseline_bpm) VALUES($1,61,57)", id)
	s := NewService(p, engine.NewEnergyEngine())
	if _, err := s.Compute(ctx, id, time.Now().UTC().AddDate(0, 0, -40).Format("2006-01-02"), true); err != nil {
		t.Fatal(err)
	}
	profile, err := s.Profile(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if profile.HRVBaselineMs == nil || *profile.HRVBaselineMs != 61 || profile.RHRBaselineBpm == nil || *profile.RHRBaselineBpm != 57 {
		t.Fatal("historical day lookup overwrote the user's current baseline cache")
	}
}
