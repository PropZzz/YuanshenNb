package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/testutil"
)

func TestPostgresAuthDatabaseFailureIsNotInvalidCredentials(t *testing.T) {
	for _, test := range []struct{ name, table, column, path string }{
		{"login", "users", "password_hash", "/api/v1/auth/login"},
		{"refresh_lookup", "refresh_tokens", "token_hash", "/api/v1/auth/refresh"},
		{"refresh_locked_lookup", "refresh_tokens", "family_id", "/api/v1/auth/refresh"},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := testutil.Postgres(t)
			cfg := config.Load()
			router := NewRouter(cfg, newRuntimeDeps(cfg, pool))
			call := func(path string, body any) *httptest.ResponseRecorder {
				t.Helper()
				data, err := json.Marshal(body)
				if err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data))
				request.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				return response
			}
			registered := call("/api/v1/auth/register", map[string]string{
				"email": "failure@example.com", "displayName": "Failure", "password": "password-123", "timezone": "UTC",
			})
			if registered.Code != 201 {
				t.Fatalf("register returned %d", registered.Code)
			}
			var tokens api.AuthTokensResponse
			if err := json.Unmarshal(registered.Body.Bytes(), &tokens); err != nil {
				t.Fatal(err)
			}
			body := map[string]string{"email": "failure@example.com", "password": "password-123"}
			if test.table == "refresh_tokens" {
				body = map[string]string{"refreshToken": tokens.RefreshToken}
			}
			ctx := context.Background()
			if _, err := pool.Exec(ctx, "ALTER TABLE "+test.table+" RENAME COLUMN "+test.column+" TO unavailable_column"); err != nil {
				t.Fatal(err)
			}
			failed := call(test.path, body)
			var problem api.ProblemDetail
			if err := json.Unmarshal(failed.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if failed.Code != 500 || problem.Code != api.ErrInternalServer {
				t.Fatalf("database failure must be 500 INTERNAL_SERVER_ERROR, got %d %s", failed.Code, problem.Code)
			}
			if !strings.HasPrefix(failed.Header().Get("Content-Type"), "application/problem+json") {
				t.Fatal("error must use the existing RFC 9457 contract")
			}
			if len(failed.Header().Values("Set-Cookie")) != 0 || strings.Contains(failed.Body.String(), "unavailable_column") {
				t.Fatal("failure must not replace session cookies or expose SQL diagnostics")
			}
			if _, err := pool.Exec(ctx, "ALTER TABLE "+test.table+" RENAME COLUMN unavailable_column TO "+test.column); err != nil {
				t.Fatal(err)
			}
			if recovered := call(test.path, body); recovered.Code != 200 {
				t.Fatalf("session must remain retryable after recovery: %d", recovered.Code)
			}
			invalid := call("/api/v1/auth/login", map[string]string{"email": "missing@example.com", "password": "password-123"})
			if invalid.Code != 401 {
				t.Fatalf("actual invalid credentials must remain 401: %d", invalid.Code)
			}
			invalidRefresh := call("/api/v1/auth/refresh", map[string]string{"refreshToken": "unknown-token"})
			var invalidProblem api.ProblemDetail
			if err := json.Unmarshal(invalidRefresh.Body.Bytes(), &invalidProblem); err != nil {
				t.Fatal(err)
			}
			if invalidRefresh.Code != 401 || invalidProblem.Code != api.ErrInvalidRefreshToken {
				t.Fatalf("actual unknown refresh must remain 401 INVALID_REFRESH_TOKEN: %d %s", invalidRefresh.Code, invalidProblem.Code)
			}
		})
	}
}
