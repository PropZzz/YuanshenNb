package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/config"
)

type stubPinger struct {
	err error
}

func (s stubPinger) Ping(context.Context) error {
	return s.err
}

func TestHealthEndpoint_UpAndDown(t *testing.T) {
	cfg := config.Config{
		CORSAllowedOrigins:  []string{"http://localhost:5173"},
		MaxRequestBodyBytes: 2 << 20,
	}

	t.Run("db up returns 200", func(t *testing.T) {
		router := NewRouter(cfg, RouterDeps{Pinger: stubPinger{}})
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var body api.HealthResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if !body.OK || body.DBStatus != api.DBStatusUp {
			t.Fatalf("expected ok=true dbStatus=up, got %+v", body)
		}
	})

	t.Run("db down returns 503 ProblemDetail", func(t *testing.T) {
		router := NewRouter(cfg, RouterDeps{Pinger: stubPinger{err: errors.New("dial refused")}})
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d: %s", rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
			t.Fatalf("expected application/problem+json, got %q", ct)
		}
		var pd api.ProblemDetail
		if err := json.Unmarshal(rec.Body.Bytes(), &pd); err != nil {
			t.Fatalf("unmarshal ProblemDetail: %v", err)
		}
		if pd.Code != api.ErrServiceUnavailable || pd.Status != http.StatusServiceUnavailable {
			t.Fatalf("expected SERVICE_UNAVAILABLE 503 ProblemDetail, got %+v", pd)
		}
	})

	t.Run("allowed origin preflight and non-matching Vary", func(t *testing.T) {
		router := NewRouter(cfg, RouterDeps{Pinger: stubPinger{}})

		req := httptest.NewRequest(http.MethodOptions, "/api/v1/health", nil)
		req.Header.Set("Origin", "http://localhost:5173")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d", rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Fatalf("expected Access-Control-Allow-Credentials=true, got %q", got)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
			t.Fatalf("expected Access-Control-Allow-Origin=http://localhost:5173, got %q", got)
		}
		if !slices.Contains(rec.Header().Values("Vary"), "Origin") {
			t.Fatalf("expected Vary: Origin on preflight response")
		}

		reqOther := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		reqOther.Header.Set("Origin", "https://evil.example")
		recOther := httptest.NewRecorder()
		router.ServeHTTP(recOther, reqOther)
		if !slices.Contains(recOther.Header().Values("Vary"), "Origin") {
			t.Fatalf("expected Vary: Origin even on non-matching origin")
		}
		if got := recOther.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Fatalf("unexpected Allow-Origin for non-matching origin: %q", got)
		}
	})
}
