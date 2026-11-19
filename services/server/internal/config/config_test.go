package config_test

import (
	"reflect"
	"testing"
	"time"

	"github.com/shixu-app/server/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("SERVER_ADDR", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	t.Setenv("ACCESS_TOKEN_TTL", "")
	t.Setenv("REFRESH_TOKEN_TTL", "")
	t.Setenv("WS_TICKET_TTL", "")
	t.Setenv("MAX_REQUEST_BODY_BYTES", "")

	cfg := config.Load()
	if cfg.AppEnv != "development" {
		t.Fatalf("expected default AppEnv development, got %q", cfg.AppEnv)
	}
	if cfg.Addr != ":8080" {
		t.Fatalf("expected default Addr :8080, got %q", cfg.Addr)
	}
	if cfg.CookieSecure {
		t.Fatalf("expected default CookieSecure false")
	}
	if cfg.AccessTokenTTL != 15*time.Minute {
		t.Fatalf("expected default AccessTokenTTL 15m, got %v", cfg.AccessTokenTTL)
	}
	if cfg.RefreshTokenTTL != 14*24*time.Hour {
		t.Fatalf("expected default RefreshTokenTTL 336h, got %v", cfg.RefreshTokenTTL)
	}
	if cfg.WSTicketTTL != 30*time.Second {
		t.Fatalf("expected default WSTicketTTL 30s, got %v", cfg.WSTicketTTL)
	}
	if cfg.MaxRequestBodyBytes != 2<<20 {
		t.Fatalf("expected default MaxRequestBodyBytes 2MiB, got %d", cfg.MaxRequestBodyBytes)
	}
	wantOrigins := []string{"http://localhost:5173"}
	if !reflect.DeepEqual(cfg.CORSAllowedOrigins, wantOrigins) {
		t.Fatalf("expected origins %v, got %v", wantOrigins, cfg.CORSAllowedOrigins)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected development defaults to validate cleanly, got %v", err)
	}
}

func TestLoad_OverridesAndValidation(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("SERVER_ADDR", ":9090")
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/app")
	t.Setenv("JWT_SECRET", "super-secret-value-for-testing-123456")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("CORS_ALLOWED_ORIGINS", " http://localhost:5173 , https://app.shixu.app ")
	t.Setenv("ACCESS_TOKEN_TTL", "10m")
	t.Setenv("REFRESH_TOKEN_TTL", "72h")
	t.Setenv("WS_TICKET_TTL", "45s")
	t.Setenv("MAX_REQUEST_BODY_BYTES", "1048576")

	cfg := config.Load()
	if cfg.Addr != ":9090" {
		t.Fatalf("expected Addr :9090, got %q", cfg.Addr)
	}
	if cfg.DatabaseURL != "postgres://u:p@db:5432/app" {
		t.Fatalf("unexpected DatabaseURL %q", cfg.DatabaseURL)
	}
	if !cfg.CookieSecure {
		t.Fatalf("expected CookieSecure true")
	}
	if cfg.AccessTokenTTL != 10*time.Minute || cfg.RefreshTokenTTL != 72*time.Hour || cfg.WSTicketTTL != 45*time.Second {
		t.Fatalf("unexpected TTL overrides: %+v", cfg)
	}
	if cfg.MaxRequestBodyBytes != 1048576 {
		t.Fatalf("expected MaxRequestBodyBytes 1048576, got %d", cfg.MaxRequestBodyBytes)
	}
	wantOrigins := []string{"http://localhost:5173", "https://app.shixu.app"}
	if !reflect.DeepEqual(cfg.CORSAllowedOrigins, wantOrigins) {
		t.Fatalf("expected origins %v, got %v", wantOrigins, cfg.CORSAllowedOrigins)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid production config, got %v", err)
	}
}

func TestValidate_ProductionRejectsWeakSecret(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "")

	cfg := config.Load()
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected Validate to reject default JWT_SECRET in production")
	}

	cfg.JWTSecret = "too-short"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected Validate to reject short JWT_SECRET in production")
	}
}
