// Package schedule owns personal calendar persistence and transactional rescue.
package schedule

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/engine"
)

var (
	ErrNotFound = errors.New("schedule not found")
	ErrOverlap  = errors.New("schedule overlap")
	ErrManaged  = errors.New("meeting managed by proposal")
	ErrTime     = errors.New("invalid time range")
	ErrRange    = errors.New("range exceeds 62 days")
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool} }

const columns = "id,user_id,workspace_id,meeting_proposal_id,title,notes,category,cognitive_load,flexibility,status,start_at,end_at,duration_minutes,deadline_at,reminder_minutes,created_at,updated_at"

func scan(row pgx.Row) (api.ScheduleItemDTO, error) {
	var it api.ScheduleItemDTO
	err := row.Scan(&it.ID, &it.UserID, &it.WorkspaceID, &it.MeetingProposalID, &it.Title, &it.Notes, &it.Category, &it.CognitiveLoad, &it.Flexibility, &it.Status, &it.StartAt, &it.EndAt, &it.DurationMinutes, &it.DeadlineAt, &it.ReminderMinutes, &it.CreatedAt, &it.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return it, ErrNotFound
	}
	return it, err
}

type Querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func List(ctx context.Context, q Querier, user uuid.UUID, from, to time.Time, cancelled bool) ([]api.ScheduleItemDTO, error) {
	if !to.After(from) {
		return nil, ErrTime
	}
	if to.Sub(from) > 62*24*time.Hour {
		return nil, ErrRange
	}
	rows, err := q.Query(ctx, "SELECT "+columns+" FROM schedule_items WHERE user_id=$1 AND ($4::boolean OR status<>'cancelled') AND time_range && tstzrange($2,$3,'[)') ORDER BY start_at,id", user, from, to, cancelled)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []api.ScheduleItemDTO{}
	for rows.Next() {
		it, e := scan(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
func (s *Service) List(ctx context.Context, id uuid.UUID, from, to time.Time, cancelled bool) ([]api.ScheduleItemDTO, error) {
	return List(ctx, s.pool, id, from, to, cancelled)
}
func (s *Service) Get(ctx context.Context, user, id uuid.UUID) (api.ScheduleItemDTO, error) {
	return scan(s.pool.QueryRow(ctx, "SELECT "+columns+" FROM schedule_items WHERE id=$1 AND user_id=$2", id, user))
}
func lock(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	var got uuid.UUID
	err := tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", id).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func checkConflict(ctx context.Context, q Querier, user, id uuid.UUID, start, end time.Time) error {
	var exists bool
	err := q.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schedule_items WHERE user_id=$1 AND id<>$2 AND status<>'cancelled' AND (flexibility='hard_locked' OR category='meeting') AND time_range && tstzrange($3,$4,'[)'))", user, id, start, end).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return ErrOverlap
	}
	return nil
}
func (s *Service) Create(ctx context.Context, user uuid.UUID, in api.CreateScheduleItemRequest) (api.ScheduleItemDTO, error) {
	if !in.EndAt.After(in.StartAt) || strings.TrimSpace(in.Title) == "" {
		return api.ScheduleItemDTO{}, ErrTime
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.ScheduleItemDTO{}, err
	}
	defer tx.Rollback(ctx)
	if err = lock(ctx, tx, user); err != nil {
		return api.ScheduleItemDTO{}, err
	}
	if !in.AllowOverlap {
		if err = checkConflict(ctx, tx, user, uuid.Nil, in.StartAt, in.EndAt); err != nil {
			return api.ScheduleItemDTO{}, err
		}
	}
	reminder := 10
	if in.ReminderMinutes != nil {
		reminder = *in.ReminderMinutes
	}
	it, err := scan(tx.QueryRow(ctx, "INSERT INTO schedule_items(user_id,title,notes,category,cognitive_load,flexibility,start_at,end_at,deadline_at,reminder_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING "+columns, user, in.Title, in.Notes, in.Category, in.CognitiveLoad, in.Flexibility, in.StartAt, in.EndAt, in.DeadlineAt, reminder))
	if err != nil {
		return it, err
	}
	return it, tx.Commit(ctx)
}
func managedChange(item api.ScheduleItemDTO, in api.UpdateScheduleItemRequest) bool {
	return item.MeetingProposalID != nil && (in.Title != nil || in.Category != nil || in.CognitiveLoad != nil || in.Flexibility != nil || in.StartAt != nil || in.EndAt != nil || in.DeadlineAt.Set || in.ClearDeadline != nil || (in.Status != nil && *in.Status != "completed"))
}
func (s *Service) Update(ctx context.Context, user, id uuid.UUID, in api.UpdateScheduleItemRequest) (api.ScheduleItemDTO, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.ScheduleItemDTO{}, err
	}
	defer tx.Rollback(ctx)
	if err = lock(ctx, tx, user); err != nil {
		return api.ScheduleItemDTO{}, err
	}
	it, err := scan(tx.QueryRow(ctx, "SELECT "+columns+" FROM schedule_items WHERE id=$1 AND user_id=$2 FOR UPDATE", id, user))
	if err != nil {
		return it, err
	}
	if managedChange(it, in) {
		return it, ErrManaged
	}
	if in.Title != nil {
		it.Title = *in.Title
	}
	if in.Notes != nil {
		it.Notes = *in.Notes
	}
	if in.Category != nil {
		it.Category = *in.Category
	}
	if in.CognitiveLoad != nil {
		it.CognitiveLoad = *in.CognitiveLoad
	}
	if in.Flexibility != nil {
		it.Flexibility = *in.Flexibility
	}
	if in.Status != nil {
		it.Status = *in.Status
	}
	if in.StartAt != nil {
		it.StartAt = *in.StartAt
	}
	if in.EndAt != nil {
		it.EndAt = *in.EndAt
	}
	if in.ReminderMinutes != nil {
		it.ReminderMinutes = *in.ReminderMinutes
	}
	if in.ShouldClearDeadline() {
		it.DeadlineAt = nil
	} else if in.DeadlineAt.Set {
		it.DeadlineAt = &in.DeadlineAt.Value
	}
	if !it.EndAt.After(it.StartAt) || strings.TrimSpace(it.Title) == "" {
		return it, ErrTime
	}
	if it.Status != "cancelled" && (in.AllowOverlap == nil || !*in.AllowOverlap) {
		if err = checkConflict(ctx, tx, user, id, it.StartAt, it.EndAt); err != nil {
			return it, err
		}
	}
	it, err = scan(tx.QueryRow(ctx, "UPDATE schedule_items SET title=$3,notes=$4,category=$5,cognitive_load=$6,flexibility=$7,status=$8,start_at=$9,end_at=$10,deadline_at=$11,reminder_minutes=$12 WHERE id=$1 AND user_id=$2 RETURNING "+columns, id, user, it.Title, it.Notes, it.Category, it.CognitiveLoad, it.Flexibility, it.Status, it.StartAt, it.EndAt, it.DeadlineAt, it.ReminderMinutes))
	if err != nil {
		return it, err
	}
	return it, tx.Commit(ctx)
}
func (s *Service) Delete(ctx context.Context, user, id uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = lock(ctx, tx, user); err != nil {
		return err
	}
	it, err := scan(tx.QueryRow(ctx, "SELECT "+columns+" FROM schedule_items WHERE id=$1 AND user_id=$2 FOR UPDATE", id, user))
	if err != nil {
		return err
	}
	if it.MeetingProposalID != nil {
		return ErrManaged
	}
	if _, err = tx.Exec(ctx, "UPDATE schedule_items SET status='cancelled' WHERE id=$1 AND user_id=$2", id, user); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func ToEngine(items []api.ScheduleItemDTO) []engine.ScheduleItemSnapshot {
	out := make([]engine.ScheduleItemSnapshot, len(items))
	for i, it := range items {
		out[i] = engine.ScheduleItemSnapshot{ID: it.ID, UserID: it.UserID, WorkspaceID: it.WorkspaceID, ProposalID: it.MeetingProposalID, Title: it.Title, Notes: it.Notes, Category: engine.ScheduleCategory(it.Category), CognitiveLoad: engine.CognitiveLoad(it.CognitiveLoad), Flexibility: engine.Flexibility(it.Flexibility), Status: engine.ScheduleStatus(it.Status), StartAt: it.StartAt, EndAt: it.EndAt, DurationMinutes: it.DurationMinutes, DeadlineAt: it.DeadlineAt, ReminderMinutes: it.ReminderMinutes, UpdatedAt: it.UpdatedAt}
	}
	return out
}
func (s *Service) Baseline(ctx context.Context, user uuid.UUID, at time.Time) (string, string, error) {
	var zone string
	if err := s.pool.QueryRow(ctx, "SELECT timezone FROM users WHERE id=$1", user).Scan(&zone); err != nil {
		return "", "", err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return "", "", err
	}
	day := at.In(loc).Format("2006-01-02")
	from, to, err := engine.RescueWindowUTC(day, zone)
	if err != nil {
		return "", "", err
	}
	items, err := s.List(ctx, user, from, to, false)
	return day, engine.ComputeBaselineVersion(day, ToEngine(items)), err
}
