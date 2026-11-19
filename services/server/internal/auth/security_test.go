package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPasswordHashUsesArgon2idAndRandomSalt(t *testing.T) {
	first, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	second, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if first == second || !strings.HasPrefix(first, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Fatal("password hashes must use salted Argon2id security parameters")
	}
	if !VerifyPassword(first, "correct horse battery staple") || VerifyPassword(first, "wrong password") || VerifyPassword("malformed", "anything") {
		t.Fatal("password verification accepted an invalid credential")
	}
}

func TestAccessTokenExpiresAndRejectsTampering(t *testing.T) {
	now := time.Date(2026, 11, 19, 0, 0, 0, 0, time.UTC)
	id := uuid.New()
	token, err := SignAccessToken(id, "a-secret-with-at-least-thirty-two-bytes", now, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	got, err := VerifyAccessToken(token, "a-secret-with-at-least-thirty-two-bytes", now.Add(14*time.Minute))
	if err != nil || got != id {
		t.Fatalf("valid token rejected: %v", err)
	}
	if _, err = VerifyAccessToken(token, "wrong-secret", now); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("wrong signing key accepted")
	}
	if _, err = VerifyAccessToken(token, "a-secret-with-at-least-thirty-two-bytes", now.Add(15*time.Minute)); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("expired token accepted")
	}
	if _, err = VerifyAccessToken(token+"x", "a-secret-with-at-least-thirty-two-bytes", now); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("tampered signature accepted")
	}
}

func TestRefreshHashAndPrincipal(t *testing.T) {
	a, err := RandomToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := RandomToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b || len(a) < 43 || len(TokenHash(a)) != 64 || strings.Contains(TokenHash(a), a) {
		t.Fatal("refresh token must have unique entropy and SHA-256 digest")
	}
	id := uuid.New()
	if UserID(WithUser(context.Background(), id)) != id || UserID(context.Background()) != uuid.Nil {
		t.Fatal("principal context leak")
	}
}
