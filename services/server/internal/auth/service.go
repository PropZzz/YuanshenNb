package auth

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID                                      uuid.UUID
	Email, DisplayName, Timezone, ThemeMode string
	CreatedAt, UpdatedAt                    time.Time
}
type Tokens struct {
	AccessToken, RefreshToken string
	ExpiresInSeconds          int
	User                      User
}
type Service struct {
	pool                  *pgxpool.Pool
	secret                string
	accessTTL, refreshTTL time.Duration
}

func NewService(pool *pgxpool.Pool, secret string, accessTTL, refreshTTL time.Duration) *Service {
	return &Service{pool, secret, accessTTL, refreshTTL}
}

const userColumns = "id,email,display_name,timezone,theme_mode,created_at,updated_at"

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Timezone, &u.ThemeMode, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}
func (s *Service) Register(ctx context.Context, email, name, password, zone, device string) (Tokens, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if zone == "" {
		zone = "Asia/Shanghai"
	}
	address, e := mail.ParseAddress(email)
	if e != nil || address.Address != email || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 64 || utf8.RuneCountInString(password) < 8 || utf8.RuneCountInString(password) > 128 {
		return Tokens{}, ErrValidation
	}
	if _, e = time.LoadLocation(zone); e != nil {
		return Tokens{}, ErrValidation
	}
	hash, e := HashPassword(password)
	if e != nil {
		return Tokens{}, e
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return Tokens{}, e
	}
	defer tx.Rollback(ctx)
	user, e := scanUser(tx.QueryRow(ctx, "INSERT INTO users(email,display_name,password_hash,timezone) VALUES($1,$2,$3,$4) RETURNING "+userColumns, email, name, hash, zone))
	if e != nil {
		var pe *pgconn.PgError
		if errors.As(e, &pe) && pe.Code == "23505" {
			return Tokens{}, ErrEmailExists
		}
		return Tokens{}, e
	}
	if _, e = tx.Exec(ctx, "INSERT INTO energy_profiles(user_id) VALUES($1)", user.ID); e != nil {
		return Tokens{}, e
	}
	out, e := s.issue(ctx, tx, user, uuid.New(), device)
	if e != nil {
		return Tokens{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Tokens{}, e
	}
	return out, nil
}
func (s *Service) Login(ctx context.Context, email, password, device string) (Tokens, error) {
	var hash string
	var id uuid.UUID
	e := s.pool.QueryRow(ctx, "SELECT id,password_hash FROM users WHERE email=$1", strings.ToLower(strings.TrimSpace(email))).Scan(&id, &hash)
	if errors.Is(e, pgx.ErrNoRows) {
		return Tokens{}, ErrCredentials
	}
	if e != nil {
		return Tokens{}, e
	}
	if !VerifyPassword(hash, password) {
		return Tokens{}, ErrCredentials
	}
	user, e := s.Me(ctx, id)
	if e != nil {
		return Tokens{}, e
	}
	return s.issue(ctx, s.pool, user, uuid.New(), device)
}

type executor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (s *Service) issue(ctx context.Context, q executor, user User, family uuid.UUID, device string) (Tokens, error) {
	refresh, e := RandomToken()
	if e != nil {
		return Tokens{}, e
	}
	now := time.Now().UTC()
	_, e = q.Exec(ctx, "INSERT INTO refresh_tokens(user_id,family_id,token_hash,device_name,expires_at) VALUES($1,$2,$3,$4,$5)", user.ID, family, TokenHash(refresh), device, now.Add(s.refreshTTL))
	if e != nil {
		return Tokens{}, e
	}
	access, e := SignAccessToken(user.ID, s.secret, now, s.accessTTL)
	return Tokens{access, refresh, int(s.accessTTL.Seconds()), user}, e
}
func (s *Service) Refresh(ctx context.Context, token, device string) (Tokens, error) {
	if token == "" {
		return Tokens{}, ErrRefresh
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return Tokens{}, e
	}
	defer tx.Rollback(ctx)
	// Lock the user before the token so simultaneous rotations and family revocation serialize.
	var id, family uuid.UUID
	var expires time.Time
	var revoked *time.Time
	e = tx.QueryRow(ctx, "SELECT user_id FROM refresh_tokens WHERE token_hash=$1", TokenHash(token)).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		return Tokens{}, ErrRefresh
	}
	if e != nil {
		return Tokens{}, e
	}
	if _, e = tx.Exec(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", id); e != nil {
		return Tokens{}, e
	}
	e = tx.QueryRow(ctx, "SELECT family_id,expires_at,revoked_at FROM refresh_tokens WHERE token_hash=$1 AND user_id=$2 FOR UPDATE", TokenHash(token), id).Scan(&family, &expires, &revoked)
	if errors.Is(e, pgx.ErrNoRows) {
		return Tokens{}, ErrRefresh
	}
	if e != nil {
		return Tokens{}, e
	}
	if revoked != nil {
		if _, e = tx.Exec(ctx, "UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE family_id=$1 AND user_id=$2", family, id); e != nil {
			return Tokens{}, e
		}
		if e = tx.Commit(ctx); e != nil {
			return Tokens{}, e
		}
		return Tokens{}, ErrTokenReuse
	}
	if !time.Now().Before(expires) {
		return Tokens{}, ErrRefresh
	}
	if _, e = tx.Exec(ctx, "UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND user_id=$2", TokenHash(token), id); e != nil {
		return Tokens{}, e
	}
	user, e := scanUser(tx.QueryRow(ctx, "SELECT "+userColumns+" FROM users WHERE id=$1", id))
	if e != nil {
		return Tokens{}, e
	}
	out, e := s.issue(ctx, tx, user, family, device)
	if e != nil {
		return Tokens{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Tokens{}, e
	}
	return out, nil
}
func (s *Service) Logout(ctx context.Context, id uuid.UUID, token string) error {
	_, err := s.pool.Exec(ctx, "UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1 AND token_hash=$2", id, TokenHash(token))
	return err
}
func (s *Service) Me(ctx context.Context, id uuid.UUID) (User, error) {
	u, e := scanUser(s.pool.QueryRow(ctx, "SELECT "+userColumns+" FROM users WHERE id=$1", id))
	if errors.Is(e, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	return u, e
}
func (s *Service) Update(ctx context.Context, id uuid.UUID, name, zone, theme *string) (User, error) {
	if name != nil {
		v := strings.TrimSpace(*name)
		if utf8.RuneCountInString(v) < 1 || utf8.RuneCountInString(v) > 64 {
			return User{}, ErrValidation
		}
		name = &v
	}
	if zone != nil {
		if _, e := time.LoadLocation(*zone); e != nil {
			return User{}, ErrValidation
		}
	}
	if theme != nil && *theme != "system" && *theme != "light" && *theme != "dark" {
		return User{}, ErrValidation
	}
	return scanUser(s.pool.QueryRow(ctx, "UPDATE users SET display_name=COALESCE($2,display_name),timezone=COALESCE($3,timezone),theme_mode=COALESCE($4,theme_mode) WHERE id=$1 RETURNING "+userColumns, id, name, zone, theme))
}
