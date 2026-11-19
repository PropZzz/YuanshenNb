// Package realtime delivers committed events to authenticated connections.
package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/auth"
)

type Hub struct {
	pool    *pgxpool.Pool
	origins []string
	ttl     time.Duration
	mu      sync.RWMutex
	clients map[uuid.UUID]map[chan []byte]struct{}
}

func NewHub(pool *pgxpool.Pool, origins []string, ttl time.Duration) *Hub {
	return &Hub{pool: pool, origins: origins, ttl: ttl, clients: make(map[uuid.UUID]map[chan []byte]struct{})}
}
func (h *Hub) Issue(ctx context.Context, id uuid.UUID) (string, time.Time, error) {
	token, err := auth.RandomToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expires := time.Now().UTC().Add(h.ttl)
	_, err = h.pool.Exec(ctx, "WITH expired AS (DELETE FROM ws_tickets WHERE expires_at<NOW()) INSERT INTO ws_tickets(token_hash,user_id,expires_at) VALUES($1,$2,$3)", auth.TokenHash(token), id, expires)
	return token, expires, err
}
func (h *Hub) Consume(ctx context.Context, token string) (uuid.UUID, error) {
	var id uuid.UUID
	if token == "" {
		return id, errors.New("invalid ticket")
	}
	err := h.pool.QueryRow(ctx, "DELETE FROM ws_tickets WHERE token_hash=$1 AND expires_at>NOW() RETURNING user_id", auth.TokenHash(token)).Scan(&id)
	return id, err
}
func (h *Hub) Publish(ids []uuid.UUID, value any) {
	raw, err := json.Marshal(value)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		for ch := range h.clients[id] {
			select {
			case ch <- raw:
			default:
			}
		}
	}
}
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" && !slices.Contains(h.origins, origin) {
		writeProblem(w, http.StatusForbidden, api.ErrForbidden, "websocket origin is not allowed")
		return
	}
	id, err := h.Consume(r.Context(), r.URL.Query().Get("ticket"))
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, api.ErrInvalidWSTicket, "websocket ticket is missing, expired or already used")
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }, HandshakeTimeout: 5 * time.Second}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	ch := make(chan []byte, 32)
	h.mu.Lock()
	if h.clients[id] == nil {
		h.clients[id] = map[chan []byte]struct{}{}
	}
	h.clients[id][ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients[id], ch)
		if len(h.clients[id]) == 0 {
			delete(h.clients, id)
		}
		h.mu.Unlock()
	}()
	done := make(chan struct{})
	pongs := make(chan string, 1)
	conn.SetReadLimit(4096)
	conn.SetPongHandler(func(payload string) error {
		select {
		case pongs <- payload:
		default:
		}
		return nil
	})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	pongTimer := time.NewTimer(10 * time.Second)
	pongTimer.Stop()
	defer pongTimer.Stop()
	var pongDeadline <-chan time.Time
	var pendingPing string
	for {
		select {
		case raw := <-ch:
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if conn.WriteMessage(websocket.TextMessage, raw) != nil {
				return
			}
		case <-ticker.C:
			pendingPing = strconv.FormatInt(time.Now().UnixNano(), 10)
			if conn.WriteControl(websocket.PingMessage, []byte(pendingPing), time.Now().Add(5*time.Second)) != nil {
				return
			}
			pongTimer.Reset(10 * time.Second)
			pongDeadline = pongTimer.C
		case payload := <-pongs:
			if payload == pendingPing {
				pongTimer.Stop()
				pongDeadline = nil
			}
		case <-pongDeadline:
			return
		case <-done:
			return
		case <-r.Context().Done():
			return
		}
	}
}

func writeProblem(w http.ResponseWriter, status int, code api.ErrorCode, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(api.NewProblem(status, code, detail))
}
