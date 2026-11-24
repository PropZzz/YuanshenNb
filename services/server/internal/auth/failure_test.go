package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/testutil"
)

func TestLoginPreservesCancelledRequest(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://test@127.0.0.1:1/test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	service := NewService(pool, "test-secret-at-least-thirty-two-bytes", time.Minute, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = service.Login(ctx, "person@example.com", "password-123", "test")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled request must keep its cause, got %v", err)
	}
}

func TestLoginPreservesClosedPoolFailure(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://test@127.0.0.1:1/test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	var ignored int
	want := pool.QueryRow(context.Background(), "SELECT 1").Scan(&ignored)
	service := NewService(pool, "test-secret-at-least-thirty-two-bytes", time.Minute, time.Hour)
	_, err = service.Login(context.Background(), "person@example.com", "password-123", "test")
	if want == nil || !errors.Is(err, want) {
		t.Fatalf("database unavailable is not an invalid password, got %v", err)
	}
}

func TestPostgresMissingCredentialsRemainUnauthorized(t *testing.T) {
	pool := testutil.Postgres(t)
	service := NewService(pool, "test-secret-at-least-thirty-two-bytes", time.Minute, time.Hour)
	ctx := context.Background()
	if _, err := service.Login(ctx, "missing@example.com", "password-123", "test"); !errors.Is(err, ErrCredentials) {
		t.Fatalf("missing account must remain invalid credentials, got %v", err)
	}
	for _, token := range []string{"", "unknown-token"} {
		if _, err := service.Refresh(ctx, token, "test"); !errors.Is(err, ErrRefresh) {
			t.Fatalf("missing token must remain invalid refresh, got %v", err)
		}
	}
}

func TestPostgresRefreshPreservesQueryFailureAndRollsBack(t *testing.T) {
	for _, column := range []string{"token_hash", "family_id"} {
		t.Run(column, func(t *testing.T) {
			pool := testutil.Postgres(t)
			ctx := context.Background()
			service := NewService(pool, "test-secret-at-least-thirty-two-bytes", time.Minute, time.Hour)
			registered, err := service.Register(ctx, "person@example.com", "Person", "password-123", "UTC", "test")
			if err != nil {
				t.Fatal(err)
			}
			// Break either the initial lookup or the locked lookup in this test's isolated schema.
			if _, err = pool.Exec(ctx, "ALTER TABLE refresh_tokens RENAME COLUMN "+column+" TO unavailable_column"); err != nil {
				t.Fatal(err)
			}
			_, err = service.Refresh(ctx, registered.RefreshToken, "test")
			var databaseError *pgconn.PgError
			if !errors.As(err, &databaseError) || databaseError.Code != "42703" {
				t.Fatalf("query failure must remain diagnostic instead of invalid token, got %v", err)
			}
			if _, err = pool.Exec(ctx, "ALTER TABLE refresh_tokens RENAME COLUMN unavailable_column TO "+column); err != nil {
				t.Fatal(err)
			}
			var total, revoked int
			if err = pool.QueryRow(ctx, "SELECT count(*),count(revoked_at) FROM refresh_tokens WHERE user_id=$1", registered.User.ID).Scan(&total, &revoked); err != nil {
				t.Fatal(err)
			}
			if total != 1 || revoked != 0 {
				t.Fatalf("failed refresh changed session state: total=%d revoked=%d", total, revoked)
			}
			if _, err = service.Refresh(ctx, registered.RefreshToken, "retry"); err != nil {
				t.Fatalf("session must be retryable after database recovery: %v", err)
			}
		})
	}
}
