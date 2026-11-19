package config_test

import (
	"reflect"
	"testing"

	"github.com/shixu-app/server/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("SERVER_ADDR", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	cfg := config.Load()
	if cfg.Addr != ":8080" {
		t.Fatalf("expected default Addr :8080, got %q", cfg.Addr)
	}
	if cfg.CookieSecure {
		t.Fatalf("expected default CookieSecure false")
	}
	wantOrigins := []string{"http://localhost:5173"}
	if !reflect.DeepEqual(cfg.CORSAllowedOrigins, wantOrigins) {
		t.Fatalf("expected origins %v, got %v", wantOrigins, cfg.CORSAllowedOrigins)
	}
}

func TestLoad_Overrides(t *testing.T) {
	t.Setenv("SERVER_ADDR", ":9090")
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/app")
	t.Setenv("JWT_SECRET", "super-secret-value-for-testing-123456")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("CORS_ALLOWED_ORIGINS", " http://localhost:5173 , https://app.shixu.app ")

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
	wantOrigins := []string{"http://localhost:5173", "https://app.shixu.app"}
	if !reflect.DeepEqual(cfg.CORSAllowedOrigins, wantOrigins) {
		t.Fatalf("expected origins %v, got %v", wantOrigins, cfg.CORSAllowedOrigins)
	}
}
