package apiadapter

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/auth"
	"github.com/shixu-app/server/internal/biometrics"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/realtime"
	"github.com/shixu-app/server/internal/schedule"
	"log/slog"
	"time"
)

type Personal struct {
	pool     *pgxpool.Pool
	bio      *biometrics.Service
	calendar *schedule.Service
	rescue   *schedule.RescueService
	hub      *realtime.Hub
}

func NewPersonal(pool *pgxpool.Pool, bio *biometrics.Service, calendar *schedule.Service, rescue *schedule.RescueService, hub *realtime.Hub) *Personal {
	return &Personal{pool, bio, calendar, rescue, hub}
}
func personalProblem(err error) error {
	var sampleError *biometrics.SampleValidationError
	if errors.As(err, &sampleError) {
		return api.NewProblem(422, api.ErrInvalidBiometricSample, "sample contains invalid units, intervals or physiological values", api.ErrorDetailItem{
			Location: fmt.Sprintf("body.samples[%d].%s", sampleError.Index, sampleError.Field),
			Message:  sampleError.Message,
		})
	}
	switch {
	case errors.Is(err, schedule.ErrNotFound):
		return api.NewProblem(404, api.ErrNotFound, "schedule or snapshot was not found")
	case errors.Is(err, schedule.ErrOverlap):
		return api.NewProblem(409, api.ErrConflictScheduleOverlap, "time overlaps a locked schedule or meeting")
	case errors.Is(err, schedule.ErrManaged):
		return api.NewProblem(409, api.ErrMeetingManagedByProposal, "manage this meeting through its proposal")
	case errors.Is(err, schedule.ErrTime):
		return api.NewProblem(422, api.ErrInvalidTimeRange, "time range or date is invalid")
	case errors.Is(err, schedule.ErrRange):
		return api.NewProblem(422, api.ErrRangeTooLarge, "query range must not exceed 62 days")
	case errors.Is(err, schedule.ErrDeadline):
		return api.NewProblem(422, api.ErrDeadlineInPast, "urgent task requires a future deadline")
	case errors.Is(err, schedule.ErrStale):
		return api.NewProblem(409, api.ErrStaleBaselineVersion, "calendar or selected option changed; refresh the preview")
	case errors.Is(err, schedule.ErrReverted):
		return api.NewProblem(409, api.ErrAlreadyReverted, "snapshot was already reverted")
	case errors.Is(err, schedule.ErrRestoreConflict):
		return api.NewProblem(409, api.ErrSnapshotRestoreConflict, "newer schedule changes prevent an atomic undo")
	case errors.Is(err, schedule.ErrPlan):
		return api.NewProblem(409, api.ErrConflict, "selected rescue option is not feasible")
	case errors.Is(err, biometrics.ErrSample):
		return api.NewProblem(422, api.ErrInvalidBiometricSample, "sample contains invalid units, intervals or physiological values")
	case errors.Is(err, biometrics.ErrHours):
		return api.NewProblem(422, api.ErrInvalidWorkHours, "work hours and focus windows are invalid")
	}
	return problem(err)
}
func (p *Personal) emit(ids []uuid.UUID, payload api.WsPayload) {
	envelope, err := api.NewWsEnvelope(payload)
	if err == nil {
		p.hub.Publish(ids, envelope)
	}
}
func (p *Personal) emitEnergy(id uuid.UUID, out api.EnergyTodayResponse) {
	p.emit([]uuid.UUID{id}, api.WsEnergyUpdatedPayload{UserID: id, LocalDay: out.LocalDay, Score: out.Score, Tier: out.Tier, DataFreshness: out.DataFreshness, ComputedAt: out.ComputedAt})
	if a := out.OverloadAlert; a != nil {
		p.emit([]uuid.UUID{id}, api.WsEnergyOverloadAlertPayload{UserID: id, LocalDay: out.LocalDay, TriggerReason: a.TriggerReason, Severity: a.Severity, CurrentScore: a.CurrentScore, Tier: a.Tier, Message: a.Message, RecommendedStrategy: a.RecommendedStrategy})
	}
}
func (p *Personal) Recompute(ctx context.Context, user uuid.UUID) {
	out, err := p.bio.Compute(ctx, user, "", true)
	if err != nil {
		slog.Error("energy recompute failed", "userId", user, "error", err)
		return
	}
	p.emitEnergy(user, out)
}
func (p *Personal) Mutation(ctx context.Context, user uuid.UUID, from, to time.Time, reason api.ScheduleUpdateReason, ids []uuid.UUID) {
	day, baseline, err := p.calendar.Baseline(ctx, user, from)
	if err == nil {
		p.emit([]uuid.UUID{user}, api.WsScheduleUpdatedPayload{UserID: user, BaselineLocalDay: day, BaselineVersion: baseline, Reason: reason, AffectedFrom: from, AffectedTo: to, ItemIDs: ids})
	}
	days := map[string]bool{day: true}
	var zone string
	if err = p.pool.QueryRow(ctx, "SELECT timezone FROM users WHERE id=$1", user).Scan(&zone); err == nil {
		loc, e := time.LoadLocation(zone)
		if e == nil {
			days[to.In(loc).Format("2006-01-02")] = true
			days[time.Now().In(loc).Format("2006-01-02")] = true
		}
	}
	for d := range days {
		out, e := p.bio.Compute(ctx, user, d, true)
		if e != nil {
			slog.Error("energy recompute after mutation failed", "userId", user, "error", e)
			continue
		}
		p.emitEnergy(user, out)
	}
	rows, e := p.pool.Query(ctx, "SELECT wm.workspace_id,other.user_id FROM workspace_members wm JOIN workspace_members other ON other.workspace_id=wm.workspace_id WHERE wm.user_id=$1", user)
	if e == nil {
		recipients := map[uuid.UUID][]uuid.UUID{}
		for rows.Next() {
			var wid, id uuid.UUID
			if rows.Scan(&wid, &id) == nil {
				recipients[wid] = append(recipients[wid], id)
			}
		}
		rows.Close()
		for wid, users := range recipients {
			p.emit(users, api.WsAvailabilityChangedPayload{WorkspaceID: wid, UserID: user, Reason: "schedule_changed", AffectedFrom: &from, AffectedTo: &to})
		}
	}
}
func (p *Personal) IngestBiometricSamplesBatch(ctx context.Context, in *api.BiometricBatchInput) (*api.BiometricBatchOutput, error) {
	id := auth.UserID(ctx)
	out, e := p.bio.Ingest(ctx, id, in.Body.Samples)
	if e != nil {
		return nil, personalProblem(e)
	}
	p.emitEnergy(id, out.LatestEnergy)
	return &api.BiometricBatchOutput{Body: out}, nil
}
func (p *Personal) SeedBiometricReplay(ctx context.Context, in *api.ReplaySeedInput) (*api.ReplaySeedOutput, error) {
	id := auth.UserID(ctx)
	out, e := p.bio.Replay(ctx, id, in.Body.Scenario, in.Body.Day)
	if e != nil {
		return nil, personalProblem(e)
	}
	p.emitEnergy(id, out.LatestEnergy)
	return &api.ReplaySeedOutput{Body: out}, nil
}
func (p *Personal) GetTodayEnergy(ctx context.Context, in *api.EnergyTodayInput) (*api.EnergyTodayOutput, error) {
	if in.Day != "" {
		if _, e := time.Parse("2006-01-02", in.Day); e != nil {
			return nil, personalProblem(schedule.ErrTime)
		}
	}
	out, e := p.bio.Compute(ctx, auth.UserID(ctx), in.Day, true)
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.EnergyTodayOutput{Body: out}, nil
}
func (p *Personal) GetEnergyProfile(ctx context.Context, _ *struct{}) (*api.EnergyProfileOutput, error) {
	out, e := p.bio.Profile(ctx, auth.UserID(ctx))
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.EnergyProfileOutput{Body: out}, nil
}
func (p *Personal) UpdateEnergyProfile(ctx context.Context, in *api.UpdateEnergyProfileInput) (*api.EnergyProfileOutput, error) {
	id := auth.UserID(ctx)
	out, e := p.bio.UpdateProfile(ctx, id, in.Body)
	if e != nil {
		return nil, personalProblem(e)
	}
	p.Recompute(ctx, id)
	return &api.EnergyProfileOutput{Body: out}, nil
}
func (p *Personal) ListScheduleItems(ctx context.Context, in *api.ListScheduleItemsInput) (*api.ListScheduleItemsOutput, error) {
	id := auth.UserID(ctx)
	items, e := p.calendar.List(ctx, id, in.From, in.To, in.IncludeCancelled)
	if e != nil {
		return nil, personalProblem(e)
	}
	day, version, e := p.calendar.Baseline(ctx, id, in.From)
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.ListScheduleItemsOutput{Body: api.ScheduleItemListResponse{Items: items, BaselineLocalDay: day, BaselineVersion: version}}, nil
}
func (p *Personal) CreateScheduleItem(ctx context.Context, in *api.CreateScheduleItemInput) (*api.ScheduleMutationOutput, error) {
	id := auth.UserID(ctx)
	it, e := p.calendar.Create(ctx, id, in.Body)
	if e != nil {
		return nil, personalProblem(e)
	}
	p.Mutation(ctx, id, it.StartAt, it.EndAt, "item_created", []uuid.UUID{it.ID})
	day, baseline, e := p.calendar.Baseline(ctx, id, it.StartAt)
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.ScheduleMutationOutput{Status: 201, Body: api.ScheduleMutationResponse{Item: it, BaselineLocalDay: day, BaselineVersion: baseline}}, nil
}
func (p *Personal) UpdateScheduleItem(ctx context.Context, in *api.UpdateScheduleItemInput) (*api.ScheduleMutationOutput, error) {
	id := auth.UserID(ctx)
	old, _ := p.calendar.Get(ctx, id, in.ID)
	it, e := p.calendar.Update(ctx, id, in.ID, in.Body)
	if e != nil {
		return nil, personalProblem(e)
	}
	from, to := it.StartAt, it.EndAt
	if !old.StartAt.IsZero() && old.StartAt.Before(from) {
		from = old.StartAt
	}
	if old.EndAt.After(to) {
		to = old.EndAt
	}
	p.Mutation(ctx, id, from, to, "item_updated", []uuid.UUID{it.ID})
	day, baseline, e := p.calendar.Baseline(ctx, id, it.StartAt)
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.ScheduleMutationOutput{Status: 200, Body: api.ScheduleMutationResponse{Item: it, BaselineLocalDay: day, BaselineVersion: baseline}}, nil
}
func (p *Personal) DeleteScheduleItem(ctx context.Context, in *api.ScheduleItemIDInput) (*struct{}, error) {
	id := auth.UserID(ctx)
	it, e := p.calendar.Get(ctx, id, in.ID)
	if e != nil {
		return nil, personalProblem(e)
	}
	if e = p.calendar.Delete(ctx, id, in.ID); e != nil {
		return nil, personalProblem(e)
	}
	p.Mutation(ctx, id, it.StartAt, it.EndAt, "item_cancelled", []uuid.UUID{it.ID})
	return nil, nil
}
func (p *Personal) PreviewRescueOptions(ctx context.Context, in *api.RescueOptionsInput) (*api.RescueOptionsOutput, error) {
	out, e := p.rescue.Options(ctx, auth.UserID(ctx), in.Body)
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.RescueOptionsOutput{Body: out}, nil
}
func (p *Personal) ApplyRescueOption(ctx context.Context, in *api.RescueApplyInput) (*api.RescueApplyOutput, error) {
	id := auth.UserID(ctx)
	out, e := p.rescue.Apply(ctx, id, in.IdempotencyKey, in.Body)
	if e != nil {
		return nil, personalProblem(e)
	}
	p.rescueMutation(ctx, id, out.BaselineLocalDay, "rescue_applied", out.AppliedItems)
	return &api.RescueApplyOutput{Body: out}, nil
}
func (p *Personal) UndoRescueSnapshot(ctx context.Context, in *api.RescueUndoInput) (*api.RescueUndoOutput, error) {
	id := auth.UserID(ctx)
	out, e := p.rescue.Undo(ctx, id, in.Body.SnapshotID)
	if e != nil {
		return nil, personalProblem(e)
	}
	p.rescueMutation(ctx, id, out.BaselineLocalDay, "rescue_reverted", out.RestoredItems)
	return &api.RescueUndoOutput{Body: out}, nil
}
func (p *Personal) rescueMutation(ctx context.Context, id uuid.UUID, day string, reason api.ScheduleUpdateReason, items []api.ScheduleItemDTO) {
	var zone string
	if p.pool.QueryRow(ctx, "SELECT timezone FROM users WHERE id=$1", id).Scan(&zone) != nil {
		return
	}
	from, to, e := engine.RescueWindowUTC(day, zone)
	if e != nil {
		return
	}
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	p.Mutation(ctx, id, from, to, reason, ids)
}
func (p *Personal) ListRescueHistory(ctx context.Context, in *api.RescueHistoryInput) (*api.RescueHistoryOutput, error) {
	out, e := p.rescue.History(ctx, auth.UserID(ctx), in.Limit, in.Cursor)
	if e != nil {
		return nil, personalProblem(e)
	}
	return &api.RescueHistoryOutput{Body: out}, nil
}
