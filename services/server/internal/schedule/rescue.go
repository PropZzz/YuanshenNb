package schedule

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/db"
	"github.com/shixu-app/server/internal/engine"
)

var (
	ErrStale           = errors.New("stale baseline or option hash")
	ErrReverted        = errors.New("snapshot already reverted")
	ErrRestoreConflict = errors.New("snapshot restore conflicts with newer schedule")
	ErrDeadline        = errors.New("urgent deadline must be in future")
	ErrPlan            = errors.New("rescue option is not feasible")
)

type InputLoader func(context.Context, Querier, uuid.UUID, string, time.Time) (engine.EnergyComputeInput, error)
type RescueService struct {
	pool   *pgxpool.Pool
	energy engine.EnergyEngine
	engine engine.RescueEngine
	load   InputLoader
}

func NewRescueService(pool *pgxpool.Pool, e engine.EnergyEngine, r engine.RescueEngine, load InputLoader) *RescueService {
	return &RescueService{pool, e, r, load}
}
func (s *RescueService) build(ctx context.Context, q Querier, user uuid.UUID, in api.RescueOptionsRequest) (engine.RescueSolverOutput, []api.ScheduleItemDTO, error) {
	now := time.Now().UTC()
	if in.TriggerReason == "urgent_task" && (in.UrgentTask == nil || !in.UrgentTask.DeadlineAt.After(now)) {
		return engine.RescueSolverOutput{}, nil, ErrDeadline
	}
	input, err := s.load(ctx, q, user, in.Day, now)
	if err != nil {
		return engine.RescueSolverOutput{}, nil, err
	}
	from, to, err := engine.RescueWindowUTC(in.Day, input.Profile.Timezone)
	if err != nil {
		return engine.RescueSolverOutput{}, nil, ErrTime
	}
	items, err := List(ctx, q, user, from, to, false)
	if err != nil {
		return engine.RescueSolverOutput{}, nil, err
	}
	energy, err := s.energy.ComputeSnapshot(ctx, input)
	if err != nil {
		return engine.RescueSolverOutput{}, nil, err
	}
	out, err := s.engine.BuildOptions(ctx, engine.RescueSolverInput{Now: now, LocalDay: in.Day, BaselineVersion: engine.ComputeBaselineVersion(in.Day, ToEngine(items)), TriggerReason: engine.RescueTriggerReason(in.TriggerReason), UrgentTask: api.ToEngineUrgentTask(in.UrgentTask), Profile: input.Profile, PredictedCurve: energy.HourlyCurve, WindowSchedules: ToEngine(items)})
	return out, items, err
}
func (s *RescueService) Options(ctx context.Context, user uuid.UUID, in api.RescueOptionsRequest) (api.RescueOptionsResponse, error) {
	out, _, err := s.build(ctx, s.pool, user, in)
	return api.RescueOptionsResponse{Day: out.LocalDay, BaselineVersion: out.BaselineVersion, Options: api.FromEngineRescueOptions(out.Options)}, err
}
func (s *RescueService) Apply(ctx context.Context, user uuid.UUID, key string, in api.RescueApplyRequest) (api.RescueApplyResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.RescueApplyResponse{}, err
	}
	defer tx.Rollback(ctx)
	if err = lock(ctx, tx, user); err != nil {
		return api.RescueApplyResponse{}, err
	}
	if key != "" {
		var id uuid.UUID
		var strategy api.RescueStrategy
		var day string
		var after []byte
		err = tx.QueryRow(ctx, "SELECT id,strategy,local_day::text,after_items FROM rescue_snapshots WHERE user_id=$1 AND idempotency_key=$2", user, key).Scan(&id, &strategy, &day, &after)
		if err == nil {
			items := []api.ScheduleItemDTO{}
			if err = json.Unmarshal(after, &items); err != nil {
				return api.RescueApplyResponse{}, err
			}
			return api.RescueApplyResponse{SnapshotID: id, Strategy: strategy, BaselineLocalDay: day, BaselineVersion: engine.ComputeBaselineVersion(day, ToEngine(items)), AppliedItems: items}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return api.RescueApplyResponse{}, err
		}
	}
	out, before, err := s.build(ctx, tx, user, api.RescueOptionsRequest{Day: in.Day, TriggerReason: in.TriggerReason, UrgentTask: in.UrgentTask})
	if err != nil {
		return api.RescueApplyResponse{}, err
	}
	if out.BaselineVersion != in.BaselineVersion {
		return api.RescueApplyResponse{}, ErrStale
	}
	var chosen *engine.RescueOptionPlan
	for i := range out.Options {
		if string(out.Options[i].Strategy) == string(in.Strategy) {
			chosen = &out.Options[i]
			break
		}
	}
	if chosen == nil || !chosen.Feasible {
		return api.RescueApplyResponse{}, ErrPlan
	}
	if in.ExpectedOptionHash != "" && in.ExpectedOptionHash != chosen.OptionHash {
		return api.RescueApplyResponse{}, ErrStale
	}
	ids := make([]uuid.UUID, 0, len(before))
	for _, it := range before {
		ids = append(ids, it.ID)
	}
	for _, diff := range chosen.DiffItems {
		switch diff.Op {
		case engine.DiffOpUnchanged:
			continue
		case engine.DiffOpCreate:
			var id uuid.UUID
			notes := ""
			var deadline *time.Time
			if diff.Category == engine.CategoryUrgent && in.UrgentTask != nil {
				notes = in.UrgentTask.Notes
				deadline = &in.UrgentTask.DeadlineAt
			}
			err = tx.QueryRow(ctx, "INSERT INTO schedule_items(user_id,title,notes,category,cognitive_load,flexibility,start_at,end_at,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", user, diff.Title, notes, diff.Category, diff.CognitiveLoad, diff.Flexibility, diff.AfterStartAt, diff.AfterEndAt, deadline).Scan(&id)
			if err != nil {
				return api.RescueApplyResponse{}, err
			}
			ids = append(ids, id)
		case engine.DiffOpMove, engine.DiffOpDefer:
			if diff.ItemID == nil {
				return api.RescueApplyResponse{}, ErrPlan
			}
			tag, e := tx.Exec(ctx, "UPDATE schedule_items SET start_at=$3,end_at=$4 WHERE id=$1 AND user_id=$2 AND flexibility<>'hard_locked' AND category<>'meeting' AND meeting_proposal_id IS NULL", *diff.ItemID, user, diff.AfterStartAt, diff.AfterEndAt)
			if e != nil {
				return api.RescueApplyResponse{}, e
			}
			if tag.RowsAffected() != 1 {
				return api.RescueApplyResponse{}, ErrManaged
			}
		default:
			return api.RescueApplyResponse{}, ErrPlan
		}
	}
	after, err := listIDs(ctx, tx, user, ids)
	if err != nil {
		return api.RescueApplyResponse{}, err
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	var snapshot uuid.UUID
	var keyValue *string
	if key != "" {
		keyValue = &key
	}
	err = tx.QueryRow(ctx, "INSERT INTO rescue_snapshots(user_id,local_day,baseline_version,option_hash,idempotency_key,strategy,trigger_reason,before_items,after_items) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", user, in.Day, out.BaselineVersion, chosen.OptionHash, keyValue, in.Strategy, in.TriggerReason, beforeJSON, afterJSON).Scan(&snapshot)
	if err != nil {
		return api.RescueApplyResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.RescueApplyResponse{}, err
	}
	return api.RescueApplyResponse{SnapshotID: snapshot, Strategy: in.Strategy, BaselineLocalDay: in.Day, BaselineVersion: engine.ComputeBaselineVersion(in.Day, ToEngine(after)), AppliedItems: after}, nil
}
func listIDs(ctx context.Context, q Querier, user uuid.UUID, ids []uuid.UUID) ([]api.ScheduleItemDTO, error) {
	rows, err := q.Query(ctx, "SELECT "+columns+" FROM schedule_items WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY start_at,id", user, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []api.ScheduleItemDTO{}
	for rows.Next() {
		it, e := scan(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, it)
	}
	return items, rows.Err()
}
func (s *RescueService) Undo(ctx context.Context, user, id uuid.UUID) (api.RescueUndoResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.RescueUndoResponse{}, err
	}
	defer tx.Rollback(ctx)
	if err = lock(ctx, tx, user); err != nil {
		return api.RescueUndoResponse{}, err
	}
	var day, status string
	var beforeJSON, afterJSON []byte
	err = tx.QueryRow(ctx, "SELECT local_day::text,status,before_items,after_items FROM rescue_snapshots WHERE id=$1 AND user_id=$2 FOR UPDATE", id, user).Scan(&day, &status, &beforeJSON, &afterJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return api.RescueUndoResponse{}, ErrNotFound
	}
	if err != nil {
		return api.RescueUndoResponse{}, err
	}
	if status == "reverted" {
		return api.RescueUndoResponse{}, ErrReverted
	}
	before, after := []api.ScheduleItemDTO{}, []api.ScheduleItemDTO{}
	if err = json.Unmarshal(beforeJSON, &before); err != nil {
		return api.RescueUndoResponse{}, err
	}
	if err = json.Unmarshal(afterJSON, &after); err != nil {
		return api.RescueUndoResponse{}, err
	}
	ids := make([]uuid.UUID, 0, len(after))
	beforeByID := map[uuid.UUID]api.ScheduleItemDTO{}
	for _, it := range before {
		beforeByID[it.ID] = it
	}
	changed := map[uuid.UUID]bool{}
	for _, it := range after {
		old, exists := beforeByID[it.ID]
		if !exists || !reflect.DeepEqual(old, it) {
			changed[it.ID] = true
			ids = append(ids, it.ID)
		}
	}
	current, err := listIDs(ctx, tx, user, ids)
	if err != nil {
		return api.RescueUndoResponse{}, err
	}
	if len(current) != len(ids) {
		return api.RescueUndoResponse{}, ErrRestoreConflict
	}
	versions := map[uuid.UUID]time.Time{}
	for _, it := range after {
		versions[it.ID] = it.UpdatedAt
	}
	for _, it := range current {
		if !it.UpdatedAt.Equal(versions[it.ID]) {
			return api.RescueUndoResponse{}, ErrRestoreConflict
		}
	}
	for _, it := range before {
		if !changed[it.ID] {
			continue
		}
		var conflict bool
		err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schedule_items WHERE user_id=$1 AND NOT(id=ANY($2::uuid[])) AND status<>'cancelled' AND (flexibility='hard_locked' OR category='meeting') AND time_range && tstzrange($3,$4,'[)'))", user, ids, it.StartAt, it.EndAt).Scan(&conflict)
		if err != nil {
			return api.RescueUndoResponse{}, err
		}
		if conflict {
			return api.RescueUndoResponse{}, ErrRestoreConflict
		}
	}
	beforeIDs := map[uuid.UUID]bool{}
	for _, it := range before {
		beforeIDs[it.ID] = true
		if !changed[it.ID] {
			continue
		}
		if _, err = tx.Exec(ctx, "UPDATE schedule_items SET title=$3,notes=$4,category=$5,cognitive_load=$6,flexibility=$7,status=$8,start_at=$9,end_at=$10,deadline_at=$11,reminder_minutes=$12 WHERE id=$1 AND user_id=$2", it.ID, user, it.Title, it.Notes, it.Category, it.CognitiveLoad, it.Flexibility, it.Status, it.StartAt, it.EndAt, it.DeadlineAt, it.ReminderMinutes); err != nil {
			return api.RescueUndoResponse{}, err
		}
	}
	for _, it := range after {
		if !beforeIDs[it.ID] {
			if _, err = tx.Exec(ctx, "UPDATE schedule_items SET status='cancelled' WHERE id=$1 AND user_id=$2", it.ID, user); err != nil {
				return api.RescueUndoResponse{}, err
			}
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE rescue_snapshots SET status='reverted',reverted_at=NOW() WHERE id=$1 AND user_id=$2", id, user); err != nil {
		return api.RescueUndoResponse{}, err
	}
	ids = ids[:0]
	for _, it := range before {
		ids = append(ids, it.ID)
	}
	restored, err := listIDs(ctx, tx, user, ids)
	if err != nil {
		return api.RescueUndoResponse{}, err
	}
	var zone string
	if err = tx.QueryRow(ctx, "SELECT timezone FROM users WHERE id=$1", user).Scan(&zone); err != nil {
		return api.RescueUndoResponse{}, err
	}
	from, to, err := engine.RescueWindowUTC(day, zone)
	if err != nil {
		return api.RescueUndoResponse{}, err
	}
	windowItems, err := List(ctx, tx, user, from, to, false)
	if err != nil {
		return api.RescueUndoResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.RescueUndoResponse{}, err
	}
	return api.RescueUndoResponse{SnapshotID: id, Status: "reverted", BaselineLocalDay: day, BaselineVersion: engine.ComputeBaselineVersion(day, ToEngine(windowItems)), RestoredItems: restored}, nil
}
func (s *RescueService) History(ctx context.Context, user uuid.UUID, limit int, cursor string) (api.RescueHistoryResponse, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	before, beforeID, err := db.DecodeCursor(cursor)
	if err != nil {
		return api.RescueHistoryResponse{}, ErrTime
	}
	rows, err := s.pool.Query(ctx, "SELECT id,user_id,local_day::text,strategy,trigger_reason,baseline_version,option_hash,status,before_items,after_items,applied_at,reverted_at FROM rescue_snapshots WHERE user_id=$1 AND ($2::timestamptz IS NULL OR (applied_at,id)<($2,$3::uuid)) ORDER BY applied_at DESC,id DESC LIMIT $4", user, before, beforeID, limit+1)
	if err != nil {
		return api.RescueHistoryResponse{}, err
	}
	defer rows.Close()
	out := api.RescueHistoryResponse{Snapshots: []api.RescueSnapshotRecord{}}
	for rows.Next() {
		var r api.RescueSnapshotRecord
		var b, a []byte
		if err = rows.Scan(&r.ID, &r.UserID, &r.LocalDay, &r.Strategy, &r.TriggerReason, &r.BaselineVersion, &r.OptionHash, &r.Status, &b, &a, &r.AppliedAt, &r.RevertedAt); err != nil {
			return out, err
		}
		if err = json.Unmarshal(b, &r.BeforeItems); err != nil {
			return out, err
		}
		if err = json.Unmarshal(a, &r.AfterItems); err != nil {
			return out, err
		}
		out.Snapshots = append(out.Snapshots, r)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Snapshots) > limit {
		out.Snapshots = out.Snapshots[:limit]
		v := db.EncodeCursor(out.Snapshots[limit-1].AppliedAt, out.Snapshots[limit-1].ID)
		out.NextCursor = &v
	}
	return out, nil
}
