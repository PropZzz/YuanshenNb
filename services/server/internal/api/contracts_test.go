package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
)

type stubAuthHandlers struct {
	refreshCookieSeen string
	meCalls           int
}

func (s *stubAuthHandlers) RegisterUser(context.Context, *api.RegisterInput) (*api.AuthTokensOutput, error) {
	return &api.AuthTokensOutput{Status: http.StatusCreated}, nil
}

func (s *stubAuthHandlers) LoginUser(context.Context, *api.LoginInput) (*api.AuthTokensOutput, error) {
	return &api.AuthTokensOutput{Status: http.StatusOK}, nil
}

func (s *stubAuthHandlers) RefreshTokens(_ context.Context, in *api.RefreshInput) (*api.AuthTokensOutput, error) {
	s.refreshCookieSeen = in.RefreshCookie
	if in.RefreshCookie == "" && (in.Body == nil || in.Body.RefreshToken == "") {
		return nil, api.NewProblem(http.StatusUnauthorized, api.ErrInvalidRefreshToken, "missing refresh token")
	}
	return &api.AuthTokensOutput{
		Status: http.StatusOK,
		Body: api.AuthTokensResponse{
			AccessToken:      "access-demo",
			RefreshToken:     "refresh-demo",
			ExpiresInSeconds: 900,
			User: api.UserProfile{
				ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
				Email:       "dev@shixu.app",
				DisplayName: "测试成员",
				Timezone:    "Asia/Shanghai",
				ThemeMode:   api.ThemeSystem,
			},
		},
	}, nil
}

func (s *stubAuthHandlers) LogoutUser(context.Context, *api.LogoutInput) (*api.LogoutOutput, error) {
	return &api.LogoutOutput{Status: http.StatusNoContent}, nil
}

func (s *stubAuthHandlers) GetCurrentUser(context.Context, *struct{}) (*api.UserProfileOutput, error) {
	s.meCalls++
	return &api.UserProfileOutput{
		Body: api.UserProfile{
			ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			Email:       "dev@shixu.app",
			DisplayName: "测试成员",
			Timezone:    "Asia/Shanghai",
			ThemeMode:   api.ThemeDark,
		},
	}, nil
}

func (s *stubAuthHandlers) UpdateCurrentUser(context.Context, *api.UpdateMeInput) (*api.UserProfileOutput, error) {
	return &api.UserProfileOutput{}, nil
}

func (s *stubAuthHandlers) IssueWsTicket(context.Context, *struct{}) (*api.WsTicketOutput, error) {
	return &api.WsTicketOutput{}, nil
}

type stubWorkspacesHandlers struct {
	api.WorkspacesHandlers
	memberIDsSeen []uuid.UUID
}

func (s *stubWorkspacesHandlers) GetWorkspaceAvailability(_ context.Context, in *api.WorkspaceAvailabilityInput) (*api.WorkspaceAvailabilityOutput, error) {
	ids, err := in.ParsedMemberIDs()
	if err != nil {
		return nil, api.NewProblem(http.StatusUnprocessableEntity, api.ErrValidationFailed, err.Error())
	}
	s.memberIDsSeen = ids
	return &api.WorkspaceAvailabilityOutput{
		Body: api.WorkspaceAvailabilityResponse{
			WorkspaceID: in.ID,
			From:        in.From,
			To:          in.To,
			Members:     []api.MemberAvailabilityView{},
		},
	}, nil
}

type stubScheduleHandlers struct {
	api.ScheduleHandlers
	lastPatch *api.UpdateScheduleItemRequest
}

func (s *stubScheduleHandlers) UpdateScheduleItem(_ context.Context, in *api.UpdateScheduleItemInput) (*api.ScheduleMutationOutput, error) {
	cp := in.Body
	s.lastPatch = &cp
	return &api.ScheduleMutationOutput{
		Status: http.StatusOK,
		Body: api.ScheduleMutationResponse{
			Item: api.ScheduleItemDTO{
				ID:              in.ID,
				UserID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
				Title:           "已更新任务",
				Notes:           "",
				Category:        api.CategoryDeepWork,
				CognitiveLoad:   api.LoadHigh,
				Flexibility:     api.FlexibilityFlexible,
				Status:          api.StatusPlanned,
				StartAt:         time.Date(2026, 11, 19, 1, 0, 0, 0, time.UTC),
				EndAt:           time.Date(2026, 11, 19, 2, 0, 0, 0, time.UTC),
				DurationMinutes: 60,
			},
			BaselineLocalDay: "2026-11-19",
			BaselineVersion:  "empty:2026-11-19",
		},
	}, nil
}

