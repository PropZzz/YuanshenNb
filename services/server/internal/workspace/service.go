// Package workspace owns membership, privacy projection and meeting transactions.
package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/auth"
	"github.com/shixu-app/server/internal/biometrics"
	"github.com/shixu-app/server/internal/db"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/schedule"
)

var (
	ErrMembership    = errors.New("not a workspace member")
	ErrRole          = errors.New("insufficient workspace role")
	ErrParticipant   = errors.New("not a meeting participant")
	ErrBusy          = errors.New("required member is busy")
	ErrInvite        = errors.New("invite code not found")
	ErrAlreadyMember = errors.New("already a workspace member")
	ErrMeeting       = errors.New("meeting not found")
	ErrCancelled     = errors.New("meeting already cancelled")
	ErrMembers       = errors.New("participant not in workspace")
	ErrRange         = errors.New("workspace range exceeds 14 days")
)

type Service struct {
	pool   *pgxpool.Pool
	engine engine.TeamPlannerEngine
	energy *biometrics.Service
}

func NewService(pool *pgxpool.Pool, e engine.TeamPlannerEngine, energy *biometrics.Service) *Service {
	return &Service{pool, e, energy}
}
func membership(ctx context.Context, q schedule.Querier, user, wid uuid.UUID) (string, error) {
	var role string
	err := q.QueryRow(ctx, "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", wid, user).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrMembership
	}
	return role, err
}

const workspaceSelect = "SELECT w.id,w.name,w.description,w.invite_code,w.owner_id,m.role,m.privacy_level,(SELECT count(*) FROM workspace_members n WHERE n.workspace_id=w.id),w.created_at,w.updated_at FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1"

