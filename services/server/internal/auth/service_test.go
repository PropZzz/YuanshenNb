package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shixu-app/server/internal/testutil"
)

func TestPostgresRegistrationLoginAndRefreshReuseRevokesFamily(t *testing.T) {
	pool := testutil.Postgres(t)
	s := NewService(pool, "a-secret-with-at-least-thirty-two-bytes", 15*time.Minute, 14*24*time.Hour)
	ctx := context.Background()
	registered, err := s.Register(ctx, "  PERSON@example.com  ", "Person", "password-123", "Asia/Shanghai", "test")
	if err != nil {
		t.Fatal(err)
	}
	if registered.User.Email != "person@example.com" {
		t.Fatal("email not normalized")
	}
	var hash string
	if err = pool.QueryRow(ctx, "SELECT password_hash FROM users WHERE id=$1", registered.User.ID).Scan(&hash); err != nil || hash == "password-123" {
		t.Fatal("password not stored securely")
	}
	var profileCount int
	pool.QueryRow(ctx, "SELECT count(*) FROM energy_profiles WHERE user_id=$1", registered.User.ID).Scan(&profileCount)
	if profileCount != 1 {
		t.Fatal("default profile not created atomically")
	}
	if _, err = s.Register(ctx, "person@example.com", "Other", "password-123", "Asia/Shanghai", ""); !errors.Is(err, ErrEmailExists) {
		t.Fatalf("duplicate email result: %v", err)
	}
	if _, err = s.Login(ctx, "person@example.com", "incorrect-password", ""); !errors.Is(err, ErrCredentials) {
		t.Fatal("invalid login accepted")
	}
	first, err := s.Login(ctx, "PERSON@example.com", "password-123", "")
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := s.Refresh(ctx, first.RefreshToken, "")
	if err != nil || rotated.RefreshToken == first.RefreshToken {
		t.Fatalf("rotation failed: %v", err)
	}
	if _, err = s.Refresh(ctx, first.RefreshToken, ""); !errors.Is(err, ErrTokenReuse) {
		t.Fatalf("expected reuse detection: %v", err)
	}
	if _, err = s.Refresh(ctx, rotated.RefreshToken, ""); !errors.Is(err, ErrTokenReuse) {
		t.Fatalf("family token survived reuse detection: %v", err)
	}
	var plaintextCount int
	pool.QueryRow(ctx, "SELECT count(*) FROM refresh_tokens WHERE token_hash=$1", first.RefreshToken).Scan(&plaintextCount)
	if plaintextCount != 0 {
		t.Fatal("plaintext refresh token persisted")
	}
}

func TestPostgresLogoutCannotRevokeAnotherUsersToken(t *testing.T) {
	pool := testutil.Postgres(t)
	s := NewService(pool, "a-secret-with-at-least-thirty-two-bytes", 15*time.Minute, 14*24*time.Hour)
	ctx := context.Background()
	a, _ := s.Register(ctx, "a@example.com", "A", "password-123", "UTC", "")
	b, _ := s.Register(ctx, "b@example.com", "B", "password-123", "UTC", "")
	if err := s.Logout(ctx, a.User.ID, b.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(ctx, b.RefreshToken, ""); err != nil {
		t.Fatal("cross-tenant logout revoked token")
	}
}