func TestRegisterContractRoutes_EmptyBodyRefreshWithCookie(t *testing.T) {
	r := chi.NewRouter()
	humaAPI := humachi.New(r, api.NewHumaConfig("2.0.0"))
	stub := &stubAuthHandlers{}
	api.RegisterContractRoutes(humaAPI, api.RouteHandlers{Auth: stub}, api.RouteOptions{})

	// 1. 无 Body 仅靠 Cookie 调用 /api/v1/auth/refresh 不得被 Huma 拦截为 422
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "rc_refresh_token", Value: "cookie-tok-123"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for cookie-only refresh without body, got %d: %s", rec.Code, rec.Body.String())
	}
	if stub.refreshCookieSeen != "cookie-tok-123" {
		t.Fatalf("expected cookie token 'cookie-tok-123', got %q", stub.refreshCookieSeen)
	}

	// 2. 缺失 Cookie 与 Body 时应返回 RFC 9457 application/problem+json 且携带 ErrInvalidRefreshToken
	reqMissing := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", strings.NewReader("{}"))
	reqMissing.Header.Set("Content-Type", "application/json")
	recMissing := httptest.NewRecorder()
	r.ServeHTTP(recMissing, reqMissing)

	if recMissing.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", recMissing.Code, recMissing.Body.String())
	}
	if ct := recMissing.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
		t.Fatalf("expected application/problem+json, got %q", ct)
	}
	var pd api.ProblemDetail
	if err := json.Unmarshal(recMissing.Body.Bytes(), &pd); err != nil {
		t.Fatalf("unmarshal ProblemDetail: %v", err)
	}
	if pd.Code != api.ErrInvalidRefreshToken {
		t.Fatalf("expected code %q, got %q", api.ErrInvalidRefreshToken, pd.Code)
	}
}

func TestWorkspaceAvailability_MemberIDsQueryParsing(t *testing.T) {
	r := chi.NewRouter()
	humaAPI := humachi.New(r, api.NewHumaConfig("2.0.0"))
	wsStub := &stubWorkspacesHandlers{}
	api.RegisterContractRoutes(humaAPI, api.RouteHandlers{Workspaces: wsStub}, api.RouteOptions{})

	wsID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	u1 := "11111111-1111-1111-1111-111111111111"
	u2 := "22222222-2222-2222-2222-222222222222"

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/workspaces/"+wsID+"/availability?from=2026-11-19T00:00:00Z&to=2026-11-20T00:00:00Z&memberIds="+u1+","+u2,
		nil,
	)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wsStub.memberIDsSeen) != 2 || wsStub.memberIDsSeen[0].String() != u1 || wsStub.memberIDsSeen[1].String() != u2 {
		t.Fatalf("expected parsed memberIds [%s %s], got %+v", u1, u2, wsStub.memberIDsSeen)
	}

	reqBad := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/workspaces/"+wsID+"/availability?from=2026-11-19T00:00:00Z&to=2026-11-20T00:00:00Z&memberIds=not-a-uuid",
		nil,
	)
	recBad := httptest.NewRecorder()
	r.ServeHTTP(recBad, reqBad)
	if recBad.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid memberIds, got %d: %s", recBad.Code, recBad.Body.String())
	}
	var pd api.ProblemDetail
	if err := json.Unmarshal(recBad.Body.Bytes(), &pd); err != nil {
		t.Fatalf("unmarshal ProblemDetail: %v", err)
	}
	if pd.Code != api.ErrValidationFailed {
		t.Fatalf("expected VALIDATION_FAILED, got %q", pd.Code)
	}
}

