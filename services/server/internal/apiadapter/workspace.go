package apiadapter

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/auth"
	"github.com/shixu-app/server/internal/workspace"
	"time"
)

type Team struct {
	service  *workspace.Service
	personal *Personal
}

func NewTeam(service *workspace.Service, personal *Personal) *Team { return &Team{service, personal} }
func teamProblem(err error) error {
	switch {
	case errors.Is(err, workspace.ErrMembership):
		return api.NewProblem(403, api.ErrForbiddenNotWorkspaceMember, "workspace membership required")
	case errors.Is(err, workspace.ErrRole):
		return api.NewProblem(403, api.ErrForbiddenInsufficientRole, "organizer or workspace administrator required")
	case errors.Is(err, workspace.ErrParticipant):
		return api.NewProblem(403, api.ErrForbiddenNotParticipant, "meeting participant required")
	case errors.Is(err, workspace.ErrBusy):
		return api.NewProblem(409, api.ErrConflictMemberBusy, "a required member now has a conflicting locked schedule")
	case errors.Is(err, workspace.ErrInvite):
		return api.NewProblem(404, api.ErrInviteCodeNotFound, "invite code was not found")
	case errors.Is(err, workspace.ErrAlreadyMember):
		return api.NewProblem(409, api.ErrAlreadyWorkspaceMember, "already a workspace member")
	case errors.Is(err, workspace.ErrMeeting):
		return api.NewProblem(404, api.ErrMeetingProposalNotFound, "meeting was not found")
	case errors.Is(err, workspace.ErrCancelled):
		return api.NewProblem(409, api.ErrMeetingAlreadyCancelled, "meeting is already cancelled")
	case errors.Is(err, workspace.ErrMembers):
		return api.NewProblem(422, api.ErrParticipantNotInWorkspace, "every selected participant must belong to this workspace")
	case errors.Is(err, workspace.ErrRange):
		return api.NewProblem(422, api.ErrRangeTooLarge, "team query range must not exceed 14 days")
	}
	return personalProblem(err)
}
func (t *Team) CreateWorkspace(ctx context.Context, in *api.CreateWorkspaceInput) (*api.WorkspaceOutput, error) {
	out, e := t.service.Create(ctx, auth.UserID(ctx), in.Body)
	if e != nil {
		return nil, teamProblem(e)
	}
	return &api.WorkspaceOutput{Status: 201, Body: out}, nil
}
func (t *Team) ListWorkspaces(ctx context.Context, _ *struct{}) (*api.WorkspaceListOutput, error) {
	out, e := t.service.List(ctx, auth.UserID(ctx))
	if e != nil {
		return nil, teamProblem(e)
	}
	return &api.WorkspaceListOutput{Body: api.WorkspaceListResponse{Workspaces: out}}, nil
}
func (t *Team) JoinWorkspace(ctx context.Context, in *api.JoinWorkspaceInput) (*api.WorkspaceOutput, error) {
	out, e := t.service.Join(ctx, auth.UserID(ctx), in.Body)
	if e != nil {
		return nil, teamProblem(e)
	}
	t.availabilityChanged(ctx, out.ID, auth.UserID(ctx))
	return &api.WorkspaceOutput{Status: 200, Body: out}, nil
}
func (t *Team) availabilityChanged(ctx context.Context, wid, user uuid.UUID) {
	members, e := t.service.Members(ctx, user, wid)
	if e != nil {
		return
	}
	ids := make([]uuid.UUID, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	t.personal.emit(ids, api.WsAvailabilityChangedPayload{WorkspaceID: wid, UserID: user, Reason: "privacy_changed"})
}
func (t *Team) UpdateWorkspacePrivacy(ctx context.Context, in *api.UpdateWorkspacePrivacyInput) (*api.WorkspaceMemberOutput, error) {
	out, e := t.service.Privacy(ctx, auth.UserID(ctx), in.ID, in.Body.PrivacyLevel)
	if e != nil {
		return nil, teamProblem(e)
	}
	t.availabilityChanged(ctx, in.ID, auth.UserID(ctx))
	return &api.WorkspaceMemberOutput{Body: out}, nil
}
func (t *Team) ListWorkspaceMembers(ctx context.Context, in *api.WorkspaceIDInput) (*api.WorkspaceMembersOutput, error) {
	out, e := t.service.Members(ctx, auth.UserID(ctx), in.ID)
	if e != nil {
		return nil, teamProblem(e)
	}
	return &api.WorkspaceMembersOutput{Body: api.WorkspaceMemberListResponse{WorkspaceID: in.ID, Members: out}}, nil
}
func (t *Team) GetWorkspaceAvailability(ctx context.Context, in *api.WorkspaceAvailabilityInput) (*api.WorkspaceAvailabilityOutput, error) {
	ids, e := in.ParsedMemberIDs()
	if e != nil {
		return nil, api.NewProblem(422, api.ErrValidationFailed, "invalid member IDs")
	}
	out, e := t.service.Availability(ctx, auth.UserID(ctx), in.ID, in.From, in.To, ids)
	if e != nil {
		return nil, teamProblem(e)
	}
	return &api.WorkspaceAvailabilityOutput{Body: out}, nil
}
func (t *Team) RecommendWorkspaceMeetings(ctx context.Context, in *api.RecommendMeetingInput) (*api.RecommendMeetingOutput, error) {
	out, e := t.service.Recommend(ctx, auth.UserID(ctx), in.ID, in.Body)
	if e != nil {
		return nil, teamProblem(e)
	}
	return &api.RecommendMeetingOutput{Body: out}, nil
}
func (t *Team) ConfirmWorkspaceMeeting(ctx context.Context, in *api.ConfirmMeetingInput) (*api.ConfirmMeetingOutput, error) {
	out, e := t.service.Confirm(ctx, auth.UserID(ctx), in.ID, in.IdempotencyKey, in.Body)
	if e != nil {
		return nil, teamProblem(e)
	}
	p := out.Proposal
	ids := participantIDs(p)
	if p.ConfirmedStartAt != nil && p.ConfirmedEndAt != nil {
		t.personal.emit(ids, api.WsWorkspaceMeetingConfirmedPayload{WorkspaceID: p.WorkspaceID, ProposalID: p.ID, OrganizerID: p.OrganizerID, Title: p.Title, CognitiveLoad: p.CognitiveLoad, StartAt: *p.ConfirmedStartAt, EndAt: *p.ConfirmedEndAt, ParticipantIDs: ids})
		for _, id := range ids {
			t.personal.Mutation(ctx, id, *p.ConfirmedStartAt, *p.ConfirmedEndAt, "team_meeting_synced", []uuid.UUID{})
		}
	}
	return &api.ConfirmMeetingOutput{Status: 201, Body: out}, nil
}
func participantIDs(p api.MeetingProposalDTO) []uuid.UUID {
	ids := make([]uuid.UUID, len(p.Participants))
	for i, v := range p.Participants {
		ids[i] = v.UserID
	}
	return ids
}
func (t *Team) ListWorkspaceMeetings(ctx context.Context, in *api.ListWorkspaceMeetingsInput) (*api.ListWorkspaceMeetingsOutput, error) {
	out, e := t.service.Meetings(ctx, auth.UserID(ctx), in.ID, in.Status, in.From, in.To, in.Limit, in.Cursor)
	if e != nil {
		return nil, teamProblem(e)
	}
	return &api.ListWorkspaceMeetingsOutput{Body: out}, nil
}
func (t *Team) RespondWorkspaceMeeting(ctx context.Context, in *api.RespondMeetingInput) (*api.RespondMeetingOutput, error) {
	user := auth.UserID(ctx)
	out, e := t.service.Respond(ctx, user, in.ID, in.ProposalID, in.Body.ResponseStatus)
	if e != nil {
		return nil, teamProblem(e)
	}
	if p, err := t.service.Proposal(ctx, user, in.ID, in.ProposalID); err == nil {
		display := ""
		for _, v := range p.Participants {
			if v.UserID == user {
				display = v.DisplayName
			}
		}
		t.personal.emit(participantIDs(p), api.WsWorkspaceMeetingRespondedPayload{WorkspaceID: in.ID, ProposalID: in.ProposalID, UserID: user, DisplayName: display, ResponseStatus: in.Body.ResponseStatus, RespondedAt: out.UpdatedAt})
		if p.ConfirmedStartAt != nil && p.ConfirmedEndAt != nil {
			t.personal.Mutation(ctx, user, *p.ConfirmedStartAt, *p.ConfirmedEndAt, "team_meeting_synced", []uuid.UUID{})
		}
	}
	return &api.RespondMeetingOutput{Body: out}, nil
}
func (t *Team) CancelWorkspaceMeeting(ctx context.Context, in *api.CancelMeetingInput) (*api.CancelMeetingOutput, error) {
	user := auth.UserID(ctx)
	out, e := t.service.Cancel(ctx, user, in.ID, in.ProposalID)
	if e != nil {
		return nil, teamProblem(e)
	}
	if p, err := t.service.Proposal(ctx, user, in.ID, in.ProposalID); err == nil {
		var reason *string
		if in.Body != nil && in.Body.Reason != "" {
			reason = &in.Body.Reason
		}
		start, end := time.Time{}, time.Time{}
		if p.ConfirmedStartAt != nil {
			start = *p.ConfirmedStartAt
		}
		if p.ConfirmedEndAt != nil {
			end = *p.ConfirmedEndAt
		}
		ids := participantIDs(p)
		t.personal.emit(ids, api.WsWorkspaceMeetingCancelledPayload{WorkspaceID: in.ID, ProposalID: in.ProposalID, CancelledByUserID: user, Title: p.Title, StartAt: start, EndAt: end, Reason: reason})
		for _, id := range ids {
			t.personal.Mutation(ctx, id, start, end, "team_meeting_synced", []uuid.UUID{})
		}
	}
	return &api.CancelMeetingOutput{Body: out}, nil
}
