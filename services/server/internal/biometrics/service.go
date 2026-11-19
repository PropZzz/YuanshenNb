// Package biometrics persists source-labelled samples and server-side energy.
package biometrics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/schedule"
)

var (
	ErrSample = errors.New("invalid biometric sample")
	ErrHours  = errors.New("invalid work hours")
)

// SampleValidationError identifies a rejected sample without partially ingesting its batch.
type SampleValidationError struct {
	Index   int
	Field   string
	Message string
}

func (e *SampleValidationError) Error() string {
	return fmt.Sprintf("sample %d %s: %s", e.Index, e.Field, e.Message)
}
func (e *SampleValidationError) Unwrap() error { return ErrSample }

type Service struct {
	pool   *pgxpool.Pool
	engine engine.EnergyEngine
}

func NewService(pool *pgxpool.Pool, e engine.EnergyEngine) *Service { return &Service{pool, e} }

type QueryExecutor interface {
	schedule.Querier
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func Profile(ctx context.Context, q schedule.Querier, id uuid.UUID) (api.EnergyProfileDTO, string, error) {
	var out api.EnergyProfileDTO
	var windows []byte
	var zone string
	err := q.QueryRow(ctx, "SELECT ep.user_id,ep.work_start_minute,ep.work_end_minute,ep.chronotype,ep.preferred_focus_windows,ep.min_recovery_buffer_min,ep.hrv_baseline_ms,ep.rhr_baseline_bpm,ep.updated_at,u.timezone FROM energy_profiles ep JOIN users u ON u.id=ep.user_id WHERE ep.user_id=$1", id).Scan(&out.UserID, &out.WorkStartMinute, &out.WorkEndMinute, &out.Chronotype, &windows, &out.MinRecoveryBufferMin, &out.HRVBaselineMs, &out.RHRBaselineBpm, &out.UpdatedAt, &zone)
	if err != nil {
		return out, "", err
	}
	if err = json.Unmarshal(windows, &out.PreferredFocusWindows); err != nil {
		return out, "", err
	}
	if out.PreferredFocusWindows == nil {
		out.PreferredFocusWindows = []api.DailyMinuteWindow{}
	}
	return out, zone, nil
}
func (s *Service) Profile(ctx context.Context, id uuid.UUID) (api.EnergyProfileDTO, error) {
	p, _, err := Profile(ctx, s.pool, id)
	return p, err
}
func EngineProfile(p api.EnergyProfileDTO, zone string) engine.EnergyProfileInput {
	windows := make([]engine.DailyMinuteWindow, len(p.PreferredFocusWindows))
	for i, w := range p.PreferredFocusWindows {
		windows[i] = engine.DailyMinuteWindow{StartMinute: w.StartMinute, EndMinute: w.EndMinute}
	}
	return engine.EnergyProfileInput{WorkScheduleProfile: engine.WorkScheduleProfile{UserID: p.UserID, Timezone: zone, WorkStartMinute: p.WorkStartMinute, WorkEndMinute: p.WorkEndMinute, Chronotype: engine.Chronotype(p.Chronotype), PreferredFocusWindows: windows, MinRecoveryBufferMin: p.MinRecoveryBufferMin}, HRVBaselineMs: p.HRVBaselineMs, RHRBaselineBpm: p.RHRBaselineBpm}
}
func LoadInput(ctx context.Context, q schedule.Querier, id uuid.UUID, day string, now time.Time) (engine.EnergyComputeInput, error) {
	p, zone, err := Profile(ctx, q, id)
	if err != nil {
		return engine.EnergyComputeInput{}, err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return engine.EnergyComputeInput{}, err
	}
	if day == "" {
		day = now.In(loc).Format("2006-01-02")
	}
	start, end, err := engine.LocalDayWindowUTC(day, zone)
	if err != nil {
		return engine.EnergyComputeInput{}, err
	}
	until := now
	if end.Before(until) {
		until = end
	}
	since := start.AddDate(0, 0, -14)
	rows, err := q.Query(ctx, "SELECT source_type,metric_type,recorded_at,end_at,numeric_value,unit,metadata,external_id FROM biometric_samples WHERE user_id=$1 AND recorded_at>=$2 AND recorded_at<=$3 ORDER BY recorded_at,external_id", id, since, until)
	if err != nil {
		return engine.EnergyComputeInput{}, err
	}
	samples := []engine.BiometricSampleInput{}
	for rows.Next() {
		var v engine.BiometricSampleInput
		var meta []byte
		if err = rows.Scan(&v.SourceType, &v.MetricType, &v.RecordedAt, &v.EndAt, &v.NumericValue, &v.Unit, &meta, &v.ExternalID); err != nil {
			rows.Close()
			return engine.EnergyComputeInput{}, err
		}
		if err = json.Unmarshal(meta, &v.Metadata); err != nil {
			rows.Close()
			return engine.EnergyComputeInput{}, err
		}
		if stage, ok := v.Metadata["sleepStage"].(string); ok {
			s := engine.SleepStage(stage)
			v.SleepStage = &s
		}
		samples = append(samples, v)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return engine.EnergyComputeInput{}, err
	}
	items, err := schedule.List(ctx, q, id, start, end, false)
	if err != nil {
		return engine.EnergyComputeInput{}, err
	}
	return engine.EnergyComputeInput{Now: now, LocalDay: day, Profile: EngineProfile(p, zone), Samples14Days: samples, DaySchedules: schedule.ToEngine(items)}, nil
}
func (s *Service) ComputeWith(ctx context.Context, q QueryExecutor, id uuid.UUID, day string, persist bool) (api.EnergyTodayResponse, error) {
	in, err := LoadInput(ctx, q, id, day, time.Now().UTC())
	if err != nil {
		return api.EnergyTodayResponse{}, err
	}
	out, err := s.engine.ComputeSnapshot(ctx, in)
	if err != nil {
		return api.EnergyTodayResponse{}, err
	}
	dto := api.FromEngineEnergyOutput(out)
	if persist {
		curve, _ := json.Marshal(dto.HourlyCurve)
		drivers, _ := json.Marshal(dto.Drivers)
		shields, _ := json.Marshal(dto.FocusShields)
		diagnostics, _ := json.Marshal(dto.Diagnostics)
		var alert []byte
		if dto.OverloadAlert != nil {
			alert, _ = json.Marshal(dto.OverloadAlert)
		}
		if _, err = q.Exec(ctx, "INSERT INTO energy_snapshots(user_id,local_day,computed_at,score,tier,data_freshness,hourly_curve,drivers,focus_shields,overload_alert,diagnostics) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", id, dto.LocalDay, dto.ComputedAt, dto.Score, dto.Tier, dto.DataFreshness, curve, drivers, shields, alert, diagnostics); err != nil {
			return dto, err
		}
		loc, err := time.LoadLocation(in.Profile.Timezone)
		if err != nil {
			return dto, err
		}
		if in.LocalDay == in.Now.In(loc).Format("2006-01-02") {
			if _, err = q.Exec(ctx, "UPDATE energy_profiles SET hrv_baseline_ms=$2,rhr_baseline_bpm=$3 WHERE user_id=$1", id, out.UpdatedHRVBaseline, out.UpdatedRHRBaseline); err != nil {
				return dto, err
			}
		}
	}
	return dto, nil
}
func (s *Service) Compute(ctx context.Context, id uuid.UUID, day string, persist bool) (api.EnergyTodayResponse, error) {
	return s.ComputeWith(ctx, s.pool, id, day, persist)
}
func ValidateSamples(samples []api.BiometricSampleDTO) error {
	if len(samples) < 1 || len(samples) > 500 {
		return ErrSample
	}
	for i, s := range samples {
		invalid := func(field, message string) error {
			return &SampleValidationError{Index: i, Field: field, Message: message}
		}
		if strings.TrimSpace(s.ExternalID) == "" {
			return invalid("externalId", "deterministic sample ID must not be empty")
		}
		if math.IsNaN(s.NumericValue) || math.IsInf(s.NumericValue, 0) {
			return invalid("numericValue", "must be a finite number")
		}
		if s.RecordedAt.IsZero() {
			return invalid("recordedAt", "sample timestamp is required")
		}
		if s.SourceType != "health_connect" && s.SourceType != "ble_gatt" && s.SourceType != "replay_demo" {
			return invalid("sourceType", "unsupported sample source")
		}
		if s.EndAt != nil && s.EndAt.Before(s.RecordedAt) {
			return invalid("endAt", "must not precede recordedAt")
		}
		switch s.MetricType {
		case "heart_rate", "resting_hr":
			if s.Unit != "bpm" {
				return invalid("unit", "heart rate requires bpm")
			}
			if s.NumericValue < 30 || s.NumericValue > 220 {
				return invalid("numericValue", "heart rate must be between 30 and 220 bpm")
			}
		case "hrv_rmssd":
			if s.Unit != "ms" {
				return invalid("unit", "HRV requires ms")
			}
			if s.NumericValue <= 0 || s.NumericValue > 250 {
				return invalid("numericValue", "HRV must be greater than 0 and no more than 250 ms")
			}
		case "sleep_session", "sleep_stage":
			if s.Unit != "minutes" {
				return invalid("unit", "sleep duration requires minutes")
			}
			if s.NumericValue <= 0 || s.NumericValue > 1440 {
				return invalid("numericValue", "sleep duration must be greater than 0 and no more than 1440 minutes")
			}
			if s.EndAt == nil || !s.EndAt.After(s.RecordedAt) {
				return invalid("endAt", "sleep intervals require an end after recordedAt")
			}
			if s.MetricType == "sleep_stage" && (s.SleepStage == nil || (*s.SleepStage != "deep" && *s.SleepStage != "rem" && *s.SleepStage != "light" && *s.SleepStage != "awake")) {
				return invalid("sleepStage", "sleep stage must be deep, rem, light or awake")
			}
		case "active_calories":
			if s.Unit != "kcal" {
				return invalid("unit", "active calories require kcal")
			}
			if s.NumericValue < 0 || s.NumericValue > 20000 {
				return invalid("numericValue", "active calories must be between 0 and 20000 kcal")
			}
		default:
			return invalid("metricType", "unsupported metric")
		}
	}
	return nil
}
func (s *Service) Ingest(ctx context.Context, id uuid.UUID, samples []api.BiometricSampleDTO) (api.BiometricBatchResponse, error) {
	if err := ValidateSamples(samples); err != nil {
		return api.BiometricBatchResponse{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.BiometricBatchResponse{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", id); err != nil {
		return api.BiometricBatchResponse{}, err
	}
	accepted := 0
	for i, v := range samples {
		meta := map[string]any{}
		for k, value := range v.Metadata {
			meta[k] = value
		}
		if v.SleepStage != nil {
			meta["sleepStage"] = *v.SleepStage
		}
		raw, e := json.Marshal(meta)
		if e != nil {
			return api.BiometricBatchResponse{}, &SampleValidationError{Index: i, Field: "metadata", Message: "sample metadata must be JSON encodable"}
		}
		tag, e := tx.Exec(ctx, "INSERT INTO biometric_samples(user_id,source_type,metric_type,recorded_at,end_at,numeric_value,unit,metadata,external_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,source_type,metric_type,external_id) DO NOTHING", id, v.SourceType, v.MetricType, v.RecordedAt, v.EndAt, v.NumericValue, v.Unit, raw, v.ExternalID)
		if e != nil {
			return api.BiometricBatchResponse{}, e
		}
		accepted += int(tag.RowsAffected())
	}
	energy, err := s.ComputeWith(ctx, tx, id, "", true)
	if err != nil {
		return api.BiometricBatchResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.BiometricBatchResponse{}, err
	}
	return api.BiometricBatchResponse{AcceptedCount: accepted, DeduplicatedCount: len(samples) - accepted, LatestEnergy: energy}, nil
}
func (s *Service) UpdateProfile(ctx context.Context, id uuid.UUID, in api.UpdateEnergyProfileRequest) (api.EnergyProfileDTO, error) {
	if in.WorkStartMinute < 0 || in.WorkStartMinute > 1439 || in.WorkEndMinute <= in.WorkStartMinute || in.WorkEndMinute > 1440 || in.MinRecoveryBufferMin < 5 || in.MinRecoveryBufferMin > 60 {
		return api.EnergyProfileDTO{}, ErrHours
	}
	for _, w := range in.PreferredFocusWindows {
		if w.StartMinute < in.WorkStartMinute || w.EndMinute > in.WorkEndMinute || w.EndMinute <= w.StartMinute {
			return api.EnergyProfileDTO{}, ErrHours
		}
	}
	if in.Chronotype != "balanced" && in.Chronotype != "morning_lark" && in.Chronotype != "night_owl" {
		return api.EnergyProfileDTO{}, ErrHours
	}
	if in.PreferredFocusWindows == nil {
		in.PreferredFocusWindows = []api.DailyMinuteWindow{}
	}
	windows, _ := json.Marshal(in.PreferredFocusWindows)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.EnergyProfileDTO{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", id); err != nil {
		return api.EnergyProfileDTO{}, err
	}
	if _, err = tx.Exec(ctx, "UPDATE energy_profiles SET work_start_minute=$2,work_end_minute=$3,chronotype=$4,preferred_focus_windows=$5,min_recovery_buffer_min=$6 WHERE user_id=$1", id, in.WorkStartMinute, in.WorkEndMinute, in.Chronotype, windows, in.MinRecoveryBufferMin); err != nil {
		return api.EnergyProfileDTO{}, err
	}
	if _, err = s.ComputeWith(ctx, tx, id, "", true); err != nil {
		return api.EnergyProfileDTO{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.EnergyProfileDTO{}, err
	}
	return s.Profile(ctx, id)
}
func (s *Service) Replay(ctx context.Context, id uuid.UUID, scenario api.ReplayScenario, day string) (api.ReplaySeedResponse, error) {
	_, zone, err := Profile(ctx, s.pool, id)
	if err != nil {
		return api.ReplaySeedResponse{}, err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return api.ReplaySeedResponse{}, err
	}
	if day == "" {
		day = time.Now().In(loc).Format("2006-01-02")
	}
	base, err := time.ParseInLocation("2006-01-02", day, loc)
	if err != nil {
		return api.ReplaySeedResponse{}, ErrSample
	}
	if scenario != "well_rested" && scenario != "sleep_deprived" && scenario != "high_stress" {
		return api.ReplaySeedResponse{}, ErrSample
	}
	samples := []api.BiometricSampleDTO{}
	for d := 13; d >= 0; d-- {
		morning := base.AddDate(0, 0, -d).Add(7 * time.Hour)
		hrv, rhr, sleep := 60.0, 56.0, 465.0
		if d < 2 && scenario == "sleep_deprived" {
			hrv, rhr, sleep = 32, 67, 230
		}
		if d < 2 && scenario == "high_stress" {
			hrv, rhr, sleep = 18, 76, 340
		}
		for _, v := range []struct {
			metric api.MetricType
			value  float64
			unit   string
		}{{"hrv_rmssd", hrv, "ms"}, {"resting_hr", rhr, "bpm"}, {"sleep_session", sleep, "minutes"}} {
			recorded := morning
			var end *time.Time
			if v.metric == "sleep_session" {
				recorded = morning.Add(-time.Duration(sleep) * time.Minute)
				e := morning
				end = &e
			}
			samples = append(samples, api.BiometricSampleDTO{SourceType: "replay_demo", MetricType: v.metric, NumericValue: v.value, Unit: v.unit, RecordedAt: recorded.UTC(), EndAt: end, ExternalID: fmt.Sprintf("replay:%s:%s:%s:0", scenario, morning.Format("2006-01-02"), v.metric)})
		}
	}
	out, err := s.Ingest(ctx, id, samples)
	if err != nil {
		return api.ReplaySeedResponse{}, err
	}
	energy, err := s.Compute(ctx, id, day, true)
	return api.ReplaySeedResponse{Scenario: scenario, Day: day, SeededCount: out.AcceptedCount, LatestEnergy: energy}, err
}
