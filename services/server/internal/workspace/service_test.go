package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/biometrics"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/testutil"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPostgresWorkspacePrivacyAndConcurrentMeetingConfirmation(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	a, b, outsider := uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{a, b, outsider} {
		p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash,timezone) VALUES($1,$2,$3,'hash','UTC')", id, id.String()+"@example.com", id.String())
		p.Exec(ctx, "INSERT INTO energy_profiles(user_id) VALUES($1)", id)
	}
	bio := biometrics.NewService(p, engine.NewEnergyEngine())
	s := NewService(p, engine.NewTeamPlannerEngine(), bio)
	workspace, err := s.Create(ctx, a, api.CreateWorkspaceRequest{Name: "Real team"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Join(ctx, b, api.JoinWorkspaceRequest{InviteCode: workspace.InviteCode}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Members(ctx, outsider, workspace.ID); !errors.Is(err, ErrMembership) {
		t.Fatalf("outsider read workspace: %v", err)
	}
	privacy := api.PrivacyLevel("busy_only")
	if _, err = s.Privacy(ctx, b, workspace.ID, privacy); err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Truncate(time.Hour).Add(25 * time.Hour)
	p.Exec(ctx, "INSERT INTO schedule_items(user_id,title,category,cognitive_load,flexibility,start_at,end_at) VALUES($1,'SECRET_TITLE','deep_work','high','hard_locked',$2,$3)", b, start.Add(-2*time.Hour), start.Add(-time.Hour))
	view, err := s.Availability(ctx, a, workspace.ID, start.Add(-3*time.Hour), start.Add(3*time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), "SECRET_TITLE") || strings.Contains(string(raw), "hrv") || strings.Contains(string(raw), "score") {
		t.Fatalf("team privacy leak: %s", raw)
	}
	req := api.ConfirmMeetingRequest{Title: "Concurrent meeting", CognitiveLoad: "medium", ParticipantIDs: []uuid.UUID{a, b}, StartAt: start, EndAt: start.Add(time.Hour)}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Confirm(ctx, a, workspace.ID, "", req); results <- err }()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrBusy) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("meeting user-row lock failed: success=%d conflict=%d", success, conflict)
	}
	meetings, err := s.Meetings(ctx, a, workspace.ID, "", time.Time{}, time.Time{}, 20, "")
	if err != nil || len(meetings.Meetings) != 1 {
		t.Fatalf("unexpected meetings: %+v %v", meetings, err)
	}
	proposal := meetings.Meetings[0]
	if _, err = s.Respond(ctx, outsider, workspace.ID, proposal.ID, "declined"); !errors.Is(err, ErrMembership) {
		t.Fatal("outsider responded to a meeting")
	}
	response, err := s.Respond(ctx, b, workspace.ID, proposal.ID, "declined")
	if err != nil || response.ScheduleStatus != "cancelled" {
		t.Fatalf("decline did not release interval: %v", err)
	}
	if _, err = s.Cancel(ctx, b, workspace.ID, proposal.ID); !errors.Is(err, ErrRole) {
		t.Fatal("ordinary participant cancelled all meetings")
	}
	cancelled, err := s.Cancel(ctx, a, workspace.ID, proposal.ID)
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("organizer cancellation failed: %v", err)
	}
}

func TestPostgresMeetingCursorKeepsRowsWithEqualCreatedAt(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','hash')", id, id.String()+"@example.com")
	s := NewService(p, nil, nil)
	w, err := s.Create(ctx, id, api.CreateWorkspaceRequest{Name: "Paging"})
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().UTC()
	for range 2 {
		if _, err = p.Exec(ctx, "INSERT INTO meeting_proposals(workspace_id,organizer_id,title,duration_minutes,created_at) VALUES($1,$2,'Draft',30,$3)", w.ID, id, stamp); err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.Meetings(ctx, id, w.ID, "", time.Time{}, time.Time{}, 1, "")
	if err != nil || len(first.Meetings) != 1 || first.NextCursor == nil {
		t.Fatal("first meeting page missing")
	}
	second, err := s.Meetings(ctx, id, w.ID, "", time.Time{}, time.Time{}, 1, *first.NextCursor)
	if err != nil || len(second.Meetings) != 1 || second.Meetings[0].ID == first.Meetings[0].ID {
		t.Fatal("cursor skipped a meeting with equal created_at")
	}
}

func TestPostgresMeetingIdempotencyCountsOnlyMaterializedOptionalParticipants(t *testing.T) {
	p := testutil.Postgres(t)
	ctx := context.Background()
	a, b := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{a, b} {
		p.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','hash')", id, id.String()+"@example.com")
	}
	s := NewService(p, nil, nil)
	w, err := s.Create(ctx, a, api.CreateWorkspaceRequest{Name: "Optional attendance"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Join(ctx, b, api.JoinWorkspaceRequest{InviteCode: w.InviteCode}); err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Add(24 * time.Hour)
	p.Exec(ctx, "INSERT INTO schedule_items(user_id,title,flexibility,start_at,end_at) VALUES($1,'Busy optional member','hard_locked',$2,$3)", b, start, start.Add(time.Hour))
	req := api.ConfirmMeetingRequest{Title: "Required only", CognitiveLoad: "low", ParticipantIDs: []uuid.UUID{a}, OptionalIDs: []uuid.UUID{b}, StartAt: start, EndAt: start.Add(time.Hour)}
	first, err := s.Confirm(ctx, a, w.ID, "retry", req)
	if err != nil || first.CreatedScheduleCount != 1 {
		t.Fatalf("initial confirmation: %+v %v", first, err)
	}
	again, err := s.Confirm(ctx, a, w.ID, "retry", req)
	if err != nil || again.Proposal.ID != first.Proposal.ID || again.CreatedScheduleCount != 1 {
		t.Fatal("idempotent response invents an optional member calendar entry")
	}
}
