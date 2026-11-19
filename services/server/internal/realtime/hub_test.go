package realtime

import (
	"context"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/auth"
	"github.com/shixu-app/server/internal/testutil"
	"testing"
	"time"
)

func TestPostgresTicketIsHashedAndConsumedExactlyOnce(t *testing.T) {
	pool := testutil.Postgres(t)
	ctx := context.Background()
	id := uuid.New()
	pool.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','hash')", id, id.String()+"@example.com")
	hub := NewHub(pool, []string{"http://localhost:5173"}, 30*time.Second)
	ticket, expires, err := hub.Issue(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if !expires.After(time.Now()) {
		t.Fatal("expired ticket issued")
	}
	var persistedHash string
	if err = pool.QueryRow(ctx, "SELECT token_hash FROM ws_tickets WHERE user_id=$1", id).Scan(&persistedHash); err != nil || persistedHash == ticket || persistedHash != auth.TokenHash(ticket) {
		t.Fatal("websocket ticket must be persisted only as a digest")
	}
	otherInstance := NewHub(pool, []string{"http://localhost:5173"}, 30*time.Second)
	got, err := otherInstance.Consume(ctx, ticket)
	if err != nil || got != id {
		t.Fatalf("ticket rejected: %v", err)
	}
	if _, err = hub.Consume(ctx, ticket); err == nil {
		t.Fatal("consumed ticket reused")
	}
	expired, _, err := hub.Issue(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE ws_tickets SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1", auth.TokenHash(expired)); err != nil {
		t.Fatal(err)
	}
	if _, err = otherInstance.Consume(ctx, expired); err == nil {
		t.Fatal("expired ticket accepted by another API instance")
	}
}
