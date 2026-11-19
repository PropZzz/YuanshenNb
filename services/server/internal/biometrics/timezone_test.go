package biometrics

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/testutil"
)

func TestPostgresEnergyLoadsOwnedSamplesAndLocalDSTDay(t *testing.T) {
	pool := testutil.Postgres(t)
	ctx := context.Background()
	user, outsider := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{user, outsider} {
		if _, err := pool.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash,timezone) VALUES($1,$2,'Test','hash','America/New_York')", id, id.String()+"@example.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO energy_profiles(user_id) VALUES($1)", id); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for _, id := range []uuid.UUID{user, outsider} {
		if _, err := pool.Exec(ctx, "INSERT INTO biometric_samples(user_id,source_type,metric_type,recorded_at,numeric_value,unit,external_id) VALUES($1,'health_connect','hrv_rmssd',$2,55,'ms','owned')", id, now.Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO schedule_items(user_id,title,start_at,end_at) VALUES($1,$2,$3,$4)", id, id.String(), time.Date(2026, 11, 2, 4, 0, 0, 0, time.UTC), time.Date(2026, 11, 2, 5, 0, 0, 0, time.UTC)); err != nil {
			t.Fatal(err)
		}
	}
	in, err := LoadInput(ctx, pool, user, "2026-11-01", now)
	if err != nil {
		t.Fatal(err)
	}
	if in.Profile.Timezone != "America/New_York" || len(in.Samples14Days) != 1 || len(in.DaySchedules) != 1 || in.DaySchedules[0].UserID != user {
		t.Fatalf("local-day or tenant filtering failed: samples=%d schedules=%d", len(in.Samples14Days), len(in.DaySchedules))
	}
	out, err := engine.NewEnergyEngine().ComputeSnapshot(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.HourlyCurve) != 25 || out.HourlyCurve[0].HourStartAt != time.Date(2026, 11, 1, 4, 0, 0, 0, time.UTC) || out.HourlyCurve[24].HourStartAt != time.Date(2026, 11, 2, 4, 0, 0, 0, time.UTC) || out.DataFreshness != engine.FreshnessLiveWearable {
		t.Fatalf("25-hour DST day or real-source label was lost: points=%d freshness=%s", len(out.HourlyCurve), out.DataFreshness)
	}
}
