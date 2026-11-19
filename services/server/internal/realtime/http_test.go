package realtime

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shixu-app/server/internal/api"
)

func TestHandshakeRejectionsUseProblemDetails(t *testing.T) {
	hub := NewHub(nil, []string{"http://localhost:5173"}, 30*time.Second)
	for _, tc := range []struct {
		name, origin string
		status       int
		code         api.ErrorCode
	}{
		{"missing ticket", "http://localhost:5173", 401, api.ErrInvalidWSTicket},
		{"native client missing ticket", "", 401, api.ErrInvalidWSTicket},
		{"untrusted origin", "https://untrusted.example", 403, api.ErrForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/v1/ws", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			res := httptest.NewRecorder()
			hub.ServeHTTP(res, req)
			var problem api.ProblemDetail
			if err := json.Unmarshal(res.Body.Bytes(), &problem); err != nil {
				t.Fatalf("handshake rejection is not JSON: %s", res.Body.String())
			}
			if res.Code != tc.status || problem.Status != tc.status || problem.Code != tc.code || res.Header().Get("Content-Type") != "application/problem+json" {
				t.Fatalf("incorrect handshake problem: status=%d body=%+v", res.Code, problem)
			}
		})
	}
}
