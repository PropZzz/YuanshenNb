package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrCredentials  = errors.New("invalid credentials")
	ErrRefresh      = errors.New("invalid refresh token")
	ErrTokenReuse   = errors.New("refresh token reuse detected")
	ErrEmailExists  = errors.New("email already exists")
	ErrValidation   = errors.New("invalid user profile")
)

type principalKey struct{}

func WithUser(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, principalKey{}, id)
}
func UserID(ctx context.Context) uuid.UUID { id, _ := ctx.Value(principalKey{}).(uuid.UUID); return id }

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}
func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=1" {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != 16 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) != 32 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
	return subtle.ConstantTimeCompare(got, want) == 1
}
func RandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func TokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

type claims struct {
	Subject string `json:"sub"`
	Expires int64  `json:"exp"`
}

func SignAccessToken(id uuid.UUID, secret string, now time.Time, ttl time.Duration) (string, error) {
	raw, err := json.Marshal(claims{id.String(), now.Add(ttl).Unix()})
	if err != nil {
		return "", err
	}
	unsigned := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func VerifyAccessToken(token, secret string, now time.Time) (uuid.UUID, error) {
	p := strings.Split(token, ".")
	if len(p) != 3 || p[0] != "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" {
		return uuid.Nil, ErrUnauthorized
	}
	sig, err := base64.RawURLEncoding.DecodeString(p[2])
	if err != nil {
		return uuid.Nil, ErrUnauthorized
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(p[0] + "." + p[1]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return uuid.Nil, ErrUnauthorized
	}
	raw, err := base64.RawURLEncoding.DecodeString(p[1])
	if err != nil {
		return uuid.Nil, ErrUnauthorized
	}
	var c claims
	if json.Unmarshal(raw, &c) != nil || now.Unix() >= c.Expires {
		return uuid.Nil, ErrUnauthorized
	}
	id, err := uuid.Parse(c.Subject)
	if err != nil || id == uuid.Nil {
		return uuid.Nil, ErrUnauthorized
	}
	return id, nil
}