func TestUpdateScheduleItem_NullableDeadlineVariants(t *testing.T) {
	r := chi.NewRouter()
	humaAPI := humachi.New(r, api.NewHumaConfig("2.0.0"))
	schedStub := &stubScheduleHandlers{}
	api.RegisterContractRoutes(humaAPI, api.RouteHandlers{Schedule: schedStub}, api.RouteOptions{})

	itemID := "33333333-3333-3333-3333-333333333333"
	patch := func(body string) {
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/schedule/items/"+itemID, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("PATCH %s failed with %d: %s", body, rec.Code, rec.Body.String())
		}
	}

	// 1. 省略 deadlineAt
	patch(`{"title":"只改标题"}`)
	if schedStub.lastPatch.DeadlineAt.Set || schedStub.lastPatch.ShouldClearDeadline() {
		t.Fatalf("expected DeadlineAt unset and ShouldClearDeadline=false, got %+v", schedStub.lastPatch.DeadlineAt)
	}

	// 2. 显式传 null
	patch(`{"deadlineAt":null}`)
	if !schedStub.lastPatch.DeadlineAt.Set || schedStub.lastPatch.DeadlineAt.Valid || !schedStub.lastPatch.ShouldClearDeadline() {
		t.Fatalf("expected DeadlineAt Set=true Valid=false ShouldClearDeadline=true, got %+v", schedStub.lastPatch.DeadlineAt)
	}

	// 3. 传有效 RFC3339 时间
	patch(`{"deadlineAt":"2026-11-20T09:30:00Z"}`)
	if !schedStub.lastPatch.DeadlineAt.Set || !schedStub.lastPatch.DeadlineAt.Valid || schedStub.lastPatch.ShouldClearDeadline() {
		t.Fatalf("expected DeadlineAt Set=true Valid=true ShouldClearDeadline=false, got %+v", schedStub.lastPatch.DeadlineAt)
	}
	if !schedStub.lastPatch.DeadlineAt.Value.Equal(time.Date(2026, 11, 20, 9, 30, 0, 0, time.UTC)) {
		t.Fatalf("unexpected parsed deadlineAt: %v", schedStub.lastPatch.DeadlineAt.Value)
	}

	// 4. clearDeadline: true
	patch(`{"clearDeadline":true}`)
	if !schedStub.lastPatch.ShouldClearDeadline() {
		t.Fatalf("expected ShouldClearDeadline=true when clearDeadline=true")
	}
}

func TestProtectedGroup_AuthMiddlewareIsolation(t *testing.T) {
	r := chi.NewRouter()
	humaAPI := humachi.New(r, api.NewHumaConfig("2.0.0"))
	authStub := &stubAuthHandlers{}
	middlewareCalls := 0

	api.RegisterContractRoutes(humaAPI, api.RouteHandlers{Auth: authStub}, api.RouteOptions{
		AuthMiddleware: func(ctx huma.Context, next func(huma.Context)) {
			middlewareCalls++
			if ctx.Header("Authorization") == "" {
				_ = huma.WriteErr(humaAPI, ctx, http.StatusUnauthorized, "missing bearer token")
				return
			}
			next(ctx)
		},
	})

	// 1. 公开端点 /auth/login 不触发 AuthMiddleware
	reqLogin := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@b.com","password":"password123"}`))
	reqLogin.Header.Set("Content-Type", "application/json")
	recLogin := httptest.NewRecorder()
	r.ServeHTTP(recLogin, reqLogin)
	if recLogin.Code != http.StatusOK || middlewareCalls != 0 {
		t.Fatalf("expected login 200 with 0 auth middleware calls, got code=%d calls=%d", recLogin.Code, middlewareCalls)
	}

	// 2. 受保护端点 /auth/me 缺失 Bearer 被拦截为 401 ProblemDetail
	reqUnauth := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	recUnauth := httptest.NewRecorder()
	r.ServeHTTP(recUnauth, reqUnauth)
	if recUnauth.Code != http.StatusUnauthorized || middlewareCalls != 1 || authStub.meCalls != 0 {
		t.Fatalf("expected 401 intercepted before handler, got code=%d mwCalls=%d meCalls=%d", recUnauth.Code, middlewareCalls, authStub.meCalls)
	}

	// 3. 携带 Bearer 放行进入 handler
	reqAuthed := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	reqAuthed.Header.Set("Authorization", "Bearer valid-jwt")
	recAuthed := httptest.NewRecorder()
	r.ServeHTTP(recAuthed, reqAuthed)
	if recAuthed.Code != http.StatusOK || authStub.meCalls != 1 {
		t.Fatalf("expected 200 and meCalls=1, got code=%d meCalls=%d", recAuthed.Code, authStub.meCalls)
	}

	// 4. 未注册的领域模块在生产模式下不暴露 501 占位路由
	reqUnregistered := httptest.NewRequest(http.MethodGet, "/api/v1/energy/today", nil)
	recUnregistered := httptest.NewRecorder()
	r.ServeHTTP(recUnregistered, reqUnregistered)
	if recUnregistered.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when energy module is nil and AllowUnimplementedStubs=false, got %d", recUnregistered.Code)
	}
}

