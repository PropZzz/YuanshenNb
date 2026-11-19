package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os/signal"
	"slices"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/db"
)

const apiVersion = "2.0.0"

// HealthPinger 抽象数据库连通探针，便于单元测试替身注入。
type HealthPinger interface {
	Ping(ctx context.Context) error
}

// RouterDeps 聚合主服务路由装配所需依赖，支持按模块渐进接入业务处理器。
type RouterDeps struct {
	Pinger         HealthPinger
	Handlers       api.RouteHandlers
	AuthMiddleware func(ctx huma.Context, next func(huma.Context))
	WSHandler      http.Handler
}

type systemHandler struct {
	pinger HealthPinger
}

func (s *systemHandler) GetHealth(ctx context.Context, _ *struct{}) (*api.HealthOutput, error) {
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if s.pinger == nil || s.pinger.Ping(pingCtx) != nil {
		return nil, api.NewProblem(http.StatusServiceUnavailable, api.ErrServiceUnavailable, "database unavailable")
	}
	return &api.HealthOutput{
		Status: http.StatusOK,
		Body: api.HealthResponse{
			OK:         true,
			Version:    apiVersion,
			DBStatus:   api.DBStatusUp,
			ServerTime: time.Now().UTC(),
		},
	}, nil
}

// NewRouter 构建主服务 HTTP 路由与中间件。
func NewRouter(cfg config.Config, deps RouterDeps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(slogRequestLogger)
	r.Use(corsMiddleware(cfg.CORSAllowedOrigins))
	r.Use(maxBodyMiddleware(cfg.MaxRequestBodyBytes))

	humaCfg := api.NewHumaConfig(apiVersion)
	humaAPI := humachi.New(r, humaCfg)

	handlers := deps.Handlers
	if handlers.System == nil {
		handlers.System = &systemHandler{pinger: deps.Pinger}
	}

	api.RegisterContractRoutes(humaAPI, handlers, api.RouteOptions{
		AuthMiddleware:          deps.AuthMiddleware,
		AllowUnimplementedStubs: false,
	})
	api.RegisterExtraSchemas(humaAPI.OpenAPI())

	if deps.WSHandler != nil {
		r.Handle("/api/v1/ws", deps.WSHandler)
	}

	return r
}

func slogRequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.Debug(
			"http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"durationMs", time.Since(start).Milliseconds(),
			"requestId", middleware.GetReqID(r.Context()),
		)
	})
}

func maxBodyMiddleware(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if limit <= 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !slices.Contains(w.Header().Values("Vary"), "Origin") {
				w.Header().Add("Vary", "Origin")
			}
			origin := r.Header.Get("Origin")
			if origin != "" && slices.Contains(allowedOrigins, origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Max-Age", "600")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid configuration: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database startup failed: %v", err)
	}
	store := db.NewPGXStore(pool)
	defer store.Close()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           NewRouter(cfg, newRuntimeDeps(cfg, pool)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("shixu server listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen and serve: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
}
