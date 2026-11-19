// Package config 负责加载服务端环境变量与运行配置。
package config

import (
	"os"
	"strconv"
	"strings"
)

const (
	defaultAddr        = ":8080"
	defaultDatabaseURL = "postgres://shixu:shixu_dev_password@127.0.0.1:5432/shixu_v2?sslmode=disable"
	defaultJWTSecret   = "change-me-dev-secret-at-least-32-bytes"
)

type Config struct {
	Addr               string
	DatabaseURL        string
	JWTSecret          string
	CookieSecure       bool
	CORSAllowedOrigins []string
}

// Load 从进程环境变量加载配置，缺失项回退到开发环境安全默认值。
func Load() Config {
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
		Addr:               addr,
		DatabaseURL:        dbURL,
		JWTSecret:          jwtSecret,
		CookieSecure:       cookieSecure,
		CORSAllowedOrigins: origins,
	}
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
