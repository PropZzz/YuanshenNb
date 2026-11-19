// Package config 负责加载并校验服务端环境变量与运行配置。
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAppEnv              = "development"
	defaultAddr                = ":8080"
	defaultDatabaseURL         = "postgres://shixu:shixu_dev_password@127.0.0.1:5432/shixu_v2?sslmode=disable"
	defaultJWTSecret           = "change-me-dev-secret-at-least-32-bytes"
	defaultAccessTokenTTL      = 15 * time.Minute
	defaultRefreshTokenTTL     = 14 * 24 * time.Hour
	defaultWSTicketTTL         = 30 * time.Second
	defaultMaxRequestBodyBytes = int64(2 << 20) // 2 MiB
)

type Config struct {
	AppEnv              string
	Addr                string
	DatabaseURL         string
	JWTSecret           string
	CookieSecure        bool
	CORSAllowedOrigins  []string
	AccessTokenTTL      time.Duration
	RefreshTokenTTL     time.Duration
	WSTicketTTL         time.Duration
	MaxRequestBodyBytes int64
}

// Load 从进程环境变量加载配置，缺失项回退到开发环境安全默认值。
func Load() Config {
	appEnv := strings.TrimSpace(os.Getenv("APP_ENV"))
	if appEnv == "" {
		appEnv = defaultAppEnv
	}

	addr := strings.TrimSpace(os.Getenv("SERVER_ADDR"))
	if addr == "" {
		addr = defaultAddr
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		dbURL = defaultDatabaseURL
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwtSecret == "" {
		jwtSecret = defaultJWTSecret
	}

	cookieSecure := false
	if raw := strings.TrimSpace(os.Getenv("COOKIE_SECURE")); raw != "" {
		if parsed, err := strconv.ParseBool(raw); err == nil {
			cookieSecure = parsed
		}
	}

	origins := parseCSV(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if len(origins) == 0 {
		origins = []string{"http://localhost:5173"}
	}

	return Config{
		AppEnv:              appEnv,
		Addr:                addr,
		DatabaseURL:         dbURL,
		JWTSecret:           jwtSecret,
		CookieSecure:        cookieSecure,
		CORSAllowedOrigins:  origins,
		AccessTokenTTL:      parseDurationEnv("ACCESS_TOKEN_TTL", defaultAccessTokenTTL),
		RefreshTokenTTL:     parseDurationEnv("REFRESH_TOKEN_TTL", defaultRefreshTokenTTL),
		WSTicketTTL:         parseDurationEnv("WS_TICKET_TTL", defaultWSTicketTTL),
		MaxRequestBodyBytes: parseInt64Env("MAX_REQUEST_BODY_BYTES", defaultMaxRequestBodyBytes),
	}
}

// Validate 校验运行配置安全性与合法性；生产环境强制要求非默认且长度足够的 JWT_SECRET。
func (c Config) Validate() error {
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return errors.New("DATABASE_URL must not be empty")
	}
	if c.AccessTokenTTL <= 0 {
		return fmt.Errorf("ACCESS_TOKEN_TTL must be positive, got %v", c.AccessTokenTTL)
	}
	if c.RefreshTokenTTL <= 0 {
		return fmt.Errorf("REFRESH_TOKEN_TTL must be positive, got %v", c.RefreshTokenTTL)
	}
	if c.WSTicketTTL <= 0 {
		return fmt.Errorf("WS_TICKET_TTL must be positive, got %v", c.WSTicketTTL)
	}
	if c.MaxRequestBodyBytes <= 0 {
		return fmt.Errorf("MAX_REQUEST_BODY_BYTES must be positive, got %d", c.MaxRequestBodyBytes)
	}
	if strings.EqualFold(c.AppEnv, "production") {
		if c.JWTSecret == defaultJWTSecret {
			return errors.New("JWT_SECRET must be overridden from development default in production")
		}
		if len(c.JWTSecret) < 32 {
			return fmt.Errorf("JWT_SECRET must be at least 32 bytes in production, got %d", len(c.JWTSecret))
		}
	}
	return nil
}

func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}

func parseInt64Env(key string, fallback int64) int64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return v
}

func parseCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
