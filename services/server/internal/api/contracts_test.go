package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/shixu-app/server/internal/api"
)

type stubAuthAndCancelHandlers struct {
	api.Handlers
	refreshCookieSeen string
}

func (s *stubAuthAndCancelHandlers) RefreshTokens(_ context.Context, in *api.RefreshInput) (*api.AuthTokensOutput, error) {
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
		},
	}, nil
}

func TestRegisterContractRoutes_EmptyBodyRefreshWithCookie(t *testing.T) {
	r := chi.NewRouter()
	humaAPI := humachi.New(r, huma.DefaultConfig("test", "2.0.0"))
	stub := &stubAuthAndCancelHandlers{}
	api.RegisterContractRoutes(humaAPI, stub)

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
