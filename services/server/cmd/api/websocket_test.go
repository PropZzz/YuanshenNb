package main

import (
	"bytes"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/testutil"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPostgresWebSocketTicketReplayAndCommittedScheduleEvent(t *testing.T) {
	pool := testutil.Postgres(t)
	cfg := config.Load()
	router := NewRouter(cfg, newRuntimeDeps(cfg, pool))
	server := httptest.NewServer(router)
	defer server.Close()
	request := func(path, token string, body any) *http.Response {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", server.URL+"/api/v1"+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	registration := request("/auth/register", "", api.RegisterRequest{Email: "ws@example.com", DisplayName: "Socket", Password: "runtime-password", Timezone: "UTC"})
	var tokens api.AuthTokensResponse
	json.NewDecoder(registration.Body).Decode(&tokens)
	registration.Body.Close()
	if registration.StatusCode != 201 {
		t.Fatal("registration failed")
	}
	ticketResponse := request("/auth/ws-ticket", tokens.AccessToken, map[string]any{})
	var ticket api.WsTicketResponse
	json.NewDecoder(ticketResponse.Body).Decode(&ticket)
	ticketResponse.Body.Close()
	if ticketResponse.StatusCode != 200 {
		t.Fatal("ticket issuance failed")
	}
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/ws?ticket=" + ticket.Ticket
	header := http.Header{"Origin": []string{"http://localhost:5173"}}
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if duplicate, response, e := websocket.DefaultDialer.Dial(url, header); e == nil {
		duplicate.Close()
		t.Fatal("one-time ticket was reused")
	} else if response == nil || response.StatusCode != 401 {
		t.Fatal("ticket replay must return 401")
	}
	start := time.Now().UTC().Add(24 * time.Hour)
	mutation := request("/schedule/items", tokens.AccessToken, api.CreateScheduleItemRequest{Title: "Socket task", Category: "routine", CognitiveLoad: "low", Flexibility: "flexible", StartAt: start, EndAt: start.Add(time.Hour)})
	mutation.Body.Close()
	if mutation.StatusCode != 201 {
		t.Fatal("schedule create failed")
	}
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for range 6 {
		var event api.WsEnvelope
		if err = conn.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == api.WsScheduleUpdated {
			if event.Version != 1 || event.EventID == uuid.Nil {
				t.Fatal("invalid event envelope")
			}
			return
		}
	}
	t.Fatal("committed schedule change was not delivered")
}