func TestDefaultErrorCodeForStatus_Mappings(t *testing.T) {
	cases := []struct {
		status int
		want   api.ErrorCode
	}{
		{http.StatusBadRequest, api.ErrBadRequest},
		{http.StatusUnauthorized, api.ErrUnauthorized},
		{http.StatusForbidden, api.ErrForbidden},
		{http.StatusNotFound, api.ErrNotFound},
		{http.StatusMethodNotAllowed, api.ErrMethodNotAllowed},
		{http.StatusConflict, api.ErrConflict},
		{http.StatusUnprocessableEntity, api.ErrValidationFailed},
		{http.StatusTooManyRequests, api.ErrTooManyRequests},
		{http.StatusInternalServerError, api.ErrInternalServer},
		{http.StatusServiceUnavailable, api.ErrServiceUnavailable},
	}
	for _, tc := range cases {
		if got := api.DefaultErrorCodeForStatus(tc.status); got != tc.want {
			t.Errorf("status %d: expected %q, got %q", tc.status, tc.want, got)
		}
	}
}

func TestNewWsEnvelope_VersionedEnvelope(t *testing.T) {
	env, err := api.NewWsEnvelope(api.WsEnergyUpdatedPayload{
		UserID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		LocalDay:      "2026-11-19",
		Score:         86,
		Tier:          api.TierPeak,
		DataFreshness: api.FreshnessLiveWearable,
		ComputedAt:    time.Date(2026, 11, 19, 2, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("NewWsEnvelope error: %v", err)
	}
	if env.Version != 1 || env.Type != api.WsEnergyUpdated {
		t.Fatalf("unexpected envelope header: %+v", env)
	}

	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if decoded["version"] != float64(1) || decoded["type"] != string(api.WsEnergyUpdated) {
		t.Fatalf("unexpected encoded envelope: %s", string(raw))
	}
}

func TestOpenAPIExportInvariants(t *testing.T) {
	r := chi.NewRouter()
	humaAPI := humachi.New(r, api.NewHumaConfig("2.0.0"))
	api.RegisterContractRoutes(humaAPI, api.RouteHandlers{}, api.RouteOptions{AllowUnimplementedStubs: true})
	api.RegisterExtraSchemas(humaAPI.OpenAPI())

	raw, err := json.Marshal(humaAPI.OpenAPI())
	if err != nil {
		t.Fatalf("marshal openapi: %v", err)
	}
	specText := string(raw)

	if strings.Contains(specText, `"$schema"`) {
		t.Fatalf("openapi spec must not contain $schema property")
	}
	if strings.Contains(specText, `["array","null"]`) {
		t.Fatalf("openapi spec must not contain nullable arrays")
	}

	var doc struct {
		Paths      map[string]map[string]json.RawMessage `json:"paths"`
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("unmarshal spec: %v", err)
	}

	opCount := 0
	for _, methods := range doc.Paths {
		for m := range methods {
			switch m {
			case "get", "post", "put", "patch", "delete":
				opCount++
			}
		}
	}
	if opCount != 32 {
		t.Fatalf("expected 32 REST operations, got %d", opCount)
	}

	for _, enumSchema := range []string{"CognitiveLoad", "EnergyTier", "ErrorCode", "PrivacyLevel", "WsEventType"} {
		if _, ok := doc.Components.Schemas[enumSchema]; !ok {
			t.Fatalf("expected shared enum schema %q in components.schemas", enumSchema)
		}
	}
}
