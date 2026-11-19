// Package apiadapter translates the fixed HTTP contracts into domain services.
package apiadapter

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/auth"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/realtime"
)

type Auth struct {
	service  *auth.Service
	hub      *realtime.Hub
	cfg      config.Config
	OnChange func(context.Context, uuid.UUID)
}

func NewAuth(service *auth.Service, hub *realtime.Hub, cfg config.Config) *Auth {
	return &Auth{service: service, hub: hub, cfg: cfg}
}
func (a *Auth) Middleware(ctx huma.Context, next func(huma.Context)) {
	parts := strings.Fields(ctx.Header("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		reject(ctx)
		return
	}
	id, err := auth.VerifyAccessToken(parts[1], a.cfg.JWTSecret, time.Now())
	if err != nil {
		reject(ctx)
		return
	}
	next(huma.WithContext(ctx, auth.WithUser(ctx.Context(), id)))
}
func reject(ctx huma.Context) {
	ctx.SetHeader("Content-Type", "application/problem+json")
	ctx.SetHeader("WWW-Authenticate", "Bearer")
	ctx.SetStatus(401)
	json.NewEncoder(ctx.BodyWriter()).Encode(api.NewProblem(401, api.ErrUnauthorized, "valid bearer token required"))
}
func problem(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, auth.ErrCredentials):
		return api.NewProblem(401, api.ErrInvalidCredentials, "email or password is incorrect")
	case errors.Is(err, auth.ErrUnauthorized):
		return api.NewProblem(401, api.ErrUnauthorized, "session is not valid")
	case errors.Is(err, auth.ErrRefresh):
		return api.NewProblem(401, api.ErrInvalidRefreshToken, "refresh token is not valid")
	case errors.Is(err, auth.ErrTokenReuse):
		return api.NewProblem(401, api.ErrTokenReuseDetected, "refresh token reuse revoked this session family")
	case errors.Is(err, auth.ErrEmailExists):
		return api.NewProblem(409, api.ErrEmailAlreadyExists, "email is already registered")
	case errors.Is(err, auth.ErrValidation):
		return api.NewProblem(422, api.ErrValidationFailed, "profile fields are invalid")
	}
	var p *api.ProblemDetail
	if errors.As(err, &p) {
		return p
	}
	slog.Error("request failed", "error", err)
	return api.NewProblem(500, api.ErrInternalServer, "request could not be completed")
}
func userDTO(u auth.User) api.UserProfile {
	return api.UserProfile{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Timezone: u.Timezone, ThemeMode: api.ThemeMode(u.ThemeMode), CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
}
func (a *Auth) tokens(t auth.Tokens, status int) *api.AuthTokensOutput {
	return &api.AuthTokensOutput{Status: status, SetCookie: []string{(&http.Cookie{Name: "rc_refresh_token", Value: t.RefreshToken, Path: "/api/v1/auth", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(a.cfg.RefreshTokenTTL.Seconds())}).String()}, Body: api.AuthTokensResponse{AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, ExpiresInSeconds: t.ExpiresInSeconds, User: userDTO(t.User)}}
}
func (a *Auth) RegisterUser(ctx context.Context, in *api.RegisterInput) (*api.AuthTokensOutput, error) {
	b := in.Body
	t, e := a.service.Register(ctx, b.Email, b.DisplayName, b.Password, b.Timezone, b.DeviceName)
	if e != nil {
		return nil, problem(e)
	}
	return a.tokens(t, 201), nil
}
func (a *Auth) LoginUser(ctx context.Context, in *api.LoginInput) (*api.AuthTokensOutput, error) {
	b := in.Body
	t, e := a.service.Login(ctx, b.Email, b.Password, b.DeviceName)
	if e != nil {
		return nil, problem(e)
	}
	return a.tokens(t, 200), nil
}
func (a *Auth) RefreshTokens(ctx context.Context, in *api.RefreshInput) (*api.AuthTokensOutput, error) {
	token, device := in.RefreshCookie, ""
	if in.Body != nil {
		if in.Body.RefreshToken != "" {
			token = in.Body.RefreshToken
		}
		device = in.Body.DeviceName
	}
	t, e := a.service.Refresh(ctx, token, device)
	if e != nil {
		return nil, problem(e)
	}
	return a.tokens(t, 200), nil
}
func (a *Auth) LogoutUser(ctx context.Context, in *api.LogoutInput) (*api.LogoutOutput, error) {
	token := in.RefreshCookie
	if in.Body != nil && in.Body.RefreshToken != "" {
		token = in.Body.RefreshToken
	}
	if e := a.service.Logout(ctx, auth.UserID(ctx), token); e != nil {
		return nil, problem(e)
	}
	return &api.LogoutOutput{Status: 204, SetCookie: []string{(&http.Cookie{Name: "rc_refresh_token", Path: "/api/v1/auth", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)}).String()}}, nil
}
func (a *Auth) GetCurrentUser(ctx context.Context, _ *struct{}) (*api.UserProfileOutput, error) {
	u, e := a.service.Me(ctx, auth.UserID(ctx))
	if e != nil {
		return nil, problem(e)
	}
	return &api.UserProfileOutput{Body: userDTO(u)}, nil
}
func (a *Auth) UpdateCurrentUser(ctx context.Context, in *api.UpdateMeInput) (*api.UserProfileOutput, error) {
	var theme *string
	if in.Body.ThemeMode != nil {
		v := string(*in.Body.ThemeMode)
		theme = &v
	}
	u, e := a.service.Update(ctx, auth.UserID(ctx), in.Body.DisplayName, in.Body.Timezone, theme)
	if e != nil {
		return nil, problem(e)
	}
	if a.OnChange != nil {
		a.OnChange(ctx, u.ID)
	}
	return &api.UserProfileOutput{Body: userDTO(u)}, nil
}
func (a *Auth) IssueWsTicket(ctx context.Context, _ *struct{}) (*api.WsTicketOutput, error) {
	ticket, expires, e := a.hub.Issue(ctx, auth.UserID(ctx))
	if e != nil {
		return nil, problem(e)
	}
	return &api.WsTicketOutput{Body: api.WsTicketResponse{Ticket: ticket, ExpiresAt: expires}}, nil
}