func scanWorkspace(row pgx.Row) (api.WorkspaceDTO, error) {
	var w api.WorkspaceDTO
	err := row.Scan(&w.ID, &w.Name, &w.Description, &w.InviteCode, &w.OwnerID, &w.MyRole, &w.MyPrivacyLevel, &w.MemberCount, &w.CreatedAt, &w.UpdatedAt)
	return w, err
}
func (s *Service) Create(ctx context.Context, user uuid.UUID, in api.CreateWorkspaceRequest) (api.WorkspaceDTO, error) {
	token, err := auth.RandomToken()
	if err != nil {
		return api.WorkspaceDTO{}, err
	}
	code := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(token[:12], "-", "A"), "_", "B"))
	privacy := api.PrivacyLevel("energy_tier")
	if in.PrivacyLevel != nil {
		privacy = *in.PrivacyLevel
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.WorkspaceDTO{}, err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	if err = tx.QueryRow(ctx, "INSERT INTO workspaces(name,description,invite_code,owner_id) VALUES($1,$2,$3,$4) RETURNING id", strings.TrimSpace(in.Name), in.Description, code, user).Scan(&id); err != nil {
		return api.WorkspaceDTO{}, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO workspace_members(workspace_id,user_id,role,privacy_level) VALUES($1,$2,'owner',$3)", id, user, privacy); err != nil {
		return api.WorkspaceDTO{}, err
	}
	out, err := scanWorkspace(tx.QueryRow(ctx, workspaceSelect+" WHERE w.id=$2", user, id))
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
func (s *Service) List(ctx context.Context, user uuid.UUID) ([]api.WorkspaceDTO, error) {
	rows, err := s.pool.Query(ctx, workspaceSelect+" ORDER BY w.created_at,w.id", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []api.WorkspaceDTO{}
	for rows.Next() {
		v, e := scanWorkspace(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Service) Join(ctx context.Context, user uuid.UUID, in api.JoinWorkspaceRequest) (api.WorkspaceDTO, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.WorkspaceDTO{}, err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	if err = tx.QueryRow(ctx, "SELECT id FROM workspaces WHERE invite_code=$1", strings.ToUpper(strings.TrimSpace(in.InviteCode))).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
		return api.WorkspaceDTO{}, ErrInvite
	}
	if err != nil {
		return api.WorkspaceDTO{}, err
	}
	privacy := api.PrivacyLevel("energy_tier")
	if in.PrivacyLevel != nil {
		privacy = *in.PrivacyLevel
	}
	tag, err := tx.Exec(ctx, "INSERT INTO workspace_members(workspace_id,user_id,privacy_level) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", id, user, privacy)
	if err != nil {
		return api.WorkspaceDTO{}, err
	}
	if tag.RowsAffected() == 0 {
		return api.WorkspaceDTO{}, ErrAlreadyMember
	}
	out, err := scanWorkspace(tx.QueryRow(ctx, workspaceSelect+" WHERE w.id=$2", user, id))
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
func (s *Service) Privacy(ctx context.Context, user, wid uuid.UUID, privacy api.PrivacyLevel) (api.WorkspaceMemberDTO, error) {
	var out api.WorkspaceMemberDTO
	err := s.pool.QueryRow(ctx, "UPDATE workspace_members m SET privacy_level=$3 FROM users u WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.id=m.user_id RETURNING m.workspace_id,m.user_id,u.display_name,m.role,u.timezone,m.privacy_level,m.joined_at", wid, user, privacy).Scan(&out.WorkspaceID, &out.UserID, &out.DisplayName, &out.Role, &out.Timezone, &out.PrivacyLevel, &out.JoinedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, ErrMembership
	}
	return out, err
}
func (s *Service) Members(ctx context.Context, user, wid uuid.UUID) ([]api.WorkspaceMemberDTO, error) {
	if _, err := membership(ctx, s.pool, user, wid); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, "SELECT m.workspace_id,m.user_id,u.display_name,m.role,u.timezone,m.privacy_level,m.joined_at FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND EXISTS(SELECT 1 FROM workspace_members caller WHERE caller.workspace_id=$1 AND caller.user_id=$2) ORDER BY m.joined_at,m.user_id", wid, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []api.WorkspaceMemberDTO{}
	for rows.Next() {
		var m api.WorkspaceMemberDTO
		if err = rows.Scan(&m.WorkspaceID, &m.UserID, &m.DisplayName, &m.Role, &m.Timezone, &m.PrivacyLevel, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func unique(groups ...[]uuid.UUID) []uuid.UUID {
	out := []uuid.UUID{}
	seen := map[uuid.UUID]bool{}
	for _, group := range groups {
		for _, id := range group {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}
func (s *Service) raw(ctx context.Context, user, wid uuid.UUID, from, to time.Time, selected []uuid.UUID) ([]engine.MemberRawSchedulingData, error) {
	if !to.After(from) {
		return nil, schedule.ErrTime
	}
	if to.Sub(from) > 14*24*time.Hour {
		return nil, ErrRange
	}
	if _, err := membership(ctx, s.pool, user, wid); err != nil {
		return nil, err
	}
	selected = unique(selected)
	filter := len(selected) > 0
	rows, err := s.pool.Query(ctx, "SELECT m.user_id,u.display_name,m.privacy_level,u.timezone,ep.work_start_minute,ep.work_end_minute,ep.chronotype,ep.preferred_focus_windows,ep.min_recovery_buffer_min FROM workspace_members m JOIN users u ON u.id=m.user_id JOIN energy_profiles ep ON ep.user_id=m.user_id WHERE m.workspace_id=$1 AND (NOT $3::boolean OR m.user_id=ANY($4::uuid[])) AND EXISTS(SELECT 1 FROM workspace_members caller WHERE caller.workspace_id=$1 AND caller.user_id=$2) ORDER BY m.user_id", wid, user, filter, selected)
	if err != nil {
		return nil, err
	}
	members := []engine.MemberRawSchedulingData{}
	for rows.Next() {
		var m engine.MemberRawSchedulingData
		var windows []byte
		if err = rows.Scan(&m.UserID, &m.DisplayName, &m.PrivacyLevel, &m.Profile.Timezone, &m.Profile.WorkStartMinute, &m.Profile.WorkEndMinute, &m.Profile.Chronotype, &windows, &m.Profile.MinRecoveryBufferMin); err != nil {
			rows.Close()
			return nil, err
		}
		m.Profile.UserID = m.UserID
		if err = json.Unmarshal(windows, &m.Profile.PreferredFocusWindows); err != nil {
			rows.Close()
			return nil, err
		}
		members = append(members, m)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if filter && len(members) != len(selected) {
		return nil, ErrMembers
	}
	for i := range members {
		m := &members[i]
		items, e := schedule.List(ctx, s.pool, m.UserID, from, to, false)
		if e != nil {
			return nil, e
		}
		m.Schedules = schedule.ToEngine(items)
		loc, e := time.LoadLocation(m.Profile.Timezone)
		if e != nil {
			return nil, e
		}
		day := from.In(loc)
		last := to.Add(-time.Nanosecond).In(loc).Format("2006-01-02")
		for {
			d := day.Format("2006-01-02")
			out, e := s.energy.Compute(ctx, m.UserID, d, true)
			if e != nil {
				return nil, e
			}
			for _, pt := range out.HourlyCurve {
				m.PredictedCurve = append(m.PredictedCurve, engine.HourlyEnergyPoint{HourStartAt: pt.HourStartAt, Score: pt.Score, Tier: engine.EnergyTier(pt.Tier)})
			}
			if d == last {
				break
			}
			day = day.AddDate(0, 0, 1)
		}
	}
	return members, nil
}
func (s *Service) Availability(ctx context.Context, user, wid uuid.UUID, from, to time.Time, ids []uuid.UUID) (api.WorkspaceAvailabilityResponse, error) {
	members, err := s.raw(ctx, user, wid, from, to, ids)
	if err != nil {
		return api.WorkspaceAvailabilityResponse{}, err
	}
	views, err := s.engine.ProjectAvailability(ctx, engine.AvailabilityProjectionInput{From: from, To: to, Members: members})
	return api.WorkspaceAvailabilityResponse{WorkspaceID: wid, From: from, To: to, Members: api.FromEngineAvailabilityViews(views)}, err
}
func (s *Service) Recommend(ctx context.Context, user, wid uuid.UUID, in api.RecommendMeetingRequest) (api.RecommendMeetingResponse, error) {
	required := unique(in.ParticipantIDs)
	requiredSet := make(map[uuid.UUID]bool, len(required))
	for _, id := range required {
		requiredSet[id] = true
	}
	optional := []uuid.UUID{}
	for _, id := range unique(in.OptionalIDs) {
		if !requiredSet[id] {
			optional = append(optional, id)
		}
	}
	ids := unique(required, optional)
	members, err := s.raw(ctx, user, wid, in.SearchFrom, in.SearchTo, ids)
	if err != nil {
		return api.RecommendMeetingResponse{}, err
	}
	respect, max := true, 3
	if in.RespectFocusShields != nil {
		respect = *in.RespectFocusShields
	}
	if in.MaxResults != nil {
		max = *in.MaxResults
	}
	out, err := s.engine.RecommendWindows(ctx, engine.MeetingSolverInput{Title: in.Title, DurationMinutes: in.DurationMinutes, CognitiveLoad: engine.CognitiveLoad(in.CognitiveLoad), RequiredUserIDs: required, OptionalUserIDs: optional, SearchFrom: in.SearchFrom, SearchTo: in.SearchTo, RespectFocusShields: respect, MaxResults: max, Members: members})
	return api.FromEngineMeetingOutput(out), err
}
func lockUsers(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) error {
	rows, err := tx.Query(ctx, "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", ids)
	if err != nil {
		return err
	}
	count := 0
	for rows.Next() {
		count++
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if count != len(ids) {
		return ErrMembers
	}
	return nil
}
func assertParticipants(ctx context.Context, q schedule.Querier, wid uuid.UUID, ids []uuid.UUID) error {
	var count int
	err := q.QueryRow(ctx, "SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND user_id=ANY($2::uuid[])", wid, ids).Scan(&count)
	if err != nil {
		return err
	}
	if count != len(ids) {
		return ErrMembers
	}
	return nil
}
func (s *Service) Confirm(ctx context.Context, user, wid uuid.UUID, key string, in api.ConfirmMeetingRequest) (api.ConfirmMeetingResponse, error) {
	if !in.EndAt.After(in.StartAt) || in.EndAt.Sub(in.StartAt) < 15*time.Minute || in.EndAt.Sub(in.StartAt) > 8*time.Hour || in.EndAt.Sub(in.StartAt)%time.Minute != 0 {
		return api.ConfirmMeetingResponse{}, schedule.ErrTime
	}
	required := unique(in.ParticipantIDs)
	all := unique(required, in.OptionalIDs)
	if len(required) == 0 {
		return api.ConfirmMeetingResponse{}, ErrMembers
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.ConfirmMeetingResponse{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = membership(ctx, tx, user, wid); err != nil {
		return api.ConfirmMeetingResponse{}, err
	}
	if err = assertParticipants(ctx, tx, wid, all); err != nil {
		return api.ConfirmMeetingResponse{}, err
	}
	if err = lockUsers(ctx, tx, unique(all, []uuid.UUID{user})); err != nil {
		return api.ConfirmMeetingResponse{}, err
	}
	if key != "" {
		var id uuid.UUID
		err = tx.QueryRow(ctx, "SELECT id FROM meeting_proposals WHERE workspace_id=$1 AND organizer_id=$2 AND idempotency_key=$3", wid, user, key).Scan(&id)
		if err == nil {
			proposal, e := getProposal(ctx, tx, user, wid, id, false)
			if e != nil {
				return api.ConfirmMeetingResponse{}, e
			}
			var created int
			if e = tx.QueryRow(ctx, "SELECT count(*) FROM schedule_items WHERE meeting_proposal_id=$1", id).Scan(&created); e != nil {
				return api.ConfirmMeetingResponse{}, e
			}
			return api.ConfirmMeetingResponse{Proposal: proposal, CreatedScheduleCount: created}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return api.ConfirmMeetingResponse{}, err
		}
	}
	requiredSet := map[uuid.UUID]bool{}
	for _, id := range required {
		requiredSet[id] = true
	}
	available := map[uuid.UUID]bool{}
	for _, id := range all {
		var busy bool
		err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schedule_items WHERE user_id=$1 AND status<>'cancelled' AND (flexibility='hard_locked' OR category='meeting') AND time_range && tstzrange($2,$3,'[)'))", id, in.StartAt, in.EndAt).Scan(&busy)
		if err != nil {
			return api.ConfirmMeetingResponse{}, err
		}
		if busy && requiredSet[id] {
			return api.ConfirmMeetingResponse{}, ErrBusy
		}
		available[id] = !busy
	}
	var proposalID uuid.UUID
	var keyValue *string
	if key != "" {
		keyValue = &key
	}
	meta := []byte("{}")
	if in.RecommendationMeta != nil {
		meta, err = json.Marshal(in.RecommendationMeta)
		if err != nil {
			return api.ConfirmMeetingResponse{}, err
		}
	}
	if in.ProposalID != nil {
		proposalID = *in.ProposalID
		tag, e := tx.Exec(ctx, "UPDATE meeting_proposals SET title=$4,description=$5,duration_minutes=$6,cognitive_load=$7,status='confirmed',confirmed_start_at=$8,confirmed_end_at=$9,idempotency_key=$10,recommendation_meta=$11 WHERE id=$1 AND workspace_id=$2 AND organizer_id=$3 AND status='draft'", proposalID, wid, user, in.Title, in.Description, int(in.EndAt.Sub(in.StartAt)/time.Minute), in.CognitiveLoad, in.StartAt, in.EndAt, keyValue, meta)
		if e != nil {
			return api.ConfirmMeetingResponse{}, e
		}
		if tag.RowsAffected() != 1 {
			return api.ConfirmMeetingResponse{}, ErrMeeting
		}
	} else {
		err = tx.QueryRow(ctx, "INSERT INTO meeting_proposals(workspace_id,organizer_id,title,description,duration_minutes,cognitive_load,status,confirmed_start_at,confirmed_end_at,idempotency_key,recommendation_meta) VALUES($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9,$10) RETURNING id", wid, user, in.Title, in.Description, int(in.EndAt.Sub(in.StartAt)/time.Minute), in.CognitiveLoad, in.StartAt, in.EndAt, keyValue, meta).Scan(&proposalID)
		if err != nil {
			return api.ConfirmMeetingResponse{}, err
		}
	}
	created := 0
	for _, id := range all {
		response := "pending"
		if id == user {
			response = "accepted"
		}
		if _, err = tx.Exec(ctx, "INSERT INTO meeting_participants(proposal_id,user_id,required,response_status) VALUES($1,$2,$3,$4) ON CONFLICT(proposal_id,user_id) DO UPDATE SET required=EXCLUDED.required,response_status=EXCLUDED.response_status", proposalID, id, requiredSet[id], response); err != nil {
			return api.ConfirmMeetingResponse{}, err
		}
		if available[id] {
			tag, e := tx.Exec(ctx, "INSERT INTO schedule_items(user_id,workspace_id,meeting_proposal_id,title,notes,category,cognitive_load,flexibility,start_at,end_at) VALUES($1,$2,$3,$4,$5,'meeting',$6,'hard_locked',$7,$8)", id, wid, proposalID, in.Title, in.Description, in.CognitiveLoad, in.StartAt, in.EndAt)
			if e != nil {
				return api.ConfirmMeetingResponse{}, e
			}
			created += int(tag.RowsAffected())
		}
	}
	proposal, err := getProposal(ctx, tx, user, wid, proposalID, false)
	if err != nil {
		return api.ConfirmMeetingResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.ConfirmMeetingResponse{}, err
	}
	return api.ConfirmMeetingResponse{Proposal: proposal, CreatedScheduleCount: created}, nil
}
func getProposal(ctx context.Context, q schedule.Querier, user, wid, id uuid.UUID, lock bool) (api.MeetingProposalDTO, error) {
	var out api.MeetingProposalDTO
	var meta []byte
	query := "SELECT p.id,p.workspace_id,p.organizer_id,p.title,p.description,p.duration_minutes,p.cognitive_load,p.status,p.confirmed_start_at,p.confirmed_end_at,p.recommendation_meta,p.created_at,p.updated_at FROM meeting_proposals p WHERE p.id=$1 AND p.workspace_id=$2 AND EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=$2 AND m.user_id=$3)"
	if lock {
		query += " FOR UPDATE OF p"
	}
	err := q.QueryRow(ctx, query, id, wid, user).Scan(&out.ID, &out.WorkspaceID, &out.OrganizerID, &out.Title, &out.Description, &out.DurationMinutes, &out.CognitiveLoad, &out.Status, &out.ConfirmedStartAt, &out.ConfirmedEndAt, &meta, &out.CreatedAt, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, ErrMeeting
	}
	if err != nil {
		return out, err
	}
	if string(meta) != "{}" && string(meta) != "null" {
		var v api.MeetingRecommendationMeta
		if err = json.Unmarshal(meta, &v); err != nil {
			return out, err
		}
		out.RecommendationMeta = &v
	}
	rows, err := q.Query(ctx, "SELECT m.user_id,u.display_name,m.required,m.response_status FROM meeting_participants m JOIN users u ON u.id=m.user_id WHERE m.proposal_id=$1 ORDER BY m.user_id", id)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	out.Participants = []api.MeetingParticipantView{}
	for rows.Next() {
		var p api.MeetingParticipantView
		if err = rows.Scan(&p.UserID, &p.DisplayName, &p.Required, &p.ResponseStatus); err != nil {
			return out, err
		}
		out.Participants = append(out.Participants, p)
	}
	return out, rows.Err()
}
func (s *Service) Meetings(ctx context.Context, user, wid uuid.UUID, status api.MeetingProposalStatus, from, to time.Time, limit int, cursor string) (api.MeetingProposalListResponse, error) {
	if _, err := membership(ctx, s.pool, user, wid); err != nil {
		return api.MeetingProposalListResponse{}, err
	}
	if limit < 1 || limit > 50 {
		limit = 20
	}
	before, beforeID, err := db.DecodeCursor(cursor)
	if err != nil {
		return api.MeetingProposalListResponse{}, schedule.ErrTime
	}
	var fromValue, toValue *time.Time
	if !from.IsZero() {
		fromValue = &from
	}
	if !to.IsZero() {
		toValue = &to
	}
	rows, err := s.pool.Query(ctx, "SELECT p.id FROM meeting_proposals p WHERE workspace_id=$1 AND ($3='' OR status=$3) AND ($4::timestamptz IS NULL OR confirmed_end_at>$4) AND ($5::timestamptz IS NULL OR confirmed_start_at<$5) AND ($6::timestamptz IS NULL OR (created_at,id)<($6,$7::uuid)) AND EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=$1 AND m.user_id=$2) ORDER BY created_at DESC,id DESC LIMIT $8", wid, user, status, fromValue, toValue, before, beforeID, limit+1)
	if err != nil {
		return api.MeetingProposalListResponse{}, err
	}
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return api.MeetingProposalListResponse{}, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return api.MeetingProposalListResponse{}, err
	}
	more := len(ids) > limit
	if more {
		ids = ids[:limit]
	}
	out := api.MeetingProposalListResponse{Meetings: []api.MeetingProposalDTO{}}
	for _, id := range ids {
		m, e := getProposal(ctx, s.pool, user, wid, id, false)
		if e != nil {
			return out, e
		}
		out.Meetings = append(out.Meetings, m)
	}
	if more {
		last := out.Meetings[len(out.Meetings)-1]
		v := db.EncodeCursor(last.CreatedAt, last.ID)
		out.NextCursor = &v
	}
	return out, nil
}
func (s *Service) Respond(ctx context.Context, user, wid, id uuid.UUID, response api.MeetingDecisionStatus) (api.RespondMeetingResponse, error) {
	if response != "accepted" && response != "declined" {
		return api.RespondMeetingResponse{}, ErrParticipant
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.RespondMeetingResponse{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = membership(ctx, tx, user, wid); err != nil {
		return api.RespondMeetingResponse{}, err
	}
	if err = lockUsers(ctx, tx, []uuid.UUID{user}); err != nil {
		return api.RespondMeetingResponse{}, err
	}
	proposal, err := getProposal(ctx, tx, user, wid, id, true)
	if err != nil {
		return api.RespondMeetingResponse{}, err
	}
	if proposal.Status == "cancelled" {
		return api.RespondMeetingResponse{}, ErrCancelled
	}
	found := false
	for _, p := range proposal.Participants {
		if p.UserID == user {
			found = true
		}
	}
	if !found {
		return api.RespondMeetingResponse{}, ErrParticipant
	}
	scheduleStatus := api.ScheduleStatus("cancelled")
	if response == "declined" {
		if _, err = tx.Exec(ctx, "UPDATE schedule_items SET status='cancelled' WHERE user_id=$1 AND meeting_proposal_id=$2", user, id); err != nil {
			return api.RespondMeetingResponse{}, err
		}
	} else {
		if proposal.ConfirmedStartAt == nil || proposal.ConfirmedEndAt == nil {
			return api.RespondMeetingResponse{}, ErrMeeting
		}
		var busy bool
		err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schedule_items WHERE user_id=$1 AND meeting_proposal_id IS DISTINCT FROM $2 AND status<>'cancelled' AND (flexibility='hard_locked' OR category='meeting') AND time_range && tstzrange($3,$4,'[)'))", user, id, *proposal.ConfirmedStartAt, *proposal.ConfirmedEndAt).Scan(&busy)
		if err != nil {
			return api.RespondMeetingResponse{}, err
		}
		if busy {
			return api.RespondMeetingResponse{}, ErrBusy
		}
		err = tx.QueryRow(ctx, "INSERT INTO schedule_items(user_id,workspace_id,meeting_proposal_id,title,notes,category,cognitive_load,flexibility,start_at,end_at) VALUES($1,$2,$3,$4,$5,'meeting',$6,'hard_locked',$7,$8) ON CONFLICT(meeting_proposal_id,user_id) WHERE meeting_proposal_id IS NOT NULL DO UPDATE SET status=CASE WHEN schedule_items.status='completed' THEN 'completed' ELSE 'planned' END RETURNING status", user, wid, id, proposal.Title, proposal.Description, proposal.CognitiveLoad, *proposal.ConfirmedStartAt, *proposal.ConfirmedEndAt).Scan(&scheduleStatus)
		if err != nil {
			return api.RespondMeetingResponse{}, err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE meeting_participants SET response_status=$3 WHERE proposal_id=$1 AND user_id=$2", id, user, response); err != nil {
		return api.RespondMeetingResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.RespondMeetingResponse{}, err
	}
	return api.RespondMeetingResponse{ProposalID: id, UserID: user, ResponseStatus: response, ScheduleStatus: scheduleStatus, UpdatedAt: time.Now().UTC()}, nil
}
func (s *Service) Cancel(ctx context.Context, user, wid, id uuid.UUID) (api.CancelMeetingResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return api.CancelMeetingResponse{}, err
	}
	defer tx.Rollback(ctx)
	role, err := membership(ctx, tx, user, wid)
	if err != nil {
		return api.CancelMeetingResponse{}, err
	}
	proposal, err := getProposal(ctx, tx, user, wid, id, false)
	if err != nil {
		return api.CancelMeetingResponse{}, err
	}
	if proposal.OrganizerID != user && role != "owner" && role != "admin" {
		return api.CancelMeetingResponse{}, ErrRole
	}
	ids := []uuid.UUID{user}
	for _, p := range proposal.Participants {
		ids = append(ids, p.UserID)
	}
	if err = lockUsers(ctx, tx, unique(ids)); err != nil {
		return api.CancelMeetingResponse{}, err
	}
	proposal, err = getProposal(ctx, tx, user, wid, id, true)
	if err != nil {
		return api.CancelMeetingResponse{}, err
	}
	if proposal.Status == "cancelled" {
		return api.CancelMeetingResponse{}, ErrCancelled
	}
	var updated time.Time
	if err = tx.QueryRow(ctx, "UPDATE meeting_proposals SET status='cancelled' WHERE id=$1 AND workspace_id=$2 RETURNING updated_at", id, wid).Scan(&updated); err != nil {
		return api.CancelMeetingResponse{}, err
	}
	tag, err := tx.Exec(ctx, "UPDATE schedule_items SET status='cancelled' WHERE meeting_proposal_id=$1 AND status<>'cancelled'", id)
	if err != nil {
		return api.CancelMeetingResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return api.CancelMeetingResponse{}, err
	}
	return api.CancelMeetingResponse{ProposalID: id, Status: "cancelled", CancelledScheduleCount: int(tag.RowsAffected()), UpdatedAt: updated}, nil
}
func (s *Service) Proposal(ctx context.Context, user, wid, id uuid.UUID) (api.MeetingProposalDTO, error) {
	return getProposal(ctx, s.pool, user, wid, id, false)
}
