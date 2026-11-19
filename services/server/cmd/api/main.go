package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"slices"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/db"
)

const apiVersion = "2.0.0"

// HealthPinger 抽象数据库连通探针，便于单元测试替身注入。
type HealthPinger interface {
	Ping(ctx context.Context) error
}

// NewRouter 构建主服务 HTTP 路由与中间件。
func NewRouter(cfg config.Config, pinger HealthPinger) http.Handler {
	r := chi.NewRouter()
	r.Use(corsMiddleware(cfg.CORSAllowedOrigins))

	humaCfg := huma.DefaultConfig("时序智配 (Temporal Intelligence Scheduler) V2 API", apiVersion)
	humaAPI := humachi.New(r, humaCfg)
	api.ConfigureHumaErrors()

	huma.Register(humaAPI, huma.Operation{
		OperationID: "getHealth",
		Method:      http.MethodGet,
		Path:        "/api/v1/health",
		Summary:     "数据库与服务连通性探针",
		Tags:        []string{"System"},
		Errors:      []int{http.StatusServiceUnavailable},
	}, func(ctx context.Context, _ *struct{}) (*api.HealthOutput, error) {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()

		dbUp := pinger != nil && pinger.Ping(pingCtx) == nil
		status := http.StatusOK
		dbStatus := "up"
		if !dbUp {
			status = http.StatusServiceUnavailable
			dbStatus = "down"
		}
		return &api.HealthOutput{
			Status: status,
			Body: api.HealthResponse{
				OK:         dbUp,
				Version:    apiVersion,
				DBStatus:   dbStatus,
				ServerTime: time.Now().UTC(),
			},
		}, nil
	})

	// P1 按模块实现业务 Handler 后通过 api.RegisterContractRoutes(humaAPI, handlers) 统一接入

	return r
}

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && slices.Contains(allowedOrigins, origin) {
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
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

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database startup failed: %v", err)
	}
	defer pool.Close()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           NewRouter(cfg, pool),
		ReadHeaderTimeout: 10 * time.Second,
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
