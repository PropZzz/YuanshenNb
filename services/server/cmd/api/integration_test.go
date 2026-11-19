package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/testutil"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestPostgresRuntimeAuthScheduleEnergyAndWorkspaceHTTP(t *testing.T) {
	pool := testutil.Postgres(t)
	cfg := config.Load()
	router := NewRouter(cfg, newRuntimeDeps(cfg, pool))
	successfulOperations := map[string]bool{}
	idsInPath := regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	call := func(method, path, token string, body any) *httptest.ResponseRecorder {
		var data []byte
		if body != nil {
			var err error
			data, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code >= 200 && res.Code < 300 {
			operation := method + " " + idsInPath.ReplaceAllString(strings.SplitN(path, "?", 2)[0], "{id}")
			successfulOperations[operation] = true
		}
		return res
	}
	expect := func(res *httptest.ResponseRecorder, status int) {
		t.Helper()
		if res.Code != status {
			t.Fatalf("HTTP expected %d got %d: %s", status, res.Code, res.Body.String())
		}
	}
	id := "00000000-0000-0000-0000-000000000001"
	protected := [][2]string{{"GET", "/auth/me"}, {"PATCH", "/auth/me"}, {"POST", "/auth/logout"}, {"POST", "/auth/ws-ticket"}, {"POST", "/biometrics/samples/batch"}, {"POST", "/biometrics/replay-seed"}, {"GET", "/energy/today"}, {"GET", "/energy/profile"}, {"PUT", "/energy/profile"}, {"GET", "/schedule/items"}, {"POST", "/schedule/items"}, {"PATCH", "/schedule/items/" + id}, {"DELETE", "/schedule/items/" + id}, {"POST", "/schedule/rescue/options"}, {"POST", "/schedule/rescue/apply"}, {"POST", "/schedule/rescue/undo"}, {"GET", "/schedule/rescue/history"}, {"POST", "/workspaces"}, {"GET", "/workspaces"}, {"POST", "/workspaces/join"}, {"PATCH", "/workspaces/" + id + "/me"}, {"GET", "/workspaces/" + id + "/members"}, {"GET", "/workspaces/" + id + "/availability"}, {"POST", "/workspaces/" + id + "/meetings/recommend"}, {"POST", "/workspaces/" + id + "/meetings/confirm"}, {"GET", "/workspaces/" + id + "/meetings"}, {"POST", "/workspaces/" + id + "/meetings/" + id + "/respond"}, {"POST", "/workspaces/" + id + "/meetings/" + id + "/cancel"}}
	for _, route := range protected {
		res := call(route[0], "/api/v1"+route[1], "", nil)
		expect(res, 401)
		if res.Result().Header.Get("Content-Type") != "application/problem+json" {
			t.Fatal("authentication rejection lost RFC 9457 content type")
		}
	}
	expect(call("GET", "/api/v1/health", "", nil), 200)
	register := call("POST", "/api/v1/auth/register", "", api.RegisterRequest{Email: "runtime@example.com", DisplayName: "Runtime", Password: "runtime-password", Timezone: "UTC"})
	expect(register, 201)
	var tokens api.AuthTokensResponse
	if err := json.Unmarshal(register.Body.Bytes(), &tokens); err != nil {
		t.Fatal(err)
	}
	if len(register.Result().Cookies()) != 1 || !register.Result().Cookies()[0].HttpOnly {
		t.Fatal("secure refresh cookie missing")
	}
	login := call("POST", "/api/v1/auth/login", "", api.LoginRequest{Email: "runtime@example.com", Password: "runtime-password"})
	expect(login, 200)
	if err := json.Unmarshal(login.Body.Bytes(), &tokens); err != nil {
		t.Fatal(err)
	}
	expect(call("GET", "/api/v1/auth/me", tokens.AccessToken, nil), 200)
	expect(call("POST", "/api/v1/auth/ws-ticket", tokens.AccessToken, nil), 200)
	now := time.Now().UTC()
	start := now.Truncate(time.Hour).Add(25 * time.Hour)
	create := call("POST", "/api/v1/schedule/items", tokens.AccessToken, api.CreateScheduleItemRequest{Title: "HTTP task", Category: "deep_work", CognitiveLoad: "high", Flexibility: "flexible", StartAt: start, EndAt: start.Add(time.Hour)})
	expect(create, 201)
	var item api.ScheduleMutationResponse
	json.Unmarshal(create.Body.Bytes(), &item)
	updatedTitle := "Updated HTTP task"
	expect(call("PATCH", "/api/v1/schedule/items/"+item.Item.ID.String(), tokens.AccessToken, api.UpdateScheduleItemRequest{Title: &updatedTitle}), 200)
	expect(call("GET", "/api/v1/schedule/items?from="+start.Add(-time.Hour).Format(time.RFC3339)+"&to="+start.Add(3*time.Hour).Format(time.RFC3339), tokens.AccessToken, nil), 200)
	expect(call("GET", "/api/v1/energy/today", tokens.AccessToken, nil), 200)
	expect(call("GET", "/api/v1/energy/profile", tokens.AccessToken, nil), 200)
	sample := api.BiometricSampleDTO{SourceType: "replay_demo", MetricType: "hrv_rmssd", RecordedAt: now.Add(-time.Minute), NumericValue: 55, Unit: "ms", ExternalID: "http-sample"}
	invalid := sample
	invalid.NumericValue = 400
	invalid.ExternalID = "http-invalid-sample"
	badBatch := call("POST", "/api/v1/biometrics/samples/batch", tokens.AccessToken, api.BiometricBatchRequest{Samples: []api.BiometricSampleDTO{sample, invalid}})
	expect(badBatch, 422)
	var invalidProblem api.ProblemDetail
	if err := json.Unmarshal(badBatch.Body.Bytes(), &invalidProblem); err != nil || invalidProblem.Code != api.ErrInvalidBiometricSample || len(invalidProblem.Errors) != 1 || invalidProblem.Errors[0].Location != "body.samples[1].numericValue" {
		t.Fatalf("invalid batch must identify the offending queue sample: %s", badBatch.Body.String())
	}
	expect(call("POST", "/api/v1/biometrics/samples/batch", tokens.AccessToken, api.BiometricBatchRequest{Samples: []api.BiometricSampleDTO{sample}}), 200)
	replay := call("POST", "/api/v1/biometrics/replay-seed", tokens.AccessToken, api.ReplaySeedRequest{Scenario: "well_rested"})
	expect(replay, 200)
	var replayBody api.ReplaySeedResponse
	json.Unmarshal(replay.Body.Bytes(), &replayBody)
	if replayBody.LatestEnergy.DataFreshness != "replay_demo" {
		t.Fatal("replay not honestly labelled")
	}
	team := call("POST", "/api/v1/workspaces", tokens.AccessToken, api.CreateWorkspaceRequest{Name: "HTTP team"})
	expect(team, 201)
	var workspace api.WorkspaceDTO
	json.Unmarshal(team.Body.Bytes(), &workspace)
	invitee := call("POST", "/api/v1/auth/register", "", api.RegisterRequest{Email: "invitee@example.com", DisplayName: "Invitee", Password: "runtime-password", Timezone: "Asia/Shanghai"})
	expect(invitee, 201)
	var inviteeTokens api.AuthTokensResponse
	if err := json.Unmarshal(invitee.Body.Bytes(), &inviteeTokens); err != nil {
		t.Fatal(err)
	}
	expect(call("POST", "/api/v1/workspaces/join", inviteeTokens.AccessToken, api.JoinWorkspaceRequest{InviteCode: workspace.InviteCode}), 200)
	expect(call("GET", "/api/v1/workspaces", tokens.AccessToken, nil), 200)
	expect(call("GET", fmt.Sprintf("/api/v1/workspaces/%s/members", workspace.ID), tokens.AccessToken, nil), 200)
	teamPath := fmt.Sprintf("/api/v1/workspaces/%s", workspace.ID)
	for _, res := range []*httptest.ResponseRecorder{
		call("GET", teamPath+"/availability?from="+start.Format(time.RFC3339)+"&to="+start.Add(15*24*time.Hour).Format(time.RFC3339), tokens.AccessToken, nil),
		call("POST", teamPath+"/meetings/recommend", tokens.AccessToken, api.RecommendMeetingRequest{Title: "Too far", DurationMinutes: 30, CognitiveLoad: "medium", ParticipantIDs: []uuid.UUID{tokens.User.ID}, SearchFrom: start, SearchTo: start.Add(15 * 24 * time.Hour)}),
	} {
		expect(res, 422)
		var rangeProblem api.ProblemDetail
		if err := json.Unmarshal(res.Body.Bytes(), &rangeProblem); err != nil || rangeProblem.Code != api.ErrRangeTooLarge {
			t.Fatalf("team range over 14 days must return RANGE_TOO_LARGE: %s", res.Body.String())
		}
	}
	expect(call("PATCH", teamPath+"/me", tokens.AccessToken, api.UpdateWorkspaceMemberConfigRequest{PrivacyLevel: "busy_only"}), 200)
	expect(call("GET", teamPath+"/availability?from="+start.Add(-time.Hour).Format(time.RFC3339)+"&to="+start.Add(3*time.Hour).Format(time.RFC3339), tokens.AccessToken, nil), 200)
	expect(call("POST", teamPath+"/meetings/recommend", tokens.AccessToken, api.RecommendMeetingRequest{Title: "HTTP meeting", DurationMinutes: 30, CognitiveLoad: "medium", ParticipantIDs: []uuid.UUID{tokens.User.ID, tokens.User.ID}, OptionalIDs: []uuid.UUID{tokens.User.ID}, SearchFrom: start, SearchTo: start.Add(6 * time.Hour)}), 200)
	meeting := call("POST", teamPath+"/meetings/confirm", tokens.AccessToken, api.ConfirmMeetingRequest{Title: "HTTP meeting", CognitiveLoad: "medium", ParticipantIDs: []uuid.UUID{tokens.User.ID}, StartAt: start.Add(3 * time.Hour), EndAt: start.Add(4 * time.Hour)})
	expect(meeting, 201)
	var confirmed api.ConfirmMeetingResponse
	json.Unmarshal(meeting.Body.Bytes(), &confirmed)
	expect(call("GET", teamPath+"/meetings", tokens.AccessToken, nil), 200)
	proposalPath := teamPath + "/meetings/" + confirmed.Proposal.ID.String()
	expect(call("POST", proposalPath+"/respond", tokens.AccessToken, api.RespondMeetingRequest{ResponseStatus: "declined"}), 200)
	expect(call("POST", proposalPath+"/cancel", tokens.AccessToken, nil), 200)
	day := now.Format("2006-01-02")
	urgent := &api.UrgentTaskDTO{Title: "HTTP rescue", DurationMinutes: 30, CognitiveLoad: "high", DeadlineAt: now.Add(30 * time.Hour)}
	preview := call("POST", "/api/v1/schedule/rescue/options", tokens.AccessToken, api.RescueOptionsRequest{Day: day, TriggerReason: "urgent_task", UrgentTask: urgent})
	expect(preview, 200)
	var options api.RescueOptionsResponse
	json.Unmarshal(preview.Body.Bytes(), &options)
	var chosen *api.RescueOptionPlan
	for i := range options.Options {
		if options.Options[i].Feasible {
			chosen = &options.Options[i]
			break
		}
	}
	if chosen == nil {
		t.Fatal("unconstrained rescue did not provide a feasible option")
	}
	applied := call("POST", "/api/v1/schedule/rescue/apply", tokens.AccessToken, api.RescueApplyRequest{Day: day, TriggerReason: "urgent_task", UrgentTask: urgent, Strategy: chosen.Strategy, BaselineVersion: options.BaselineVersion, ExpectedOptionHash: chosen.OptionHash})
	expect(applied, 200)
	var apply api.RescueApplyResponse
	json.Unmarshal(applied.Body.Bytes(), &apply)
	expect(call("POST", "/api/v1/schedule/rescue/undo", tokens.AccessToken, api.RescueUndoRequest{SnapshotID: apply.SnapshotID}), 200)
	expect(call("GET", "/api/v1/schedule/rescue/history", tokens.AccessToken, nil), 200)
	newName := "Updated runtime"
	expect(call("PATCH", "/api/v1/auth/me", tokens.AccessToken, api.UpdateMeRequest{DisplayName: &newName}), 200)
	expect(call("PUT", "/api/v1/energy/profile", tokens.AccessToken, api.UpdateEnergyProfileRequest{WorkStartMinute: 540, WorkEndMinute: 1080, Chronotype: "balanced", PreferredFocusWindows: []api.DailyMinuteWindow{}, MinRecoveryBufferMin: 15}), 200)
	expect(call("DELETE", "/api/v1/schedule/items/"+item.Item.ID.String(), tokens.AccessToken, nil), 204)
	refreshed := call("POST", "/api/v1/auth/refresh", "", api.RefreshTokenRequest{RefreshToken: tokens.RefreshToken})
	expect(refreshed, 200)
	if err := json.Unmarshal(refreshed.Body.Bytes(), &tokens); err != nil {
		t.Fatal(err)
	}
	expect(call("POST", "/api/v1/auth/logout", tokens.AccessToken, api.LogoutRequest{RefreshToken: tokens.RefreshToken}), 204)
	if len(successfulOperations) != 32 {
		t.Fatalf("expected successful database-backed coverage of all 32 HTTP operations; got %d: %v", len(successfulOperations), successfulOperations)
	}
}
