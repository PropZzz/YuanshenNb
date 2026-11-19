package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
		CORSAllowedOrigins: []string{"http://localhost:5173"},
	}

	t.Run("db up returns 200", func(t *testing.T) {
		router := NewRouter(cfg, stubPinger{})
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
		if !body.OK || body.DBStatus != "up" {
			t.Fatalf("expected ok=true dbStatus=up, got %+v", body)
		}
	})

	t.Run("db down returns 503", func(t *testing.T) {
		router := NewRouter(cfg, stubPinger{err: errors.New("dial refused")})
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d: %s", rec.Code, rec.Body.String())
		}
		var body api.HealthResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if body.OK || body.DBStatus != "down" {
			t.Fatalf("expected ok=false dbStatus=down, got %+v", body)
		}
	})

	t.Run("allowed origin preflight", func(t *testing.T) {
		router := NewRouter(cfg, stubPinger{})
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
	})
}
